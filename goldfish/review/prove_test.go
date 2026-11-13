package review

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func run(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.email=t@t", "-c", "user.name=t"}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// El clon va al commit del PR y vuelve a su rama; con cambios sin commit no se toca.
func TestCheckoutPRRestores(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, "init", "-q", "-b", "mi-rama")
	f := filepath.Join(dir, "a.txt")
	_ = os.WriteFile(f, []byte("1"), 0o644)
	run(t, dir, "add", "a.txt")
	run(t, dir, "commit", "-q", "-m", "uno")
	run(t, dir, "checkout", "-q", "-b", "pr")
	_ = os.WriteFile(f, []byte("2"), 0o644)
	run(t, dir, "commit", "-q", "-am", "dos")
	prHead := run(t, dir, "rev-parse", "HEAD")
	run(t, dir, "checkout", "-q", "mi-rama")

	ctx := context.Background()
	r := &Run{Head: prHead}
	restore, err := checkoutPR(ctx, dir, r)
	if err != nil {
		t.Fatal(err)
	}
	if got := run(t, dir, "rev-parse", "HEAD"); got != prHead {
		t.Fatalf("no quedó en el PR: %s", got)
	}
	if r.ProveFrom != "mi-rama" {
		t.Errorf("ProveFrom = %q", r.ProveFrom)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	if b := run(t, dir, "branch", "--show-current"); b != "mi-rama" {
		t.Fatalf("no volvió: %q", b)
	}

	// con un cambio sin commit, no se toca
	_ = os.WriteFile(f, []byte("sucio"), 0o644)
	if _, err := checkoutPR(ctx, dir, &Run{Head: prHead}); err == nil {
		t.Fatal("con cambios sin commit no debería moverlo")
	}
	if b := run(t, dir, "branch", "--show-current"); b != "mi-rama" {
		t.Fatalf("se movió igual: %q", b)
	}
}
