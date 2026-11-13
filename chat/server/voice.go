package main

// VOCES DE LA VIDEOLLAMADA: el texto se vuelve audio con ElevenLabs (voice_elevenlabs.go, por su conector). Hubo dos
// motores más —las voces de macOS con `say` y Gemini— y se quitaron el 2026-11-12: ElevenLabs suena mejor, tiene
// voces colombianas y entrega una frase en 0,35–0,7 s (Gemini, ~2,4 s y con un cupo de 10 pedidos por minuto).
//
//	GET  /api/voice          ¿hay llave de ElevenLabs?, y cuánto del tope diario se usó (voice_budget.go)
//	POST /api/voice          {"voice": "Laura", "text": "…"} → audio/mpeg
//
// Cada frase se guarda una vez (en la caché del usuario, por modelo, voz y texto): repetirla no vuelve a cobrarse.

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxVoiceText = 600 // caracteres por frase: la videollamada manda frases cortas

func voiceCacheDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "creditop-chat", "voice")
}

func registerVoice(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/voice", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"elevenlabs": elevenReady(), "usedToday": readBudget().Chars, "dailyLimit": dailyVoiceLimit()})
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
