package main

// LA CONSOLA DE NEWS: lo que hizo el servidor, en orden, y sobre qué máquina corre. News trabaja sola (actualiza cada
// 6 horas, mide los favoritos en Hugging Face, borra modelos) y hasta ahora lo único que decía era una frase en el pie,
// que se pisaba con la siguiente. La consola de la interfaz (la región `panel` del taller) muestra esto.
//
// La bitácora vive en memoria: son los últimos `activityMax` renglones desde que arrancó el servidor. No es un registro
// para auditar; es para ver qué pasó en esta sesión sin abrir una terminal.

import (
	"net/http"
	"sort"
	"sync"
	"time"

	"creditop/my-tools/lib/machine"
)

// Entry: un renglón de la consola.
type Entry struct {
	At   string `json:"at"`
	Kind string `json:"kind"` // info · ok · warn · error
	Text string `json:"text"`
}

const activityMax = 200

type activity struct {
	mu      sync.Mutex
	entries []Entry
}

func (a *activity) add(kind, text string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.entries = append(a.entries, Entry{At: time.Now().Format(time.RFC3339), Kind: kind, Text: text})
	if n := len(a.entries) - activityMax; n > 0 {
		a.entries = append([]Entry(nil), a.entries[n:]...)
	}
}

func (a *activity) list() []Entry {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]Entry{}, a.entries...)
}

// note: un renglón en la consola.
func (s *server) note(kind, text string) { s.activity.add(kind, text) }

type engineRow struct {
	ID string `json:"id"`
	engineState
}

func (s *server) consoleRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/activity", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"entries": s.activity.list()})
	})
	// Esta máquina: qué es, con qué motores cuenta para correr modelos y en qué carpetas se buscan los instalados.
	mux.HandleFunc("GET /api/machine", func(w http.ResponseWriter, _ *http.Request) {
		rows := []engineRow{}
		for id, e := range engines() {
			rows = append(rows, engineRow{ID: id, engineState: e})
		}
		sort.Slice(rows, func(a, b int) bool { return rows[a].Name < rows[b].Name })
		writeJSON(w, 200, map[string]any{
			"machine": machine.Detect(), "engines": rows,
			"roots": []map[string]string{
				{"name": "caché de Hugging Face", "path": s.roots.Hub},
				{"name": "GGUF de llama-server y entornos", "path": s.roots.Mine},
				{"name": "whisper.cpp", "path": s.roots.Whisper},
			},
		})
	})
}
