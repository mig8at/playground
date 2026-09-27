package main

/* Lo que radar sabe del Makefile, sacado del Makefile y de su historia en git — nunca escrito a mano.
 *
 * ⚠ Un target que hoy no existe NO está «muerto» por aparecer en la historia. El 2026-09-27 se contó así a
 * mano y salió que `make context-lint` se invocaba 330 veces sobre una carpeta borrada; mirando la fecha,
 * las 527 invocaciones eran TODAS de antes de sacarlo. Por eso cada target que falta lleva la fecha en que
 * salió, y sólo cuenta lo que se invocó DESPUÉS. */

import (
	"regexp"
	"strings"
	"time"
)

var (
	// reTarget es un target documentado: la misma forma que lee `listar` para imprimir la ayuda.
	reTarget = regexp.MustCompile(`(?m)^([a-z][a-zA-Z0-9_-]*):.*## @[a-z]+ `)
	// reAlias es una línea del bloque de nombres viejos: `  viejo:nuevo \`.
	reAlias = regexp.MustCompile(`(?m)^\s+([a-z][a-zA-Z0-9_-]*):([a-z][a-zA-Z0-9_-]*)\s*\\?$`)
)

// Makefile es el catálogo de hoy.
type Makefile struct {
	Targets map[string]bool   // documentados (`## @…`)
	Aliases map[string]string // nombre viejo → nombre nuevo
}

// ParseMakefile lee el catálogo de un Makefile.
func ParseMakefile(src string) Makefile {
	m := Makefile{Targets: map[string]bool{}, Aliases: map[string]string{}}
	for _, g := range reTarget.FindAllStringSubmatch(src, -1) {
		m.Targets[g[1]] = true
	}
	// Los alias viven en los bloques `*_OLD_TARGETS := \` … hasta la primera línea que no sigue.
	for _, block := range strings.Split(src, "_OLD_TARGETS :=")[1:] {
		end := strings.Index(block, "\n\n")
		if end < 0 {
			end = len(block)
		}
		for _, g := range reAlias.FindAllStringSubmatch(block[:end], -1) {
			m.Aliases[g[1]] = g[2]
		}
	}
	return m
}

// Canonical: el nombre de hoy de un target (el mismo, o el nuevo si es un alias).
func (m Makefile) Canonical(t string) string {
	if n, ok := m.Aliases[t]; ok {
		return n
	}
	return t
}

// Known: si `make t` corre hoy, documentado o por alias.
func (m Makefile) Known(t string) bool {
	return m.Targets[t] || m.Aliases[t] != ""
}

// History es lo que el Makefile fue siendo: cuándo apareció y cuándo salió cada target, y desde cuándo
// existe cada alias. Se lee de UNA pasada por `git log -p`, no con un `git log` por target.
type History struct {
	Added      map[string]time.Time // primera vez que apareció `target:`
	Removed    map[string]time.Time // última vez que se borró `target:` (vale si hoy no está)
	AliasAdded map[string]time.Time // desde cuándo existe el alias `viejo:nuevo`
}

var (
	reAddedTarget   = regexp.MustCompile(`^\+([a-z][a-zA-Z0-9_-]*):`)
	reRemovedTarget = regexp.MustCompile(`^-([a-z][a-zA-Z0-9_-]*):`)
	reAddedAlias    = regexp.MustCompile(`^\+\s+([a-z][a-zA-Z0-9_-]*):([a-z][a-zA-Z0-9_-]*)\s*\\?$`)
)

// commitMark separa los commits en la salida de `git log -p`: no puede empezar con `@@`, que es como
// empieza cada tramo del diff.
const commitMark = "##radar-commit## "

// ParseHistory lee la salida de `git log -p --reverse --format=<commitMark>%cI -- Makefile`.
func ParseHistory(log string) History {
	h := History{Added: map[string]time.Time{}, Removed: map[string]time.Time{}, AliasAdded: map[string]time.Time{}}
	var when time.Time
	for _, line := range strings.Split(log, "\n") {
		if d, ok := strings.CutPrefix(line, commitMark); ok {
			when, _ = time.Parse(time.RFC3339, strings.TrimSpace(d))
			continue
		}
		if m := reAddedAlias.FindStringSubmatch(line); m != nil {
			if _, seen := h.AliasAdded[m[1]]; !seen {
				h.AliasAdded[m[1]] = when
			}
			continue
		}
		if m := reAddedTarget.FindStringSubmatch(line); m != nil {
			if _, seen := h.Added[m[1]]; !seen {
				h.Added[m[1]] = when
			}
		} else if m := reRemovedTarget.FindStringSubmatch(line); m != nil {
			h.Removed[m[1]] = when
		}
	}
	return h
}

// GitHistory lee la historia del Makefile del playground.
func GitHistory(root string) History {
	out, err := gitOutput(root, "log", "-p", "--reverse", "--format="+commitMark+"%cI", "--", "Makefile")
	if err != nil {
		return History{Added: map[string]time.Time{}, Removed: map[string]time.Time{}, AliasAdded: map[string]time.Time{}}
	}
	return ParseHistory(out)
}
