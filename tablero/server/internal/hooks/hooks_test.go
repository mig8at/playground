package hooks

// No persiguen cobertura: cada una fija una conducta que ya falló, o que falló en la versión anterior.

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"creditop/playground/tablero/server/internal/shell"
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
