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
	Status string      `json:"status"`           // propuesto · corrido · descartado · no-permitido
	Reason string      `json:"reason,omitempty"` // por qué no está permitido, o el error al correrlo
	Exit   int         `json:"exit,omitempty"`
	Ms     int64       `json:"ms,omitempty"`
	Output *Attachment `json:"output,omitempty"` // la salida, como un archivo: viaja con la próxima pregunta
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
	"conectores": "connectors/CLAUDE.md", "estilo": "tools/ui/CLAUDE.md", "visor": "visor/CLAUDE.md", "herramientas": "tools/CLAUDE.md",
}

const trapsFile = "tablero/data/traps/doc.md"

var allowList = []allowed{
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
	{regexp.MustCompile(`^comandos(?: ([\p{L}0-9-]{2,40}))?$`), func(ctx context.Context, a *app, m []string) (string, int, error) {
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
	{regexp.MustCompile(`^trampas$`), func(_ context.Context, a *app, _ []string) (string, int, error) {
		return a.section(trapsFile, "## Índice · ¿con qué síntoma llegás?", "\n## ")
	}},
	{regexp.MustCompile(`^trampa (F-[0-9]{1,4})$`), func(_ context.Context, a *app, m []string) (string, int, error) {
		return a.section(trapsFile, "### "+m[1]+" ", "\n### F-", "\n## ")
	}},
	{regexp.MustCompile(`^guia ([a-z]{3,20})$`), func(_ context.Context, a *app, m []string) (string, int, error) {
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
	cmd = strings.Join(strings.Fields(cmd), " ")
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

// Los comandos van en bloques ```comando, uno por línea.
var commandBlock = regexp.MustCompile("(?s)```comando[^\\n]*\\n(.*?)```")

// parseCommands saca los comandos que pidió el modelo, ya validados (máximo 8 por respuesta).
func parseCommands(answer string) []Command {
	var out []Command
	for _, block := range commandBlock.FindAllStringSubmatch(answer, -1) {
		for _, line := range strings.Split(block[1], "\n") {
			line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "$"))
			if line == "" || len(out) >= 8 {
				continue
			}
			c := Command{ID: newID(), Cmd: line, Status: "propuesto"}
			if _, err := commandArgs(line); err != nil {
				c.Status, c.Reason = "no-permitido", err.Error()
			}
			out = append(out, c)
		}
	}
	return out
}

// modes: los modos asistidos. «asistente» (y «knowledge», el primero, del mismo día) lee sus instrucciones de
// wally/WALLY.md en CADA pregunta: editarlo cambia a Wally desde la próxima, sin reiniciar nada.
var modes = map[string]bool{"asistente": true, "knowledge": true}

// instructionsFor es lo que va antes de cada pregunta en un modo asistido.
func (a *app) instructionsFor(mode string) (string, error) {
	if !modes[mode] {
		return "", nil
	}
	raw, err := os.ReadFile(filepath.Join(a.root, "wally", "WALLY.md"))
	if err != nil {
		return "", fmt.Errorf("no pude leer wally/WALLY.md: %v", err)
	}
	return "Estas son tus instrucciones (WALLY.md):\n\n" + string(raw), nil
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
	if err := os.MkdirAll(a.filesDir(), 0o755); err != nil {
		return Attachment{}, exit, err
	}
	att := Attachment{ID: newID(), Name: name, Size: int64(len(text)), Chars: utf8.RuneCountInString(text), Kind: "salida"}
	if err := os.WriteFile(filepath.Join(a.filesDir(), att.ID+".txt"), []byte(text), 0o600); err != nil {
		return Attachment{}, exit, err
	}
	meta, _ := json.Marshal(att)
	if err := os.WriteFile(filepath.Join(a.filesDir(), att.ID+".json"), meta, 0o600); err != nil {
		return Attachment{}, exit, err
	}
	return att, exit, nil
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
	a.store.mu.Lock()
	c, ok := a.store.convs[r.PathValue("id")]
	var cmd *Command
	if ok {
		for i := range c.Messages {
			if c.Messages[i].ID == r.PathValue("mid") {
				for j := range c.Messages[i].Commands {
					if c.Messages[i].Commands[j].ID == r.PathValue("cid") {
						cmd = &c.Messages[i].Commands[j]
					}
				}
			}
		}
	}
	if cmd == nil {
		a.store.mu.Unlock()
		writeErr(w, 404, errors.New("no existe ese comando"))
		return
	}
	if cmd.Status != "propuesto" {
		a.store.mu.Unlock()
		writeErr(w, 409, fmt.Errorf("ese comando ya está %s", cmd.Status))
		return
	}
	shown := cmd.Cmd
	a.store.mu.Unlock()

	result := Command{Status: "descartado"}
	if in.Action == "run" {
		// La lista blanca se vuelve a mirar acá, al correr: lo guardado no se toma como validado.
		if _, err := commandArgs(shown); err != nil {
			result = Command{Status: "no-permitido", Reason: err.Error()}
		} else {
			start := time.Now()
			att, exit, err := a.runToFile(r.Context(), shown, "salida: "+shown)
			result = Command{Status: "corrido", Exit: exit, Ms: time.Since(start).Milliseconds()}
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
	c.Updated = time.Now()
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, c)
}
