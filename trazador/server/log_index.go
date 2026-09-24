package main

// log_index.go — el MAPA de mensajes de log → archivo que los emite, construido desde el código.
//
// QUÉ RESUELVE. Una traza son decenas de líneas y la pregunta es «¿qué archivos corrieron?». Resolverlas
// de a una con `git grep` no escala; acá el mapa se construye UNA vez leyendo el código de los repos, y
// después cada traza se resuelve en memoria (`trace_files.go`), y `-chequeo` cruza los matchers del mapa de
// etapas contra lo que el código de verdad emite (`check.go`).
//
// Lo construía Python (`workers/logs.py`) hasta el 2026-09-24; al retirarse workers se portó acá, que
// es su único lector, comparando el JSON byte a byte contra el de Python.
//
// ⚠ POR QUÉ LA LLAVE ES EL MENSAJE Y NO UN HASH QUE VENGA EN EL LOG. Porque no viene: medido en prod, el
// campo `extra_file` aparece en ~5% de las líneas y apunta a `vendor/laravel/framework` — el logger
// registrando su propia línea, no la de quien llamó. El mensaje, en cambio, es un literal del código.
//
// ⚠ Y POR QUÉ SE MATCHEA POR PREFIJO. En el código el mensaje está partido —`'… para entidad ' . $id`— y
// en runtime llega completo: el literal es un PREFIJO de lo que se ve en Loki, nunca al revés.
//
//	go run . -indexar-logs              actualiza las refs remotas, lee los repos y escribe ../logs.json
//	go run . -indexar-logs -sin-fetch   sin red: indexa lo que hay en disco, y lo dice

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"creditop/playground/connectors/repos"
	"creditop/playground/lib/text"
)

// logIndexPath es donde se escribe el índice: en la raíz del trazador, fuera de git (se deriva del
// código, así que no se versiona: se reconstruye).
const logIndexPath = "../logs.json"

// logPatterns: las familias que usa CreditOp, medidas. `tracer->log(nivel, MENSAJE, ctx)` (1.054 en
// legacy-backend) y el `Log::` de Laravel, donde el mensaje es el PRIMER argumento (~170). Se acepta
// comilla simple o doble; en PHP la simple no interpola, así que el literal es exacto.
var logPatterns = []*regexp.Regexp{
	// ⚠ NO se ancla en el nombre de la variable, y ésa fue la tercera vez que el mismo error costó
	// cobertura: las formas son cinco —`$this->tracer->`, `$tracer->`, `$this->tracerService->` (190
	// llamadas), `$obsTracer->`, `$this->`— y cada patrón que nombraba una perdía las otras en silencio.
	// Lo estable es la FIRMA: `->log('nivel', 'mensaje'`.
	regexp.MustCompile(`(?i)->\s*log\s*\(\s*['"][a-z]+['"]\s*,\s*['"]([^'"]{12,})['"]`),
	regexp.MustCompile(`(?i)Log\s*::\s*(?:info|error|warning|debug|critical|notice|alert|emergency)\s*\(\s*['"]([^'"]{12,})['"]`),
	regexp.MustCompile(`(?i)logger\s*\(\s*\)\s*->\s*[a-z]+\s*\(\s*['"]([^'"]{12,})['"]`),
	regexp.MustCompile(`(?i)Log\s*::\s*channel\s*\([^)]*\)\s*->\s*[a-z]+\s*\(\s*['"]([^'"]{12,})['"]`),
	// TypeScript/JS y Go, por si el mensaje sale de un microservicio
	regexp.MustCompile("(?:logger|log|console)\\s*\\.\\s*(?:info|error|warn|debug)\\s*\\(\\s*['\"`]([^'\"`]{12,})['\"`]"),
	regexp.MustCompile(`(?:slog|log)\.(?:Info|Error|Warn|Debug)\w*\(\s*"([^"]{12,})`),
}

// logPrefilter es lo que se le pide a `git grep`. ⚠ Con `-i`: el prefiltro case-SENSITIVE era MÁS
// ESTRICTO que los patrones (que ignoran mayúsculas) y tiraba líneas antes de que nadie las mirara —
// `$obsTracer->log(` no entraba por la T mayúscula, y con eso se perdían cientos de mensajes. ⚠ Y con
// `-e` antes: el patrón empieza con `-` (`->log(`) y sin `-e` git lo toma como una bandera.
const logPrefilter = `->log\(|Log::|logger\(\)->|logger\.|slog\.`

// tooManyFiles: un mensaje que aparece en más archivos que esto no identifica nada.
const tooManyFiles = 6

// normalizeLiteral es la forma con la que se compara, la MISMA que `normalizeMessage` usa al resolver.
func normalizeLiteral(m string) string {
	return strings.TrimRight(strings.Join(strings.FieldsFunc(m, text.IsSpace), " "), " :.-,")
}

// pathHash: identificador corto y estable de una ruta (sha1, 7 caracteres, en mayúsculas). Medido sobre
// los 5.123 archivos de los 12 repos: con 6 hay una colisión, con 7 ninguna.
func pathHash(path string) string {
	sum := sha1.Sum([]byte(path))
	return strings.ToUpper(hex.EncodeToString(sum[:]))[:7]
}

type indexEntry struct {
	path, line string
	isTest     bool
}

/* buildLogIndex recorre la ref de cada repo y saca todos los mensajes de log con su archivo.
 *
 * ⚠ ACTUALIZA LAS REFS REMOTAS ANTES DE RECORRER, y no es una comodidad. Hasta el 2026-09-18 esto indexaba
 * el `main` LOCAL de cada clon, que nadie actualiza: medido ese día, cinco de los diez repos estaban detrás
 * (hasta 22 commits), así que el índice describía un código de días atrás. Y no falla: devuelve MENOS
 * mensajes, y «menos» se lee igual que «no existe». Qué ref se recorre lo decide `repos.RefToIndex`: la
 * que CONTIENE a la otra. */
func buildLogIndex(fetch bool) int {
	cl := repos.Find()
	if fetch {
		if failed := cl.RefreshRemotes(30 * time.Second); len(failed) > 0 {
			fmt.Printf("  ⚠ no se pudo actualizar: %s — se usa lo que hay en disco\n", strings.Join(failed, ", "))
		} else {
			fmt.Println("  refs remotas actualizadas")
		}
	} else {
		fmt.Println("  ⚠ sin actualizar refs (-sin-fetch): se indexa lo que hay en disco")
	}
	keys, index := indexRepos(cl)
	var b strings.Builder
	writeIndex(&b, keys, index)
	if err := os.WriteFile(logIndexPath, []byte(b.String()), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "  ✘ no pude escribir %s: %v\n", logIndexPath, err)
		return 1
	}
	ambiguousCount := 0
	for _, v := range index {
		if len(v) > tooManyFiles {
			ambiguousCount++
		}
	}
	abs, _ := filepath.Abs(logIndexPath)
	fmt.Printf("\n  %d mensajes distintos · %d KB · %d aparecen en más de %d archivos (no identifican)\n  → %s\n",
		len(keys), b.Len()/1024, ambiguousCount, tooManyFiles, abs)
	return 0
}

// indexRepos recorre los repos en el orden de la lista y devuelve las claves en el orden en que
// aparecieron, con sus archivos.
func indexRepos(cl *repos.Client) ([]string, map[string][]indexEntry) {
	var keys []string
	index := map[string][]indexEntry{}
	for _, alias := range cl.IndexedOrder() {
		root := cl.Indexed()[alias]
		ref, reason := cl.RefToIndex(root)
		if ref == "" {
			fmt.Fprintf(os.Stderr, "  ⚠ %s: %s — queda FUERA del índice\n", alias, reason)
			continue
		}
		cmd := exec.Command("git", "-C", root, "grep", "-n", "--no-color", "-I", "-i", "-E", "-e", logPrefilter, ref)
		out, err := cmd.Output()
		// ⚠ Un fallo del grep se REPORTA: antes el repo entero quedaba fuera sin aviso, y «0 mensajes» se
		// leía como «este repo no loguea». El 1 de git grep es «no hubo coincidencias», no un error.
		if err != nil {
			if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 1 {
				fmt.Fprintf(os.Stderr, "  ⚠ %s: el grep falló (%v)\n", alias, err)
				continue
			}
		}
		n := 0
		for _, line := range text.SplitLines(string(out)) {
			without := strings.Replace(line, ref+":", "", 1)
			path, rest, _ := strings.Cut(without, ":")
			num, asText, _ := strings.Cut(rest, ":")
			if strings.Contains(path, "/vendor/") || strings.Contains(path, "/node_modules/") {
				continue
			}
			for _, rx := range logPatterns {
				for _, m := range rx.FindAllStringSubmatch(asText, -1) {
					k := normalizeLiteral(m[1])
					if utf8.RuneCountInString(k) < 12 {
						continue
					}
					if _, ok := index[k]; !ok {
						keys = append(keys, k)
					}
					index[k] = append(index[k], indexEntry{alias + "/" + path, num, strings.Contains(strings.ToLower(path), "test")})
					n++
				}
			}
		}
		if n > 0 {
			fmt.Printf("  %-24s %5d mensajes   %s (%s)\n", alias, n, ref, reason)
		}
	}
	return keys, index
}

// writeIndex escribe el JSON con la misma forma que el de Python (`indent=1`, sin escapar lo que no
// es ASCII y con las claves en el orden en que aparecieron), para que una versión se pueda comparar
// contra la otra byte a byte.
func writeIndex(b *strings.Builder, keys []string, index map[string][]indexEntry) {
	if len(keys) == 0 {
		b.WriteString("{}")
		return
	}
	b.WriteString("{\n")
	for i, k := range keys {
		b.WriteString(" ")
		jsonString(b, k)
		b.WriteString(": [\n")
		for j, e := range index[k] {
			b.WriteString("  {\n   \"ruta\": ")
			jsonString(b, e.path)
			b.WriteString(",\n   \"linea\": ")
			jsonString(b, e.line)
			fmt.Fprintf(b, ",\n   \"es_test\": %t,\n   \"h\": ", e.isTest)
			jsonString(b, pathHash(e.path))
			b.WriteString("\n  }")
			if j < len(index[k])-1 {
				b.WriteString(",")
			}
			b.WriteString("\n")
		}
		b.WriteString(" ]")
		if i < len(keys)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
	b.WriteString("}")
}

// jsonString escapa como `json.dumps(ensure_ascii=False)`: sólo la comilla, la barra y los de control.
func jsonString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}
