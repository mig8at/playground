package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// El borrado de la bitácora salió de la UI el 2026-09-22, pero agosto tiene seis entradas borradas
// (`deletedAt`) y siguen sin tener que verse. La recarga, además, reconstruye en vez de acumular: se
// ejecuta cada vez que cambia un Markdown de tarea, y acumulando cada avance se vería dos veces.
func TestListHidesDeletedEntriesAcrossReloads(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "entries"), 0o755); err != nil {
		t.Fatal(err)
	}
	day := time.Now().Format("2006-01-02")
	lines := `{"id":1,"day":"` + day + `","hour":9,"minutes":20,"kind":"progress","startedAt":"` + day + `T09:00:00-05:00","createdAt":"` + day + `T09:20:00-05:00","freeTitle":"KYC","note":"visible"}
{"id":2,"day":"` + day + `","hour":10,"minutes":20,"kind":"progress","startedAt":"` + day + `T10:00:00-05:00","createdAt":"` + day + `T10:20:00-05:00","freeTitle":"KYC","note":"borrada","deletedAt":"` + day + `T11:00:00-05:00"}
`
	if err := os.WriteFile(filepath.Join(dir, "entries", day[:7]+".jsonl"), []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("", "KYC", 0, 0, "test", time.Now(), 15, "nueva"); err != nil {
		t.Fatal(err)
	}
	if err := s.load(); err != nil {
		t.Fatal(err)
	}

	entries, err := s.List(30, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Note != "nueva" || entries[1].Note != "visible" {
		t.Fatalf("entries = %+v", entries)
	}
	// Y reescribir el mes (lo hace `Create`) no le quita la marca a la borrada.
	raw, err := os.ReadFile(filepath.Join(dir, "entries", day[:7]+".jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(string(raw), `"deletedAt"`); n != 1 {
		t.Errorf("el mes reescrito tiene %d entradas borradas, esperaba 1:\n%s", n, raw)
	}
}
