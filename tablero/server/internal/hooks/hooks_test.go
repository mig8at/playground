package hooks

// No persiguen cobertura: cada una fija una conducta que ya falló, o que falló en la versión anterior.

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"creditop/playground/connectors/canon"
	"creditop/playground/lib/shell"
	"creditop/playground/tablero/server/internal/canoncache"
)

// toyRepo arma un HOME con `Desktop/CREDITOP/github/legacy-backend` y un test que arrastra el trait.
func toyRepo(t *testing.T) (home, lb string) {
	t.Helper()
	home = t.TempDir()
	lb = filepath.Join(home, "Desktop", "CREDITOP", "github", "legacy-backend")
	for rel, body := range map[string]string{
		"tests/Feature/Jobs/WipesTest.php": "<?php\nuses(RefreshDatabase::class);\n",
		"tests/Unit/CleanTest.php":         "<?php\n// use RefreshDatabase; en un comentario no cuenta\nclass CleanTest {}\n",
	} {
		os.MkdirAll(filepath.Dir(filepath.Join(lb, rel)), 0o755)
		os.WriteFile(filepath.Join(lb, rel), []byte(body), 0o644)
	}
	return home, lb
}

func TestTheGuard(t *testing.T) {
	home, lb := toyRepo(t)
	playground := filepath.Join(home, "Desktop", "CREDITOP", "playground")
	worktree := filepath.Join(home, "legacy-backend-feature")
	os.MkdirAll(filepath.Join(worktree, "tests", "Feature", "Only"), 0o755)
	os.WriteFile(filepath.Join(worktree, "tests", "Feature", "Only", "OnlyTest.php"), []byte("<?php\nuse RefreshDatabase;\n"), 0o644)
	cases := []struct {
		name, cmd, cwd string
		blocks         bool
	}{
		{"la suite sin ruta", "cd " + lb + " && ./vendor/bin/sail artisan test", playground, true},
		{"recrear la base", "php artisan migrate:fresh --seed", lb, true},
		{"make fresh", "make fresh", lb, true},
		{"make test en el repo", "make test", lb, true},
		{"make test en OTRO repo", "make test", playground, false},
		{"una ruta limpia", "cd " + lb + " && sail artisan test tests/Unit", playground, false},
		{"una carpeta con el trait", "cd " + lb + " && sail artisan test tests/Feature/Jobs", playground, true},
		{"…a propósito", Override + " sail artisan test tests/Feature/Jobs", lb, false},
		// nombrar no es ejecutar: el cuerpo del heredoc y el mensaje del commit no cuentan
		{"el commit que dice make test", "git -C " + lb + " commit -m \"$(cat <<'EOF'\nmake test y migrate:fresh\nEOF\n)\"", playground, false},
		// ⚠ los dos huecos de la versión de Python
		{"la raíz con ~", "cd ~/Desktop/CREDITOP/github/legacy-backend && sail artisan test tests/Feature/Jobs", playground, true},
		{"la raíz relativa al cwd de la sesión", "cd legacy-backend && sail artisan test tests/Feature/Jobs", filepath.Dir(lb), true},
		{"un worktree no apaga la guarda", "phpunit tests/Unit; sail artisan db:wipe", worktree, true},
		{"la raíz es el worktree", "sail artisan test tests/Feature/Only", worktree, true},
	}
	for _, c := range cases {
		if got := len(Guard(c.cmd, c.cwd, home)) > 0; got != c.blocks {
			t.Errorf("%s: frena=%v, quería %v (%q)", c.name, got, c.blocks, c.cmd)
		}
	}
}

func TestAHookThatCannotReadItsInputLetsWorkGoOn(t *testing.T) {
	for _, name := range []string{"generated", "destructive-tests", "task-lint", "closeout", "no-existe"} {
		var stderr bytes.Buffer
		env := Env{Stdin: strings.NewReader("esto no es JSON"), Stdout: &bytes.Buffer{}, Stderr: &stderr, Today: func() string { return "2026-09-23" }}
		if code := Run(name, env); code == 2 {
			t.Errorf("%s: con una entrada rota bloqueó", name)
		}
	}
}

func TestSplitIsPosixShlex(t *testing.T) {
	cases := map[string][]string{
		`a "b c" 'd e'`:    {"a", "b c", "d e"},
		`x\ y "a\"b" '\n'`: {"x y", `a"b`, `\n`},
		`"\$" '' ""`:       {`\$`, "", ""},
		`a"b"c`:            {"abc"},
	}
	for in, want := range cases {
		got, err := shell.Split(in)
		if err != nil || strings.Join(got, "|") != strings.Join(want, "|") {
			t.Errorf("Split(%q) = %q %v, quería %q", in, got, err, want)
		}
	}
	for _, in := range []string{`"abierta`, `al final\`} {
		if _, err := shell.Split(in); err == nil {
			t.Errorf("Split(%q) tenía que fallar", in)
		}
	}
}

// Leer no es tocar, y nombrar junto a una escritura tampoco: la ruta tiene que estar pegada al verbo.
func TestWritingIsNotReadingNorNaming(t *testing.T) {
	const path = "tasks/kyc/task.md"
	cases := []struct {
		tool, input string
		wrote       bool
	}{
		{"Write", `{"file_path": "/x/tablero/tasks/kyc/task.md"}`, true},
		{"Read", `{"file_path": "/x/tablero/tasks/kyc/task.md"}`, false},
		{"Bash", `{"command": "head -60 tablero/tasks/kyc/task.md"}`, false},
		{"Bash", `{"command": "echo tablero/tasks/kyc/task.md > /tmp/lista"}`, false},
		{"Bash", `{"command": "echo x > tablero/tasks/kyc/task.md"}`, true},
		{"Bash", `{"command": "sed -i '' 's/a/b/' tablero/tasks/kyc/task.md"}`, true},
		{"Bash", `{"command": "git add tablero/tasks/kyc/task.md && git commit -m x"}`, true},
		{"Bash", `{"command": "python3 - <<'EOF'\np='tablero/tasks/kyc/task.md'\nopen(p,'w').write(s)\nEOF"}`, true},
	}
	for _, c := range cases {
		input, err := pyDumps([]byte(c.input))
		if err != nil {
			t.Fatal(err)
		}
		if got := wrote([]piece{{c.tool, input}}, path); got != c.wrote {
			t.Errorf("%s %s: escribió=%v, quería %v", c.tool, c.input, got, c.wrote)
		}
	}
}

// Los patrones se buscan sobre la entrada tal como la escribía `json.dumps` de Python.
func TestPyDumpsWritesLikePython(t *testing.T) {
	cases := map[string]string{
		`{"a":1,"b":[true,null,{}],"c":"ñ\n\u0001"}`: `{"a": 1, "b": [true, null, {}], "c": "ñ\n\u0001"}`,
		`[1.0, 1e20, 100000.0, 1.5e-7, 0.5]`:         `[1.0, 1e+20, 100000.0, 1.5e-07, 0.5]`,
	}
	for in, want := range cases {
		if got, err := pyDumps([]byte(in)); err != nil || got != want {
			t.Errorf("pyDumps(%s) = %s %v, quería %s", in, got, err, want)
		}
	}
}

func TestGeneratedFilesAreBlockedAndTheRestPass(t *testing.T) {
	for path, want := range map[string]int{"/x/trazador/logs.json": 2, "./trazador//logs.json": 2, "/x/trazador/server/main.go": 0, "": 0} {
		env := Env{Stdin: strings.NewReader(`{"tool_input":{"file_path":"` + path + `"}}`), Stderr: &bytes.Buffer{}}
		if got := Generated(env); got != want {
			t.Errorf("Generated(%q) = %d, quería %d", path, got, want)
		}
	}
}

func TestALooseTaskInDataIsStopped(t *testing.T) {
	env := Env{Stdin: strings.NewReader(`{"tool_input":{"file_path":"/x/tablero/data/tarea-suelta.md"}}`), Stderr: &bytes.Buffer{}}
	if got := TaskLint(env); got != 2 {
		t.Errorf("una tarea suelta en data/ tenía que frenarse; dio %d", got)
	}
}

// El catálogo de conectores sale de `bin/pg help --json`: marca lo que escribe y, si pg no anda, no
// imprime nada —el catálogo de make sale igual—.
func TestTheConnectorCatalogComesFromPgAndMarksWrites(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := connectorCatalog(root); got != "" {
		t.Errorf("sin pg no tiene que haber catálogo; dio %q", got)
	}
	script := "#!/bin/sh\necho '[{\"name\":\"sql\",\"summary\":\"lee\"},{\"name\":\"jira create\",\"summary\":\"crea\",\"write\":true}]'\n"
	if err := os.WriteFile(filepath.Join(root, "bin", "pg"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	got := connectorCatalog(root)
	if !strings.Contains(got, "    sql · ⚠jira create") || strings.Contains(got, "⚠sql") {
		t.Errorf("catálogo:\n%s", got)
	}
}

// El catálogo con descripciones pesaba 28 KB y Claude Code lo cortó a un preview de 2 KB: el modelo no
// veía ni canon ni el harness. Esta prueba lee el Makefile REAL, así que un target nuevo que empuje el
// catálogo por encima del presupuesto la hace fallar acá, y no en silencio al arrancar una sesión.
func TestTheRealCatalogFitsTheContextBudget(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	makefile, err := os.ReadFile(filepath.Join(root, "Makefile"))
	if err != nil {
		t.Fatalf("no encuentro el Makefile del playground: %v", err)
	}
	_, out, _, err := run(root, 20*time.Second, "make")
	if err != nil {
		t.Fatalf("make: %v", err)
	}
	targets := makeTargets(string(makefile))
	if len(targets) < 50 {
		t.Fatalf("leí %d targets del Makefile: el patrón dejó de reconocerlos", len(targets))
	}
	got := compactCatalog(withoutColors(out), targets)
	for name := range targets {
		if !strings.Contains(got, name) {
			t.Errorf("el catálogo perdió %q", name)
		}
	}
	// La sección de canon se mide con un canon MÁS GRANDE que el de hoy: 80 temas (hoy son 54) con nombres
	// de 12 caracteres (los reales promedian ~9), repartidos en seis etapas. Si canon crece más que eso,
	// falla acá y no se corta el inicio en silencio.
	var fake canoncache.Cache
	for i := 0; i < 80; i++ {
		fake.Topics = append(fake.Topics, canon.TopicSummary{Topic: fmt.Sprintf("tema-sint-%02d", i)})
	}
	for s := 0; s < 6; s++ {
		st := canon.Stage{Title: fmt.Sprintf("ETAPA NÚMERO %d", s)}
		for i := s * 6; i < s*6+10; i++ {
			st.Topics = append(st.Topics, fake.Topics[i].Topic)
		}
		fake.Stages = append(fake.Stages, st)
	}
	canonText := formatCanon(fake, "copia del 2026-09-27 19:00: canon no respondió")
	// Los conectores no entran en la cuenta (piden compilar pg): se les reserva 1,5 KB. Los accesos
	// tampoco (piden red): 700 B alcanzan para el renglón de estados y cuatro avisos.
	if size := len(header) + len(root) + len(got) + 1500 + 700 + len(canonText); size > contextBudget {
		t.Errorf("el catálogo pesa ~%d B, por encima de %d: Claude Code lo va a cortar", size, contextBudget)
	}
}

// Una línea del grupo que no es un target (los `go run` de canon) se queda entera, y un target que
// escribe lleva su ⚠ pegado al nombre.
func TestTheCompactCatalogKeepsGroupsAndNonTargetLines(t *testing.T) {
	catalog := "  CANON\n    canon-search       busca\n    canon-write        ⚠ ESCRIBE\n    go run . -ronda    qué cambió\n\n  HARNESS\n    harness-case       casos"
	got := compactCatalog(catalog, map[string]bool{"canon-search": false, "canon-write": true, "harness-case": false})
	want := "  CANON\n    canon-search · ⚠canon-write\n    go run . -ronda    qué cambió\n\n  HARNESS\n    harness-case"
	if got != want {
		t.Errorf("catálogo:\n%s\nquería:\n%s", got, want)
	}
}
