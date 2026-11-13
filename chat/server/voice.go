package main

// VOCES DE LA VIDEOLLAMADA: el texto se vuelve audio con ElevenLabs (voice_elevenlabs.go, por su conector). Hubo dos
// motores más —las voces de macOS con `say` y Gemini— y se quitaron el 2026-11-12: ElevenLabs suena mejor, tiene
// voces colombianas y entrega una frase en 0,35–0,7 s (Gemini, ~2,4 s y con un cupo de 10 pedidos por minuto).
//
//	GET  /api/voice          ¿hay llave de ElevenLabs?, y cuánto del tope diario se usó (voice_budget.go)
//	GET  /api/voice/voices   las voces: las mejores (personas), las de personaje (animales) y las de la cuenta
//	GET  /api/voice/species  por especie, su voz de mujer y su voz de hombre (voice_top.go)
//	POST /api/voice          {"voice": "Laura", "text": "…"} → audio/mpeg
//
// Cada frase se guarda una vez (junto al historial del chat, por modelo, voz y texto): repetirla no vuelve a cobrarse.

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const maxVoiceText = 600 // caracteres por frase: la videollamada manda frases cortas

// voiceCacheDir: dónde quedan las frases ya generadas. Junto al historial del chat (Application Support), no en la
// carpeta de cachés de macOS, que el sistema puede vaciar: una frase se paga una sola vez y queda para siempre, así la
// línea de tiempo de la videollamada puede volver a sonar sin gastar. La primera vez trae lo que había en la caché vieja.
var voiceMigrate sync.Once

func voiceCacheDir() string {
	base, err := historyDir()
	if err != nil {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "voice")
	voiceMigrate.Do(func() {
		old, err := os.UserCacheDir()
		if err != nil {
			return
		}
		old = filepath.Join(old, "creditop-chat", "voice")
		entries, err := os.ReadDir(old)
		if err != nil {
			return
		}
		_ = os.MkdirAll(dir, 0o755)
		for _, e := range entries {
			if !e.IsDir() {
				_ = os.Rename(filepath.Join(old, e.Name()), filepath.Join(dir, e.Name()))
			}
		}
		_ = os.Remove(old)
	})
	return dir
}

func registerVoice(mux *http.ServeMux) {
	registerVoiceAssign(mux)
	registerSfx(mux)
	mux.HandleFunc("GET /api/voice", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"elevenlabs": elevenReady(), "usedToday": readBudget().Chars, "dailyLimit": dailyVoiceLimit()})
	})
	mux.HandleFunc("GET /api/voice/voices", func(w http.ResponseWriter, r *http.Request) {
		voices, err := elevenVoiceList()
		if err != nil {
			fail(w, http.StatusUnprocessableEntity, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"voices": voices})
	})
	mux.HandleFunc("GET /api/voice/species", func(w http.ResponseWriter, r *http.Request) {
		out := map[string]map[string]string{}
		for sp, pair := range speciesVoices {
			out[sp] = map[string]string{"female": pair[0], "male": pair[1]}
		}
		writeJSON(w, http.StatusOK, map[string]any{"species": out})
	})
	mux.HandleFunc("POST /api/voice", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Voice string `json:"voice"`
			Text  string `json:"text"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		text := strings.TrimSpace(req.Text)
		if text == "" || len([]rune(text)) > maxVoiceText {
			fail(w, http.StatusBadRequest, errors.New("el texto va vacío o es demasiado largo"))
			return
		}
		file, err := synthesizeEleven(req.Voice, text)
		if err != nil {
			fail(w, http.StatusUnprocessableEntity, err)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("Cache-Control", "private, max-age=86400")
		http.ServeFile(w, r, file)
	})
}
