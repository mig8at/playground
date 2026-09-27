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
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

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
lo externo ya está cableado y con credenciales puestas. Acá van SÓLO LOS NOMBRES (⚠ = escribe):
` + "`make`" + ` sin argumentos da qué hace cada uno y sus parámetros, y ` + "`make | grep <palabra>`" + ` lo busca.

La base, Loki, PostHog, Confluence, Jira y Slack se consultan por ` + "`bin/pg`" + ` (la lista, al final): leer es libre
y lo que escribe (Jira, Slack) sin ` + "`--apply`" + ` sólo muestra. Registrado como servidor MCP (` + "`bin/pg mcp`" + `), los
mismos comandos llegan como herramientas nativas (` + "`sql`, `logs`, `jira_search`…" + `). Leer canales e hilos de
Slack sigue por su MCP de claude.ai.

`

// contextBudget es lo que el hook puede imprimir sin que Claude Code lo corte. Por encima, el harness
// guarda la salida en un archivo y al contexto entra un PREVIEW de ~2 KB: medido el 2026-09-27, el
// catálogo con descripciones pesaba 28 KB y el modelo veía sólo el principio de «LO QUE SE USA TODOS
// LOS DÍAS» — ni canon, ni el harness, ni los conectores. El umbral exacto no está documentado; 9 KB
// deja margen y lo fija una prueba contra el Makefile real.
const contextBudget = 9000

// catalogWidth es el ancho al que se envuelven los nombres de un grupo.
const catalogWidth = 100

// reTarget es un target documentado del Makefile: la misma forma que lee `listar` para imprimir la ayuda.
var reTarget = regexp.MustCompile(`(?m)^([a-z][a-zA-Z0-9_-]*):.*## @[a-z]+ (.*)$`)

// makeTargets: los targets que la ayuda lista, y si escriben (su descripción arranca con «⚠ ESCRIBE»).
func makeTargets(makefile string) map[string]bool {
	targets := map[string]bool{}
	for _, m := range reTarget.FindAllStringSubmatch(makefile, -1) {
		targets[m[1]] = strings.HasPrefix(m[2], "⚠ ESCRIBE")
	}
	return targets
}

/* compactCatalog deja del catálogo de `make` los grupos y los NOMBRES, en el orden en que la ayuda los
 * imprime, envueltos a lo ancho. Una línea de un grupo que no es un target —los `go run` de canon— queda
 * como está: son pocas y no hay otro lugar donde se lean.
 *
 * Por qué sólo nombres: las descripciones son el 90 % del peso (medido: 2,3 KB sin ellas, 8 KB cortadas a
 * 40 caracteres, y eso sin los conectores). Un nombre alcanza para saber que la herramienta EXISTE —que
 * es el error que este hook evita—; qué hace y con qué parámetros lo contesta `make` en una llamada. */
func compactCatalog(catalog string, targets map[string]bool) string {
	var out strings.Builder
	var group []string
	flush := func() {
		out.WriteString(wrapNames(group))
		group = nil
	}
	for _, line := range strings.Split(catalog, "\n") {
		if fields := strings.Fields(line); strings.HasPrefix(line, "    ") && len(fields) > 0 {
			if writes, ok := targets[fields[0]]; ok {
				group = append(group, marked(fields[0], writes))
				continue
			}
		}
		flush()
		out.WriteString(line + "\n")
	}
	flush()
	return strings.TrimRightFunc(out.String(), text.IsSpace)
}

func marked(name string, writes bool) string {
	if writes {
		return "⚠" + name
	}
	return name
}

// wrapNames pone los nombres en renglones de hasta catalogWidth, separados por « · ». Un nombre no se
// parte nunca, aunque tenga espacios («jira create»).
func wrapNames(names []string) string {
	var out, row strings.Builder
	for _, name := range names {
		if row.Len() > 0 && utf8.RuneCountInString(row.String())+3+utf8.RuneCountInString(name) > catalogWidth {
			out.WriteString(row.String() + "\n")
			row.Reset()
		}
		if row.Len() == 0 {
			row.WriteString("    " + name)
		} else {
			row.WriteString(" · " + name)
		}
	}
	if row.Len() > 0 {
		out.WriteString(row.String() + "\n")
	}
	return out.String()
}

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
	// Sin el Makefile legible no se sabe qué línea es un target: sale el catálogo entero, que es peor
	// (lo corta el harness) pero no miente.
	if makefile, err := os.ReadFile(filepath.Join(env.Root, "Makefile")); err == nil {
		catalog = compactCatalog(catalog, makeTargets(string(makefile)))
	}
	fmt.Fprintf(env.Stdout, header, env.Root)
	fmt.Fprintln(env.Stdout, catalog)
	if list := connectorCatalog(env.Root); list != "" {
		fmt.Fprintln(env.Stdout)
		fmt.Fprintln(env.Stdout, list)
	}
	return 0
}

// pgCommand es lo que el catálogo usa de `pg help --json`.
type pgCommand struct {
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Write   bool   `json:"write"`
	NoTool  bool   `json:"no_tool"`
}

// connectorCatalog es la lista de `bin/pg`, sacada del propio binario: la misma que su ayuda y que su
// servidor MCP. Si pg no compila, no hay lista —y el catálogo de `make` sale igual—.
func connectorCatalog(root string) string {
	_, out, _, err := run(root, 60*time.Second, filepath.Join(root, "bin", "pg"), "help", "--json")
	if err != nil {
		return ""
	}
	var cmds []pgCommand
	if json.Unmarshal([]byte(out), &cmds) != nil || len(cmds) == 0 {
		return ""
	}
	// Como los targets: sólo nombres, porque `bin/pg help` los describe y el MCP ya los trae como
	// herramientas con su esquema.
	names := make([]string, 0, len(cmds))
	for _, c := range cmds {
		names = append(names, marked(c.Name, c.Write))
	}
	return "  CONECTORES   (bin/pg help · ⚠ = escribe: sin --apply sólo muestra · MCP: bin/pg mcp)\n" +
		strings.TrimRight(wrapNames(names), "\n")
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
