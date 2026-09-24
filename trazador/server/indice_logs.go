package main

// indice_logs.go — el MAPA de mensajes de log → archivo que los emite, construido desde el código.
//
// QUÉ RESUELVE. Una traza son decenas de líneas y la pregunta es «¿qué archivos corrieron?». Resolverlas
// de a una con `git grep` no escala; acá el mapa se construye UNA vez leyendo el código de los repos, y
// después cada traza se resuelve en memoria (`archivos.go`), y `-chequeo` cruza los matchers del mapa de
// etapas contra lo que el código de verdad emite (`chequeo.go`).
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

// rutaIndiceLogs es donde se escribe el índice: en la raíz del trazador, fuera de git (se deriva del
// código, así que no se versiona: se reconstruye).
const rutaIndiceLogs = "../logs.json"

// patronesLog: las familias que usa CreditOp, medidas. `tracer->log(nivel, MENSAJE, ctx)` (1.054 en
// legacy-backend) y el `Log::` de Laravel, donde el mensaje es el PRIMER argumento (~170). Se acepta
// comilla simple o doble; en PHP la simple no interpola, así que el literal es exacto.
var patronesLog = []*regexp.Regexp{
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

// prefiltroLog es lo que se le pide a `git grep`. ⚠ Con `-i`: el prefiltro case-SENSITIVE era MÁS
// ESTRICTO que los patrones (que ignoran mayúsculas) y tiraba líneas antes de que nadie las mirara —
// `$obsTracer->log(` no entraba por la T mayúscula, y con eso se perdían cientos de mensajes. ⚠ Y con
// `-e` antes: el patrón empieza con `-` (`->log(`) y sin `-e` git lo toma como una bandera.
const prefiltroLog = `->log\(|Log::|logger\(\)->|logger\.|slog\.`

// demasiadosArchivos: un mensaje que aparece en más archivos que esto no identifica nada.
const demasiadosArchivos = 6

// normalizarLiteral es la forma con la que se compara, la MISMA que `normalizarMsg` usa al resolver.
func normalizarLiteral(m string) string {
	return strings.TrimRight(strings.Join(strings.FieldsFunc(m, text.IsSpace), " "), " :.-,")
}

// hashRuta: identificador corto y estable de una ruta (sha1, 7 caracteres, en mayúsculas). Medido sobre
// los 5.123 archivos de los 12 repos: con 6 hay una colisión, con 7 ninguna.
func hashRuta(ruta string) string {
	sum := sha1.Sum([]byte(ruta))
	return strings.ToUpper(hex.EncodeToString(sum[:]))[:7]
}

type entradaIndice struct {
	ruta, linea string
	esTest      bool
}

/* construirIndiceLogs recorre la ref de cada repo y saca todos los mensajes de log con su archivo.
 *
 * ⚠ ACTUALIZA LAS REFS REMOTAS ANTES DE RECORRER, y no es una comodidad. Hasta el 2026-09-18 esto indexaba
 * el `main` LOCAL de cada clon, que nadie actualiza: medido ese día, cinco de los diez repos estaban detrás
 * (hasta 22 commits), así que el índice describía un código de días atrás. Y no falla: devuelve MENOS
 * mensajes, y «menos» se lee igual que «no existe». Qué ref se recorre lo decide `repos.RefToIndex`: la
 * que CONTIENE a la otra. */
func construirIndiceLogs(fetch bool) int {
	cl := repos.Find()
	if fetch {
		if fallaron := cl.RefreshRemotes(30 * time.Second); len(fallaron) > 0 {
			fmt.Printf("  ⚠ no se pudo actualizar: %s — se usa lo que hay en disco\n", strings.Join(fallaron, ", "))
		} else {
			fmt.Println("  refs remotas actualizadas")
		}
	} else {
		fmt.Println("  ⚠ sin actualizar refs (-sin-fetch): se indexa lo que hay en disco")
	}
	claves, indice := indexarRepos(cl)
	var b strings.Builder
	escribirIndice(&b, claves, indice)
	if err := os.WriteFile(rutaIndiceLogs, []byte(b.String()), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "  ✘ no pude escribir %s: %v\n", rutaIndiceLogs, err)
		return 1
	}
	ambiguos := 0
	for _, v := range indice {
		if len(v) > demasiadosArchivos {
			ambiguos++
		}
	}
	abs, _ := filepath.Abs(rutaIndiceLogs)
	fmt.Printf("\n  %d mensajes distintos · %d KB · %d aparecen en más de %d archivos (no identifican)\n  → %s\n",
		len(claves), b.Len()/1024, ambiguos, demasiadosArchivos, abs)
	return 0
}

// indexarRepos recorre los repos en el orden de la lista y devuelve las claves en el orden en que
// aparecieron, con sus archivos.
func indexarRepos(cl *repos.Client) ([]string, map[string][]entradaIndice) {
	var claves []string
	indice := map[string][]entradaIndice{}
	for _, alias := range cl.IndexedOrder() {
		root := cl.Indexed()[alias]
		ref, motivo := cl.RefToIndex(root)
		if ref == "" {
			fmt.Fprintf(os.Stderr, "  ⚠ %s: %s — queda FUERA del índice\n", alias, motivo)
			continue
		}
		cmd := exec.Command("git", "-C", root, "grep", "-n", "--no-color", "-I", "-i", "-E", "-e", prefiltroLog, ref)
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
		for _, linea := range text.SplitLines(string(out)) {
			sin := strings.Replace(linea, ref+":", "", 1)
			ruta, resto, _ := strings.Cut(sin, ":")
			num, texto, _ := strings.Cut(resto, ":")
			if strings.Contains(ruta, "/vendor/") || strings.Contains(ruta, "/node_modules/") {
				continue
			}
			for _, rx := range patronesLog {
				for _, m := range rx.FindAllStringSubmatch(texto, -1) {
					k := normalizarLiteral(m[1])
					if utf8.RuneCountInString(k) < 12 {
						continue
					}
					if _, ok := indice[k]; !ok {
						claves = append(claves, k)
					}
					indice[k] = append(indice[k], entradaIndice{alias + "/" + ruta, num, strings.Contains(strings.ToLower(ruta), "test")})
					n++
				}
			}
		}
		if n > 0 {
			fmt.Printf("  %-24s %5d mensajes   %s (%s)\n", alias, n, ref, motivo)
		}
	}
	return claves, indice
}

// escribirIndice escribe el JSON con la misma forma que el de Python (`indent=1`, sin escapar lo que no
// es ASCII y con las claves en el orden en que aparecieron), para que una versión se pueda comparar
// contra la otra byte a byte.
func escribirIndice(b *strings.Builder, claves []string, indice map[string][]entradaIndice) {
	if len(claves) == 0 {
		b.WriteString("{}")
		return
	}
	b.WriteString("{\n")
	for i, k := range claves {
		b.WriteString(" ")
		cadenaJSON(b, k)
		b.WriteString(": [\n")
		for j, e := range indice[k] {
			b.WriteString("  {\n   \"ruta\": ")
			cadenaJSON(b, e.ruta)
			b.WriteString(",\n   \"linea\": ")
			cadenaJSON(b, e.linea)
			fmt.Fprintf(b, ",\n   \"es_test\": %t,\n   \"h\": ", e.esTest)
			cadenaJSON(b, hashRuta(e.ruta))
			b.WriteString("\n  }")
			if j < len(indice[k])-1 {
				b.WriteString(",")
			}
			b.WriteString("\n")
		}
		b.WriteString(" ]")
		if i < len(claves)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
	b.WriteString("}")
}

// cadenaJSON escapa como `json.dumps(ensure_ascii=False)`: sólo la comilla, la barra y los de control.
func cadenaJSON(b *strings.Builder, s string) {
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
