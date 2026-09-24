package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/taskcontext"
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
		Schema: taskcontext.BlockSchema, ID: "blk_codigo", At: "2026-03-20T10:00:00-05:00", Via: "manual",
		Title: "El camino está validado", Body: "Se recorrió de punta a punta.",
	}, time.Now()); err != nil {
		t.Fatal(err)
	}
	events, err := s.TaskContext(8)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Title != "El camino está validado" {
		t.Fatalf("events = %+v", events)
	}
}
