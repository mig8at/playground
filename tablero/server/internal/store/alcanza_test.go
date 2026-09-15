package store

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitT(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// Un SQUASH con el contenido editado cambia el patch-id: `git cherry` deja de reconocer el cambio y la
// rama sale como «no llegó» aunque su PR esté mergeado y el commit resultante viva en el ambiente. Es
// lo que hacía que Alta Fleet dijera que nada suyo estaba en main (2026-09-15).
func TestAlcanzaReconoceElSquashPorElCommitDelPR(t *testing.T) {
	dir := t.TempDir()
	// `alcanza` mira refs `origin/<amb>`: se arma un repo "remoto" y se clona, que es la forma honesta
	// de tener esos refs sin falsearlos.
	orig := filepath.Join(dir, "orig")
	os.MkdirAll(orig, 0o755)
	gitT(t, orig, "init", "-q", "-b", "main")
	os.WriteFile(filepath.Join(orig, "a.txt"), []byte("uno\n"), 0o644)
	gitT(t, orig, "add", ".")
	gitT(t, orig, "commit", "-q", "-m", "base")
	gitT(t, orig, "branch", "rama")
	gitT(t, orig, "checkout", "-q", "rama")
	os.WriteFile(filepath.Join(orig, "b.txt"), []byte("dos\n"), 0o644)
	gitT(t, orig, "add", ".")
	gitT(t, orig, "commit", "-q", "-m", "el trabajo")
	// en main entra una versión DISTINTA del mismo trabajo (como un squash con el contenido editado en review)
	gitT(t, orig, "checkout", "-q", "main")
	os.WriteFile(filepath.Join(orig, "b.txt"), []byte("dos, revisado\n"), 0o644)
	gitT(t, orig, "add", ".")
	gitT(t, orig, "commit", "-q", "-m", "el trabajo (#983)")
	squash := gitT(t, orig, "rev-parse", "HEAD")

	repo := filepath.Join(dir, "clon")
	gitT(t, dir, "clone", "-q", orig, repo)
	ctx := context.Background()

	// 1. sin PR: el patch-id no coincide, así que NO llegó — y eso es lo correcto con la sola señal de git
	en, _, como := alcanza(ctx, repo, "origin/rama", "main", nil)
	if en || como != "no" {
		t.Errorf("sin PR tenía que dar no llegó: en=%v como=%q", en, como)
	}
	// 2. con el PR mergeado y su commit ya en main: llegó, y se dice CÓMO se supo
	pr := &PullRequest{Numero: 983, Estado: "MERGED", Base: "main", MergeCommit: squash}
	en, _, como = alcanza(ctx, repo, "origin/rama", "main", pr)
	if !en || como != "pr" {
		t.Errorf("con el commit del PR en main tenía que llegar por «pr»: en=%v como=%q", en, como)
	}
	// 3. un PR abierto no prueba nada
	abierto := &PullRequest{Numero: 984, Estado: "OPEN", Base: "main", MergeCommit: ""}
	if en, _, _ := alcanza(ctx, repo, "origin/rama", "main", abierto); en {
		t.Error("un PR abierto no puede marcar el ambiente como alcanzado")
	}
	// 4. un ambiente que no existe en el repo no es «no llegó»
	if _, _, como := alcanza(ctx, repo, "origin/rama", "staging", pr); como != "" {
		t.Errorf("ambiente inexistente tiene que dar como=\"\", dio %q", como)
	}
}
