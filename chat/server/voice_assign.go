package main

// LA VOZ DE CADA PERSONAJE, cuando se la cambia desde la videollamada (el ♂/♀ de su recuadro): personaje → voz de
// ElevenLabs. Lo que no está acá usa la voz de su JSON (chat/src/characters). Se guarda junto al historial del chat
// (voice-assign.json), así vale igual en el navegador y en Cockpit. Elegir CUÁL voz (la primera libre del otro género)
// lo hace la interfaz, que conoce a todos los personajes.
//
//	GET /api/voice/assign                       {"assign": {"miguel/luigi": "Lina", …}}
//	PUT /api/voice/assign  {"key": "…", "voice": "Lina"}   (voice vacío: vuelve a la del JSON)
//
// LA VOZ CON QUE SONÓ CADA MENSAJE (voice-said.json): la primera vez que un mensaje suena queda anotada su voz, y al
// repetirlo en la línea de tiempo suena con ésa aunque después se le haya cambiado la voz al personaje. Así lo que ya
// se dijo no cambia (y sale de las frases guardadas, sin cobrar); el cambio vale de ahí en adelante.
//
//	GET /api/voice/said                         {"said": {"<id del mensaje>": "Lina", …}}
//	PUT /api/voice/said    {"id": "…", "voice": "Lina"}   (sólo la primera vez: lo ya anotado no se pisa)

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
	registerVoiceSaid(mux)
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

var saidMu sync.Mutex

func saidFile() string { return filepath.Join(voiceCacheDir(), "voice-said.json") }

func readSaid() map[string]string {
	out := map[string]string{}
	if raw, err := os.ReadFile(saidFile()); err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func registerVoiceSaid(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/voice/said", func(w http.ResponseWriter, r *http.Request) {
		saidMu.Lock()
		defer saidMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"said": readSaid()})
	})
	mux.HandleFunc("PUT /api/voice/said", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ ID, Voice string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		id, voice := strings.TrimSpace(req.ID), strings.TrimSpace(req.Voice)
		if id == "" || voice == "" || len(id) > 200 || len(voice) > 120 {
			fail(w, http.StatusBadRequest, errors.New("falta el mensaje o la voz"))
			return
		}
		got, err := rememberSaid(id, voice)
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"voice": got})
	})
}

// rememberSaid anota la voz con que sonó (o se sincronizó) un mensaje, sólo la primera vez, y devuelve la que quedó.
func rememberSaid(id, voice string) (string, error) {
	saidMu.Lock()
	defer saidMu.Unlock()
	all := readSaid()
	if had, ok := all[id]; ok {
		return had, nil
	}
	all[id] = voice
	raw, _ := json.Marshal(all)
	if err := os.MkdirAll(voiceCacheDir(), 0o755); err != nil {
		return "", err
	}
	if err := writeAtomic(saidFile(), raw); err != nil {
		return "", err
	}
	return voice, nil
}
