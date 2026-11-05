package main

/* Una meta lanzada desde la interfaz: la API corre `bin/navegador ask` (el mismo CLI que en la terminal) con
 * NAVEGADOR_EVENTS=1, junta lo que va diciendo —una línea JSON por evento— y le pasa por stdin la respuesta a un
 * NECESITO/CONFIRMAR. Una corrida a la vez: la sesión en vivo es una sola. */

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// AskEvent es una cosa que dijo ask: lo que piensa (think), un comando (act), una captura que mira (look), un
// comando que falló (fail), la respuesta de una vuelta (result), lo que costó (stats), una pregunta a la persona
// (ask), la respuesta (answer), el reporte (report), avisos (note, site) y lo que sale sin formato (out, err).
type AskEvent struct {
	N    int       `json:"n"`
	Kind string    `json:"k"`
	Text string    `json:"t"`
	At   time.Time `json:"at"`
}

type Asker struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	running bool
	waiting bool // terminó una vuelta con NECESITO/CONFIRMAR y espera la respuesta
	goal    string
	started time.Time
	exit    string // cómo terminó el proceso, si terminó mal
	events  []AskEvent
	// external: una sesión que maneja Claude desde la conversación con bin/navegador (empezar · pienso ·
	// terminar): no hay proceso; los eventos los manda el CLI.
	external bool
}

// AskState es lo que lee la interfaz: los eventos desde el número since.
type AskState struct {
	Running  bool       `json:"running"`
	Waiting  bool       `json:"waiting"`
	Goal     string     `json:"meta"`
	Started  time.Time  `json:"inicio"`
	Exit     string     `json:"salida,omitempty"`
	External bool       `json:"externa,omitempty"` // la maneja Claude desde la conversación
	Total    int        `json:"total"`
	Events   []AskEvent `json:"eventos"`
}

// navegadorBin es bin/navegador del repo (o NAVEGADOR_BIN).
func navegadorBin() string {
	if b := os.Getenv("NAVEGADOR_BIN"); b != "" {
		return b
	}
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(file))), "bin", "navegador")
}

// Start lanza la meta. url vacía: sigue en la sesión en vivo que esté abierta.
func (a *Asker) Start(api, goal, url, device string, guide bool, steps int) error {
	goal = strings.TrimSpace(goal)
	if goal == "" {
		return errors.New("falta la meta")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.running || a.external {
		return errors.New("ya hay una meta corriendo: esperá a que termine o frenala")
	}
	args := []string{"ask"}
	if url != "" {
		args = append(args, "--url", url)
	}
	if device != "" {
		args = append(args, "--dispositivo", device)
	}
	if guide {
		args = append(args, "--guia")
	}
	if steps > 0 {
		args = append(args, "--pasos", strconv.Itoa(steps))
	}
	args = append(args, goal)
	cmd := exec.Command(navegadorBin(), args...)
	cmd.Env = append(os.Environ(), "NAVEGADOR_API="+api, "NAVEGADOR_EVENTS=1")
	// Su propio grupo y sin terminal: frenarlo mata también al Claude Code que lanzó.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	a.cmd, a.stdin, a.running, a.waiting = cmd, stdin, true, false
	a.goal, a.started, a.exit, a.events = goal, time.Now(), "", nil
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); a.read(stdout, "out") }()
	go func() { defer wg.Done(); a.read(stderr, "err") }()
	go func() {
		wg.Wait()
		err := cmd.Wait()
		a.mu.Lock()
		defer a.mu.Unlock()
		if err != nil && a.exit == "" {
			a.exit = err.Error()
		}
		a.running, a.waiting = false, false
		go func() { hub.Publish("askstate", a.State(-1)) }() // en otra goroutine: acá el lock está tomado
	}()
	go func() { hub.Publish("askstate", a.State(-1)) }()
	return nil
}

// read junta las líneas de una salida: JSON de eventos, o texto suelto con el tipo plain.
func (a *Asker) read(r io.Reader, plain string) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		ev := AskEvent{Kind: plain, Text: line}
		var j struct {
			K string `json:"k"`
			T string `json:"t"`
		}
		if strings.HasPrefix(line, "{") && json.Unmarshal([]byte(line), &j) == nil && j.K != "" {
			ev.Kind, ev.Text = j.K, j.T
		} else if strings.TrimSpace(line) == "" {
			continue
		}
		a.mu.Lock()
		ev.N, ev.At = len(a.events), time.Now()
		a.events = append(a.events, ev)
		switch ev.Kind {
		case "ask":
			a.waiting = true
		case "answer", "note":
			a.waiting = false
		}
		a.mu.Unlock()
		hub.Publish("ask", ev)
		if ev.Kind == "ask" || ev.Kind == "answer" || ev.Kind == "note" {
			hub.Publish("askstate", a.State(-1))
		}
	}
}

func (a *Asker) State(since int) AskState {
	a.mu.Lock()
	defer a.mu.Unlock()
	if since < 0 { // sólo el estado, sin eventos (para el stream)
		since = len(a.events)
	}
	if since > len(a.events) {
		since = 0
	}
	return AskState{Running: a.running || a.external, Waiting: a.waiting, Goal: a.goal, Started: a.started, Exit: a.exit, External: a.external,
		Total: len(a.events), Events: append([]AskEvent{}, a.events[since:]...)}
}

// Answer contesta la pregunta pendiente. Vacía termina la corrida sin hacer lo que estaba por confirmar.
func (a *Asker) Answer(text string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.running || !a.waiting {
		return errors.New("no hay ninguna pregunta esperando respuesta")
	}
	text = strings.ReplaceAll(strings.TrimSpace(text), "\n", " ")
	if _, err := io.WriteString(a.stdin, text+"\n"); err != nil {
		return err
	}
	a.waiting = false
	go func() { hub.Publish("askstate", a.State(-1)) }() // en otra goroutine: acá el lock está tomado
	return nil
}

// Stop frena la corrida (y el Claude Code que lanzó: es todo el grupo).
func (a *Asker) Stop() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.external {
		a.external = false
		go func() { hub.Publish("askstate", a.State(-1)) }()
	}
	if !a.running || a.cmd == nil || a.cmd.Process == nil {
		return
	}
	a.exit = "frenada desde la interfaz"
	_ = syscall.Kill(-a.cmd.Process.Pid, syscall.SIGTERM)
}

// Begin abre una sesión externa (Claude desde la conversación): el panel se limpia y muestra la meta.
func (a *Asker) Begin(goal string) error {
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return errors.New("hay una meta de ask corriendo: esperá a que termine")
	}
	a.external, a.waiting, a.goal, a.started, a.exit, a.events = true, false, strings.TrimSpace(goal), time.Now(), "", nil
	a.mu.Unlock()
	hub.Publish("askstate", a.State(0))
	return nil
}

// Event suma un evento de la sesión externa (un comando, lo que piensa, cómo terminó). Sin sesión, se ignora:
// los comandos de una prueba suelta no ensucian el panel.
func (a *Asker) Event(kind, text string) {
	a.mu.Lock()
	if !a.external {
		a.mu.Unlock()
		return
	}
	ev := AskEvent{N: len(a.events), Kind: kind, Text: text, At: time.Now()}
	a.events = append(a.events, ev)
	a.mu.Unlock()
	hub.Publish("ask", ev)
}

// End cierra la sesión externa.
func (a *Asker) End() {
	a.mu.Lock()
	a.external = false
	a.mu.Unlock()
	hub.Publish("askstate", a.State(-1))
}
