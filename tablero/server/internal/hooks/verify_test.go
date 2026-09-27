package hooks

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// toyRoot arma un playground de juguete con git: un archivo commiteado en `app/`.
func toyRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "app"), 0o755)
	os.WriteFile(filepath.Join(root, "app", "main.ts"), []byte("export const a = 1;\n"), 0o644)
	for _, args := range [][]string{
		{"init", "-q"}, {"-c", "user.email=t@t", "-c", "user.name=t", "add", "."},
		{"-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	return root
}

// transcript escribe un transcript con los tool_use dados y devuelve su ruta.
func transcript(t *testing.T, uses ...map[string]any) string {
	t.Helper()
	var lines []string
	for _, u := range uses {
		b, _ := json.Marshal(map[string]any{"message": map[string]any{"content": []any{u}}})
		lines = append(lines, string(b))
	}
	path := filepath.Join(t.TempDir(), "t.jsonl")
	os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
	return path
}

func edit(path string) map[string]any {
	return map[string]any{"type": "tool_use", "name": "Edit", "input": map[string]any{"file_path": path, "old_string": "a", "new_string": "b"}}
}

func bash(cmd string) map[string]any {
	return map[string]any{"type": "tool_use", "name": "Bash", "input": map[string]any{"command": cmd}}
}

func stop(t *testing.T, root, tr string, active bool) string {
	t.Helper()
	payload, _ := json.Marshal(map[string]any{"session_id": "s1", "transcript_path": tr, "stop_hook_active": active})
	var out bytes.Buffer
	env := Env{Root: root, Stdin: bytes.NewReader(payload), Stdout: &out, Stderr: &bytes.Buffer{}, Today: func() string { return "2026-09-27" }}
	if code := Verify(env); code != 0 {
		t.Fatalf("un hook de Stop sale 0 siempre; dio %d", code)
	}
	return out.String()
}

// withZones reemplaza las zonas reales (que corren make) por las de la prueba.
func withZones(t *testing.T, zones []zone) {
	t.Helper()
	saved := verifyZones
	verifyZones = zones
	t.Cleanup(func() { verifyZones = saved })
}

func failing() []zone {
	return []zone{{name: "toy", prefixes: []string{"app/"}, exts: []string{".ts"},
		commands: func([]string) [][]string {
			return [][]string{{"sh", "-c", "echo 'app/main.ts(1,1): error TS1375'; exit 2"}}
		}}}
}

// Leer no es tocar, y la extensión filtra: un .md de la zona no dispara el typecheck. Por Bash cuenta la
// ruta pegada a un verbo que escribe, no mencionarla.
func TestOnlyWhatTheSessionWroteInTheZoneCounts(t *testing.T) {
	root := "/r"
	z := zone{name: "toy", prefixes: []string{"app/"}, exts: []string{".ts"}}
	cases := []struct {
		name string
		uses []map[string]any
		want bool
	}{
		{"editar un .ts de la zona", []map[string]any{edit("/r/app/main.ts")}, true},
		{"editar un .md de la zona", []map[string]any{edit("/r/app/README.md")}, false},
		{"editar un .ts de otra carpeta", []map[string]any{edit("/r/other/main.ts")}, false},
		{"leerlo", []map[string]any{{"type": "tool_use", "name": "Read", "input": map[string]any{"file_path": "/r/app/main.ts"}}}, false},
		{"escribirlo por Bash", []map[string]any{bash("sed -i '' 's/a/b/' app/main.ts")}, true},
		{"nombrarlo en un grep", []map[string]any{bash("grep -rn foo app/main.ts")}, false},
	}
	for _, c := range cases {
		pieces := readTranscript(transcript(t, c.uses...))
		got := len(z.touchedPrefixes(writtenFiles(pieces, root), pieces)) > 0
		if got != c.want {
			t.Errorf("%s: tocó=%v, quería %v", c.name, got, c.want)
		}
	}
}

// El caso que lo motivó: un typecheck roto frena, con la salida del compilador. Y se avisa UNA vez por
// estado del árbol: la segunda respuesta sobre el mismo código no vuelve a frenar, pero cambiar el código
// vuelve a medir.
func TestAFailureBlocksOncePerTreeState(t *testing.T) {
	root := toyRoot(t)
	withZones(t, failing())
	tr := transcript(t, edit(filepath.Join(root, "app", "main.ts")))

	first := stop(t, root, tr, false)
	if !strings.Contains(first, `"decision": "block"`) || !strings.Contains(first, "TS1375") {
		t.Fatalf("un chequeo que falla tenía que frenar con su salida; dio:\n%s", first)
	}
	if again := stop(t, root, tr, false); again != "" {
		t.Errorf("con el mismo árbol no se vuelve a avisar; dio:\n%s", again)
	}
	os.WriteFile(filepath.Join(root, "app", "main.ts"), []byte("export const a = 2;\n"), 0o644)
	if changed := stop(t, root, tr, false); !strings.Contains(changed, "block") {
		t.Errorf("cambió el código: había que volver a medir y avisar; dio:\n%s", changed)
	}
}

// stop_hook_active corta el bucle; sin nada escrito en una zona no corre nada; un verde no dice nada.
func TestItStaysQuietWhenItShould(t *testing.T) {
	root := toyRoot(t)
	withZones(t, failing())
	if out := stop(t, root, transcript(t, edit(filepath.Join(root, "app", "main.ts"))), true); out != "" {
		t.Errorf("con stop_hook_active tiene que dejar terminar; dio:\n%s", out)
	}
	if out := stop(t, root, transcript(t, edit(filepath.Join(root, "docs.md"))), false); out != "" {
		t.Errorf("sin nada escrito en la zona no tiene que correr; dio:\n%s", out)
	}
	withZones(t, []zone{{name: "toy-ok", prefixes: []string{"app/"},
		commands: func([]string) [][]string { return [][]string{{"true"}} }}})
	if out := stop(t, root, transcript(t, edit(filepath.Join(root, "app", "main.ts"))), false); out != "" {
		t.Errorf("un verde no tiene que decir nada; dio:\n%s", out)
	}
}

// El de Go prueba sólo los paquetes tocados, no el módulo entero.
func TestTheGoZoneTestsOnlyTheTouchedPackages(t *testing.T) {
	for _, z := range verifyZones {
		if z.name != "go" {
			continue
		}
		got := z.commands([]string{"trazador/server/"})
		want := [][]string{{"go", "vet", "./trazador/server/..."}, {"go", "test", "./trazador/server/..."}}
		if len(got) != 2 || strings.Join(got[0], " ") != strings.Join(want[0], " ") || strings.Join(got[1], " ") != strings.Join(want[1], " ") {
			t.Errorf("comandos: %v", got)
		}
		return
	}
	t.Fatal("no hay zona de Go")
}
