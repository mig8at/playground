package hooks

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"creditop/my-tools/lib/cockpit"
)

// Lo que el hook le manda al panel «Claude» de Cockpit: una línea por herramienta, emparejada antes y después.
func TestCockpitActivitySummarizesEachTool(t *testing.T) {
	pre := map[string]any{"hook_event_name": "PreToolUse", "session_id": "s1", "tool_use_id": "t1", "tool_name": "Bash",
		"tool_input": map[string]any{"command": "make harness-case TARGET=local\n# segunda línea", "description": "Correr el caso"}}
	act, ok := cockpitActivity(pre, "/repo")
	if !ok || act.Kind != "start" || act.ID != "t1" || act.Text != "make harness-case TARGET=local …  — Correr el caso" {
		t.Errorf("bash: %+v %v", act, ok)
	}

	post := map[string]any{"hook_event_name": "PostToolUse", "session_id": "s1", "tool_use_id": "t1", "tool_name": "Bash",
		"tool_input": map[string]any{"command": "false"}, "tool_response": map[string]any{"is_error": true}}
	if act, _ := cockpitActivity(post, "/repo"); act.Kind != "end" || act.OK == nil || *act.OK {
		t.Errorf("un error tiene que llegar como fallido: %+v", act)
	}

	read := map[string]any{"hook_event_name": "PreToolUse", "tool_name": "Read", "tool_input": map[string]any{"file_path": "/repo/tablero/src/App.vue"}}
	if act, _ := cockpitActivity(read, "/repo"); act.Text != "tablero/src/App.vue" || act.ID == "" {
		t.Errorf("read: la ruta relativa y un id aunque no venga: %+v", act)
	}

	for _, skip := range []map[string]any{
		{"hook_event_name": "PreToolUse", "tool_name": "mcp__ccd_turn__update_plan", "tool_input": map[string]any{}},
		{"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": map[string]any{"command": "bin/cockpit say hola"}},
	} {
		if _, ok := cockpitActivity(skip, "/repo"); ok {
			t.Errorf("no se manda: %v", skip["tool_name"])
		}
	}

	if act, _ := cockpitActivity(map[string]any{"hook_event_name": "PreToolUse", "tool_name": "mcp__my-tools__sql",
		"tool_input": map[string]any{"query": "SELECT 1"}}, ""); act.Tool != "sql" || act.Text != "SELECT 1" {
		t.Errorf("mcp: el nombre corto y su consulta: %+v", act)
	}
}

// Seguir a Claude: el USO de una herramienta la trae al frente; editar su código, no.
func TestCockpitTargetFollowsTheToolInUse(t *testing.T) {
	bash := func(cmd string) map[string]any { return map[string]any{"command": cmd} }
	cases := []struct {
		tool       string
		in         map[string]any
		app, route string
	}{
		{"Bash", bash("make harness-case TARGET=local CASES='pullman@score=700'"), "harness", "/local/pullman"},
		{"Bash", bash("make tarea-bloque N=my-tools ARCHIVO=b.md"), "tablero", "#/tareas/my-tools"},
		{"Bash", bash("make tarea-bloque N=96 ARCHIVO=b.md"), "tablero", ""},
		{"Bash", bash("bin/pg tarea bloque --tarea integracion-vtex"), "tablero", "#/tareas/integracion-vtex"},
		{"Bash", bash("bin/jarvis open http://localhost:5207/"), "jarvis", ""},
		{"Bash", bash("make goldfish-run REPO=legacy-backend RAMA=fix/x"), "goldfish", ""},
		{"Bash", bash("go run ./goldfish/server -list"), "goldfish", ""},
		{"Bash", bash("bin/chat send miguel@creditop.com hola --as luigi"), "chat", ""},
		{"Bash", bash("git status"), "", ""},
		{"Edit", map[string]any{"file_path": "/repo/tablero/tasks/canon/task.md"}, "tablero", "#/tareas/canon"},
		{"Edit", map[string]any{"file_path": "/repo/harness/panel/index.html"}, "", ""},
		{"mcp__my-tools__tarea_bloque", map[string]any{"tarea": "harness"}, "tablero", "#/tareas/harness"},
	}
	for _, c := range cases {
		app, route := cockpitTarget(c.tool, c.in, "/repo")
		if app != c.app || route != c.route {
			t.Errorf("%s %v: dio %q %q, quería %q %q", c.tool, c.in, app, route, c.app, c.route)
		}
	}
}

// Frenar desde Cockpit: con el freno puesto, una herramienta se niega (sale 2 y le dice a Claude por qué), bin/cockpit
// pasa, y escribirle a Claude lo levanta.
func TestCockpitStopBlocksToolsUntilMiguelWrites(t *testing.T) {
	stopped := true
	var activities int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-cockpit-token") != "llave" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/stop":
			if r.Method == http.MethodPost {
				var in struct {
					Stopped bool `json:"stopped"`
				}
				_ = json.NewDecoder(r.Body).Decode(&in)
				stopped = in.Stopped
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"stopped": stopped})
		case "/activity":
			activities++
		}
	}))
	defer srv.Close()
	home := t.TempDir()
	port := srv.Listener.Addr().(*net.TCPAddr).Port
	if err := os.MkdirAll(filepath.Dir(cockpit.ControlPath(home)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cockpit.ControlPath(home), []byte(fmt.Sprintf(`{"port":%d,"token":"llave"}`, port)), 0o600); err != nil {
		t.Fatal(err)
	}
	hook := func(payload string) (int, string) {
		var stderr bytes.Buffer
		code := Cockpit(Env{Home: home, Root: "/repo", Stdin: strings.NewReader(payload), Stdout: io.Discard, Stderr: &stderr})
		return code, stderr.String()
	}

	code, msg := hook(`{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"make harness-case TARGET=local"}}`)
	if code != 2 || !strings.Contains(msg, "te frenó") {
		t.Errorf("frenado, el comando se niega con el motivo: %d %q", code, msg)
	}
	if activities != 2 {
		t.Errorf("el intento negado queda en el panel (empieza y falla): %d avisos", activities)
	}
	if code, _ := hook(`{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"bin/cockpit say paré"}}`); code != 0 {
		t.Errorf("bin/cockpit pasa aunque esté frenado: %d", code)
	}
	if code, _ := hook(`{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"bin/cockpit restart tablero"}}`); code != 2 {
		t.Errorf("bin/cockpit restart hace algo: frenado no pasa (salió %d)", code)
	}
	if code, _ := hook(`{"hook_event_name":"UserPromptSubmit","prompt":"seguí"}`); code != 0 || stopped {
		t.Errorf("escribirle a Claude levanta el freno: %d %v", code, stopped)
	}
	if code, _ := hook(`{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}`); code != 0 {
		t.Errorf("sin freno, pasa: %d", code)
	}
}

// Un caso del harness deja el panel en su ambiente, comercio y canal.
func TestCockpitHarnessRouteFromTheCommand(t *testing.T) {
	cases := map[string]string{
		"make harness-case TARGET=local CASES='pullman@score=700'":                     "/local/pullman",
		"make harness-walk-wizard TARGET=qa CASES='motai:173' FLOW=self-service":       "/qa/motai/autogestion",
		"make harness-listing MERCHANT=alkosto TARGET=local":                           "/local/alkosto",
		"make harness-case TARGET=local CASES='#82e8961e:24'":                          "",
		"make harness-doctor TARGET=local":                                             "",
		"make harness-walk-wizard TARGET=local CASES='pullman' FLOW=merchant ENGINE=x": "/local/pullman/asesor",
	}
	for cmd, want := range cases {
		if app, got := cockpitTarget("Bash", map[string]any{"command": cmd}, ""); app != "harness" || got != want {
			t.Errorf("%s: dio %q %q, quería harness %q", cmd, app, got, want)
		}
	}
}

func TestFormatCockpit(t *testing.T) {
	closed := formatCockpit(nil)
	if !strings.Contains(closed, "cerrado") || !strings.Contains(closed, "make cockpit") {
		t.Fatalf("cerrado no dice cómo abrirlo: %q", closed)
	}
	var st cockpit.Status
	if err := json.Unmarshal([]byte(`{"current":"tablero","apps":[{"id":"chat","ready":true},{"id":"tablero","ready":true},{"id":"harness","ready":false}]}`), &st); err != nil {
		t.Fatal(err)
	}
	open := formatCockpit(&st)
	for _, want := range []string{"con tablero al frente", "arriba: chat · tablero", "apagadas: harness"} {
		if !strings.Contains(open, want) {
			t.Fatalf("falta %q en:\n%s", want, open)
		}
	}
}
