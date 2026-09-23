package store

import (
	"testing"
	"time"
)

func TestListForWorkKeepsFullOrderedHistory(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	old := time.Date(2026, time.January, 3, 9, 0, 0, 0, time.Local)
	newer := time.Date(2026, time.September, 22, 10, 0, 0, 0, time.Local)
	if _, err := s.Create("CORE-1", "", 1, 8, "progress", old, 20, "avance antiguo"); err != nil {
		t.Fatal(err)
	}
	removed, err := s.Create("CORE-1", "", 1, 8, "progress", newer.Add(time.Hour), 20, "avance eliminado")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("CORE-2", "", 1, 9, "progress", newer, 20, "otra tarea"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("", "", 2, 8, "test", newer, 15, "mismo esfuerzo"); err != nil {
		t.Fatal(err)
	}
	if err := s.SoftDelete(removed.ID); err != nil {
		t.Fatal(err)
	}
	// La recarga se ejecuta cuando cambia un Markdown de tarea. Debe reconstruir las entradas en vez
	// de acumularlas: de lo contrario cada hito se vería dos veces después de una actualización.
	if err := s.cargar(); err != nil {
		t.Fatal(err)
	}

	entries, err := s.ListForWork("CORE-1", 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Note != "mismo esfuerzo" || entries[1].Note != "avance antiguo" {
		t.Fatalf("entries = %+v", entries)
	}
	if _, err := s.ListForWork("", 0); err == nil {
		t.Fatal("se aceptó una consulta sin ancla")
	}
}
