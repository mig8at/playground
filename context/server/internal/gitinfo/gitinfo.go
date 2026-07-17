// Package gitinfo opera git sobre un repo. Lo mayormente-lectura (State/Branches/
// IsClean/BranchExists/Published) observa qué rama/commit tiene cada repo para
// rastrear "combinaciones de ramas"; las operaciones de ESCRITURA (Checkout/Pull/
// CreateBranch/DeleteLocalBranch) las dispara el usuario al alinear/derivar/borrar.
// NUNCA toca el remoto: no hay push ni delete remoto (pull es --ff-only).
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

// BranchExists indica si existe la rama LOCAL.
func BranchExists(root, branch string) bool {
	return run2ok(root, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch)
}

// Published indica si la rama fue empujada (existe origin/<branch>). Se usa solo
// para INFORMAR: al borrar, Context nunca toca el remoto.
func Published(root, branch string) bool {
	return run2ok(root, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/"+branch)
}

// run2ok corre git y devuelve true si el exit fue 0 (para chequeos existencia).
func run2ok(root string, args ...string) bool {
	err := exec.Command("git", append([]string{"-C", root}, args...)...).Run()
	return err == nil
}

// CreateBranch crea la rama `branch` a partir de `base` (si base != "", primero
// hace checkout de base para ramificar desde el punto correcto) y queda parado en
// ella. Validar IsClean antes.
func CreateBranch(root, branch, base string) error {
	if base != "" {
		if err := runCtx(root, 20*time.Second, "checkout", base); err != nil {
			return err
		}
	}
	return runCtx(root, 20*time.Second, "checkout", "-b", branch)
}

// DeleteLocalBranch borra la rama LOCAL (force, -D). NUNCA toca el remoto. No se
// puede borrar la rama actual → el caller debe hacer checkout a otra antes.
func DeleteLocalBranch(root, branch string) error {
	return runCtx(root, 20*time.Second, "branch", "-D", branch)
}
