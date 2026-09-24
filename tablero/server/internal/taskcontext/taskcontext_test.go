package taskcontext

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"creditop/playground/tablero/server/internal/layout"
)

func block(id, at, title string) Event {
	return Event{Schema: BlockSchema, ID: id, At: at, Via: "manual", Title: title, Body: "Lo que sostiene el título."}
}

func TestAppendReadsNewestFirstAndKeepsOneLinePerBlock(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	if _, err := Append(dir, "flujo", block("blk_a", "2026-09-20T09:00:00-05:00", "El primer corte"), time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := Append(dir, "flujo", block("blk_b", "2026-09-21T09:00:00-05:00", "El camino completo"), time.Now()); err != nil {
		t.Fatal(err)
	}
	events, err := Read(dir, "flujo")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Title != "El camino completo" {
		t.Fatalf("events = %+v", events)
	}
	b, err := os.ReadFile(layout.At(dir).ContextPath("flujo"))
	if err != nil {
		t.Fatal(err)
	}
	if lines := strings.Count(strings.TrimSpace(string(b)), "\n") + 1; lines != 2 {
		t.Fatalf("líneas = %d, archivo = %s", lines, b)
	}
}

func TestDecodeRejectsUnknownFields(t *testing.T) {
	line := `{"schema":"tablero.task-context/v2","id":"blk_a","at":"2026-09-20T09:00:00-05:00","via":"manual","title":"x","body":"y","next":"seguir"}`
	if _, err := Decode([]byte(line)); err == nil {
		t.Fatal("aceptó un «siguiente» dentro de un bloque")
	}
}

// El formato de hitos se migró el 2026-09-23 y no se lee más: si una línea vieja aparece —pegada a mano o
// traída de otra rama— la lectura falla en vez de mostrarla como si fuera un bloque.
func TestAnOldMilestoneMakesTheStackUnreadable(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	path := layout.At(dir).ContextPath("flujo")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	old := `{"schema":"tablero.task-context/v1","id":"ctx_a","at":"2026-09-20T09:00:00-05:00","kind":"checkpoint","summary":"x"}`
	if err := os.WriteFile(path, []byte(old+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(dir, "flujo"); err == nil {
		t.Fatal("leyó un hito del formato viejo")
	}
}
