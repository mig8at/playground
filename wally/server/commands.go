package main

// EL MODO ASISTIDO: Wally deja de sólo contestar y puede PEDIR VER cosas de la máquina, pero no las corre él: propone
// un comando, Miguel lo aprueba en la interfaz, el servidor lo corre y la salida vuelve al modelo en la próxima
// pregunta (idea de Miguel, 2026-11-17). Las instrucciones y el catálogo están en wally/WALLY.md (lo que CLAUDE.md es
// para Claude Code); la lista blanca de abajo es la que manda, y WALLY.md tiene que decir lo mismo.
//
// ⚠ LO QUE SE CORRE LO DECIDE ESTE ARCHIVO, no el modelo: una lista blanca de comandos de SÓLO LECTURA, con sus
// argumentos validados, que se corren SIN SHELL (`exec` con los argumentos separados): un `;`, un `$(…)` o un `|` en
// lo que proponga el modelo no llegan a ejecutarse nunca. Lo que no está en la lista queda «no permitido» y no se
// puede correr desde la interfaz.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Command es un comando que el modelo pidió en una respuesta.
type Command struct {
	ID     string      `json:"id"`
	Cmd    string      `json:"cmd"`
	Status string      `json:"status"`           // propuesto · corriendo · corrido · descartado · not-allowed
	Reason string      `json:"reason,omitempty"` // por qué no está permitido, o el error al correrlo
	Exit   int         `json:"exit,omitempty"`
	Ms     int64       `json:"ms,omitempty"`
	Output *Attachment `json:"output,omitempty"` // la salida, como un archivo: viaja con la próxima pregunta
	// Content: el archivo que entregó el modelo en un bloque ```file (sandbox.go): «correrlo» es guardarlo.
	Content string `json:"content,omitempty"`
	// Change: qué cambió al escribir o parchar (el diff y las cuentas); Report: el resultado de `probar` en datos
	// (errores y criterios). Los dos son para la tarjeta de la interfaz: al modelo le llega el texto de Output.
	// Touched: un comando de consola que cambió archivos del proyecto (para el freno cuenta como escritura).
	Touched bool         `json:"touched,omitempty"`
	Change  *fileChange  `json:"change,omitempty"`
	Report  *checkReport `json:"report,omitempty"`
}

// allowed: un comando de la lista blanca y cómo se corre. `run` recibe lo que capturó la expresión: o corre `make`
// con sus argumentos separados (sin shell), o lee un archivo de una lista fija (sin correr nada).
type allowed struct {
	re  *regexp.Regexp
	run func(ctx context.Context, a *app, m []string) (string, int, error)
}

// makeRun corre `make <args>` en la raíz de my-tools, sin shell.
func makeRun(args ...string) func(context.Context, *app, []string) (string, int, error) {
	return func(ctx context.Context, a *app, _ []string) (string, int, error) { return a.runMake(ctx, args...) }
}

// guides: las guías que se pueden pedir con `guia <herramienta>` → su archivo. Una lista fija: nada de rutas.
var guides = map[string]string{
	"jarvis": "jarvis/CLAUDE.md", "cockpit": "cockpit/CLAUDE.md", "correo": "correo/CLAUDE.md", "harness": "harness/CLAUDE.md",
	"tablero": "tablero/CLAUDE.md", "knowledge": "knowledge/CLAUDE.md", "goldfish": "goldfish/CLAUDE.md",
	"sentinel": "sentinel/CLAUDE.md", "chat": "chat/CLAUDE.md", "office": "office/CLAUDE.md", "wally": "wally/CLAUDE.md",
	"connectors": "connectors/CLAUDE.md", "style": "tools/ui/CLAUDE.md", "visor": "visor/CLAUDE.md", "tools": "tools/CLAUDE.md",
}

const trapsFile = "tablero/data/traps/doc.md"

var allowList = []allowed{
	// Las habilidades (skills.go): el índice, o una entera con sus comandos. Es lo primero que pide el modelo.
	{regexp.MustCompile(`^help(?: ([a-z][a-z0-9-]{1,30}))?$`), func(_ context.Context, a *app, m []string) (string, int, error) {
		return a.skillHelp(m[1])
	}},
	{regexp.MustCompile(`^make knowledge-map$`), makeRun("knowledge-map")},
	{regexp.MustCompile(`^make knowledge-search Q=(?:'([^'"` + "`" + `$\\;&|<>]{1,120})'|"([^'"` + "`" + `$\\;&|<>]{1,120})")$`),
		func(ctx context.Context, a *app, m []string) (string, int, error) {
			return a.runMake(ctx, "knowledge-search", "Q="+m[1]+m[2])
		}},
	{regexp.MustCompile(`^make knowledge-read ID=['"]?([a-z0-9][a-z0-9-]{0,80}(?:#[a-z0-9][a-z0-9-]{0,120})?)['"]?$`),
		func(ctx context.Context, a *app, m []string) (string, int, error) {
			return a.runMake(ctx, "knowledge-read", "ID="+m[1])
		}},
	{regexp.MustCompile(`^make tareas$`), makeRun("tareas")},
	// El catálogo de make: `make` sin argumentos sólo lista. Con una palabra, sus líneas (y la del grupo).
	{regexp.MustCompile(`^commands(?: ([\p{L}0-9-]{2,40}))?$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		out, exit, err := a.runMake(ctx)
		if err != nil || m[1] == "" {
			return out, exit, err
		}
		word := strings.ToLower(m[1])
		var keep []string
		for _, line := range strings.Split(out, "\n") {
			if strings.Contains(strings.ToLower(line), word) {
				keep = append(keep, line)
			}
		}
		if len(keep) == 0 {
			return fmt.Sprintf("ningún comando menciona «%s»", m[1]), 0, nil
		}
		return strings.Join(keep, "\n"), 0, nil
	}},
	{regexp.MustCompile(`^traps$`), func(_ context.Context, a *app, _ []string) (string, int, error) {
		return a.section(trapsFile, "## Índice · ¿con qué síntoma llegás?", "\n## ")
	}},
	{regexp.MustCompile(`^trap (F-[0-9]{1,4})$`), func(_ context.Context, a *app, m []string) (string, int, error) {
		return a.section(trapsFile, "### "+m[1]+" ", "\n### F-", "\n## ")
	}},
	// Una tarea del tablero: SÓLO su task.md (el plan y sus criterios), por número o por slug. Nunca su pila
	// (context.jsonl) ni sus artifacts: traen mediciones de los ambientes, y lo que lee Wally viaja al proveedor.
	{regexp.MustCompile(`^task ([0-9]{1,5}|[a-z0-9][a-z0-9-]{1,100})$`), func(_ context.Context, a *app, m []string) (string, int, error) {
		return a.readTask(m[1])
	}},
	// Sentinel, el vigía de producción: sólo sus resúmenes AGREGADOS (conteos, porcentajes, despliegues), que lee de
	// lo guardado. `signal` queda afuera (trae líneas de log de una entidad) y de `deploy` se sacan los textos de los
	// errores nuevos del front: viajan al proveedor.
	{regexp.MustCompile(`^sentinel now$`), func(ctx context.Context, a *app, _ []string) (string, int, error) {
		return a.runSentinel(ctx, "now")
	}},
	{regexp.MustCompile(`^sentinel day(?: ([0-9]{4}-[0-9]{2}-[0-9]{2}))?$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		if m[1] == "" {
			return a.runSentinel(ctx, "day")
		}
		return a.runSentinel(ctx, "day", m[1])
	}},
	{regexp.MustCompile(`^sentinel deploy ([a-z][a-z0-9-]{1,40})(?: (v?[0-9][0-9A-Za-z.-]{0,30}))?$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		if m[2] == "" {
			return a.runSentinel(ctx, "deploy", m[1])
		}
		return a.runSentinel(ctx, "deploy", m[1], m[2])
	}},
	// La carpeta de pruebas (sandbox.go): lo único que un agente escribe. «escribir» no se pide como comando: sale de
	// un bloque ```file, y su contenido viaja en el Command (decideCommand lo guarda).
	{regexp.MustCompile(`^write (sandbox/\S+)$`), func(_ context.Context, _ *app, m []string) (string, int, error) {
		return "para escribir, entregá el archivo en un bloque ```file " + m[1] + " … ```", 1, nil
	}},
	{regexp.MustCompile(`^patch (sandbox/\S+)$`), func(_ context.Context, _ *app, m []string) (string, int, error) {
		return "para parchar, entregá los cambios en un bloque ```patch " + m[1] + " … ```", 1, nil
	}},
	// Rust (rust.go): compilar, testear y probar una API, DENTRO de un contenedor sin red que sólo ve el proyecto.
	{regexp.MustCompile(`^(build|test|check-api) (sandbox/[a-z0-9][a-z0-9_-]{0,40})$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		return a.runRust(ctx, m[2], m[1])
	}},
	// La consola del agente (rust.go): cualquier comando, pero DENTRO del contenedor de su proyecto. Acá el texto no
	// se restringe —adentro no hay red ni nada de la Mac salvo el proyecto—; lo que se valida es dónde corre.
	{regexp.MustCompile(`^console (sandbox/[a-z0-9][a-z0-9_-]{0,40}) (.+)$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		if len(m[2]) > 2000 {
			return "el comando pasa de 2.000 caracteres: partilo en varios", 1, nil
		}
		return a.runConsole(ctx, m[1], m[2])
	}},
	{regexp.MustCompile(`^list (sandbox(?:/[a-z0-9][a-z0-9_/-]{0,120})?)$`), func(_ context.Context, a *app, m []string) (string, int, error) {
		out, err := a.listSandbox(strings.TrimPrefix(strings.TrimPrefix(m[1], "sandbox"), "/"))
		return out, 0, err
	}},
	{regexp.MustCompile(`^read (sandbox/\S+)$`), func(_ context.Context, a *app, m []string) (string, int, error) {
		out, err := a.readSandbox(m[1])
		return out, 0, err
	}},
	{regexp.MustCompile(`^check (sandbox/\S+)$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		rel := sandboxPath.FindStringSubmatch(m[1])
		if rel == nil {
			return "se prueba como probar sandbox/<proyecto> o sandbox/<proyecto>/<pagina>.html", 1, nil
		}
		return a.checkSandbox(ctx, rel[1])
	}},
	// Canon, el corpus del equipo, sólo para leer: un tema o una sección, y buscar. Va por el CLI `playground` con la
	// sesión de Miguel (sin shell). Sirve para pasar un tema de canon a knowledge, verificándolo contra main.
	{regexp.MustCompile(`^canon read ([a-z0-9][a-z0-9-]{0,60}/(?:context|operar)(?:#[a-z0-9][a-z0-9-]{0,120})?)$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		return a.runPlayground(ctx, "canon", "read", m[1])
	}},
	{regexp.MustCompile(`^canon search (?:'([^'"` + "`" + `$\\;&|<>]{2,120})'|"([^'"` + "`" + `$\\;&|<>]{2,120})")$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		return a.runPlayground(ctx, "canon", "search", m[1]+m[2])
	}},
	// Poner al día la biblioteca (code.go): qué cambió, en qué fuente, y el código de hoy.
	{regexp.MustCompile(`^changes$`), func(ctx context.Context, a *app, _ []string) (string, int, error) {
		out, _, err := a.runMake(ctx, "knowledge-check")
		if err != nil {
			return "", -1, err
		}
		var keep []string
		for _, line := range strings.Split(out, "\n") {
			if t := strings.TrimSpace(line); t != "" && !strings.HasPrefix(t, "unchanged ·") && !strings.HasPrefix(t, "make:") && !strings.HasPrefix(t, "exit status") {
				keep = append(keep, t)
			}
		}
		return strings.Join(keep, "\n"), 0, nil
	}},
	{regexp.MustCompile(`^sources ([a-z0-9][a-z0-9-]{0,80})$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		out, err := a.sourcesReport(ctx, m[1])
		return out, 0, err
	}},
	{regexp.MustCompile(`^diff ([a-z0-9][a-z0-9-]{0,80}) ([a-z][a-z0-9-]{1,40}:[A-Za-z0-9_][A-Za-z0-9_./@+-]{0,300})$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		out, err := a.sourceDiff(ctx, m[1], m[2])
		return out, 0, err
	}},
	{regexp.MustCompile(`^grep ([a-z][a-z0-9-]{1,40}:[A-Za-z0-9_][A-Za-z0-9_./@+-]{0,300}) (?:'([^'"` + "`" + `$\\;&|<>]{2,80})'|"([^'"` + "`" + `$\\;&|<>]{2,80})")$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		out, err := a.grepAtMain(ctx, m[1], m[2]+m[3])
		return out, 0, err
	}},
	{regexp.MustCompile(`^code ([a-z][a-z0-9-]{1,40}:[A-Za-z0-9_][A-Za-z0-9_./@+-]{0,300})(?::([0-9]{1,6})-([0-9]{1,6}))?$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
		from, to := 0, 0
		if m[2] != "" {
			fmt.Sscan(m[2], &from)
			fmt.Sscan(m[3], &to)
		}
		out, err := a.codeAtMain(ctx, m[1], from, to)
		return out, 0, err
	}},
	{regexp.MustCompile(`^guide ([a-z]{3,20})$`), func(_ context.Context, a *app, m []string) (string, int, error) {
		path, ok := guides[m[1]]
		if !ok {
			names := make([]string, 0, len(guides))
			for n := range guides {
				names = append(names, n)
			}
			sort.Strings(names)
			return fmt.Sprintf("no hay una guía «%s»; las que hay: %s", m[1], strings.Join(names, ", ")), 1, nil
		}
		raw, err := os.ReadFile(filepath.Join(a.root, path))
		return string(raw), 0, err
	}},
}

// match busca el comando en la lista blanca: la entrada y lo que capturó, o por qué no.
func match(cmd string) (allowed, []string, error) {
	cmd = normalizeCommand(strings.Join(strings.Fields(cmd), " "))
	for _, a := range allowList {
		if m := a.re.FindStringSubmatch(cmd); m != nil {
			return a, m, nil
		}
	}
	return allowed{}, nil, errors.New("no está en la lista de comandos de sólo lectura de WALLY.md")
}

// commandArgs se queda para las pruebas: ¿pasa la lista blanca?
func commandArgs(cmd string) ([]string, error) {
	_, m, err := match(cmd)
	return m, err
}

// section devuelve de un archivo el pedazo que empieza en `start` y termina antes del primero de `ends`.
func (a *app) section(path, start string, ends ...string) (string, int, error) {
	raw, err := os.ReadFile(filepath.Join(a.root, path))
	if err != nil {
		return "", -1, err
	}
	text := string(raw)
	i := strings.Index(text, start)
	if i < 0 {
		return fmt.Sprintf("no encontré «%s»", strings.TrimSpace(start)), 1, nil
	}
	rest := text[i:]
	cut := len(rest)
	for _, e := range ends {
		if j := strings.Index(rest[len(start):], e); j >= 0 && len(start)+j < cut {
			cut = len(start) + j
		}
	}
	return strings.TrimSpace(rest[:cut]), 0, nil
}

// Los comandos van en bloques ```command, uno por línea.
var commandBlock = regexp.MustCompile("(?s)```(?:command|comando)[^\\n]*\\n(.*?)```")

// parseCommands saca los comandos que pidió el modelo, ya validados (máximo 8 por respuesta).
func parseCommands(answer string) []Command {
	var out []Command
	// Primero lo que entrega para la carpeta de pruebas, en el orden en que lo escribió: un archivo entero (```file)
	// es un comando «escribir» y un parche (```patch), «parchar», cada uno con su contenido. Van ANTES que los comandos
	// para que un `probar` de la misma respuesta encuentre lo recién escrito.
	for _, block := range fileBlock.FindAllStringSubmatch(answer, -1) {
		if len(out) >= 10 {
			break
		}
		verb := map[string]string{"file": "write", "patch": "patch", "archivo": "write", "parche": "patch"}[block[1]]
		path := block[2]
		if strings.HasPrefix(path, "pruebas/") { // la carpeta de antes (legacy.go)
			path = "sandbox/" + strings.TrimPrefix(path, "pruebas/")
		}
		path = strings.Fields(normalizeCommand("write " + path))[1] // criterios.json → criteria.json
		c := Command{ID: newID(), Cmd: verb + " " + path, Status: "proposed", Content: block[3]}
		if !sandboxFile.MatchString(path) {
			c.Status, c.Reason, c.Content = "not-allowed", "sólo se escribe en sandbox/<proyecto>/…, tipos html, css, js, mjs, json, svg, md, txt, rs, toml o lock", ""
		}
		out = append(out, c)
	}
	files := len(out)
	for _, block := range commandBlock.FindAllStringSubmatch(answer, -1) {
		for _, line := range strings.Split(block[1], "\n") {
			line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "$"))
			if line == "" || len(out)-files >= 8 {
				continue
			}
			line = normalizeCommand(line) // con los nombres de antes también (legacy.go)
			c := Command{ID: newID(), Cmd: line, Status: "proposed"}
			if _, err := commandArgs(line); err != nil {
				c.Status, c.Reason = "not-allowed", err.Error()
			}
			out = append(out, c)
		}
	}
	return out
}

// modes: los modos asistidos. «asistente» (y «knowledge», el primero, del mismo día) lee sus instrucciones de
// wally/WALLY.md en CADA pregunta: editarlo cambia a Wally desde la próxima, sin reiniciar nada.
var modes = map[string]bool{"assistant": true, "knowledge": true}

// instructionsFor es lo que va antes de cada pregunta en un modo asistido.
func (a *app) instructionsFor(mode string) (string, error) {
	if !modes[mode] {
		return "", nil
	}
	raw, err := os.ReadFile(filepath.Join(a.root, "wally", "WALLY.md"))
	if err != nil {
		return "", fmt.Errorf("no pude leer wally/WALLY.md: %v", err)
	}
	return "Estas son tus instrucciones (WALLY.md):\n\n" + strings.TrimRight(string(raw), "\n") + "\n\n" + a.skillIndex(), nil
}

// modeContext corre lo que un modo adjunta al empezar (el mapa de knowledge), como un archivo.
func (a *app) modeContext(ctx context.Context, mode string) ([]Attachment, error) {
	if mode != "knowledge" {
		return nil, nil
	}
	att, _, err := a.runToFile(ctx, "make knowledge-map", "mapa de knowledge")
	if err != nil {
		return nil, err
	}
	return []Attachment{att}, nil
}

// La salida de un comando no lleva los colores de la terminal.
var ansi = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")

const maxOutput = 300_000

// runMake corre `make <args>` en la raíz, sin shell, y devuelve lo que imprimió (sin colores) y su código.
func (a *app) runMake(ctx context.Context, args ...string) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "make", append([]string{"--no-print-directory"}, args...)...)
	cmd.Dir = a.root
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	exit := 0
	if err != nil {
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			return "", -1, fmt.Errorf("no pude correr make %s: %v", strings.Join(args, " "), err)
		}
		exit = ee.ExitCode()
	}
	return ansi.ReplaceAllString(out.String(), ""), exit, nil
}

// runToFile corre un comando de la lista blanca y guarda su salida como un archivo adjunto.
func (a *app) runToFile(ctx context.Context, shown, name string) (Attachment, int, error) {
	entry, m, err := match(shown)
	if err != nil {
		return Attachment{}, -1, err
	}
	text, exit, err := entry.run(ctx, a, m)
	if err != nil {
		return Attachment{}, exit, err
	}
	if utf8.RuneCountInString(text) > maxOutput {
		text = string([]rune(text)[:maxOutput]) + "\n… (salida cortada: pasaba de 300 mil caracteres)"
	}
	if exit != 0 {
		text = fmt.Sprintf("(el comando terminó con código %d)\n%s", exit, text)
	}
	text = strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(text)
	att, err := a.saveOutput(text, name)
	return att, exit, err
}

// saveOutput guarda un texto como la salida de un comando: un adjunto que viaja con la próxima pregunta.
func (a *app) saveOutput(text, name string) (Attachment, error) {
	if err := os.MkdirAll(a.filesDir(), 0o755); err != nil {
		return Attachment{}, err
	}
	att := Attachment{ID: newID(), Name: name, Size: int64(len(text)), Chars: utf8.RuneCountInString(text), Kind: "salida"}
	if err := os.WriteFile(filepath.Join(a.filesDir(), att.ID+".txt"), []byte(text), 0o600); err != nil {
		return Attachment{}, err
	}
	meta, _ := json.Marshal(att)
	if err := os.WriteFile(filepath.Join(a.filesDir(), att.ID+".json"), meta, 0o600); err != nil {
		return Attachment{}, err
	}
	return att, nil
}

// commandAction corre o descarta un comando propuesto: POST …/messages/{mid}/commands/{cid} {action: run|decline}.
func (a *app) commandAction(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || (in.Action != "run" && in.Action != "decline") {
		writeErr(w, 400, errors.New("action tiene que ser run o decline"))
		return
	}
	c, code, err := a.decideCommand(r.Context(), r.PathValue("id"), r.PathValue("mid"), r.PathValue("cid"), in.Action)
	if err != nil {
		writeErr(w, code, err)
		return
	}
	writeJSON(w, 200, c)
}

// decideCommand corre o descarta un comando propuesto y lo guarda. La usan la interfaz y los agentes de un grupo,
// que corren solos los de la lista blanca (son de sólo lectura). Devuelve la conversación y, si falla, el código HTTP.
func (a *app) decideCommand(ctx context.Context, convID, mid, cid, action string) (Conversation, int, error) {
	a.store.mu.Lock()
	c, ok := a.store.convs[convID]
	var cmd *Command
	if ok {
		for i := range c.Messages {
			if c.Messages[i].ID == mid {
				for j := range c.Messages[i].Commands {
					if c.Messages[i].Commands[j].ID == cid {
						cmd = &c.Messages[i].Commands[j]
					}
				}
			}
		}
	}
	if cmd == nil {
		a.store.mu.Unlock()
		return Conversation{}, 404, errors.New("no existe ese comando")
	}
	if cmd.Status != "proposed" {
		a.store.mu.Unlock()
		return Conversation{}, 409, fmt.Errorf("ese comando ya está %s", cmd.Status)
	}
	shown := cmd.Cmd
	content := cmd.Content
	// «corriendo» mientras corre: otra ventana (o `bin/wally ask --auto`) no lo vuelve a correr y la interfaz lo muestra.
	if action == "run" {
		cmd.Status = "running"
		c.Updated = time.Now()
	}
	a.store.mu.Unlock()

	result := Command{Status: "dismissed"}
	var change *fileChange
	var report *checkReport
	touched := false
	if action == "run" {
		// La lista blanca se vuelve a mirar acá, al correr: lo guardado no se toma como validado.
		if _, err := commandArgs(shown); err != nil {
			result = Command{Status: "not-allowed", Reason: err.Error()}
		} else {
			start := time.Now()
			var att Attachment
			var exit int
			var err error
			if content != "" && strings.HasPrefix(shown, "patch ") {
				var note string
				var ch fileChange
				if note, exit, ch, err = a.patchSandboxChange(strings.TrimPrefix(shown, "patch "), content); err == nil {
					if exit == 0 {
						change = &ch
					}
					if exit != 0 {
						note = fmt.Sprintf("(el parche no se aplicó)\n%s", note)
					}
					att, err = a.saveOutput(note, "salida: "+shown)
				}
			} else if content != "" {
				var note string
				var ch fileChange
				if note, ch, err = a.writeSandboxChange(strings.TrimPrefix(shown, "write "), content); err == nil {
					change = &ch
					att, err = a.saveOutput(note, "salida: "+shown)
				}
			} else {
				stampProject, before := "", ""
				if f := strings.Fields(shown); len(f) > 2 && f[0] == "console" {
					stampProject = strings.TrimPrefix(f[1], "sandbox/")
					before = a.sandboxStamp(stampProject)
				}
				att, exit, err = a.runToFile(ctx, shown, "salida: "+shown)
				touched = stampProject != "" && a.sandboxStamp(stampProject) != before
				if strings.HasPrefix(shown, "check ") {
					report = a.sandboxReport(shown)
				} else if strings.HasPrefix(shown, "check-api ") && err == nil {
					if text, terr := a.fileText(att.ID); terr == nil {
						report = checkTextReport(text)
					}
				}
			}
			result = Command{Status: "ran", Exit: exit, Ms: time.Since(start).Milliseconds()}
			if err != nil {
				result.Reason = err.Error()
			} else {
				result.Output = &att
			}
		}
	}

	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	cmd.Status, cmd.Reason, cmd.Exit, cmd.Ms, cmd.Output = result.Status, result.Reason, result.Exit, result.Ms, result.Output
	cmd.Change, cmd.Report, cmd.Touched = change, report, touched
	// Guardado, el contenido ya está en el disco (y en el texto de la respuesta): no se duplica en lo guardado.
	if result.Status == "ran" && result.Reason == "" {
		cmd.Content = ""
	}
	c.Updated = time.Now()
	if err := a.store.save(); err != nil {
		return Conversation{}, 500, err
	}
	return *c, 200, nil
}

// tasksDir: las tareas del tablero, una carpeta por slug con su task.md.
const tasksDir = "tablero/tasks"

// readTask devuelve el task.md de una tarea, buscándola por slug o por el `id:` de su frontmatter.
func (a *app) readTask(key string) (string, int, error) {
	dir := filepath.Join(a.root, tasksDir)
	if raw, err := os.ReadFile(filepath.Join(dir, key, "task.md")); err == nil {
		return string(raw), 0, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", -1, err
	}
	want := "\nid: " + key + "\n"
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name(), "task.md"))
		if err == nil && strings.Contains("\n"+string(raw), want) {
			return string(raw), 0, nil
		}
	}
	return fmt.Sprintf("no hay una tarea «%s» (`make tareas` las lista con su número)", key), 1, nil
}

// runSentinel corre `bin/sentinel <args>` sin shell. Su salida 1 es «hay algo que mirar», no un error.
func (a *app) runSentinel(ctx context.Context, args ...string) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(a.root, "bin", "sentinel"), args...)
	cmd.Dir = a.root
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			return "", -1, fmt.Errorf("no pude correr bin/sentinel %s: %v", strings.Join(args, " "), err)
		}
	}
	return withoutFrontErrorTexts(ansi.ReplaceAllString(out.String(), "")), 0, nil
}

// frontErrorsHeader: el bloque de `bin/sentinel deploy` con el TEXTO de los errores de JavaScript del front. Puede traer
// lo que el cliente escribió, así que no viaja: queda cuántos son y cómo verlos.
const frontErrorsHeader = "Errores del front NUEVOS"

func withoutFrontErrorTexts(text string) string {
	lines := strings.Split(text, "\n")
	var keep []string
	for i := 0; i < len(lines); i++ {
		if !strings.HasPrefix(lines[i], frontErrorsHeader) {
			keep = append(keep, lines[i])
			continue
		}
		n := 0
		for i+1 < len(lines) && strings.HasPrefix(lines[i+1], "  ✗ ") {
			i++
			n++
		}
		keep = append(keep, fmt.Sprintf("%s: %d mensaje(s) distintos. Sus textos no se mandan desde acá (pueden traer lo que escribió un cliente): Miguel los ve con bin/sentinel deploy en su consola.", frontErrorsHeader, n))
	}
	return strings.Join(keep, "\n")
}

// runPlayground corre el CLI del playground compartido (`~/.local/bin/playground`), sin shell, con la sesión de Miguel.
func (a *app) runPlayground(ctx context.Context, args ...string) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	bin, err := exec.LookPath("playground")
	if err != nil {
		home, _ := os.UserHomeDir()
		bin = filepath.Join(home, ".local", "bin", "playground")
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	exit := 0
	if err := cmd.Run(); err != nil {
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			return "", -1, fmt.Errorf("no pude correr playground %s: %v", strings.Join(args, " "), err)
		}
		exit = ee.ExitCode()
	}
	return ansi.ReplaceAllString(out.String(), ""), exit, nil
}
