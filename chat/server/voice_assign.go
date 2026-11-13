package main

// LA VOZ DE CADA PERSONAJE, cuando se la cambia desde la videollamada (el ♂/♀ de su recuadro): personaje → voz de
// ElevenLabs. Lo que no está acá usa la voz de su JSON (chat/src/characters). Se guarda junto al historial del chat
// (voice-assign.json), así vale igual en el navegador y en Cockpit. Elegir CUÁL voz (la primera libre del otro género)
// lo hace la interfaz, que conoce a todos los personajes.
//
//	GET /api/voice/assign                       {"assign": {"miguel/luigi": "Lina", …}}
//	PUT /api/voice/assign  {"key": "…", "voice": "Lina"}   (voice vacío: vuelve a la del JSON)

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var assignMu sync.Mutex

func assignFile() string { return filepath.Join(voiceCacheDir(), "voice-assign.json") }

func readAssign() map[string]string {
	out := map[string]string{}
	if raw, err := os.ReadFile(assignFile()); err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func registerVoiceAssign(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/voice/assign", func(w http.ResponseWriter, r *http.Request) {
		assignMu.Lock()
		defer assignMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"assign": readAssign()})
	})
	mux.HandleFunc("PUT /api/voice/assign", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Key, Voice string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		key := strings.ToLower(strings.TrimSpace(req.Key))
		if key == "" || len(key) > 120 || len(req.Voice) > 120 {
			fail(w, http.StatusBadRequest, errors.New("falta el personaje, o el nombre es demasiado largo"))
			return
		}
		assignMu.Lock()
		defer assignMu.Unlock()
		all := readAssign()
		if v := strings.TrimSpace(req.Voice); v == "" {
			delete(all, key)
		} else {
			all[key] = v
		}
		raw, _ := json.Marshal(all)
		if err := os.MkdirAll(voiceCacheDir(), 0o755); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		if err := os.WriteFile(assignFile(), raw, 0o644); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"assign": all})
	})
}
