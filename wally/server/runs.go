package main

// Las corridas automáticas que terminaron (Miguel, 2026-11-17: «que un agente trabaje solo» sólo sirve si uno se
// entera cuando termina). Quien corre el modo Auto —la interfaz o `bin/wally ask --auto`— avisa acá al cerrar: sale un
// aviso de macOS (tocarlo abre Wally en esa conversación) y la corrida queda «sin ver» hasta que se abre, que es el
// numerito del ícono de Wally en la barra de Cockpit.

import (
	"creditop/my-tools/lib/notice"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

type finishedRun struct {
	At     time.Time `json:"at"`
	Who    string    `json:"who"`
	Text   string    `json:"text"`
	OK     bool      `json:"ok"`
	Rounds int       `json:"rounds,omitempty"`
}

type runStore struct {
	mu     sync.Mutex
	unseen map[string]finishedRun // id de la conversación → la última corrida que terminó y no se vio
	// La conversación que la interfaz tiene adelante, con Wally a la vista, y cuándo lo dijo por última vez.
	watchID string
	watchAt time.Time
}

// runDone: POST /api/conversations/{id}/done {rounds, ms, stopped} — terminó una corrida automática.
func (a *app) runDone(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Rounds  int    `json:"rounds"`
		Ms      int64  `json:"ms"`
		Stopped string `json:"stopped"` // por qué frenó sin quedar bien ("" si cerró bien)
		Quiet   bool   `json:"quiet"`   // sin aviso del sistema (quien corre ya lo está mirando)
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	run, err := a.finishRun(r.PathValue("id"), in.Rounds, in.Ms, in.Stopped, in.Quiet)
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	writeJSON(w, 200, run)
}

// finishRun anota una corrida automática que terminó: queda «sin ver» y, salvo quiet o que Miguel la esté mirando,
// sale el aviso de macOS.
func (a *app) finishRun(id string, rounds int, ms int64, stopped string, quiet bool) (finishedRun, error) {
	a.store.mu.Lock()
	c, ok := a.store.convs[id]
	who := ""
	if ok {
		who = c.Title
		if c.Agent != nil {
			who = c.Agent.Name
		} else if c.Main {
			who = "Wally"
		}
	}
	a.store.mu.Unlock()
	if !ok {
		return finishedRun{}, fmt.Errorf("no existe esa conversación")
	}
	run := finishedRun{At: time.Now(), Who: who, OK: stopped == "", Rounds: rounds}
	run.Text = fmt.Sprintf("Terminó: %d vuelta(s), %d s.", rounds, ms/1000)
	if stopped != "" {
		run.Text = "Frenó sin quedar bien: " + strings.TrimSpace(stopped)
		if r := []rune(run.Text); len(r) > 220 {
			run.Text = string(r[:220]) + "…"
		}
	}
	watched := a.watching(id)
	a.runs.mu.Lock()
	if a.runs.unseen == nil {
		a.runs.unseen = map[string]finishedRun{}
	}
	if !watched {
		a.runs.unseen[id] = run
	}
	a.runs.mu.Unlock()
	if !quiet && !watched && !a.silent {
		go func() {
			if err := macNotice("Wally · "+who, run.Text, "#/c/"+id, !run.OK); err != nil {
				log.Printf("wally: el aviso no salió: %v", err)
			}
		}()
	}
	return run, nil
}

// watching: ¿la interfaz tiene esa conversación adelante, con Wally a la vista? (la interfaz lo dice en cada
// consulta de /api/live; vale unos segundos).
func (a *app) watching(id string) bool {
	a.runs.mu.Lock()
	defer a.runs.mu.Unlock()
	return a.runs.watchID == id && time.Since(a.runs.watchAt) < 8*time.Second
}

func (a *app) noteWatching(id string) {
	a.runs.mu.Lock()
	a.runs.watchID, a.runs.watchAt = id, time.Now()
	a.runs.mu.Unlock()
}

// runSeen: POST /api/conversations/{id}/seen — se abrió la conversación: deja de contar.
func (a *app) runSeen(w http.ResponseWriter, r *http.Request) {
	a.runs.mu.Lock()
	delete(a.runs.unseen, r.PathValue("id"))
	a.runs.mu.Unlock()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *app) runsUnseen() map[string]finishedRun {
	a.runs.mu.Lock()
	defer a.runs.mu.Unlock()
	out := map[string]finishedRun{}
	for k, v := range a.runs.unseen {
		out[k] = v
	}
	return out
}

// macNotice: el aviso, por lib/notice (Cockpit decide el silencio y lo guarda en su bandeja). Tocarlo abre la
// conversación en Wally. Una corrida que falló suena y es importante.
func macNotice(title, body, route string, sound bool) error {
	_, err := notice.Send(notice.Notice{App: "wally", Title: title, Body: body, URL: "cockpit://wally/" + route,
		Group: "creditop-wally-" + route, Replace: true, Important: sound, Sound: sound})
	return err
}
