package citations

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"creditop/playground/tablero/server/internal/repos"
)

func run(t *testing.T, dir, date string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_DATE="+date, "GIT_COMMITTER_DATE="+date,
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

// lines: `n` líneas largas y distintas, para que cada una sirva de ancla.
func lines(prefix string, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("$%s_variable_numero_%02d = true;", prefix, i+1)
	}
	return out
}

func join(ls []string) string { return strings.Join(ls, "\n") + "\n" }

// Un repo citado y un documento que lo cita, con fechas: se afirma el 2 de enero y el código cambia
// el 3. Cada cita cae en el balde que corresponde a lo que le pasó a su línea.
func TestEachCitationLandsInTheBucketOfWhatHappenedToItsLine(t *testing.T) {
	tmp := t.TempDir()
	toy, pg := filepath.Join(tmp, "toy"), filepath.Join(tmp, "pg")
	for _, d := range []string{toy, pg} {
		run(t, tmp, "2026-01-01T12:00:00-0500", "init", "-q", "-b", "main", d)
	}
	a, c := lines("a", 30), lines("c", 10)
	write(t, filepath.Join(toy, "src/a.php"), join(a))
	write(t, filepath.Join(toy, "src/b.php"), join(lines("b", 5)))
	write(t, filepath.Join(toy, "src/c.php"), join(c))
	run(t, toy, "2026-01-01T12:00:00-0500", "add", ".")
	run(t, toy, "2026-01-01T12:00:00-0500", "commit", "-qm", "base")

	write(t, filepath.Join(pg, "tools/repos.json"), `{"indexed":{"toy":"`+toy+`"},"citable_only":{},"extensions":[".php"]}`)
	write(t, filepath.Join(pg, "docs/doc.md"), strings.Join([]string{
		"se movió: `src/a.php:5`",
		"se reescribió: `src/a.php:20`",
		"no existe la línea: `src/a.php:99`",
		"intacta: `src/b.php:3`",
		"corrida: `src/c.php:5`",
		"inexistente: `src/nope.php:1`",
		"corta: `:12`",
	}, "\n")+"\n")
	run(t, pg, "2026-01-02T12:00:00-0500", "add", ".")
	run(t, pg, "2026-01-02T12:00:00-0500", "commit", "-qm", "doc")

	// el 3: diez líneas arriba de a.php (y la 20 original reescrita), dos arriba de c.php
	moved := append(lines("nueva", 10), a...)
	moved[29] = "$esta_linea_ya_no_es_la_que_era = false;"
	write(t, filepath.Join(toy, "src/a.php"), join(moved))
	write(t, filepath.Join(toy, "src/c.php"), join(append(lines("arriba", 2), c...)))
	run(t, toy, "2026-01-03T12:00:00-0500", "commit", "-qam", "cambia")

	res := New(repos.New(filepath.Join(pg, "tools"))).Review([]string{filepath.Join(pg, "docs/doc.md")})
	want := map[string]string{
		Moved:     "toy: está en :15",
		Rewritten: "la línea de entonces ya no está",
		Outside:   "toy/src/a.php: tiene 40 líneas",
		OK:        "ancla",
		Shifted:   "toy: está en :7",
		Missing:   "",
		Short:     "relativa al contexto",
	}
	for key, note := range want {
		items := res.Buckets[key]
		if len(items) != 1 || !strings.Contains(items[0].Note, note) {
			t.Errorf("balde %s: quería una cita con «%s», hay %+v", key, note, items)
		}
	}
	if !res.Broken() {
		t.Error("con una movida, una reescrita y una fuera de rango, Broken tiene que dar true")
	}
}
