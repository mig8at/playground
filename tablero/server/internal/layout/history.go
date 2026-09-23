package layout

// history.go — lo que git sabe de cada tarea, siguiendo sus mudanzas.
//
// «Días sin tocar» y «qué tareas se tocaron hoy» salen de git y no del mtime (el mtime cambia con un
// checkout y diría «tocada hoy» de algo que nadie leyó en semanas). Pero git ve una tarea por su RUTA:
// si se muda —de `data/<slug>.md` a `tasks/<slug>/task.md` el 2026-09-23, o de un slug a otro al
// renombrarla—, la ruta nueva «nace» ese día, y todas las tareas movidas parecerían tocadas hoy. La
// agenda perdería las dormidas y el cierre le reclamaría piezas a cada una.
//
// Por eso acá un MOVIMIENTO PURO (git lo marca R100: mismo contenido, otra ruta) no cuenta como toque,
// y la historia de la ruta vieja se hereda. Un movimiento CON cambios (R<100) sí es un toque: alguien
// escribió en la tarea.

import (
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// repoTaskPath: el slug a partir de una ruta relativa al repo, en la forma de hoy o en la de antes.
var repoTaskPath = regexp.MustCompile(`(?:^|/)(?:tasks/([a-z0-9][a-z0-9-]*)/task\.md|data/([a-z0-9][a-z0-9-]*)\.md)$`)

// SlugOfRepoPath devuelve el slug de una ruta de tarea tal como la imprime git, o "" si no es una.
func SlugOfRepoPath(p string) string {
	m := repoTaskPath.FindStringSubmatch(strings.TrimSpace(p))
	if m == nil {
		return ""
	}
	if m[1] != "" {
		return m[1]
	}
	return m[2]
}

// change es una línea de `--name-status` (o de `status --porcelain=v2`).
type change struct {
	status string // M, A, D, R…
	score  int    // similitud de un renombre (100 = mismo contenido)
	from   string // ruta vieja de un renombre
	path   string // ruta (la nueva, en un renombre)
}

func (c change) rename() bool   { return c.status == "R" }
func (c change) pureMove() bool { return c.rename() && c.score == 100 }

// identities sigue a una tarea a través de sus renombres: `alias` lleva de un slug viejo al actual.
type identities struct{ alias map[string]string }

func newIdentities() *identities { return &identities{alias: map[string]string{}} }

func (ids *identities) resolve(slug string) string {
	for i := 0; i < 32; i++ { // tope contra un ciclo improbable (renombrar a y volver)
		next, ok := ids.alias[slug]
		if !ok || next == slug {
			return slug
		}
		slug = next
	}
	return slug
}

// link registra que la ruta vieja de un renombre es la misma tarea que la nueva.
func (ids *identities) link(from, to string) {
	old, now := SlugOfRepoPath(from), SlugOfRepoPath(to)
	if old != "" && now != "" && old != now {
		ids.alias[old] = ids.resolve(now)
	}
}

// root es la carpeta `tablero/`, desde donde se le pregunta a git.
func (l Layout) root() string { return filepath.Dir(filepath.Clean(l.Data)) }

func (l Layout) git(args ...string) (string, error) {
	out, err := exec.Command("git", append([]string{"-C", l.root()}, args...)...).Output()
	return string(out), err
}

// pathspec: las dos formas, para que git vea los dos extremos de una mudanza y la detecte como tal.
func (l Layout) pathspec() []string {
	return []string{"--", filepath.Base(filepath.Clean(l.Data)), filepath.Base(filepath.Clean(l.Tasks))}
}

// logChanges recorre `git log -M --name-status` del más nuevo al más viejo; `visit` recibe la fecha
// del commit (YYYY-MM-DD) y cada cambio.
func (l Layout) logChanges(extra []string, visit func(date string, c change)) {
	args := append([]string{"log", "--format=@%cs", "-M", "--name-status"}, extra...)
	out, err := l.git(append(args, l.pathspec()...)...)
	if err != nil {
		return
	}
	date := ""
	for _, line := range strings.Split(out, "\n") {
		switch {
		case line == "":
		case strings.HasPrefix(line, "@"):
			date = line[1:]
		default:
			if c, ok := parseNameStatus(line); ok {
				visit(date, c)
			}
		}
	}
}

func parseNameStatus(line string) (change, bool) {
	f := strings.Split(line, "\t")
	if len(f) < 2 || f[0] == "" {
		return change{}, false
	}
	c := change{status: f[0][:1]}
	if c.rename() || c.status == "C" {
		if len(f) < 3 {
			return change{}, false
		}
		c.score, _ = strconv.Atoi(f[0][1:])
		c.from, c.path = f[1], f[2]
		return c, true
	}
	c.path = f[1]
	return c, true
}

// workingTree: lo que cambió sin commitear. Usa el formato v2 porque es el que dice la SIMILITUD de un
// renombre en el índice: con el v1, un `git mv` sin commitear se veía como un toque.
func (l Layout) workingTree() []change {
	// -uall: sin él, una tarea nueva sin commitear aparece como su CARPETA (`? tasks/x/`) y no se ve.
	// relativePaths=false: el v2 imprime las rutas relativas al directorio actual, y `git log` desde la
	// raíz; sin igualarlas, seguir una mudanza sin commitear buscaba la ruta vieja en otro lado.
	out, err := l.git(append([]string{"-c", "status.relativePaths=false", "status", "--porcelain=v2", "-uall"}, l.pathspec()...)...)
	if err != nil {
		return nil
	}
	var cs []change
	for _, line := range strings.Split(out, "\n") {
		switch {
		case strings.HasPrefix(line, "1 "), strings.HasPrefix(line, "u "):
			// 1 XY sub mH mI mW hH hI ruta
			if f := strings.SplitN(line, " ", 9); len(f) == 9 {
				cs = append(cs, change{status: "M", path: f[8]})
			}
		case strings.HasPrefix(line, "2 "):
			// 2 XY sub mH mI mW hH hI Xpuntaje ruta<TAB>ruta-vieja
			f := strings.SplitN(line, " ", 10)
			if len(f) < 10 {
				continue
			}
			paths := strings.SplitN(f[9], "\t", 2)
			if len(paths) < 2 {
				continue
			}
			score, _ := strconv.Atoi(f[8][1:])
			if f[1][1] != '.' { // el working tree cambió además del índice: no es un movimiento puro
				score = 0
			}
			cs = append(cs, change{status: f[8][:1], score: score, from: paths[1], path: paths[0]})
		case strings.HasPrefix(line, "? "):
			cs = append(cs, change{status: "A", path: line[2:]})
		}
	}
	return cs
}

// LastTouches: para cada tarea, la fecha (YYYY-MM-DD) del último commit que CAMBIÓ su documento, u hoy
// si está cambiado en el working tree. Una mudanza pura no cuenta. Dos llamadas a git para todas las
// tareas: la primera vez que aparece una tarea en el log, del más nuevo al más viejo, es su último toque.
func (l Layout) LastTouches() map[string]string {
	out := map[string]string{}
	ids := newIdentities()
	today := time.Now().Format("2006-01-02")
	touch := func(date string, c change) {
		if c.rename() {
			ids.link(c.from, c.path)
			if c.pureMove() {
				return
			}
		}
		if s := SlugOfRepoPath(c.path); s != "" && c.status != "D" {
			if id := ids.resolve(s); out[id] == "" {
				out[id] = date
			}
		}
	}
	for _, c := range l.workingTree() {
		touch(today, c)
	}
	l.logChanges(nil, func(date string, c change) { touch(date, c) })
	return out
}

// TouchedOn: las tareas cuyo documento cambió en el día (una mudanza pura no cuenta). Si el día es hoy,
// cuenta también lo que está cambiado sin commitear: lo sin commitear no tiene fecha.
func (l Layout) TouchedOn(day string, isToday bool) map[string]bool {
	out := map[string]bool{}
	ids := newIdentities()
	d, err := time.Parse("2006-01-02", day)
	if err != nil {
		return out
	}
	since := day + " 00:00:00"
	until := d.AddDate(0, 0, 1).Format("2006-01-02") + " 00:00:00"
	touch := func(c change) {
		if c.rename() {
			ids.link(c.from, c.path)
			if c.pureMove() {
				return
			}
		}
		if s := SlugOfRepoPath(c.path); s != "" && c.status != "D" {
			out[ids.resolve(s)] = true
		}
	}
	if isToday {
		for _, c := range l.workingTree() {
			touch(c)
		}
	}
	l.logChanges([]string{"--since=" + since, "--until=" + until}, func(_ string, c change) { touch(c) })
	return out
}

// DocumentBefore: el documento de una tarea como estaba en el último commit ANTERIOR al día, siguiendo
// sus mudanzas (si el día siguiente se movió, se lee de la ruta vieja). ok=false si no existía.
//
// ⚠ No sirve `git log -1 --before=… --follow`: git filtra por fecha ANTES de seguir el renombre, así que
// si la mudanza es posterior al día, el log queda vacío (lo cazó TestTheDocumentBeforeFollowsALaterMove).
// Se pide la historia entera con --follow —cada commit trae la ruta que tenía entonces— y se toma el
// primero anterior al día.
func (l Layout) DocumentBefore(slug, day string) (string, bool) {
	rel, err := filepath.Rel(l.root(), l.TaskPath(slug))
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	spec := rel
	// Una mudanza SIN COMMITEAR todavía no está en la historia de la ruta nueva, y --follow no tiene de
	// dónde seguir: se parte de la ruta vieja del renombre que está en el índice. Sin esto, el día de
	// una mudanza toda tarea movida parecía «recién creada» (lo cazó la comparación del 2026-09-23).
	if out, _ := l.git("log", "-1", "--format=%H", "--", rel); strings.TrimSpace(out) == "" {
		for _, c := range l.workingTree() {
			if c.rename() && (c.path == rel || strings.HasSuffix(c.path, "/"+rel)) {
				spec = ":(top)" + c.from
				break
			}
		}
	}
	out, err := l.git("log", "--follow", "--format=@%H %cs", "--name-only", "--", spec)
	if err != nil {
		return "", false
	}
	hash, date := "", ""
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "":
		case strings.HasPrefix(line, "@"):
			hash, date, _ = strings.Cut(line[1:], " ")
		case hash != "" && date < day:
			doc, err := l.git("show", hash+":"+line)
			if err != nil {
				return "", false
			}
			return doc, true
		}
	}
	return "", false
}
