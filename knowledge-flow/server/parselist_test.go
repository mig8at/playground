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

// Una respuesta cortada por largo (la corrida #28) rescata los ítems completos, y un «[]» suelto no es la respuesta.
func TestParseListRescuesACutAnswer(t *testing.T) {
	text := `[{"id": "a#1", "evidencia": []}, {"id": "a#2", "veredicto": "sigue"}, {"id": "a#3", "texto": "cort`
	out, err := parseList(text)
	if err != nil || len(out) != 2 || out[1]["id"] != "a#2" {
		t.Fatalf("parseList = %v, %v", out, err)
	}
}

func TestOnlyItemsKeepsTheAppendix(t *testing.T) {
	pkg := "# Paquete\n\n## ÍTEM a#1 — x\nuno\n\n## ÍTEM a#2 — y\ndos\n\n# ARCHIVOS\nf"
	got := onlyItems(pkg, []string{"a#2"})
	if got != "# Paquete\n\n## ÍTEM a#2 — y\ndos\n\n# ARCHIVOS\nf" {
		t.Fatalf("onlyItems = %q", got)
	}
}
