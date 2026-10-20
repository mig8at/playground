package store

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// El PR de una rama sale de `gh pr list`, que puede traer varios por rama y —con `--search head:x`—
// también ramas que sólo EMPIEZAN igual. Las dos cosas se resuelven en el índice: gana el número más
// alto, y se busca por nombre exacto.
func TestIndexPRsNewestWinsAndMatchesExactly(t *testing.T) {
	rawItems := []rawPR{
		{Number: 1043, State: "OPEN", HeadRefName: "feature/pais-como-dato", BaseRefName: "main"},
		{Number: 1126, State: "MERGED", HeadRefName: "feature/pais-como-dato-onto-develop", BaseRefName: "develop"},
		{Number: 1061, State: "MERGED", HeadRefName: "feature/pais-como-dato", BaseRefName: "qa"},
		{Number: 900, State: "CLOSED", HeadRefName: "feature/pais-como-dato", BaseRefName: "qa"},
	}
	idx := indexPRs(rawItems)
	pr := idx["feature/pais-como-dato"]
	if pr == nil || pr.Number != 1061 {
		t.Fatalf("tenía que ganar el #1061 (el más alto de ESA rama), quedó %+v", pr)
	}
	if idx["feature/pais-como-dato-onto-develop"].Number != 1126 {
		t.Error("la rama con sufijo es OTRA rama, no puede mezclarse con la corta")
	}
	if idx["feature/pais"] != nil {
		t.Error("buscar por prefijo no puede devolver nada: el índice es por nombre exacto")
	}
}

// Un worktree comparte las ramas con su repo original: si el original ya está bajo root, listarlo repetía cada
// rama una vez por carpeta. Uno cuyo original vive afuera se queda, para no perder sus ramas.
func TestReposInSkipsWorktreesOfListedRepos(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mustMkdir := func(p string) {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeGitFile := func(dir, gitdir string) {
		mustMkdir(dir)
		if err := os.WriteFile(filepath.Join(dir, ".git"), []byte("gitdir: "+gitdir+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustMkdir(filepath.Join(root, "backend", ".git", "worktrees", "backend-feature"))
	writeGitFile(filepath.Join(root, "backend-feature"), filepath.Join(root, "backend", ".git", "worktrees", "backend-feature"))
	writeGitFile(filepath.Join(root, "foreign-worktree"), filepath.Join(outside, "other", ".git", "worktrees", "foreign-worktree"))

	got := reposIn(root)
	for i := range got {
		got[i] = filepath.Base(got[i])
	}
	sort.Strings(got)
	want := []string{"backend", "foreign-worktree"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("repos = %v, quería %v (el worktree de backend no se lista aparte)", got, want)
	}
}
