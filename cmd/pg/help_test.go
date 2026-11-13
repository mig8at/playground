package main

import "testing"

// `pg help <prefijo>` filtra por el principio del nombre, y un nombre mal escrito sugiere el más parecido.
func TestHelpFiltersAndSuggests(t *testing.T) {
	if got := matching("sql"); len(got) != 1 || got[0].Name != "sql" {
		t.Errorf("sql: %d comandos", len(got))
	}
	jira := matching("jira")
	if len(jira) < 2 {
		t.Fatalf("jira: %d comandos", len(jira))
	}
	for _, c := range jira {
		if len(c.Name) < 4 || c.Name[:4] != "jira" {
			t.Errorf("%q no empieza con jira", c.Name)
		}
	}
	if len(matching("")) != 0 || len(matching("zzz")) != 0 {
		t.Error("un prefijo vacío o desconocido no trae nada")
	}
	for typed, want := range map[string]string{"sqll": "sql", "jira serch": "jira search", "lgos": "logs", "jria": "jira", "request timline": "request timeline"} {
		if got := nearest(typed); got != want {
			t.Errorf("nearest(%q) = %q, se esperaba %q", typed, got, want)
		}
	}
	if got := nearest("algo completamente distinto"); got != "" {
		t.Errorf("lo que no se parece a nada no sugiere: %q", got)
	}
	if editDistance("gato", "pato") != 1 || editDistance("", "abc") != 3 || editDistance("abc", "abc") != 0 {
		t.Error("editDistance")
	}
}
