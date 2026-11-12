package main

// LA VOZ DE GEMINI para la videollamada: el mismo POST /api/voice, con "engine": "gemini". El texto va a Google
// (gemini-3.8-flash-lite-tts, el más rápido y barato que se midió: ~0,6 s al primer audio y ~US$0,0012 por mensaje de
// 8 s, 2026-11-12) y vuelve como audio PCM de 24 kHz, que acá se envuelve en un WAV y se guarda: una frase se paga una
// sola vez. Si no hay llave o Gemini falla, la interfaz vuelve a las voces locales de macOS.
//
// Sólo se manda el texto. Una instrucción de estilo («dilo como un oso grave») la LEEN en voz alta los dos modelos
// 3.8 (Flash y Flash Lite), en español o en inglés, y no aceptan systemInstruction (medido 2026-11-12): el carácter
// de cada personaje sale de la voz elegida y, en la interfaz, de un toque de tono al reproducir.
//
// La llave es la del conector: GEMINI_API_KEY del proceso, o la de connectors/.env del playground.

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const geminiVoiceModel = "gemini-3.8-flash-lite-tts"

func geminiKey() string {
	if k := os.Getenv("GEMINI_API_KEY"); k != "" {
		return k
	}
	root, err := playgroundRoot()
	if err != nil {
		return ""
	}
	f, err := os.Open(filepath.Join(root, "connectors", ".env"))
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if v, ok := strings.CutPrefix(strings.TrimSpace(sc.Text()), "GEMINI_API_KEY="); ok {
			return strings.Trim(v, `"'`)
		}
	}
	return ""
}

// wavFromPCM envuelve PCM de 16 bits mono en un WAV que el navegador reproduce.
func wavFromPCM(pcm []byte, rate int) []byte {
	var b bytes.Buffer
	w := func(v any) { binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	w(uint32(36 + len(pcm)))
	b.WriteString("WAVEfmt ")
	w(uint32(16))
	w(uint16(1))
	w(uint16(1))
	w(uint32(rate))
	w(uint32(rate * 2))
	w(uint16(2))
	w(uint16(16))
	b.WriteString("data")
	w(uint32(len(pcm)))
	b.Write(pcm)
	return b.Bytes()
}

// synthesizeGemini devuelve la ruta del WAV de `text` dicho por la voz `voice` de Gemini, generándolo si no estaba.
func synthesizeGemini(ctx context.Context, voice, text string) (string, error) {
	key := geminiKey()
	if key == "" {
		return "", errors.New("falta GEMINI_API_KEY (connectors/.env)")
	}
	if voice == "" {
		voice = "Puck"
	}
	prompt := text
	sum := sha256.Sum256([]byte(fmt.Sprintf("gemini2|%s|%s|%s", geminiVoiceModel, voice, prompt)))
	dir := voiceCacheDir()
	file := filepath.Join(dir, "g-"+hex.EncodeToString(sum[:12])+".wav")
	if _, err := os.Stat(file); err == nil {
		return file, nil
	}
	body, _ := json.Marshal(map[string]any{
		"contents": []any{map[string]any{"parts": []any{map[string]any{"text": prompt}}}},
		"generationConfig": map[string]any{
			"responseModalities": []string{"AUDIO"},
			"speechConfig":       map[string]any{"voiceConfig": map[string]any{"prebuiltVoiceConfig": map[string]any{"voiceName": voice}}},
		},
	})
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://generativelanguage.googleapis.com/v1beta/models/"+geminiVoiceModel+":generateContent", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", key)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gemini %d: %s", res.StatusCode, strings.TrimSpace(string(raw[:min(len(raw), 200)])))
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					InlineData *struct{ Data string } `json:"inlineData"`
				}
			}
		}
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	for _, c := range out.Candidates {
		for _, p := range c.Content.Parts {
			if p.InlineData == nil {
				continue
			}
			pcm, err := base64.StdEncoding.DecodeString(p.InlineData.Data)
			if err != nil {
				return "", err
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return "", err
			}
			tmp := file + ".tmp"
			if err := os.WriteFile(tmp, wavFromPCM(cleanSpeech(pcm, 24000), 24000), 0o644); err != nil {
				return "", err
			}
			return file, os.Rename(tmp, file)
		}
	}
	return "", errors.New("gemini no devolvió audio")
}
