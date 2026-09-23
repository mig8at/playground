package layout

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Un repo de juguete con fechas controladas: la mudanza del 2026-09-23 tiene que ser invisible para
// «días sin tocar» y para el cierre, y lo que sí es trabajo tiene que seguir contando.
type toyRepo struct {
	t    *testing.T
	root string // raíz del repo
	l    Layout
}

func newToyRepo(t *testing.T) *toyRepo {
	root := t.TempDir()
	r := &toyRepo{t: t, root: root, l: At(filepath.Join(root, "tablero", "data"))}
	r.git("", "init", "-q")
	return r
}

func (r *toyRepo) git(date string, args ...string) string {
	r.t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@t", "-C", r.root}, args...)...)
	cmd.Env = os.Environ()
	if date != "" {
		cmd.Env = append(cmd.Env, "GIT_AUTHOR_DATE="+date+"T12:00:00", "GIT_COMMITTER_DATE="+date+"T12:00:00")
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		r.t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func (r *toyRepo) write(rel, text string) {
	r.t.Helper()
	p := filepath.Join(r.root, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		r.t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		r.t.Fatal(err)
	}
}

// mv mueve con git creando la carpeta de destino, como lo hará la mudanza de verdad.
func (r *toyRepo) mv(from, to string) {
	r.t.Helper()
	if err := os.MkdirAll(filepath.Dir(filepath.Join(r.root, to)), 0o755); err != nil {
		r.t.Fatal(err)
	}
	r.git("", "mv", from, to)
}

func (r *toyRepo) commit(date, msg string) {
	r.git(date, "add", "-A")
	r.git(date, "commit", "-q", "-m", msg)
}

func doc(title string) string {
	return "---\nid: 1\ntitle: \"" + title + "\"\n---\n\n## Si retomás esto sin contexto, empezá acá\n\n" +
		strings.Repeat("Una línea del cuerpo que hace que el archivo sea parecido a sí mismo.\n", 20)
}

func TestAPureMoveIsNotATouchAndHistoryIsInherited(t *testing.T) {
	r := newToyRepo(t)
	r.write("tablero/data/a.md", doc("A"))
	r.write("tablero/data/b.md", doc("B"))
	r.commit("2026-01-01", "nacen a y b")
	r.write("tablero/data/a.md", doc("A")+"Un avance.\n")
	r.commit("2026-01-02", "se trabaja en a")
	r.mv("tablero/data/a.md", "tablero/tasks/a/task.md")
	r.commit("2026-01-03", "mudanza")

	got := r.l.LastTouches()
	if got["a"] != "2026-01-02" {
		t.Errorf("a: la mudanza no es trabajo, el último toque es del 02; dio %q", got["a"])
	}
	if got["b"] != "2026-01-01" {
		t.Errorf("b sigue en data/ y no se tocó desde el 01; dio %q", got["b"])
	}
	if on, _ := r.l.TouchedOn("2026-01-03", false); on["a"] {
		t.Errorf("el día de la mudanza no tocó ninguna tarea; dio %v", on)
	}
	if on, _ := r.l.TouchedOn("2026-01-02", false); !on["a"] {
		t.Errorf("el 02 sí se trabajó en a; dio %v", on)
	}
}

// Un barrido declarado en el commit (SweepTrailer) no es trabajo en las tareas que toca: ni las vuelve
// tocadas para el cierre ni las despierta para la agenda. Y si ese mismo día hubo trabajo de verdad, la
// tarea sí está tocada.
func TestASweepDeclaredInTheCommitIsNotATouch(t *testing.T) {
	r := newToyRepo(t)
	r.write("tablero/tasks/a/task.md", doc("A"))
	r.write("tablero/tasks/b/task.md", doc("B"))
	r.commit("2026-03-01", "nacen")
	r.write("tablero/tasks/a/task.md", doc("A")+"ruta nueva\n")
	r.write("tablero/tasks/b/task.md", doc("B")+"ruta nueva\n")
	r.git("2026-03-05", "add", "-A")
	r.git("2026-03-05", "commit", "-q", "-m", "barrido de rutas", "-m", "Sin-avance: sólo se reapuntaron rutas")
	r.write("tablero/tasks/b/task.md", doc("B")+"ruta nueva\nun avance de verdad\n")
	r.commit("2026-03-05", "se trabaja en b")

	touched, swept := r.l.TouchedOn("2026-03-05", false)
	if touched["a"] || swept["a"] != "sólo se reapuntaron rutas" {
		t.Errorf("a sólo fue barrida: touched=%v swept=%v", touched, swept)
	}
	if !touched["b"] || swept["b"] != "" {
		t.Errorf("b además se trabajó ese día: touched=%v swept=%v", touched, swept)
	}
	got := r.l.LastTouches()
	if got["a"] != "2026-03-01" {
		t.Errorf("el barrido no despierta a a: su último toque es del 01; dio %q", got["a"])
	}
	if got["b"] != "2026-03-05" {
		t.Errorf("b se trabajó el 05; dio %q", got["b"])
	}
}

func TestARenamedSlugKeepsItsHistoryAndAMoveWithEditsCounts(t *testing.T) {
	r := newToyRepo(t)
	r.write("tablero/tasks/b/task.md", doc("B"))
	r.write("tablero/tasks/a/task.md", doc("A"))
	r.commit("2026-02-01", "nacen")
	r.git("", "mv", "tablero/tasks/b", "tablero/tasks/c")
	r.commit("2026-02-04", "b pasa a llamarse c")
	r.git("", "mv", "tablero/tasks/a", "tablero/tasks/z")
	r.write("tablero/tasks/z/task.md", doc("Z, reescrita")+strings.Repeat("Otra cosa distinta.\n", 25))
	r.commit("2026-02-05", "a se mueve y se reescribe")

	got := r.l.LastTouches()
	if got["c"] != "2026-02-01" {
		t.Errorf("c es b renombrada: hereda su último toque del 01; dio %q", got["c"])
	}
	if got["z"] != "2026-02-05" {
		t.Errorf("mover Y editar es trabajo: z se tocó el 05; dio %q", got["z"])
	}
}

func TestTheDocumentBeforeFollowsALaterMove(t *testing.T) {
	r := newToyRepo(t)
	r.write("tablero/data/a.md", doc("A de ayer"))
	r.commit("2026-03-01", "nace a")
	r.mv("tablero/data/a.md", "tablero/tasks/a/task.md")
	r.commit("2026-03-05", "mudanza")

	// el cierre del 05 compara con el documento de antes del 05, que vivía en la ruta vieja
	body, ok := r.l.DocumentBefore("a", "2026-03-05")
	if !ok || !strings.Contains(body, "A de ayer") {
		t.Fatalf("tenía que leer el documento del 01 en data/a.md; ok=%v:\n%s", ok, body)
	}
	if _, ok := r.l.DocumentBefore("a", "2026-03-01"); ok {
		t.Errorf("antes del 01 la tarea no existía")
	}
}

func TestTheWorkingTreeCountsEditsButNotAStagedMove(t *testing.T) {
	r := newToyRepo(t)
	r.write("tablero/data/a.md", doc("A"))
	r.write("tablero/data/b.md", doc("B"))
	r.commit("2026-04-01", "nacen")
	today := time.Now().Format("2006-01-02")

	r.mv("tablero/data/a.md", "tablero/tasks/a/task.md")
	if got := r.l.LastTouches(); got["a"] != "2026-04-01" {
		t.Errorf("un git mv sin commitear no es un toque; dio %q", got["a"])
	}
	if on, _ := r.l.TouchedOn(today, true); on["a"] {
		t.Errorf("hoy no se trabajó en a, sólo se movió; dio %v", on)
	}

	r.write("tablero/data/b.md", doc("B")+"Un avance sin commitear.\n")
	r.write("tablero/tasks/n/task.md", doc("Nueva"))
	got := r.l.LastTouches()
	if got["b"] != today || got["n"] != today {
		t.Errorf("lo cambiado y lo nuevo sin commitear es de hoy; dio b=%q n=%q", got["b"], got["n"])
	}
}

func TestSlugOfRepoPath(t *testing.T) {
	for in, want := range map[string]string{
		"tablero/tasks/kyc/task.md":       "kyc",
		"tasks/kyc/task.md":               "kyc",
		"tablero/data/kyc.md":             "kyc",
		"tablero/data/traps/doc.md":       "",
		"tablero/data/artifacts/k.md":     "",
		"tablero/tasks/kyc/context.jsonl": "",
	} {
		if got := SlugOfRepoPath(in); got != want {
			t.Errorf("%s → %q, quería %q", in, got, want)
		}
	}
}

// El día de una mudanza, antes de commitearla, el documento de ayer se lee de la ruta vieja: sin eso el
// cierre veía cada tarea movida como recién creada y salteaba los contenedores (medido el 2026-09-23).
func TestTheDocumentBeforeFollowsAnUncommittedMove(t *testing.T) {
	r := newToyRepo(t)
	r.write("tablero/data/a.md", doc("A de ayer"))
	r.commit("2026-05-01", "nace a")
	r.mv("tablero/data/a.md", "tablero/tasks/a/task.md") // en el índice, sin commit
	body, ok := r.l.DocumentBefore("a", time.Now().Format("2006-01-02"))
	if !ok || !strings.Contains(body, "A de ayer") {
		t.Fatalf("tenía que seguir la mudanza sin commitear hasta data/a.md; ok=%v", ok)
	}
}
