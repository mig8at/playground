package main

// DICTADO: lo que grabás con el micrófono de la barra de escribir se transcribe ACÁ, en tu máquina, con Whisper
// (whisper.cpp, `whisper-cli`), sin mandarlo a ningún servicio. La interfaz graba con MediaRecorder (webm u mp4,
// según el navegador), `ffmpeg` lo pasa al WAV de 16 kHz mono que pide Whisper, y el texto vuelve a la caja para que
// lo revises antes de mandarlo.
//
//	GET  /api/dictate   ¿está listo? (whisper-cli, ffmpeg y el modelo); si no, qué falta
//	POST /api/dictate   el audio en el cuerpo → {"text": "…"}
//
// El modelo: CHAT_WHISPER_MODEL, o ~/.cache/whisper/ggml-large-v3-turbo-q5_0.bin (se baja una vez, ~550 MB). Con
// `brew install whisper-cpp` corre sobre Metal: unos segundos de audio se transcriben en uno o dos.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const maxDictation = 25 << 20 // 25 MB: varios minutos de voz comprimida

// Un dictado a la vez: Whisper usa toda la GPU y dos en paralelo tardan lo mismo que en fila.
var dictationMu sync.Mutex

type dictationTools struct {
	Whisper, Ffmpeg, Model string
}

// findTool busca un binario en el PATH y, si no está (una app abierta desde el Dock trae un PATH mínimo), en Homebrew.
func findTool(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, dir := range []string{"/opt/homebrew/bin", "/usr/local/bin"} {
		if p := filepath.Join(dir, name); fileExists(p) {
			return p
		}
	}
	return ""
}

func whisperModel() string {
	if m := os.Getenv("CHAT_WHISPER_MODEL"); m != "" {
		return m
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".cache", "whisper", "ggml-large-v3-turbo-q5_0.bin")
}

// dictationReady dice qué hay y, si falta algo, qué (para que la interfaz no ofrezca un micrófono que no anda).
func dictationReady() (dictationTools, error) {
	t := dictationTools{Whisper: findTool("whisper-cli"), Ffmpeg: findTool("ffmpeg"), Model: whisperModel()}
	var missing []string
	if t.Whisper == "" {
		missing = append(missing, "whisper-cli (brew install whisper-cpp)")
	}
	if t.Ffmpeg == "" {
		missing = append(missing, "ffmpeg (brew install ffmpeg)")
	}
	if !fileExists(t.Model) {
		missing = append(missing, "el modelo "+t.Model)
	}
	if len(missing) > 0 {
		return t, errors.New("falta " + strings.Join(missing, ", "))
	}
	return t, nil
}

// transcribe pasa el audio a WAV de 16 kHz y lo transcribe en español. Devuelve el texto sin marcas de tiempo.
func transcribe(ctx context.Context, t dictationTools, audio []byte) (string, error) {
	dir, err := os.MkdirTemp("", "chat-dictation-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	in, wav := filepath.Join(dir, "in"), filepath.Join(dir, "in.wav")
	if err := os.WriteFile(in, audio, 0o600); err != nil {
		return "", err
	}
	if out, err := exec.CommandContext(ctx, t.Ffmpeg, "-nostdin", "-loglevel", "error", "-i", in,
		"-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav).CombinedOutput(); err != nil {
		return "", fmt.Errorf("no pude leer el audio: %s", strings.TrimSpace(string(out)))
	}
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, t.Whisper, "-m", t.Model, "-l", "es", "-nt", "-np", "-t", "8", "--prompt", dictationVocabulary, "-f", wav)
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("whisper no pudo transcribir: %s", strings.TrimSpace(lastLine(stderr.String())))
	}
	return cleanTranscript(stdout.String()), nil
}

// dictationVocabulary orienta a Whisper con las palabras del trabajo: sin esto, «hash» salía «hashtag» (medido con una
// voz de prueba). No obliga a usarlas: sólo las hace más probables.
const dictationVocabulary = "CreditOp, CreditopX, VTEX, Shopify, hash, token, llavero, sucursal, comercio, solicitud, " +
	"Duncan, Cockpit, tablero, harness, cuadrilla, Jarvis, canon, QA, prod, PR, Jira, Experian, Datacrédito"

// cleanTranscript junta las líneas en un solo texto y saca lo que Whisper escribe cuando no oye nada.
func cleanTranscript(s string) string {
	text := strings.Join(strings.Fields(s), " ")
	switch strings.ToLower(strings.Trim(text, " .[]()")) {
	case "", "blank_audio", "silencio", "música", "music":
		return ""
	}
	return text
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return lines[len(lines)-1]
}

func registerDictation(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/dictate", func(w http.ResponseWriter, r *http.Request) {
		if _, err := dictationReady(); err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ready": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ready": true})
	})
	mux.HandleFunc("POST /api/dictate", func(w http.ResponseWriter, r *http.Request) {
		tools, err := dictationReady()
		if err != nil {
			fail(w, http.StatusServiceUnavailable, err)
			return
		}
		audio, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDictation))
		if err != nil {
			fail(w, http.StatusRequestEntityTooLarge, errors.New("el audio pasa de 25 MB"))
			return
		}
		if len(audio) == 0 {
			fail(w, http.StatusBadRequest, errors.New("no llegó audio"))
			return
		}
		dictationMu.Lock()
		defer dictationMu.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		start := time.Now()
		text, err := transcribe(ctx, tools, audio)
		if err != nil {
			fail(w, http.StatusUnprocessableEntity, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"text": text, "seconds": time.Since(start).Seconds()})
	})
}
