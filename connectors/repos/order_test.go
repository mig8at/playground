package repos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// El orden de la lista importa: el índice de logs se arma recorriendo los repos en ese orden, y un map
// de Go lo pierde en silencio.
func TestIndexedOrderFollowsTheFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "repos.json"), []byte(`{"indexed":{"zeta":"~/z","alfa":"~/a","medio":"m"},"citable_only":{},"extensions":[".go"]}`), 0o644)
	if got := strings.Join(New(dir).IndexedOrder(), ","); got != "zeta,alfa,medio" {
		t.Errorf("orden = %s", got)
	}
}

// Un repo cuya rama de producción no es `main` se resuelve contra esa rama, no contra un `main` parado.
func TestBranchOverridesMain(t *testing.T) {
	dir := t.TempDir()
	repo := filepath.Join(dir, "app")
	for _, args := range [][]string{{"init", "-q", "-b", "main", repo}, {"-C", repo, "commit", "-q", "--allow-empty", "-m", "a"}, {"-C", repo, "branch", "main-pro"}} {
		if code, _ := git(dir, 10e9, args...); code != 0 {
			t.Skip("sin git utilizable")
		}
	}
	os.WriteFile(filepath.Join(dir, "repos.json"), []byte(`{"indexed":{},"citable_only":{"app":"`+repo+`"},"branches":{"app":"main-pro"},"extensions":[".go"]}`), 0o644)
	if ref, _ := New(dir).RefToIndex(repo); ref != "main-pro" {
		t.Errorf("ref = %q, quería main-pro", ref)
	}
}
