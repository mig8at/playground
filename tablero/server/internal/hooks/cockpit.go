package hooks

// ── cockpit ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Le pasa a Cockpit (cockpit/, la app de escritorio) cada herramienta que usa Claude, para que Miguel vea en vivo, en
// el panel «Claude», qué está haciendo: antes de usarla (`start`, con una línea que la resume) y al terminar (`end`).
// Corre en PreToolUse y PostToolUse de TODAS las herramientas (`.claude/settings.json`).
//
// ⚠ No puede frenar ni demorar a Claude: si Cockpit no está abierto (no hay archivo de control) sale al instante; si
// no contesta, corta a los 400 ms. Siempre sale 0.

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"creditop/playground/lib/cockpit"
)

func Cockpit(env Env) int {
	ctl, err := cockpit.Load(env.Home)
	if err != nil {
		return 0
	}
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	act, send := cockpitActivity(payload, env.Root)
	if !send {
		return 0
	}
	_ = ctl.Do("POST", "/activity", act, nil, 400*time.Millisecond)
	return 0
}

// cockpitActivity arma la línea del panel. `false`: no se manda (una herramienta interna de la app, o el propio
// `bin/cockpit`, que ya se ve como mensaje).
func cockpitActivity(payload map[string]any, root string) (cockpit.Activity, bool) {
	tool := str(payload, "tool_name")
	in := toolInput(payload)
	if tool == "" || strings.HasPrefix(tool, "mcp__ccd_") || tool == "ToolSearch" || tool == "TodoWrite" {
		return cockpit.Activity{}, false
	}
	text := toolSummary(tool, in, root)
	if tool == "Bash" && (strings.HasPrefix(text, "bin/cockpit") || strings.Contains(text, "/bin/cockpit ")) {
		return cockpit.Activity{}, false
	}
	act := cockpit.Activity{Session: str(payload, "session_id"), Tool: shortTool(tool), Text: text}
	// Pre y Post se emparejan por el id de la llamada; si el evento no lo trae, por lo que se llamó.
	act.ID = str(payload, "tool_use_id")
	if act.ID == "" {
		raw, _ := json.Marshal(in)
		sum := sha1.Sum([]byte(act.Session + tool + string(raw)))
		act.ID = hex.EncodeToString(sum[:8])
	}
	switch str(payload, "hook_event_name") {
	case "PreToolUse":
		act.Kind = "start"
		act.App, act.Route = cockpitTarget(tool, in, root)
	case "PostToolUse":
		act.Kind = "end"
		okay := !toolFailed(payload)
		act.OK = &okay
	default:
		return cockpit.Activity{}, false
	}
	return act, true
}

// toolFailed: lo que la respuesta de la herramienta deja ver de un error.
func toolFailed(payload map[string]any) bool {
	resp, _ := payload["tool_response"].(map[string]any)
	if resp == nil {
		return false
	}
	for _, key := range []string{"is_error", "interrupted"} {
		if v, _ := resp[key].(bool); v {
			return true
		}
	}
	if e, _ := resp["error"].(string); e != "" {
		return true
	}
	return false
}

// shortTool: `mcp__playground__sql` → `sql`; las demás, como vienen.
func shortTool(tool string) string {
	if strings.HasPrefix(tool, "mcp__") {
		if i := strings.LastIndex(tool, "__"); i > 4 {
			return tool[i+2:]
		}
	}
	return tool
}

// toolSummary: UNA línea que dice qué se hace — el comando, el archivo, lo que se busca.
func toolSummary(tool string, in map[string]any, root string) string {
	rel := func(p string) string {
		if root != "" {
			if r, err := filepath.Rel(root, p); err == nil && !strings.HasPrefix(r, "..") {
				return r
			}
		}
		return p
	}
	first := func(s string) string {
		s = strings.TrimSpace(s)
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			return strings.TrimSpace(s[:i]) + " …"
		}
		return s
	}
	switch tool {
	case "Bash":
		if d := str(in, "description"); d != "" {
			return first(str(in, "command")) + "  — " + d
		}
		return first(str(in, "command"))
	case "Read", "Edit", "Write", "NotebookEdit":
		return rel(str(in, "file_path"))
	case "Grep":
		return str(in, "pattern")
	case "Glob":
		return str(in, "pattern")
	case "WebFetch":
		return str(in, "url")
	case "WebSearch":
		return str(in, "query")
	case "Agent", "Task":
		return str(in, "description")
	case "Skill":
		return str(in, "skill")
	}
	// Una herramienta MCP u otra: su primer argumento de texto, si tiene.
	for _, key := range []string{"query", "q", "command", "url", "action", "id"} {
		if v := str(in, key); v != "" {
			return first(v)
		}
	}
	return ""
}

/*
SEGUIR A CLAUDE: a qué app de Cockpit corresponde una herramienta, y en qué ruta. Sólo el USO de una herramienta la

	trae al frente —correr el harness, escribir en una tarea, manejar Jarvis—; editar el código de una herramienta es
	trabajar en ella, no usarla, y no mueve nada. Vacío: no corresponde a ninguna.
*/
var (
	taskArg     = regexp.MustCompile(`(?:\bN=|--tarea[= ]|\bTAREA=)['"]?([a-z0-9][a-z0-9-]*)`)
	taskDocPath = regexp.MustCompile(`(?:^|/)tablero/tasks/([a-z0-9][a-z0-9-]*)/`)
)

func cockpitTarget(tool string, in map[string]any, root string) (app, route string) {
	taskRoute := func(slug string) string {
		// Una tarea por número no tiene ruta: el tablero se abre en el sprint.
		if slug == "" || regexp.MustCompile(`^[0-9]+$`).MatchString(slug) {
			return ""
		}
		return "#/tareas/" + slug
	}
	switch tool {
	case "Bash":
		cmd := str(in, "command")
		switch {
		case regexp.MustCompile(`\bmake (harness-|panel\b)|\bbin/advisor\b|\bharness/(dev|bin)/`).MatchString(cmd):
			return "harness", ""
		case regexp.MustCompile(`\bmake (tarea-|tareas|retomar|agente|cierre|bitacora|tablero)|\bbin/pg (tarea|tareas|cierre|bitacora)\b`).MatchString(cmd):
			slug := ""
			if m := taskArg.FindStringSubmatch(cmd); m != nil {
				slug = m[1]
			}
			return "tablero", taskRoute(slug)
		case regexp.MustCompile(`\bbin/jarvis\b|\bmake jarvis`).MatchString(cmd):
			return "jarvis", ""
		case regexp.MustCompile(`\bmake visor`).MatchString(cmd):
			return "designer", ""
		case regexp.MustCompile(`\bmake ecommerce\b|\becommerce/server\b`).MatchString(cmd):
			return "ecommerce", ""
		case regexp.MustCompile(`\bbin/chat\b|\bplayground (send|online|history)\b`).MatchString(cmd):
			return "chat", ""
		}
	case "Edit", "Write":
		// El documento o la pila de una tarea: es escribir EN el tablero.
		if m := taskDocPath.FindStringSubmatch(str(in, "file_path")); m != nil {
			return "tablero", taskRoute(m[1])
		}
	}
	short := shortTool(tool)
	switch {
	case short == "tarea_bloque" || short == "tarea_pila" || short == "bitacora_add" || short == "tareas" || short == "cierre":
		return "tablero", taskRoute(str(in, "tarea"))
	case strings.HasPrefix(short, "harness"):
		return "harness", ""
	}
	return "", ""
}
