package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"creditop/playground/tablero/server/internal/layout"
)

func TestEditingAnEffortPreservesLocalAndHistoricalReferences(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	lay := layout.At(dir)
	os.MkdirAll(lay.Dir("playground-local"), 0755)
	path := lay.TaskPath("playground-local")
	os.WriteFile(path, []byte("---\nid: 96\ntitle: Local\nclase: proyecto\nstage: work\ncreated: \"2026-10-03T12:00:00Z\"\nknowledge: [lender-listing, lender-listing#monto]\ncanon: [listado]\n---\n\n## Objetivo\nTrabajar en local.\n"), 0644)
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	e := s.find(96)
	if e == nil || e.KnowledgeTopics != "lender-listing,lender-listing#monto" || e.CanonTopics != "listado" {
		t.Fatalf("lectura: %+v", e)
	}
	e.Title = "Título editado"
	if err := s.writeEffort(96); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), "knowledge: [lender-listing, lender-listing#monto]") || !strings.Contains(string(raw), "canon: [listado]") {
		t.Fatalf("perdió referencias al editar: %s", raw)
	}
	if _, _, err := s.readEffort("playground-local"); err != nil {
		t.Fatal(err)
	}
}
