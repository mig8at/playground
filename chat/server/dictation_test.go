package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// De punta a punta, con Whisper de verdad: una voz de macOS (`say`) en webm, como la manda la interfaz, entra por
// POST /api/dictate y vuelve como texto. Se salta si en esta máquina falta `say`, ffmpeg, whisper-cli o el modelo.
func TestDictationTranscribesSpanishVoice(t *testing.T) {
	tools, err := dictationReady()
	if err != nil {
		t.Skip(err)
	}
	if _, err := exec.LookPath("say"); err != nil {
		t.Skip("sin `say` para generar la voz")
	}
	dir := t.TempDir()
	aiff, webm := filepath.Join(dir, "voz.aiff"), filepath.Join(dir, "voz.webm")
	if out, err := exec.Command("say", "-v", "Paulina", "Mándame el hash de la sucursal por el llavero", "-o", aiff).CombinedOutput(); err != nil {
		t.Skipf("say: %s", out)
	}
	if out, err := exec.Command(tools.Ffmpeg, "-nostdin", "-loglevel", "error", "-i", aiff, "-c:a", "libopus", webm).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %s", out)
	}
	audio, _ := os.ReadFile(webm)

	mux := http.NewServeMux()
	registerDictation(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/dictate", bytes.NewReader(audio)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/dictate: %d %s", rec.Code, rec.Body)
	}
	var out struct{ Text string }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	text := strings.ToLower(out.Text)
	for _, want := range []string{"hash", "sucursal", "llavero"} {
		if !strings.Contains(text, want) {
			t.Errorf("falta %q en %q", want, out.Text)
		}
	}
}

func TestDictationRejectsEmptyAudio(t *testing.T) {
	if _, err := dictationReady(); err != nil {
		t.Skip(err)
	}
	mux := http.NewServeMux()
	registerDictation(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/dictate", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("sin audio: %d, quería 400", rec.Code)
	}
}

func TestCleanTranscript(t *testing.T) {
	for in, want := range map[string]string{
		" Hola Duncan,\n ¿ya está?\n": "Hola Duncan, ¿ya está?",
		" [BLANK_AUDIO]\n":            "",
		"(Música)":                    "",
	} {
		if got := cleanTranscript(in); got != want {
			t.Errorf("cleanTranscript(%q) = %q, quería %q", in, got, want)
		}
	}
}
