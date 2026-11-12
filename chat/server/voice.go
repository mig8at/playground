package main

// VOCES DE LA VIDEOLLAMADA: el texto se vuelve audio ACÁ, en tu máquina, con `say` de macOS. Nada sale a ningún
// servicio. Va por el servidor y no por la síntesis del navegador por dos razones medidas: dentro de Cockpit (WebKit)
// el navegador sólo ofrece dos voces en español (Mónica y Paulina), y `say` tiene todas (Eddy, Reed, Rocko, Grandpa…);
// y con un archivo de audio la videollamada puede mover la boca con el volumen real de lo que suena.
//
//	GET  /api/voice          las voces en español de esta máquina
//	POST /api/voice          {"voice": "Eddy (Español (México))", "text": "…", "rate": 1} → audio/wav
//	                         {"engine": "gemini", "voice": "Puck", "text": "…"} → la de
//	                         Gemini (voice_gemini.go)
//
// Cada frase se guarda una vez (en la caché del usuario, por voz, velocidad y texto): repetir no vuelve a generarla.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

const maxVoiceText = 600 // caracteres por frase: la videollamada manda frases cortas

var (
	voiceListOnce sync.Once
	voiceList     []string
)

// spanishVoices son los nombres que acepta `say -v`, sólo los de español.
func spanishVoices() []string {
	voiceListOnce.Do(func() {
		out, err := exec.Command("say", "-v", "?").Output()
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(out), "\n") {
			// «Eddy (Español (México)) es_MX    # ¡Hola! …»: el nombre es lo que va antes del código de idioma
			i := strings.Index(line, " es_")
			if i <= 0 {
				continue
			}
			voiceList = append(voiceList, strings.TrimSpace(line[:i]))
		}
	})
	return voiceList
}

func voiceCacheDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "creditop-chat", "voice")
}

// synthesize devuelve la ruta del WAV de `text` dicho por `voice`, generándolo si no estaba.
func synthesize(voice, text string, rate float64) (string, error) {
	known := false
	for _, v := range spanishVoices() {
		if v == voice {
			known = true
			break
		}
	}
	if !known {
		return "", fmt.Errorf("la voz %q no está en esta máquina", voice)
	}
	if rate <= 0 {
		rate = 1
	}
	wpm := int(185 * rate) // 185 palabras por minuto es la velocidad normal de `say`
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%s", voice, wpm, text)))
	dir := voiceCacheDir()
	file := filepath.Join(dir, hex.EncodeToString(sum[:12])+".wav")
	if _, err := os.Stat(file); err == nil {
		return file, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	tmp := file + ".tmp.wav"
	cmd := exec.Command("say", "-v", voice, "-r", fmt.Sprint(wpm), "--file-format=WAVE", "--data-format=LEI16@22050", "-o", tmp, "--", text)
	if out, err := cmd.CombinedOutput(); err != nil {
		os.Remove(tmp)
		return "", fmt.Errorf("say: %v %s", err, strings.TrimSpace(string(out)))
	}
	return file, os.Rename(tmp, file)
}

func registerVoice(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/voice", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"voices": spanishVoices(), "gemini": geminiKey() != ""})
	})
	mux.HandleFunc("POST /api/voice", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Engine string  `json:"engine"`
			Voice  string  `json:"voice"`
			Text   string  `json:"text"`
			Rate   float64 `json:"rate"`
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
		var file string
		var err error
		if req.Engine == "gemini" {
			file, err = synthesizeGemini(r.Context(), req.Voice, text)
		} else {
			file, err = synthesize(req.Voice, text, req.Rate)
		}
		if err != nil {
			fail(w, http.StatusUnprocessableEntity, err)
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		w.Header().Set("Cache-Control", "private, max-age=86400")
		http.ServeFile(w, r, file)
	})
}
