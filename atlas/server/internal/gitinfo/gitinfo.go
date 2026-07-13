// Package gitinfo lee estado de git de un repo (solo lectura: nunca hace
// checkout ni modifica nada). Atlas observa qué rama/commit tiene cada repo para
// rastrear "combinaciones de ramas".
package gitinfo

import (
	"os/exec"
	"strings"
)

func run(root string, args ...string) (string, error) {
	out, err := exec.Command("git", append([]string{"-C", root}, args...)...).Output()
	return strings.TrimSpace(string(out)), err
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
