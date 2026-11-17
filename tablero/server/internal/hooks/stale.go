package hooks

/* staleSection: los cambios sin commitear que llevan más de un día quietos en este worktree.
 *
 * POR QUÉ. Varias sesiones comparten el worktree y su índice, y cada una commitea SÓLO sus rutas. Lo que
 * otra sesión dejó a medias no lo commitea nadie: queda modificado o sin seguimiento días, se mezcla con
 * lo nuevo en cada `git status` y nadie sabe si es trabajo vivo o abandonado. Al revisar el 2026-11-17
 * había 18 archivos así, de 3 a 5 días (flujos de Jarvis, artifacts de tareas, una pila a medio escribir,
 * un `harness.json` staged). Lo reciente no se lista: puede ser de una sesión que está trabajando ahora.
 *
 * Sólo lee: `git status` y el mtime de cada archivo. Sin git, no dice nada. */

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// staleAfter: desde cuánto un cambio sin commitear deja de parecer trabajo en curso.
const staleAfter = 24 * time.Hour

// staleLines: cuántas líneas lista como mucho; el resto va en «… y N más».
const staleLines = 8

// pendingChange es una entrada de `git status`.
type pendingChange struct {
	path   string
	code   string // XY de porcelain: «M », « M», «??», «D »…
	staged bool
	mod    time.Time // cero si el archivo ya no existe (borrado)
}

func staleSection(root string) string {
	_, out, _, err := run(root, 5*time.Second, "git", "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return ""
	}
	return formatStale(parsePorcelain(out, root), time.Now())
}

// parsePorcelain lee `git status --porcelain=v1 -z`. En un renombre la ruta vieja viene después, sola.
func parsePorcelain(out, root string) []pendingChange {
	var changes []pendingChange
	parts := strings.Split(out, "\x00")
	for i := 0; i < len(parts); i++ {
		e := parts[i]
		if len(e) < 4 {
			continue
		}
		c := pendingChange{code: e[:2], path: e[3:], staged: e[0] != ' ' && e[0] != '?'}
		if e[0] == 'R' || e[0] == 'C' {
			i++ // la ruta de origen
		}
		if st, err := os.Stat(filepath.Join(root, c.path)); err == nil {
			c.mod = st.ModTime()
		}
		changes = append(changes, c)
	}
	return changes
}

// staleGroup junta los archivos nuevos de una misma carpeta: diez flujos de Jarvis son una línea.
type staleGroup struct {
	label  string
	first  string // la ruta del primero: con uno solo, se muestra el archivo y no la carpeta
	files  int
	staged bool
	newest time.Time
}

func formatStale(changes []pendingChange, now time.Time) string {
	groups := map[string]*staleGroup{}
	total := 0
	for _, c := range changes {
		// Un borrado no tiene fecha: cuenta como viejo sólo si está staged (si no, no se sabe).
		if c.mod.IsZero() && !c.staged {
			continue
		}
		if !c.mod.IsZero() && now.Sub(c.mod) < staleAfter {
			continue
		}
		total++
		key := c.path
		if dir := filepath.Dir(c.path); c.code == "??" && dir != "." {
			key = dir + "/"
		}
		g := groups[key]
		if g == nil {
			g = &staleGroup{label: key, first: c.path}
			groups[key] = g
		}
		g.files++
		g.staged = g.staged || c.staged
		if c.mod.After(g.newest) {
			g.newest = c.mod
		}
	}
	if total == 0 {
		return ""
	}
	list := make([]*staleGroup, 0, len(groups))
	for _, g := range groups {
		list = append(list, g)
	}
	// Lo staged primero (el índice es de todas las sesiones), después lo más viejo.
	sort.Slice(list, func(i, j int) bool {
		if list[i].staged != list[j].staged {
			return list[i].staged
		}
		if !list[i].newest.Equal(list[j].newest) {
			return list[i].newest.Before(list[j].newest)
		}
		return list[i].label < list[j].label
	})
	var b strings.Builder
	fmt.Fprintf(&b, "  SIN COMMITEAR — %d cambio(s) quietos hace más de un día en este worktree: de otra sesión o a medias.\n", total)
	b.WriteString("    No son tuyos: no los commitees ni los descartes sin preguntarle a Miguel. Commitear por ruta los deja afuera.\n")
	for i, g := range list {
		if i == staleLines {
			fmt.Fprintf(&b, "    … y %d más (`git status`)\n", len(list)-staleLines)
			break
		}
		mark := "·"
		if g.staged {
			mark = "● staged"
		}
		label := g.first
		if g.files > 1 {
			label = g.label
			label += fmt.Sprintf(" (%d nuevos)", g.files)
		}
		age := "borrado"
		if !g.newest.IsZero() {
			age = "hace " + days(now.Sub(g.newest))
		}
		fmt.Fprintf(&b, "    %s %s · %s\n", mark, label, age)
	}
	return strings.TrimRight(b.String(), "\n")
}

// days dice una antigüedad de más de un día en días (y horas si son pocos).
func days(d time.Duration) string {
	h := int(d.Hours())
	if h < 48 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dd", h/24)
}
