package store

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// El último toque sale de git y no del mtime, y lo sin commitear cuenta como HOY.
func TestUltimosToquesPorGitYWorkingTree(t *testing.T) {
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_DATE=2026-09-01T10:00:00-05:00", "GIT_COMMITTER_DATE=2026-09-01T10:00:00-05:00")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	run("config", "user.email", "t@t")
	run("config", "user.name", "t")
	os.WriteFile(filepath.Join(dir, "vieja.md"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(dir, "sucia.md"), []byte("a"), 0o644)
	run("add", ".")
	run("commit", "-q", "-m", "uno")
	os.WriteFile(filepath.Join(dir, "sucia.md"), []byte("b"), 0o644) // modificada, sin commit
	os.WriteFile(filepath.Join(dir, "nueva.md"), []byte("c"), 0o644) // nunca commiteada

	got := ultimosToques(dir)
	hoy := time.Now().Format("2006-01-02")
	if got["vieja.md"] != "2026-09-01" {
		t.Errorf("vieja: esperaba la fecha del commit, dio %q", got["vieja.md"])
	}
	if got["sucia.md"] != hoy {
		t.Errorf("sucia: modificada sin commit tiene que ser HOY, dio %q", got["sucia.md"])
	}
	if got["nueva.md"] != hoy {
		t.Errorf("nueva: sin commit tiene que ser HOY, dio %q", got["nueva.md"])
	}
}
