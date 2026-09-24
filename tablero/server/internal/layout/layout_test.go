package layout

import (
	"os"
	"path/filepath"
	"testing"
)

// Con TABLERO_DATA afuera del repo, `tools/` no está al lado de los datos: se busca hacia arriba desde donde
// se corre. Sin esto, una herramienta que manda su bloque por `make tarea-bloque` corría make en un
// directorio sin Makefile (2026-09-23).
func TestToolsIsFoundFromTheWorkingDirWhenDataLivesElsewhere(t *testing.T) {
	repo := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repo, "tools"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "tools", "repos.json"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(repo, "tablero", "server")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Chdir(work)
	elsewhere := filepath.Join(t.TempDir(), "copy", "data")
	got, _ := filepath.EvalSymlinks(At(elsewhere).Tools())
	want, _ := filepath.EvalSymlinks(filepath.Join(repo, "tools"))
	if got != want {
		t.Fatalf("Tools() = %s, quería %s", got, want)
	}
}
