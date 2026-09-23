package pulse

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Estas dos piezas fallan EN SILENCIO si se rompen —el pulso simplemente registra menos y nadie se
// entera hasta que la jornada aparece vacía—, así que van fijadas con un repo git de verdad en un
// temporal: probar el parseo contra salidas inventadas de git no habría atajado ninguno de los dos bugs
// reales que aparecieron acá (el repo anidado y el mtime de carpeta).

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	base := []string{"-c", "user.email=yo@ejemplo.com", "-c", "user.name=Yo", "-c", "commit.gpgsign=false"}
	cmd := exec.Command("git", append(base, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// testRepo deja un repo con un commit hecho por `yo@ejemplo.com`.
func testRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitIn(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("uno\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-qm", "primero")
	return dir
}

func byType(sigs []Signal) map[string]int {
	m := map[string]int{}
	for _, s := range sigs {
		m[s.Why]++
	}
	return m
}

func TestProbeSeesCommitAndReflog(t *testing.T) {
	dir := testRepo(t)
	sigs := Probe(filepath.Dir(dir), dir, time.Now().Add(-time.Hour), []string{"yo@ejemplo.com"})

	kinds := byType(sigs)
	if kinds["commit"] != 1 {
		t.Errorf("commits = %d, se esperaba 1 — %v", kinds["commit"], sigs)
	}
	if kinds["reflog"] == 0 {
		t.Error("el reflog no aportó ninguna señal: sin él se pierde el trabajo que no deja commit")
	}
	for _, s := range sigs {
		if s.Branch != "main" {
			t.Errorf("branch = %q, se esperaba main", s.Branch)
		}
	}
}

// El autor es el filtro que separa MI jornada de la del equipo: lo que baja con un `pull` no cuenta.
func TestProbeIgnoresForeignCommits(t *testing.T) {
	dir := testRepo(t)
	if kinds := byType(Probe(filepath.Dir(dir), dir, time.Now().Add(-time.Hour), []string{"otro@ejemplo.com"})); kinds["commit"] != 0 {
		t.Errorf("commits ajenos contados = %d, se esperaba 0", kinds["commit"])
	}
}

// La señal `edit` es la única que ve el trabajo en curso: el mtime se pierde al commitear.
func TestProbeSeesDirtyFileAndRespectsWindow(t *testing.T) {
	dir := testRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("dos\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	sigs := Probe(filepath.Dir(dir), dir, time.Now().Add(-time.Hour), []string{"yo@ejemplo.com"})
	if byType(sigs)["edit"] != 1 {
		t.Fatalf("edit = %d, se esperaba 1 — %v", byType(sigs)["edit"], sigs)
	}

	// Un archivo que quedó sucio ANTES de la ventana no prueba que estés trabajando ahora: contarlo
	// pintaría de verde una hora que no existió.
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(filepath.Join(dir, "a.txt"), old, old); err != nil {
		t.Fatal(err)
	}
	if kinds := byType(Probe(filepath.Dir(dir), dir, time.Now().Add(-time.Hour), []string{"yo@ejemplo.com"})); kinds["edit"] != 0 {
		t.Errorf("edit fuera de ventana = %d, se esperaba 0", kinds["edit"])
	}
}

// El bug real: `microservices/` ve sus servicios como carpetas sin seguimiento, así que se ensuciaba
// cada vez que se trabajaba en cualquiera de ellos y se llevaba a su nombre horas de otro repo.
func TestProbeIsNotDirtiedByNestedRepo(t *testing.T) {
	parent := testRepo(t)
	child := filepath.Join(parent, "servicio")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	gitIn(t, child, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(child, "b.txt"), []byte("hola\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if kinds := byType(Probe(filepath.Dir(parent), parent, time.Now().Add(-time.Hour), []string{"yo@ejemplo.com"})); kinds["edit"] != 0 {
		t.Errorf("el padre reportó %d ediciones por un repo anidado; se esperaba 0", kinds["edit"])
	}
	// …y el anidado SÍ se descubre por su cuenta, con su ruta relativa como nombre.
	repos := Repos(filepath.Dir(parent))
	var seen bool
	for _, r := range repos {
		if r == child {
			seen = true
		}
	}
	if !seen {
		t.Errorf("el repo anidado no se descubrió: %v", repos)
	}
	if n := Name(filepath.Dir(parent), child); n != filepath.Join(filepath.Base(parent), "servicio") {
		t.Errorf("Name = %q; se esperaba la ruta relativa (dos repos distintos no pueden compartir nombre)", n)
	}
}

// ── agregación ──────────────────────────────────────────────────────────────────────────────────

func sig(repo, at, why, what string) Signal {
	return Signal{Repo: repo, At: at, Why: why, What: what}
}

// La idempotencia es la propiedad que hace segura una siembra sobre datos que ya existen: sin dedupe,
// re-sembrar duplicaría commits y el mapa iría creciendo solo.
func TestAggregateDedupesAcrossTicks(t *testing.T) {
	one := sig("repo", "2026-08-04T10:07:00-05:00", "commit", "x")
	one.Insertions, one.Deletions = 10, 2
	ticks := []Tick{
		{T: "2026-08-04T10:10:00-05:00", Since: "2026-08-04T10:05:00-05:00", Signals: []Signal{one}},
		{T: "2026-08-04T10:15:00-05:00", Since: "2026-08-04T10:10:00-05:00", Signals: []Signal{one}},
	}
	hours := Aggregate(ticks, 0)
	var c *Hour
	for i := range hours {
		if hours[i].Day == "2026-08-04" && hours[i].Hour == 10 {
			c = &hours[i]
		}
	}
	if c == nil {
		t.Fatal("no se agregó la hora 10")
	}
	if c.Commits != 1 || c.Insertions != 10 {
		t.Errorf("commits=%d ins=%d; el mismo commit visto dos veces tiene que contar una", c.Commits, c.Insertions)
	}
	if c.Slots != 1 {
		t.Errorf("slots=%d; dos señales en el mismo tramo son un tramo", c.Slots)
	}
}

// Sin esta distinción el mapa acusa: un hueco porque el Mac estaba apagado se leería como "no trabajé".
func TestAggregateSeparatesNoRecordFromNoChanges(t *testing.T) {
	hours := Aggregate([]Tick{
		{T: "2026-08-04T14:03:00-05:00", Since: "2026-08-04T13:58:00-05:00"}, // tick vacío: miró y no había nada
	}, 0)
	if len(hours) == 0 {
		t.Fatal("un tick sin señales igual tiene que dejar cobertura")
	}
	var covered int
	for _, h := range hours {
		covered += h.Covered
		if h.Slots != 0 {
			t.Errorf("slots=%d sobre un tick vacío", h.Slots)
		}
	}
	if covered == 0 {
		t.Error("cobertura=0: sin ella no se distingue 'no trabajé' de 'nadie estaba anotando'")
	}
}

// Una siembra mira semanas hacia atrás y no puede reclamar que el agente estuvo vivo todo ese tiempo.
func TestAggregateDoesNotTrustSeededCoverage(t *testing.T) {
	hours := Aggregate([]Tick{{
		T:       "2026-08-04T09:00:00-05:00",
		Since:   "2026-07-15T09:00:00-05:00",
		Signals: []Signal{sig("repo", "2026-07-20T11:20:00-05:00", "commit", "viejo")},
	}}, 0)
	for _, h := range hours {
		if h.Day == "2026-07-20" && h.Covered != 0 {
			t.Errorf("la siembra reclamó cobertura en %s %dh", h.Day, h.Hour)
		}
	}
}

// `Read` filtra por la fecha del TICK, y como cada señal lleva su propio instante, una siembra escrita
// hoy contiene semanas de historia. La grilla lo disimulaba —dibuja sólo sus columnas— pero el desglose
// "en qué" sumaba días que el encabezado decía no estar mostrando.
func TestAggregateClipsToWindow(t *testing.T) {
	old := time.Now().AddDate(0, 0, -30)
	today := time.Now()
	tk := Tick{
		T:     today.Format(time.RFC3339),
		Since: old.Format(time.RFC3339),
		Signals: []Signal{
			sig("repo", old.Format(time.RFC3339), "commit", "de hace un mes"),
			sig("repo", today.Format(time.RFC3339), "commit", "de hoy"),
		},
	}
	if n := len(Aggregate([]Tick{tk}, 0)); n < 2 {
		t.Fatalf("sin ventana se esperaban las dos celdas, hubo %d", n)
	}
	cut := time.Now().AddDate(0, 0, -6).Format("2006-01-02")
	for _, h := range Aggregate([]Tick{tk}, 7) {
		if h.Day < cut {
			t.Errorf("celda de %s fuera de la ventana de 7 días (corte %s)", h.Day, cut)
		}
	}
}

func TestAggregateSlotsPerHour(t *testing.T) {
	var sigs []Signal
	for _, m := range []string{"00", "04", "05", "17", "59"} { // 00 y 04 caen en el MISMO tramo
		sigs = append(sigs, sig("repo", "2026-08-04T11:"+m+":00-05:00", "reflog", "x"+m))
	}
	hours := Aggregate([]Tick{{T: "2026-08-04T12:00:00-05:00", Since: "2026-08-04T11:00:00-05:00", Signals: sigs}}, 0)
	for _, h := range hours {
		if h.Hour == 11 && h.Slots != 4 {
			t.Errorf("slots=%d, se esperaban 4 (00 y 04 comparten tramo)", h.Slots)
		}
	}
	if SlotsPerHour != 12 {
		t.Errorf("SlotsPerHour=%d; la grilla de la jornada asume 12", SlotsPerHour)
	}
}
