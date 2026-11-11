package hooks

import "testing"

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

	if act, _ := cockpitActivity(map[string]any{"hook_event_name": "PreToolUse", "tool_name": "mcp__playground__sql",
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
		{"Bash", bash("make harness-case TARGET=local CASES='pullman@score=700'"), "harness", ""},
		{"Bash", bash("make tarea-bloque N=playground-local ARCHIVO=b.md"), "tablero", "#/tareas/playground-local"},
		{"Bash", bash("make tarea-bloque N=96 ARCHIVO=b.md"), "tablero", ""},
		{"Bash", bash("bin/pg tarea bloque --tarea integracion-vtex"), "tablero", "#/tareas/integracion-vtex"},
		{"Bash", bash("bin/jarvis open http://localhost:5207/"), "jarvis", ""},
		{"Bash", bash("bin/chat send miguel@creditop.com hola --as luigi"), "chat", ""},
		{"Bash", bash("git status"), "", ""},
		{"Edit", map[string]any{"file_path": "/repo/tablero/tasks/canon/task.md"}, "tablero", "#/tareas/canon"},
		{"Edit", map[string]any{"file_path": "/repo/harness/panel/index.html"}, "", ""},
		{"mcp__playground__tarea_bloque", map[string]any{"tarea": "harness"}, "tablero", "#/tareas/harness"},
	}
	for _, c := range cases {
		app, route := cockpitTarget(c.tool, c.in, "/repo")
		if app != c.app || route != c.route {
			t.Errorf("%s %v: dio %q %q, quería %q %q", c.tool, c.in, app, route, c.app, c.route)
		}
	}
}
