package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWeekOf(t *testing.T) {
	loc := time.FixedZone("COT", -5*3600)
	cases := map[string][3]string{
		"2026-11-18": {"2026-W47", "2026-11-16", "2026-11-22"}, // miércoles
		"2026-11-16": {"2026-W47", "2026-11-16", "2026-11-22"}, // lunes
		"2026-11-22": {"2026-W47", "2026-11-16", "2026-11-22"}, // domingo
		"2027-01-01": {"2026-W53", "2026-12-28", "2027-01-03"}, // la semana ISO cruza el año
	}
	for day, want := range cases {
		d, _ := time.ParseInLocation("2006-01-02", day, loc)
		key, _, from, to := weekOf(d.Add(10 * time.Hour))
		if key != want[0] || from.Format("2006-01-02") != want[1] || to.Format("2006-01-02") != want[2] {
			t.Errorf("%s → %s %s %s, quería %v", day, key, from.Format("2006-01-02"), to.Format("2006-01-02"), want)
		}
	}
}

// carry: con los mismos modelos, los textos de antes pasan a la versión nueva; los que no estaban no se inventan.
func TestCarry(t *testing.T) {
	prev := &Week{Models: []Model{{ID: "a/x", What: "hace x", Novelty: "nuevo x"}}, Papers: []Paper{{ID: "1", SummarySpanish: "uno"}},
		Lead: "a/x", Why: "porque", Wrote: "abc"}
	w := &Week{Models: []Model{{ID: "a/x"}, {ID: "b/y"}}, Papers: []Paper{{ID: "1"}, {ID: "2"}}}
	carry(prev, w)
	if w.Models[0].What != "hace x" || w.Models[1].What != "" || w.Papers[0].SummarySpanish != "uno" || w.Papers[1].SummarySpanish != "" {
		t.Fatalf("%+v %+v", w.Models, w.Papers)
	}
	if w.Lead != "a/x" || w.Wrote != "abc" {
		t.Fatalf("%+v", w)
	}
}

func TestFingerprintOnlyNewModelsAndPapers(t *testing.T) {
	a := &Week{Models: []Model{{ID: "a", New: true}, {ID: "b", Likes: 1}}, Papers: []Paper{{ID: "1"}}}
	b := &Week{Models: []Model{{ID: "a", New: true, Likes: 99}, {ID: "c"}}, Papers: []Paper{{ID: "1", Upvotes: 5}}}
	if fingerprint(a) != fingerprint(b) {
		t.Fatal("cambió la huella por algo que no se le manda al modelo")
	}
	b.Models = append(b.Models, Model{ID: "d", New: true})
	if fingerprint(a) == fingerprint(b) {
		t.Fatal("un modelo nuevo más tiene que cambiar la huella")
	}
}

// Los favoritos del repo se leen enteros: un error de tipeo en el JSON lo dice la prueba, no la interfaz en blanco.
func TestFavoritesFileIsValid(t *testing.T) {
	favs, err := loadFavorites("../favorites.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(favs) == 0 {
		t.Fatal("favorites.json vacío")
	}
}

// Los instalados: los GGUF se agrupan con su proyector, un blob compartido no se borra con uno solo de sus dueños, y
// nada fuera de las raíces se puede borrar.
func TestInstalledScanAndRemove(t *testing.T) {
	tmp := t.TempDir()
	r := roots{hub: filepath.Join(tmp, "hub"), mine: filepath.Join(tmp, "mine")}
	write := func(p string, n int) {
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, make([]byte, n), 0o644)
	}
	write(filepath.Join(r.mine, "models", "Foo-4B-Instruct-Q4_K_M.gguf"), 100)
	write(filepath.Join(r.mine, "models", "mmproj-Foo-4B-Instruct-Q8_0.gguf"), 10)
	write(filepath.Join(r.mine, "tool", ".venv", "bin", "python"), 5)
	write(filepath.Join(r.mine, "chat", "x"), 5) // sin venv: no es un modelo
	write(filepath.Join(r.hub, "blobs", "shared"), 50)
	write(filepath.Join(r.hub, "blobs", "own"), 20)
	for _, m := range []string{"models--a--x", "models--b--y"} {
		os.MkdirAll(filepath.Join(r.hub, m, "snapshots", "1"), 0o755)
		os.Symlink(filepath.Join(r.hub, "blobs", "shared"), filepath.Join(r.hub, m, "snapshots", "1", "w"))
	}
	os.Symlink(filepath.Join(r.hub, "blobs", "own"), filepath.Join(r.hub, "models--a--x", "snapshots", "1", "v"))

	got := map[string]int64{}
	for _, it := range scanInstalled(r) {
		got[it.Key] = it.Bytes
	}
	if got["gguf:Foo-4B-Instruct"] != 110 || got["env:tool"] != 5 || got["hub:a/x"] != 70 || got["hub:b/y"] != 50 || len(got) != 4 {
		t.Fatalf("%v", got)
	}
	if _, err := removeInstalled(r, "hub:a/x"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(r.hub, "blobs", "shared")); err != nil {
		t.Fatal("borró un blob que también usa b/y")
	}
	if _, err := os.Stat(filepath.Join(r.hub, "blobs", "own")); !os.IsNotExist(err) {
		t.Fatal("no borró el blob propio de a/x")
	}
	if _, err := removeInstalled(r, "env:../../etc"); err == nil {
		t.Fatal("una clave que no está en la lista no se borra")
	}
	if r.inside(r.mine) || r.inside("/etc/passwd") || !r.inside(filepath.Join(r.mine, "tool")) {
		t.Fatal("inside")
	}
}
