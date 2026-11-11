package hooks

// ── cockpit ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Le pasa a Cockpit (cockpit/, la app de escritorio) cada herramienta que usa Claude, para que Miguel vea en vivo, en
// el panel «Claude», qué está haciendo: antes de usarla (`start`, con una línea que la resume) y al terminar (`end`).
// Corre en PreToolUse y PostToolUse de TODAS las herramientas, y en UserPromptSubmit (`.claude/settings.json`).
//
// FRENAR: si Miguel tocó «Frenar» en el panel, en PreToolUse NIEGA la herramienta (sale 2: Claude Code le muestra el
// motivo a Claude) y la anota como ✗. Deja pasar sólo `bin/cockpit` (para que Claude cuente que paró) y las herramientas
// internas de la app (cerrar el turno). Cuando Miguel le escribe a Claude (UserPromptSubmit), el freno se levanta.
//
// ⚠ Fuera de eso no puede demorar a Claude: si Cockpit no está abierto (no hay archivo de control) sale al instante; si
// no contesta, corta a los 400 ms y deja pasar.

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	const wait = 400 * time.Millisecond
	switch str(payload, "hook_event_name") {
	case "UserPromptSubmit":
		_ = ctl.Do("POST", "/stop", map[string]any{"stopped": false, "by": "reanudado: le escribiste a Claude"}, nil, wait)
		return 0
	case "PreToolUse":
		if cockpitAlwaysAllowed(payload) {
			break
		}
		var st struct {
			Stopped bool `json:"stopped"`
		}
		if ctl.Do("GET", "/stop", nil, &st, wait) == nil && st.Stopped {
			if act, send := cockpitActivity(payload, env.Root); send {
				_ = ctl.Do("POST", "/activity", act, nil, wait)
				no := false
				act.Kind, act.OK = "end", &no
				_ = ctl.Do("POST", "/activity", act, nil, wait)
			}
			fmt.Fprintln(env.Stderr, "Miguel te frenó desde Cockpit: no uses más herramientas. Contale en una línea qué estabas "+
				"haciendo y dónde quedó, y esperá su indicación (puede reanudar desde el panel de Cockpit o escribirte).")
			return 2
		}
	}
	act, send := cockpitActivity(payload, env.Root)
	if !send {
		return 0
	}
	_ = ctl.Do("POST", "/activity", act, nil, wait)
	return 0
}

/*
cockpitSection: el aviso del arranque — si Cockpit está abierto y qué apps ya tienen su servidor arriba. Existe para

	que una sesión no levante un servidor que ya corre (dos `make tablero` chocan por el puerto) y sepa que lo que hace
	se ve en vivo. Cerrado no es un error: las herramientas se levantan con su `make`.
*/
func cockpitSection(home string) string {
	ctl, err := cockpit.Load(home)
	if err != nil {
		return formatCockpit(nil)
	}
	var st cockpit.Status
	if ctl.Do("GET", "/status", nil, &st, 400*time.Millisecond) != nil {
		return formatCockpit(nil)
	}
	return formatCockpit(&st)
}

func formatCockpit(st *cockpit.Status) string {
	if st == nil {
		return "  COCKPIT — cerrado (`make cockpit` lo abre): la app de escritorio donde Miguel ve las herramientas.\n" +
			"    Las interfaces se levantan con su `make` (tablero · panel · jarvis · visor · ecommerce · knowledge-ui). Detalle: cockpit/CLAUDE.md"
	}
	var up, down []string
	for _, a := range st.Apps {
		if a.Ready {
			up = append(up, a.ID)
		} else {
			down = append(down, a.ID)
		}
	}
	list := func(ids []string) string {
		if len(ids) == 0 {
			return "ninguna"
		}
		return strings.Join(ids, " · ")
	}
	front := st.Current
	if front == "" {
		front = "ninguna"
	}
	return fmt.Sprintf("  COCKPIT — abierto, con %s al frente: Miguel ve en vivo cada herramienta que usás (panel «Claude»)\n"+
		"    arriba: %s  ← su servidor YA corre: no levantes otro\n"+
		"    apagadas: %s  ← se levantan al abrirlas en la barra, o con su `make`\n"+
		"    `bin/cockpit open <app> [ruta]` lleva a Miguel a un lugar · `bin/cockpit say \"…\"` cuenta la intención. Detalle: cockpit/CLAUDE.md",
		front, list(up), list(down))
}

// cockpitAlwaysAllowed: lo que pasa aunque esté frenado — `bin/cockpit` (contar que paró) y lo interno de la app
// (la lista de tareas, cerrar el turno).
func cockpitAlwaysAllowed(payload map[string]any) bool {
	tool := str(payload, "tool_name")
	if strings.HasPrefix(tool, "mcp__ccd_") || tool == "ToolSearch" || tool == "TodoWrite" {
		return true
	}
	if tool == "Bash" {
		cmd := strings.TrimSpace(str(toolInput(payload), "command"))
		return strings.HasPrefix(cmd, "bin/cockpit ") || strings.Contains(cmd, "/bin/cockpit ")
	}
	return false
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
			return "harness", harnessRoute(cmd)
		case regexp.MustCompile(`\bmake (tarea-|tareas|retomar|agente|cierre|bitacora|tablero)|\bbin/pg (tarea|tareas|cierre|bitacora)\b`).MatchString(cmd):
			slug := ""
			if m := taskArg.FindStringSubmatch(cmd); m != nil {
				slug = m[1]
			}
			return "tablero", taskRoute(slug)
		case regexp.MustCompile(`\bmake knowledge-(read|search|map|check|ui)\b`).MatchString(cmd):
			// Leer un tema lo abre en knowledge (`ID=tema#ancla`).
			if m := regexp.MustCompile(`\bID=['"]?([a-z][a-z0-9-]*)(?:#([a-z0-9-]+))?`).FindStringSubmatch(cmd); m != nil {
				if m[2] != "" {
					return "knowledge", "#/" + m[1] + "/" + m[2]
				}
				return "knowledge", "#/" + m[1]
			}
			return "knowledge", ""
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

/*
La ruta del panel del harness para un comando: `/<ambiente>/<comercio>/<canal>` (la entiende su `applyRoute`). El

	ambiente sale de `TARGET=`; el comercio, de `MERCHANT=` o del primero de `CASES=` (por slug: un `#hash` no es una
	ruta del panel); el canal, de `FLOW=`. Sin ambiente o sin comercio, sin ruta: el panel queda donde estaba.
*/
var (
	harnessTargetArg   = regexp.MustCompile(`\bTARGET=['"]?(local|dev|qa|staging)\b`)
	harnessMerchantArg = regexp.MustCompile(`\b(?:MERCHANT|CASES)=['"]?([a-z][a-z0-9-]*)`)
	harnessFlowArg     = regexp.MustCompile(`\bFLOW=['"]?([a-z-]+)`)
	harnessChannels    = map[string]string{"merchant": "asesor", "advisor": "asesor", "asesor": "asesor",
		"self-service": "autogestion", "autogestion": "autogestion", "ecommerce": "ecommerce", "qr": "qr"}
)

func harnessRoute(cmd string) string {
	target := harnessTargetArg.FindStringSubmatch(cmd)
	merchant := harnessMerchantArg.FindStringSubmatch(cmd)
	if target == nil || merchant == nil {
		return ""
	}
	route := "/" + target[1] + "/" + merchant[1]
	if flow := harnessFlowArg.FindStringSubmatch(cmd); flow != nil {
		if channel, ok := harnessChannels[flow[1]]; ok {
			route += "/" + channel
		}
	}
	return route
}
