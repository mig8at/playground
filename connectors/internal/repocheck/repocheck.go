// Package repocheck es la regla «un solo cliente por servicio», cableada: recorre el código del repo
// y devuelve dónde alguien le habla a un servicio por su cuenta, fuera de `connectors/`.
//
// Lo usan las pruebas de cada conector. Hasta el 2026-09-24 cada una traía su copia de este recorrido
// —tres, con diferencias chicas—, que es exactamente la deriva que los conectores vinieron a cerrar.
package repocheck

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// Code son los lenguajes del repo que pueden traer un cliente.
var Code = regexp.MustCompile(`\.(go|ts|mjs|js|py)$`)

var comment = regexp.MustCompile(`^\s*(//|#|\*|/\*)`)

// Root es la raíz del repo, según git.
func Root(t testing.TB) string {
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		t.Fatalf("git rev-parse: %v", err)
	}
	return strings.TrimSpace(string(out))
}

// Offenders devuelve `ruta:línea` de cada línea de CÓDIGO (no comentario) que matchea `client`, fuera de
// `connectors/`. Se saltan las pruebas: un servidor falso que mira la ruta que le piden no es un cliente.
//
// `allowed` son excepciones con NOMBRE y MOTIVO (prefijo de ruta → por qué): una excepción sin motivo
// es una regla que nadie sabe cuándo se levanta. Una excepción que ya no matchea nada hace fallar la
// prueba, para que se borre en vez de quedar como permiso vigente.
func Offenders(t testing.TB, client *regexp.Regexp, allowed map[string]string) []string {
	t.Helper()
	root := Root(t)
	out, err := exec.Command("git", "-C", root, "ls-files", "-co", "--exclude-standard").Output()
	if err != nil {
		t.Fatalf("git ls-files: %v", err)
	}
	var offenders []string
	used := map[string]bool{}
	scanned := 0
	for _, rel := range strings.Split(string(out), "\n") {
		if !Code.MatchString(rel) || strings.HasPrefix(rel, "connectors/") || strings.Contains(rel, "node_modules/") ||
			strings.HasSuffix(rel, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			continue
		}
		scanned++
		for i, line := range strings.Split(string(raw), "\n") {
			if !client.MatchString(line) || comment.MatchString(line) {
				continue
			}
			if prefix := allowedBy(rel, allowed); prefix != "" {
				used[prefix] = true
				continue
			}
			offenders = append(offenders, rel+":"+strconv.Itoa(i+1))
		}
	}
	if scanned < 100 {
		t.Fatalf("sólo recorrí %d archivos: el chequeo no miró el repo", scanned)
	}
	var stale []string
	for prefix := range allowed {
		if !used[prefix] {
			stale = append(stale, prefix)
		}
	}
	sort.Strings(stale)
	if len(stale) > 0 {
		t.Errorf("estas excepciones ya no matchean nada — borralas: %v", stale)
	}
	return offenders
}

func allowedBy(rel string, allowed map[string]string) string {
	for prefix := range allowed {
		if strings.HasPrefix(rel, prefix) {
			return prefix
		}
	}
	return ""
}
