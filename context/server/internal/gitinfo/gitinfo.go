// Package gitinfo lee estado de git de un repo (solo lectura: nunca hace
// checkout ni modifica nada). Context observa qué rama/commit tiene cada repo para
// rastrear "combinaciones de ramas".
package gitinfo

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

func run(root string, args ...string) (string, error) {
	out, err := exec.Command("git", append([]string{"-C", root}, args...)...).Output()
	return strings.TrimSpace(string(out)), err
}

// runCtx corre git con timeout y devuelve el stderr real como error (para
// que el usuario sepa qué falló y lo pueda hacer manual).
func runCtx(root string, timeout time.Duration, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", root}, args...)...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if ctx.Err() == context.DeadlineExceeded {
			msg = "timeout"
		} else if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("%s", firstLine(msg))
	}
	return nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return s
}

// IsClean indica si el working tree no tiene cambios (incluye untracked).
func IsClean(root string) bool {
	out, err := run(root, "status", "--porcelain")
	return err == nil && out == ""
}

// Checkout cambia a una rama local. Validar IsClean antes.
func Checkout(root, branch string) error {
	return runCtx(root, 20*time.Second, "checkout", branch)
}

// Pull hace fast-forward-only (nunca genera merge/conflictos): si diverge, falla claro.
func Pull(root string) error {
	return runCtx(root, 90*time.Second, "pull", "--ff-only")
}

// State devuelve la rama actual y el commit corto de HEAD.
func State(root string) (branch, commit string) {
	branch, _ = run(root, "rev-parse", "--abbrev-ref", "HEAD")
	commit, _ = run(root, "rev-parse", "--short", "HEAD")
	return
}

// Branches lista las ramas locales del repo.
func Branches(root string) []string {
	out, err := run(root, "for-each-ref", "--format=%(refname:short)", "refs/heads")
	if err != nil || out == "" {
		return nil
	}
	return strings.Split(out, "\n")
}
