package main

// LA VOZ DE ELEVENLABS para la videollamada: POST /api/voice con "voice" por nombre («Laura»)
// o id. Va por el conector (connectors/elevenlabs: la llave vive sólo en connectors/.env) y vuelve en MP3, que se
// guarda: una frase se paga una sola vez. Si se acaban los créditos o la llave no sirve, el servidor deja de llamar un
// rato y la videollamada lo avisa (sin voz).

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"creditop/playground/connectors/elevenlabs"
)

var (
	elevenMu      sync.Mutex
	elevenIDs     = map[string]string{} // nombre de voz → id (la lista de voces se pide una vez)
	elevenBlocked time.Time             // hasta cuándo no se llama (sin créditos, llave inválida)
	elevenWhy     string
)

func elevenReady() bool {
	_, err := elevenlabs.LoadConfig()
	return err == nil
}

// synthesizeEleven devuelve la ruta del MP3 de `text` dicho por la voz `voice`, generándolo si no estaba.
func synthesizeEleven(voice, text string) (string, error) {
	cfg, err := elevenlabs.LoadConfig()
	if err != nil {
		return "", err
	}
	if voice == "" {
		return "", errors.New("falta la voz de ElevenLabs del personaje")
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("eleven|%s|%s|%s", cfg.Model, voice, text)))
	dir := voiceCacheDir()
	file := filepath.Join(dir, "e-"+hex.EncodeToString(sum[:12])+".mp3")
	if _, err := os.Stat(file); err == nil {
		return file, nil
	}
	// dos pedidos iguales a la vez (la llamada y el ▶ del mismo mensaje, dos ventanas) generan una sola vez
	return voiceOnce(file, func() (string, error) { return generateEleven(cfg, voice, text, dir, file) })
}

// UNA FRASE SE GENERA UNA VEZ AUNQUE LA PIDAN DOS A LA VEZ: la caché en disco evita repetirla DESPUÉS de generada,
// pero dos pedidos simultáneos de la misma frase no la encontraban todavía y pagaban los dos. voiceOnce deja pasar al
// primero y hace esperar a los demás su mismo resultado (el candado es por archivo, o sea por modelo, voz y texto).
type voiceCall struct {
	done chan struct{}
	file string
	err  error
}

var (
	voiceCallsMu sync.Mutex
	voiceCalls   = map[string]*voiceCall{}
)

func voiceOnce(key string, generate func() (string, error)) (string, error) {
	voiceCallsMu.Lock()
	if c, ok := voiceCalls[key]; ok {
		voiceCallsMu.Unlock()
		<-c.done
		return c.file, c.err
	}
	c := &voiceCall{done: make(chan struct{})}
	voiceCalls[key] = c
	voiceCallsMu.Unlock()
	// con defer: aunque generate entre en pánico, los que esperan se liberan y el candado no queda tomado
	defer func() {
		voiceCallsMu.Lock()
		delete(voiceCalls, key)
		voiceCallsMu.Unlock()
		close(c.done)
	}()
	c.err = errors.New("no se pudo generar la voz")
	c.file, c.err = generate()
	return c.file, c.err
}

// generateEleven pide la frase a ElevenLabs y la deja en `file`. Sólo se llama desde voiceOnce.
func generateEleven(cfg elevenlabs.Config, voice, text, dir, file string) (string, error) {
	// entre mirar el disco y tomar el candado, otro pedido igual pudo haber terminado: entonces ya está
	if _, err := os.Stat(file); err == nil {
		return file, nil
	}
	var err error
	elevenMu.Lock()
	if time.Now().Before(elevenBlocked) {
		why := elevenWhy
		elevenMu.Unlock()
		return "", errors.New(why)
	}
	id, known := elevenIDs[voice]
	elevenMu.Unlock()
	if top := voiceIDByName(voice); top != "" { // de las listas de voice_top.go (personas o animales): va por su id
		id, known = top, true
	}
	cl := elevenlabs.New(cfg)
	if !known {
		if id, err = cl.VoiceID(voice); err != nil {
			return "", elevenFriendly(err)
		}
		elevenMu.Lock()
		elevenIDs[voice] = id
		elevenMu.Unlock()
	}
	// el tope diario (voice_budget.go): se reserva antes de pedir y se devuelve si ElevenLabs falla
	n := len([]rune(text))
	if err := spendVoice(n); err != nil {
		return "", err
	}
	audio, err := cl.Speech(id, text)
	if err != nil {
		refundVoice(n)
		return "", elevenFriendly(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, audio, 0o644); err != nil {
		return "", err
	}
	return file, os.Rename(tmp, file)
}

// elevenFriendly vuelve corto el error y, si no tiene sentido reintentar enseguida, deja de llamar un rato.
func elevenFriendly(err error) error {
	var e *elevenlabs.Error
	if !errors.As(err, &e) {
		return err
	}
	var why string
	var pause time.Duration
	switch {
	case e.Status == 401:
		why, pause = "ElevenLabs no aceptó la llave (revisá ELEVENLABS_API_KEY y sus permisos).", 10*time.Minute
	case e.Status == 429 || e.Status == 402:
		why, pause = "ElevenLabs: sin créditos o demasiados pedidos a la vez.", time.Minute
	default:
		return err
	}
	elevenMu.Lock()
	elevenBlocked, elevenWhy = time.Now().Add(pause), why
	elevenMu.Unlock()
	return errors.New(why)
}

// elevenVoiceList: las voces de la cuenta (para el ▶ de cada mensaje y para cambiarle la voz a un personaje). Se guardan
// en disco (voice-list.json, junto a las frases) y se piden a ElevenLabs a lo sumo una vez al día.
var (
	elevenListMu sync.Mutex
	elevenList   []map[string]string
	elevenListAt time.Time
)

const voiceListTTL = 24 * time.Hour

type savedVoiceList struct {
	Fetched time.Time           `json:"fetched"`
	Voices  []map[string]string `json:"voices"`
}

func elevenVoiceList() ([]map[string]string, error) {
	elevenListMu.Lock()
	defer elevenListMu.Unlock()
	if elevenList != nil && time.Since(elevenListAt) < voiceListTTL {
		return elevenList, nil
	}
	file := filepath.Join(voiceCacheDir(), "voice-list.json")
	var saved savedVoiceList
	if raw, err := os.ReadFile(file); err == nil && json.Unmarshal(raw, &saved) == nil && time.Since(saved.Fetched) < voiceListTTL && len(saved.Voices) > 0 {
		elevenList, elevenListAt = withTopVoices(saved.Voices), saved.Fetched
		return elevenList, nil
	}
	cfg, err := elevenlabs.LoadConfig()
	if err != nil {
		return nil, err
	}
	voices, err := elevenlabs.New(cfg).Voices()
	if err != nil {
		if len(saved.Voices) > 0 {
			return withTopVoices(saved.Voices), nil // sin red o sin cupo: la lista de ayer sirve
		}
		return nil, elevenFriendly(err)
	}
	out := make([]map[string]string, 0, len(voices))
	for _, v := range voices {
		// el nombre corto («Laura»), que es el que se manda a /api/voice, y lo que la describe
		name := strings.TrimSpace(strings.SplitN(v.Name, " - ", 2)[0])
		out = append(out, map[string]string{"name": name, "gender": v.Labels["gender"], "accent": v.Labels["accent"], "description": v.Name})
	}
	elevenList, elevenListAt = withTopVoices(out), time.Now()
	if raw, err := json.Marshal(savedVoiceList{Fetched: elevenListAt, Voices: out}); err == nil {
		_ = os.MkdirAll(voiceCacheDir(), 0o755)
		_ = os.WriteFile(file, raw, 0o644)
	}
	return out, nil
}

// withTopVoices: primero las mejores voces (voice_top.go, con su puesto en "top"), después las de la cuenta que no estén.
func withTopVoices(account []map[string]string) []map[string]string {
	out := make([]map[string]string, 0, len(topVoices)+len(account))
	seen := map[string]bool{}
	for i, v := range topVoices {
		out = append(out, map[string]string{"name": v.Name, "gender": v.Gender, "accent": v.Accent, "description": v.Tone, "top": fmt.Sprint(i + 1), "pool": "people"})
		seen[v.Name] = true
	}
	// las de los animales (no van para personas: la interfaz las elige por especie)
	for _, v := range characterVoices {
		out = append(out, map[string]string{"name": v.Name, "gender": v.Gender, "accent": v.Accent, "description": v.Tone, "pool": "character"})
		seen[v.Name] = true
	}
	for _, v := range account {
		if !seen[v["name"]] {
			out = append(out, v)
		}
	}
	return out
}
