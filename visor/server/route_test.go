package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"creditop/playground/connectors/figma"
)

// Lo que Miguel pega llega en varias formas, y todas se entienden igual: la URL del visor con su capa y su
// huella, el enlace de una tarea, y la ruta sola. El proyecto se acepta por nombre.
func TestPastedIsUnderstoodInEveryForm(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.library.opened("RkyauDfqEsFbJZBBoqChAV", "Altafinanciera", "PRODUCTO")
	s.readFlow = func(context.Context, string) (figma.Structure, string, error) { return figma.Structure{}, "", nil }
	cases := []struct{ raw, layer, print, from string }{
		{"http://localhost:5193/altafinanciera/266-1279?modo=comparar&capa=I1-6711_1265-1238&huella=0123456789ab", "I1:6711;1265:1238", "0123456789ab", "el visor"},
		{"visor:altafinanciera/266-1279@53265587646d", "", "53265587646d", "una tarea"},
		{"  `RkyauDfqEsFbJZBBoqChAV/266-1279?capa=1-6708`  ", "1:6708", "", "la ruta"},
	}
	for _, c := range cases {
		p, err := s.parsePasted(context.Background(), c.raw)
		if err != nil {
			t.Fatalf("%s: %v", c.raw, err)
		}
		if p.key != "RkyauDfqEsFbJZBBoqChAV" || p.screen != "266:1279" || p.layer != c.layer || p.print != c.print || p.from != c.from {
			t.Errorf("%s → %+v", c.raw, p)
		}
	}
	if _, err := s.parsePasted(context.Background(), ""); err == nil {
		t.Error("nada pegado es un error de uso")
	}
}

// La tarea que enlaza la pantalla sale de su documento o de su pila, con cualquier forma de enlace; la
// misma tarea se cuenta una vez, y la de otra pantalla no.
func TestLinkedTasksFindsTheTaskOfTheScreen(t *testing.T) {
	root := t.TempDir()
	write := func(rel, body string) {
		p := filepath.Join(root, rel)
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("alta/task.md", "---\nid: 76\ntitle: \"Alta Fleet\"\n---\nver [bienvenida](visor:altafinanciera/266-1279@53265587646d)\n")
	write("alta/context.jsonl", `{"body":"otra vez visor:RkyauDfqEsFbJZBBoqChAV/266-1279"}`+"\n")
	write("otra/task.md", "---\nid: 12\n---\nhttp://localhost:5193/altafinanciera/1-12908\n")
	s := newServer(nil, t.TempDir())
	s.library.opened("RkyauDfqEsFbJZBBoqChAV", "Altafinanciera", "PRODUCTO")
	got := s.linkedTasks(root, "RkyauDfqEsFbJZBBoqChAV", "266:1279")
	if len(got) != 1 || got[0].id != "76" || got[0].title != "Alta Fleet" || got[0].folder != "alta" {
		t.Errorf("la tarea 76, una vez: %+v", got)
	}
}

// Los títulos del paquete bajan un nivel; lo que va adentro de un bloque de código no se toca.
func TestDemoteLeavesCodeAlone(t *testing.T) {
	got := demote("# A\n## B\n```css\n# no\n```\ntexto")
	if got != "## A\n### B\n```css\n# no\n```\ntexto" {
		t.Errorf("%q", got)
	}
	if !strings.HasPrefix(demote("sin títulos"), "sin") {
		t.Error("sin títulos queda igual")
	}
}
