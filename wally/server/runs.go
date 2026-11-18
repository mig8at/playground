package main

// Las corridas automáticas que terminaron (Miguel, 2026-11-17: «que un agente trabaje solo» sólo sirve si uno se
// entera cuando termina). Quien corre el modo Auto —la interfaz o `bin/wally ask --auto`— avisa acá al cerrar: sale un
// aviso de macOS (tocarlo abre Wally en esa conversación) y la corrida queda «sin ver» hasta que se abre, que es el
// numerito del ícono de Wally en la barra de Cockpit.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
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
	id := r.PathValue("id")
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
		writeErr(w, 404, fmt.Errorf("no existe esa conversación"))
		return
	}
	run := finishedRun{At: time.Now(), Who: who, OK: in.Stopped == "", Rounds: in.Rounds}
	run.Text = fmt.Sprintf("Terminó: %d vuelta(s), %d s.", in.Rounds, in.Ms/1000)
	if in.Stopped != "" {
		run.Text = "Frenó sin quedar bien: " + strings.TrimSpace(in.Stopped)
		if r := []rune(run.Text); len(r) > 220 {
			run.Text = string(r[:220]) + "…"
		}
	}
	a.runs.mu.Lock()
	if a.runs.unseen == nil {
		a.runs.unseen = map[string]finishedRun{}
	}
	a.runs.unseen[id] = run
	a.runs.mu.Unlock()
	if !in.Quiet {
		go func() {
			if err := macNotice("Wally · "+who, run.Text, "#/c/"+id, !run.OK); err != nil {
				log.Printf("wally: el aviso no salió: %v", err)
			}
		}()
	}
	writeJSON(w, 200, run)
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

// macNotice: el aviso del sistema, por el avisador del chat («Chat de my-tools», que ya tiene permiso de avisos y abre
// un enlace `cockpit://` al tocarlo), como Sentinel y Correo; sin él, por osascript.
func macNotice(title, body, route string, sound bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	home, _ := os.UserHomeDir()
	bin := filepath.Join(home, "Applications", "Chat de my-tools.app", "Contents", "MacOS", "ChatNotifier")
	if st, err := os.Stat(bin); err == nil && !st.IsDir() {
		args := []string{"--title", title, "--body", body, "--url", "cockpit://wally/" + route, "--group", "creditop-wally-" + route}
		if sound {
			args = append(args, "--sound")
		}
		if out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput(); err != nil {
			return fmt.Errorf("avisador: %v %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	script := fmt.Sprintf("display notification %q with title %q", body, title)
	if out, err := exec.CommandContext(ctx, "osascript", "-e", script).CombinedOutput(); err != nil {
		return fmt.Errorf("osascript: %v %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
