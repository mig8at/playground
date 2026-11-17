package main

// EL MODO ASISTIDO: Wally deja de sólo contestar y puede PEDIR VER cosas de la máquina, pero no las corre él: propone
// un comando, Miguel lo aprueba en la interfaz, el servidor lo corre y la salida vuelve al modelo en la próxima
// pregunta (idea de Miguel, 2026-11-17). Hoy hay un modo, «knowledge»: la biblioteca local de knowledge/.
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

// allowed: el comando pedido → los argumentos de `make`, o por qué no.
type allowed struct {
	re    *regexp.Regexp
	build func(m []string) []string
}

var allowList = []allowed{
	{regexp.MustCompile(`^make knowledge-map$`), func([]string) []string { return []string{"knowledge-map"} }},
	{regexp.MustCompile(`^make knowledge-search Q=(?:'([^'"` + "`" + `$\\;&|<>]{1,120})'|"([^'"` + "`" + `$\\;&|<>]{1,120})")$`),
		func(m []string) []string { return []string{"knowledge-search", "Q=" + m[1] + m[2]} }},
	{regexp.MustCompile(`^make knowledge-read ID=['"]?([a-z0-9][a-z0-9-]{0,80}(?:#[a-z0-9][a-z0-9-]{0,120})?)['"]?$`),
		func(m []string) []string { return []string{"knowledge-read", "ID=" + m[1]} }},
}

// commandArgs valida un comando contra la lista blanca y devuelve los argumentos de make.
func commandArgs(cmd string) ([]string, error) {
	cmd = strings.Join(strings.Fields(cmd), " ")
	for _, a := range allowList {
		if m := a.re.FindStringSubmatch(cmd); m != nil {
			return a.build(m), nil
		}
	}
	return nil, errors.New("no está en la lista de comandos de sólo lectura (make knowledge-map · knowledge-search Q='…' · knowledge-read ID=…)")
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

// Las instrucciones de cada modo: van al principio de cada pregunta (AI Studio no recuerda nada).
var modeInstructions = map[string]string{
	"knowledge": `Sos Wally, un asistente que ayuda a Miguel (CreditOp, una fintech colombiana de originación de crédito) a
entender su biblioteca de conocimiento local: temas escritos a partir del código, con sus fuentes. Te paso el mapa de
la biblioteca (los temas, con su id y su resumen).

No podés leer nada por tu cuenta. Cuando necesites ver un tema o buscar algo, PEDILO con un bloque de código con el
lenguaje «comando», un comando por línea, sólo de esta lista:

` + "```comando" + `
make knowledge-search Q='palabras a buscar'
make knowledge-read ID=id-del-tema
make knowledge-read ID=id-del-tema#ancla-de-la-seccion
` + "```" + `

Miguel decide si los corre y te devuelve la salida en el mensaje siguiente. Pedí sólo lo necesario (hasta 5 por vez) y
decí en una línea para qué. Cuando ya tengas lo que necesitás, contestá sin pedir comandos, citando el id del tema de
donde sale cada cosa. No inventes el contenido de un tema que no leíste: si no está, decilo.`,
}

// modeContext corre lo que un modo adjunta al empezar (el mapa de knowledge), como un archivo.
func (a *app) modeContext(ctx context.Context, mode string) ([]Attachment, error) {
	if mode != "knowledge" {
		return nil, nil
	}
	att, _, err := a.runToFile(ctx, "make knowledge-map", []string{"knowledge-map"}, "mapa de knowledge")
	if err != nil {
		return nil, err
	}
	return []Attachment{att}, nil
}

// La salida de un comando no lleva los colores de la terminal.
var ansi = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")

const maxOutput = 300_000

// runToFile corre `make <args>` en la raíz, sin shell, y guarda su salida como un archivo adjunto.
func (a *app) runToFile(ctx context.Context, shown string, args []string, name string) (Attachment, int, error) {
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
			return Attachment{}, -1, fmt.Errorf("no pude correr %s: %v", shown, err)
		}
		exit = ee.ExitCode()
	}
	text := ansi.ReplaceAllString(out.String(), "")
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
		args, err := commandArgs(shown)
		if err != nil {
			result = Command{Status: "no-permitido", Reason: err.Error()}
		} else {
			start := time.Now()
			att, exit, err := a.runToFile(r.Context(), shown, args, "salida: "+shown)
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
