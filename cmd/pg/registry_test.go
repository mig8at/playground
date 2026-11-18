package main

import (
	"io"
	"os"
	"regexp"
	"slices"
	"testing"
)

// flagsOf corre el comando con -h y devuelve las banderas que imprime su ayuda: lo que ACEPTA, leído de
// él mismo y no de lo que el registro dice que acepta.
func flagsOf(t *testing.T, c command) []string {
	t.Helper()
	r, w, _ := os.Pipe()
	stderr, stdout := os.Stderr, os.Stdout
	os.Stderr, os.Stdout = w, w
	c.run([]string{"-h"})
	os.Stderr, os.Stdout = stderr, stdout
	w.Close()
	out, _ := io.ReadAll(r)
	var flags []string
	for _, m := range regexp.MustCompile(`(?m)^\s+-([a-z][a-z-]*)`).FindAllStringSubmatch(string(out), -1) {
		flags = append(flags, m[1])
	}
	return flags
}

// Lo que el registro DECLARA de un comando es lo que muestra la ayuda de pg. Si no coincide con lo que el
// comando ACEPTA, la ayuda ofrece una opción que el comando rechaza —o calla una que existe—. Es la regla de «lo que una herramienta afirma sobre otra se cablea»: acá se lee la
// ayuda de cada comando y se cruza contra su declaración, en los dos sentidos.
func TestEveryDeclaredParamIsAFlagTheCommandAccepts(t *testing.T) {
	// banderas que un comando acepta y que a propósito no se le ofrecen al modelo
	notOffered := map[string][]string{
		"sql": {"csv"}, // el CSV es para la consola; el modelo lee texto o JSON
	}
	for _, c := range commands {
		// Sólo los que parsean banderas: uno sin banderas, o con sólo posicionales, tomaría `-h` como
		// argumento y saldría a la red.
		hasFlags := c.Write
		for _, p := range c.Params {
			hasFlags = hasFlags || !p.Positional
		}
		if !hasFlags {
			continue
		}
		accepted := flagsOf(t, c)
		declared := map[string]bool{}
		for _, p := range c.Params {
			if p.Positional {
				continue
			}
			flag := p.Name
			declared[flag] = true
			if !slices.Contains(accepted, flag) {
				t.Errorf("%s declara --%s, pero el comando no la acepta (acepta %v)", c.Name, flag, accepted)
			}
		}
		for _, f := range accepted {
			if f == "apply" && c.Write {
				continue
			}
			if !declared[f] && !slices.Contains(notOffered[c.Name], f) {
				t.Errorf("%s acepta --%s y el registro no la declara: el MCP no la ofrece", c.Name, f)
			}
		}
		if c.Write != slices.Contains(accepted, "apply") {
			t.Errorf("%s: Write=%v pero ¿acepta --apply? %v", c.Name, c.Write, slices.Contains(accepted, "apply"))
		}
	}
}

func mustFind(t *testing.T, name string) command {
	t.Helper()
	c, ok := find(name)
	if !ok {
		t.Fatalf("no existe %q", name)
	}
	return c
}
