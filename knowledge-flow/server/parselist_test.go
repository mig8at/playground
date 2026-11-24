package main

import "testing"

// Un «[» antes de la lista (la corrida #21) no tiene que tapar la lista válida que viene después.
func TestParseListSkipsBracketsBeforeTheList(t *testing.T) {
	text := "Miré [el diff de main] y esto sale:\n```json\n[{\"id\": \"a#b\", \"veredicto\": \"sigue\"}]\n```"
	out, err := parseList(text)
	if err != nil || len(out) != 1 || out[0]["id"] != "a#b" {
		t.Fatalf("parseList = %v, %v", out, err)
	}
	if _, err := parseList("[{\"id\": no_se_sabe}]"); err == nil {
		t.Fatal("una lista inválida tiene que fallar")
	}
}
