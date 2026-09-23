package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Dos archivos con el mismo id se pisaban en `slugs[id]` y sobrevivía uno solo, sin aviso (pasó el
// 2026-09-14 con el 79). La regla: la más VIEJA por `created` conserva el número; la otra recibe el
// siguiente libre y se persiste en su archivo, como con los `id: 0`.
func TestLoadRenumbersDuplicateIDs(t *testing.T) {
	dir := t.TempDir()
	write := func(slug, id, created string) {
		fm := "---\nid: " + id + "\ntitle: \"" + slug + "\"\nstage: work\ncreated: \"" + created + "\"\n---\n\ncuerpo\n"
		if err := os.WriteFile(filepath.Join(dir, slug+".md"), []byte(fm), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("vieja", "79", "2026-09-11T08:00:00-05:00")
	write("nueva", "79", "2026-09-14T18:00:00-05:00")
	write("otra", "82", "2026-09-14T10:00:00-05:00")

	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if s.slugs[79] != "vieja.md" {
		t.Errorf("el 79 tenía que quedarse con la más vieja, quedó %q", s.slugs[79])
	}
	if s.slugs[83] != "nueva.md" {
		t.Errorf("la nueva tenía que pasar al 83 (siguiente libre), slugs=%v", s.slugs)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "nueva.md"))
	if !strings.Contains(string(b), "\nid: 83\n") {
		t.Errorf("el id nuevo tiene que quedar PERSISTIDO en el archivo:\n%s", b)
	}
	if len(s.efforts) != 3 {
		t.Errorf("se perdió una tarea: %d de 3", len(s.efforts))
	}
}
