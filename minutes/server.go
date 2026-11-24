package main

// LA API DE LA APP (Cockpit → Minutes): la misma carpeta y las mismas funciones que el CLI, por HTTP.
//
//	GET    /api/state                         ¿se está grabando? y qué está haciendo (grabando · terminando · nada)
//	GET    /api/recordings                    las grabaciones, de la más nueva a la más vieja
//	GET    /api/recordings/{id}               una: su estado, las capturas, lo transcrito y, si ya está, timeline.json
//	GET    /api/recordings/{id}/frames/{f}    una captura
//	POST   /api/start {title}                 arranca (como `bin/minutes start`)
//	POST   /api/stop                          frena, termina de transcribir y arma el resumen (tarda ~1 min: de fondo)
//	POST   /api/recordings/{id}/summarize     lo vuelve a armar
//	DELETE /api/recordings/{id}               la borra del disco (la interfaz pide dos toques)
//
// Sólo desde esta máquina (Host 127.0.0.1 o localhost) y, salvo las imágenes, con el encabezado `X-Minutes: 1`: una
// página web cualquiera no puede mandarlo sin preguntar antes, y acá nadie contesta esa pregunta.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type server struct {
	mu      sync.Mutex
	phase   string // "" · "starting" · "finishing" · "summarizing"
	working string // la grabación sobre la que trabaja
	lastErr string
}

func serve(addr string) error {
	s := &server{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", s.state)
	mux.HandleFunc("GET /api/recordings", s.list)
	mux.HandleFunc("GET /api/recordings/{id}", s.one)
	mux.HandleFunc("GET /api/recordings/{id}/frames/{file}", s.frame)
	mux.HandleFunc("POST /api/start", s.start)
	mux.HandleFunc("POST /api/stop", s.stop)
	mux.HandleFunc("POST /api/recordings/{id}/summarize", s.summarize)
	mux.HandleFunc("DELETE /api/recordings/{id}", s.remove)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("minutes: API en http://%s", addr)
	return http.Serve(ln, guard(mux))
}

func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if i := strings.LastIndexByte(host, ':'); i >= 0 {
			host = host[:i]
		}
		if host != "127.0.0.1" && host != "localhost" {
			writeErr(w, http.StatusForbidden, errors.New("sólo desde esta máquina"))
			return
		}
		image := r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/frames/")
		if !image && r.Header.Get("X-Minutes") != "1" {
			writeErr(w, http.StatusForbidden, errors.New("falta el encabezado X-Minutes"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSONResponse(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

var idRe = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$`)

// dirOf: la carpeta de una grabación, sólo si el id tiene la forma de una (nada de rutas).
func dirOf(id string) (string, error) {
	if !idRe.MatchString(id) {
		return "", errors.New("no es una grabación")
	}
	d := filepath.Join(recordingsDir(), id)
	if _, err := os.Stat(d); err != nil {
		return "", errors.New("no existe esa grabación")
	}
	return d, nil
}

// currentID: la grabación en curso (si la grabadora sigue viva).
func currentID() string {
	b, err := os.ReadFile(currentFile())
	if err != nil {
		return ""
	}
	id := strings.TrimSpace(string(b))
	if d, err := dirOf(id); err != nil || recorderDone(d) {
		return ""
	}
	return id
}

type recordingOut struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Started    string  `json:"started"`
	Seconds    float64 `json:"seconds"`
	Frames     int     `json:"frames"`
	Recording  bool    `json:"recording"`
	HasSummary bool    `json:"has_summary"`
}

func describe(d string) recordingOut {
	var m Meta
	readJSON(filepath.Join(d, "meta.json"), &m)
	st, _ := recorderState(d)
	o := recordingOut{ID: filepath.Base(d), Title: m.Title, Started: firstNonEmpty(st.Started, m.Started), Seconds: st.Seconds,
		Frames: countLines(filepath.Join(d, "frames.jsonl")), HasSummary: fileExists(filepath.Join(d, "timeline.json"))}
	if o.ID == currentID() {
		o.Recording = true
		if t, err := time.Parse(time.RFC3339, st.Started); err == nil {
			o.Seconds = time.Since(t).Seconds()
		}
	}
	return o
}

func (s *server) state(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSONResponse(w, map[string]any{"current": currentID(), "phase": s.phase, "working": s.working, "error": s.lastErr})
}

func (s *server) list(w http.ResponseWriter, r *http.Request) {
	all := recordings()
	sort.Sort(sort.Reverse(sort.StringSlice(all)))
	out := []recordingOut{}
	for _, d := range all {
		out = append(out, describe(d))
	}
	writeJSONResponse(w, map[string]any{"recordings": out})
}

func (s *server) one(w http.ResponseWriter, r *http.Request) {
	d, err := dirOf(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	var segs []Segment
	for _, g := range loadTranscript(d) {
		if !g.Echo {
			segs = append(segs, g)
		}
	}
	sort.SliceStable(segs, func(i, j int) bool { return segs[i].Start < segs[j].Start })
	out := map[string]any{"recording": describe(d), "frames": loadFrames(d), "segments": segs, "pending": len(pendingChunks(d))}
	var tl Timeline
	if err := readJSON(filepath.Join(d, "timeline.json"), &tl); err == nil {
		out["timeline"] = tl
	}
	writeJSONResponse(w, out)
}

func (s *server) frame(w http.ResponseWriter, r *http.Request) {
	d, err := dirOf(r.PathValue("id"))
	f := r.PathValue("file")
	if err != nil || strings.ContainsAny(f, "/\\") || !strings.HasSuffix(f, ".jpg") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "max-age=86400")
	http.ServeFile(w, r, filepath.Join(d, "frames", f))
}

// busy: una operación a la vez (arrancar, frenar, resumir).
func (s *server) begin(phase, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phase != "" {
		return fmt.Errorf("ya estoy %s", map[string]string{"starting": "arrancando", "finishing": "terminando una grabación", "summarizing": "armando un resumen"}[s.phase])
	}
	s.phase, s.working, s.lastErr = phase, id, ""
	return nil
}

func (s *server) end(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.phase, s.working = "", ""
	if err != nil {
		s.lastErr = err.Error()
	}
}

func (s *server) start(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title string `json:"title"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	if err := s.begin("starting", ""); err != nil {
		writeErr(w, http.StatusConflict, err)
		return
	}
	args := []string{}
	if t := strings.TrimSpace(in.Title); t != "" {
		args = append(args, "--title", t)
	}
	err := start(args)
	s.end(err)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSONResponse(w, map[string]string{"id": currentID()})
}

func (s *server) stop(w http.ResponseWriter, r *http.Request) {
	id := currentID()
	if id == "" {
		writeErr(w, http.StatusConflict, errors.New("no hay una grabación en curso"))
		return
	}
	if err := s.begin("finishing", id); err != nil {
		writeErr(w, http.StatusConflict, err)
		return
	}
	go func() { s.end(stop(nil)) }()
	writeJSONResponse(w, map[string]string{"id": id})
}

func (s *server) summarize(w http.ResponseWriter, r *http.Request) {
	d, err := dirOf(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	if !recorderDone(d) {
		writeErr(w, http.StatusConflict, errors.New("la grabación sigue en curso"))
		return
	}
	if err := s.begin("summarizing", filepath.Base(d)); err != nil {
		writeErr(w, http.StatusConflict, err)
		return
	}
	go func() {
		err := transcribePending(d, false)
		if err == nil {
			err = summarize(d, summarizeOptions{MaxScreens: 20})
		}
		s.end(err)
	}()
	writeJSONResponse(w, map[string]string{"id": filepath.Base(d)})
}

func (s *server) remove(w http.ResponseWriter, r *http.Request) {
	d, err := dirOf(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	s.mu.Lock()
	busy := s.working == filepath.Base(d)
	s.mu.Unlock()
	if busy || !recorderDone(d) {
		writeErr(w, http.StatusConflict, errors.New("está en uso: frenala primero"))
		return
	}
	if err := os.RemoveAll(d); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSONResponse(w, map[string]bool{"ok": true})
}
