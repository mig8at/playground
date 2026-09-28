package main

/* La API de la interfaz: las MISMAS vistas que la consola, en JSON. Sólo escucha en 127.0.0.1 —las
 * transcripciones traen de todo— y sólo lee. */

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"creditop/playground/connectors/canon"
	"creditop/playground/radar/scan"
)

// SessionSummary es una fila de la lista de sesiones.
type SessionSummary struct {
	ID         string    `json:"id"`
	Entrypoint string    `json:"entrypoint"`
	Start      time.Time `json:"start"`
	Calls      int       `json:"calls"`
	Friction   int       `json:"friction"`
	Skills     []string  `json:"skills"`
}

// Summaries: las sesiones con alguna llamada en el período, de la más nueva a la más vieja.
func Summaries(sessions []scan.Session, since time.Time) []SessionSummary {
	var out []SessionSummary
	for i := len(sessions) - 1; i >= 0; i-- {
		s := sessions[i]
		row := SessionSummary{ID: s.ID, Entrypoint: s.Entrypoint, Start: s.Start}
		seen := map[string]bool{}
		for _, c := range s.Calls {
			if c.Time.Before(since) {
				continue
			}
			row.Calls++
			if c.Outcome != scan.OutcomeOK {
				row.Friction++
			}
			for _, k := range c.Keys {
				if name, ok := strings.CutPrefix(k, "skill "); ok && !seen[name] {
					seen[name] = true
					row.Skills = append(row.Skills, name)
				}
			}
		}
		if row.Calls > 0 {
			out = append(out, row)
		}
	}
	return out
}

// server guarda lo que no cambia entre pedidos.
type server struct {
	root, projects string
	mu             sync.Mutex
	skipped        int // corridas automáticas que el último pedido dejó afuera
}

// load lee las sesiones (con el índice) y el período del pedido.
func (sv *server) load(r *http.Request) ([]scan.Session, []scan.Call, time.Time, int, error) {
	sv.mu.Lock() // el índice es un archivo: dos pedidos a la vez no lo escriben juntos
	defer sv.mu.Unlock()
	days, err := strconv.Atoi(r.URL.Query().Get("days"))
	if err != nil || days <= 0 || days > 365 {
		days = 30
	}
	sessions, read, err := scan.LoadSessions(scan.TranscriptDirs(sv.projects, sv.root), scan.CachePath(sv.root))
	sessions, sv.skipped = scan.HumanOnly(sessions, r.URL.Query().Get("all") == "1")
	since := time.Now().AddDate(0, 0, -days)
	return sessions, scan.InPeriod(sessions, since), since, read, err
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func (sv *server) handler() http.Handler {
	mux := http.NewServeMux()
	src := func() scan.Makefile {
		raw, _ := os.ReadFile(filepath.Join(sv.root, "Makefile"))
		return scan.ParseMakefile(string(raw))
	}
	view := func(build func(sessions []scan.Session, calls []scan.Call, since time.Time, r *http.Request) (any, int)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			sessions, calls, since, read, err := sv.load(r)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			out, status := build(sessions, calls, since, r)
			if status != http.StatusOK {
				w.WriteHeader(status)
			}
			w.Header().Set("X-Radar-Read", strconv.Itoa(read))
			w.Header().Set("X-Radar-Skipped", strconv.Itoa(sv.skipped))
			writeJSON(w, out)
		}
	}
	mux.HandleFunc("/api/usage", view(func(_ []scan.Session, calls []scan.Call, _ time.Time, _ *http.Request) (any, int) {
		return scan.UsageView(calls, src()), http.StatusOK
	}))
	mux.HandleFunc("/api/friction", view(func(_ []scan.Session, calls []scan.Call, _ time.Time, _ *http.Request) (any, int) {
		return scan.FrictionView(calls), http.StatusOK
	}))
	mux.HandleFunc("/api/drift", view(func(_ []scan.Session, calls []scan.Call, _ time.Time, _ *http.Request) (any, int) {
		return scan.DriftView(calls, src(), scan.GitHistory(sv.root), scan.SkillNames(sv.root)), http.StatusOK
	}))
	mux.HandleFunc("/api/gaps", view(func(sessions []scan.Session, _ []scan.Call, since time.Time, r *http.Request) (any, int) {
		g := scan.GapsView(sessions, since)
		if r.URL.Query().Get("recheck") == "1" {
			recheck(&g, canon.FromEnv())
		}
		return g, http.StatusOK
	}))
	mux.HandleFunc("/api/sessions", view(func(sessions []scan.Session, _ []scan.Call, since time.Time, _ *http.Request) (any, int) {
		return Summaries(sessions, since), http.StatusOK
	}))
	mux.HandleFunc("/api/session", view(func(sessions []scan.Session, _ []scan.Call, _ time.Time, r *http.Request) (any, int) {
		id := r.URL.Query().Get("id")
		if id == "" {
			return map[string]string{"error": "falta ?id="}, http.StatusBadRequest
		}
		s, ok := scan.FindSession(sessions, id)
		if !ok {
			return map[string]string{"error": "no hay una sesión con ese id"}, http.StatusNotFound
		}
		return s, http.StatusOK
	}))
	return mux
}

// serve arranca la API. Rechaza cualquier dirección que no sea de esta máquina.
func serve(root, projects, addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("radar sólo escucha en esta máquina (127.0.0.1 o localhost), no en %q", host)
	}
	sv := &server{root: root, projects: projects}
	fmt.Fprintf(os.Stderr, "radar · API en http://%s\n", addr)
	return http.ListenAndServe(addr, sv.handler())
}
