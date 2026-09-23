package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"creditop/tablero/server/internal/layout"
	"creditop/tablero/server/internal/taskcontext"
)

func TestTaskContextFindsTheJSONLForAnEffort(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	lay := layout.At(dir)
	if err := os.MkdirAll(lay.Dir("codigo"), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\nid: 8\ntitle: Código\nstage: work\ncreated: 2026-03-20T09:00:00-05:00\n---\n\n## Si retomás esto sin contexto, empezá acá\n"
	if err := os.WriteFile(lay.TaskPath("codigo"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := taskcontext.Append(dir, "codigo", taskcontext.Event{
		Kind: "checkpoint", Goal: "Cerrar el flujo", Summary: "El camino está validado", State: "Listo para revisión", Next: "Pedir la aprobación final",
	}, time.Now()); err != nil {
		t.Fatal(err)
	}
	events, err := s.TaskContext(8)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Summary != "El camino está validado" {
		t.Fatalf("events = %+v", events)
	}
}
