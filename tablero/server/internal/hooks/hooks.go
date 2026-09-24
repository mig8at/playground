// Package hooks son los hooks de Claude Code del playground (`.claude/settings.json`): reglas que
// estaban escritas como «acordate de correr X» y pasaron a ser automáticas, porque una regla que
// depende de que alguien se acuerde se olvida, sobre todo cuando olvidarla NO ROMPE NADA.
//
//	session-start      SessionStart · el catálogo de `make`, para que un modelo no decida que no puede
//	generated          PreToolUse (Write|Edit) · frena editar a mano un archivo GENERADO
//	destructive-tests  PreToolUse (Bash) · frena lo que puede recrear una base desde legacy-backend
//	task-lint          PostToolUse (Write|Edit) · valida una tarea del tablero apenas se escribe
//	closeout           Stop · el cierre de sesión del tablero, sobre las tareas que ESTA sesión tocó
//
// Nacieron como cinco scripts de Python en `.claude/hooks/` y pasaron a Go el 2026-09-23, comparados
// entrada por entrada contra esa versión. Los corre `.claude/hooks/run`, que compila el binario cuando
// cambia su código.
//
// ⚠ UN HOOK ROTO NO PUEDE IMPEDIR TRABAJAR: todo error interno sale 0 (o 1, que Claude Code muestra y no
// bloquea). Sólo un motivo de verdad sale 2.
package hooks

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/lib/text"
)

// Env es lo que un hook necesita saber de afuera.
type Env struct {
	Root   string // la raíz del playground
	Home   string
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
	Today  func() string // la fecha local, YYYY-MM-DD
}

// Run corre el hook `name` y devuelve el código de salida.
func Run(name string, env Env) int {
	switch name {
	case "session-start":
		return SessionStart(env)
	case "generated":
		return Generated(env)
	case "destructive-tests":
		return DestructiveTests(env)
	case "task-lint":
		return TaskLint(env)
	case "closeout":
		return Closeout(env)
	}
	fmt.Fprintf(env.Stderr, "(hook desconocido: %q; no se bloquea)\n", name)
	return 0
}

func readPayload(r io.Reader) (map[string]any, bool) {
	var payload map[string]any
	if err := json.NewDecoder(r).Decode(&payload); err != nil || payload == nil {
		return nil, false
	}
	return payload, true
}

func str(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

func toolInput(payload map[string]any) map[string]any {
	in, _ := payload["tool_input"].(map[string]any)
	return in
}

// ── SessionStart ────────────────────────────────────────────────────────────────────────────────

const header = `# Herramientas de este repo (playground) — inyectado al arrancar, no hace falta correr nada

` + "`make <comando>`" + ` desde %s es la puerta única. Antes de decir que NO podés
acceder a algo (logs, base de datos, documentación de negocio), buscalo en esta lista: casi todo
lo externo ya está cableado y con credenciales puestas.

Lo que NO está acá: **Slack** entra por su MCP (ya conectado, herramientas ` + "`slack_*`" + `) y **Jira**
tiene un servidor MCP propio en ` + "`tablero/server/cmd/jira-mcp`" + ` que sólo funciona si está registrado
en la config — si no ves herramientas ` + "`jira_*`" + `, no lo está.

`

// withoutColors saca las secuencias ANSI del help de `make`: en la terminal son color, en contexto ruido.
// Una secuencia rara que no cierra en 12 caracteres no se come el texto.
func withoutColors(s string) string {
	var out strings.Builder
	for i := 0; i < len(s); {
		if s[i] == '\033' {
			if end := strings.IndexByte(s[i:], 'm'); end != -1 && end < 12 {
				i += end + 1
				continue
			}
		}
		out.WriteByte(s[i])
		i++
	}
	return out.String()
}

/* SessionStart le dice al modelo qué herramientas tiene, sin que nadie se acuerde de correr `make`.
 *
 * EL PROBLEMA QUE RESUELVE: el playground ya tiene acceso a Loki, a Redash, a las cuatro bases de datos
 * y a Confluence — pero un modelo que no corre `make` no se entera, **decide que no puede** y contesta
 * suponiendo. Falla en silencio y hacia el lado peor: inventar en vez de mirar.
 *
 * POR QUÉ UN HOOK Y NO UNA LÍNEA EN CLAUDE.md: este catálogo se genera del propio Makefile. Escrito a
 * mano, se desincroniza el día que agregás un target y nadie lo nota. Sin matcher en settings.json,
 * así que también entra al reanudar y DESPUÉS DE COMPACTAR — que es cuando más se olvida. Para
 * SessionStart el stdout entra como texto plano al contexto. */
func SessionStart(env Env) int {
	_, out, _, err := run(env.Root, 20*time.Second, "make")
	if err != nil {
		fmt.Fprintf(env.Stderr, "(no se pudo listar las herramientas: %s)\n", err)
		return 0
	}
	catalog := strings.TrimRightFunc(withoutColors(out), text.IsSpace)
	if catalog == "" {
		return 0
	}
	fmt.Fprintf(env.Stdout, header, env.Root)
	fmt.Fprintln(env.Stdout, catalog)
	return 0
}

// ── PreToolUse: generados ───────────────────────────────────────────────────────────────────────

// generatedFiles: archivo generado → con qué se regenera. Un archivo generado suele decir «no lo edites
// a mano», y eso es una regla escrita: se puede violar sin que nada falle, y la próxima regeneración
// borra el cambio en silencio. Un PreToolUse con exit 2 IMPIDE la escritura y devuelve el motivo.
var generatedFiles = []struct{ path, command string }{
	// El índice de mensajes de log → archivo: se deriva del código de los repos, así que una corrección a
	// mano se pierde en la próxima corrida y, mientras tanto, resuelve trazas contra un código que no existe.
	{"trazador/logs.json", "make trazador-indexar-logs"},
}

// asPosix es `pathlib.Path(p).as_posix()`: sin barras repetidas, sin `.` sueltos y sin barra final.
func asPosix(p string) string {
	ps := parts(p)
	if len(ps) == 0 {
		return "."
	}
	return joinParts(ps)
}

// Generated frena editar a mano un archivo que se regenera.
func Generated(env Env) int {
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	target := str(toolInput(payload), "file_path")
	if target == "" {
		return 0
	}
	posix := asPosix(target)
	for _, g := range generatedFiles {
		if strings.HasSuffix(posix, g.path) {
			fmt.Fprintf(env.Stderr, "✋ `%s` es un archivo GENERADO: editarlo a mano se pierde en la próxima "+
				"regeneración, sin aviso.\n   Para cambiar su contenido, cambiá la FUENTE y regeneralo:\n     %s\n", g.path, g.command)
			return 2
		}
	}
	return 0
}

// ── PreToolUse: tests destructivos ──────────────────────────────────────────────────────────────

// DestructiveTests: ver `destructive.go`.
func DestructiveTests(env Env) int {
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	if tool, present := payload["tool_name"]; present && tool != nil && tool != "Bash" {
		return 0
	}
	cmd := str(toolInput(payload), "command")
	reasons := Guard(cmd, str(payload, "cwd"), env.Home)
	if len(reasons) == 0 {
		return 0
	}
	fmt.Fprint(env.Stderr, "⛔ Bloqueado por el hook destructive-tests (tablero/server/internal/hooks/destructive.go · CLAUDE.md §«La suite de PHPUnit de "+
		"legacy-backend NO se corre entera»):\n")
	for _, r := range reasons {
		fmt.Fprintf(env.Stderr, "  ✗ %s\n", r)
	}
	return 2
}

// ── PostToolUse: lint de la tarea ───────────────────────────────────────────────────────────────

// suffix es `pathlib.Path(p).suffix`: la extensión del nombre, sin contar el punto de un archivo oculto.
func suffix(p string) string {
	n := name(p)
	if i := strings.LastIndex(n, "."); i > 0 && i < len(n)-1 {
		return n[i:]
	}
	return ""
}

/* TaskLint valida un archivo de tarea del tablero apenas se escribe.
 *
 * EL PROBLEMA: el frontmatter de una tarea no falla en ningún lado. Una etapa inventada no cae en
 * ninguna columna; un id repetido hace que una tarea PISE a la otra; y un texto con rutas o repos
 * debajo de «## Tarea (publicable)» sale a Jira. Las cuatro pasaron (27/8 y 14/9) y nadie se enteró.
 *
 * Si lo escrito es `tablero/tasks/<slug>/task.md`, corre `tasks -lint`, la fuente única de esas
 * reglas. Si es un `.md` suelto en `tablero/data/` —donde vivían las tareas hasta el 2026-09-23—, lo
 * frena: una sesión con el mapa viejo recrearía ahí una tarea que ya nadie lee. Un PostToolUse no
 * puede bloquear, pero con exit 2 su stderr vuelve al modelo como error. */
func TaskLint(env Env) int {
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	target := str(toolInput(payload), "file_path")
	dir := parent(target)
	if suffix(target) == ".md" && name(dir) == "data" && name(parent(dir)) == "tablero" {
		fmt.Fprintf(env.Stderr, "✗ %s quedó suelto en tablero/data/, donde las tareas vivían hasta el "+
			"2026-09-23. Hoy una tarea es una carpeta: tablero/tasks/<slug>/task.md, con su "+
			"context.jsonl y su artifacts/ al lado (tablero/CLAUDE.md). Movelo ahí.\n", name(target))
		return 2
	}
	if name(target) != "task.md" || name(parent(dir)) != "tasks" || name(parent(parent(dir))) != "tablero" {
		return 0
	}
	server := filepath.Join(env.Root, "tablero", "server")
	// ⚠ Si esta carpeta no existe el hook sale 0 SIN AVISAR. Así estuvo apagado desde el 2026-09-23 (fase
	// 3 del código en inglés): la carpeta pasó de `cmd/tareas` a `cmd/tasks` y la ruta quedó vieja.
	if _, err := os.Stat(target); err != nil || !isDir(filepath.Join(server, "cmd", "tasks")) {
		return 0
	}
	code, _, stderr, err := run(server, 60*time.Second, "go", "run", "./cmd/tasks", "-lint", target)
	if err != nil {
		return 0
	}
	if code == 1 {
		fmt.Fprint(env.Stderr, strings.TrimRightFunc(stderr, text.IsSpace)+"\n"+
			"Arreglalo ahora: la regla de cada campo está en tablero/TASK-TEMPLATE.md.\n")
		return 2
	}
	return 0
}

// run corre un comando con tope de tiempo y devuelve su código, stdout y stderr. El error es sólo el de
// no haber podido correrlo (no existe, se pasó del tope).
func run(dir string, timeout time.Duration, name string, args ...string) (int, string, string, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	var stdout, stderr strings.Builder
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Start(); err != nil {
		return 0, "", "", err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			if exit, ok := err.(*exec.ExitError); ok {
				return exit.ExitCode(), stdout.String(), stderr.String(), nil
			}
			return 0, "", "", err
		}
		return 0, stdout.String(), stderr.String(), nil
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		<-done
		return 0, "", "", fmt.Errorf("se pasó de %s", timeout)
	}
}
