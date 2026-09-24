package main

import (
	"encoding/json"
	"io"
	"os"
	"regexp"
	"slices"
	"strings"
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

// Lo que el registro DECLARA de un comando es lo que el MCP le ofrece al modelo. Si no coincide con lo
// que el comando ACEPTA, el modelo manda un parámetro que el comando rechaza —o peor, uno que no existe
// y se pierde—. Es la regla de «lo que una herramienta afirma sobre otra se cablea»: acá se lee la
// ayuda de cada comando y se cruza contra su declaración, en los dos sentidos.
func TestEveryDeclaredParamIsAFlagTheCommandAccepts(t *testing.T) {
	// banderas que un comando acepta y que a propósito no se le ofrecen al modelo
	notOffered := map[string][]string{
		"sql": {"csv"}, // el CSV es para la consola; el modelo lee texto o JSON
	}
	for _, c := range tools() {
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
			declared[p.Name] = true
			if !slices.Contains(accepted, p.Name) {
				t.Errorf("%s declara --%s, pero el comando no la acepta (acepta %v)", c.Name, p.Name, accepted)
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

// Los argumentos del modelo pasan a la línea de comando, y lo que no cuadra se rechaza en vez de
// ignorarse: un parámetro ignorado se lee como aplicado.
func TestArgvBuildsTheCommandLineAndRejectsWhatDoesNotFit(t *testing.T) {
	cases := []struct {
		cmd, in string
		want    string // la línea, o "ERR:<fragmento>"
	}{
		{"sql", `{"target":"local","query":"SELECT 1","json":true}`, "sql --target local --query SELECT 1 --json"},
		{"sql", `{"target":"local","query":"SELECT 1","json":false}`, "sql --target local --query SELECT 1"},
		{"sql", `{"target":"local"}`, "ERR:falta query"},
		{"sql", `{"target":"local","query":"x","otro":1}`, "ERR:desconocido: otro"},
		{"logs", `{"target":"qa","query":"{a=\"b\"}","limit":20}`, `logs --target qa --query {a="b"} --limit 20`},
		{"logs", `{"target":"qa","query":"x","limit":2.5}`, "ERR:entero"},
		{"confluence search", `{"text":"cupo rotativo"}`, "confluence search cupo rotativo"},
		{"jira create", `{"summary":"t","type_id":"10005"}`, "jira create --summary t --type-id 10005"},
		{"jira create", `{"summary":"t","apply":true}`, "jira create --summary t --apply"},
		{"jira delete", `{"key":"CORE-1"}`, "jira delete --key CORE-1"},
		{"jira search", `{"jql":"key = X","apply":true}`, "ERR:desconocido: apply"},
	}
	for _, tc := range cases {
		got, err := argv(mustFind(t, tc.cmd), json.RawMessage(tc.in))
		line := strings.Join(got, " ")
		if strings.HasPrefix(tc.want, "ERR:") {
			if err == nil || !strings.Contains(err.Error(), tc.want[4:]) {
				t.Errorf("%s %s: quería error %q, dio %q / %v", tc.cmd, tc.in, tc.want[4:], line, err)
			}
			continue
		}
		if err != nil || line != tc.want {
			t.Errorf("%s %s:\n  dio    %q (%v)\n  quería %q", tc.cmd, tc.in, line, err, tc.want)
		}
	}
}

// Sólo las herramientas que escriben ofrecen `apply`, y el ambiente se ofrece con sus cinco valores.
func TestTheSchemaOffersApplyOnlyToWritesAndTheTargetEnum(t *testing.T) {
	for _, c := range tools() {
		props := toolSchema(c)["properties"].(map[string]any)
		if _, has := props["apply"]; has != c.Write {
			t.Errorf("%s: ¿apply en el esquema? %v, ¿escribe? %v", c.Name, has, c.Write)
		}
		if tp, ok := props["target"].(map[string]any); ok && len(tp["enum"].([]string)) != 5 {
			t.Errorf("%s: el target tiene que ofrecer los cinco ambientes", c.Name)
		}
	}
}
