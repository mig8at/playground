// Package elevenlabs es la conexión del playground con ElevenLabs: la llave, las voces, el saldo de créditos y el
// texto a voz. Lo usan `pg elevenlabs …` y la videollamada del chat (chat/server/voice_elevenlabs.go).
//
// La llave (ELEVENLABS_API_KEY, en connectors/.env) se creó con permisos mínimos: Text to Speech, Voices (lectura) y
// User (para leer el saldo). Con otra llave sin «User», Usage falla y lo demás sigue andando.
//
// COSTO: se cobra por carácter del texto. Con eleven_flash_v2_5 (el modelo por defecto) medio crédito por carácter; un
// mensaje de 150 caracteres son ~75 créditos.
package elevenlabs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/env"
)

// API es la base de la API (una variable para que las pruebas la apunten a un servidor falso).
var API = "https://api.elevenlabs.io"

// DefaultModel: el más rápido y barato que habla español (~75 ms de latencia según ElevenLabs, 0,5 crédito por
// carácter). ELEVENLABS_MODEL lo cambia (p. ej. eleven_multilingual_v2, más expresivo y al doble de costo).
const DefaultModel = "eleven_flash_v2_5"

// Config es la cuenta. No depende del ambiente: vive en `connectors/.env`.
type Config struct {
	Key   string
	Model string
	File  string
}

// LoadConfig lee ELEVENLABS_API_KEY y ELEVENLABS_MODEL de connectors/.env (el proceso gana).
func LoadConfig() (Config, error) {
	v, err := env.LoadShared()
	if err != nil {
		return Config{}, err
	}
	c := Config{Key: v.Get("ELEVENLABS_API_KEY"), Model: v.Get("ELEVENLABS_MODEL"), File: v.File}
	if c.Model == "" {
		c.Model = DefaultModel
	}
	if c.Key == "" {
		return c, errors.New("falta ELEVENLABS_API_KEY en connectors/.env: creala en https://elevenlabs.io/app/settings/api-keys (Text to Speech, Voices de lectura y User)")
	}
	return c, nil
}

// Client habla con la API.
type Client struct {
	HTTP   *http.Client
	Config Config
}

// New arma el cliente.
func New(c Config) *Client { return &Client{HTTP: &http.Client{Timeout: 60 * time.Second}, Config: c} }

// Error es una respuesta de error de la API, con su código HTTP (429: sin créditos o demasiados pedidos a la vez).
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("elevenlabs %d: %s", e.Status, e.Message) }

func (c *Client) do(method, path string, body any, accept string) ([]byte, error) {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, API+path, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set("xi-api-key", c.Config.Key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, &Error{Status: res.StatusCode, Message: errorMessage(raw)}
	}
	return raw, nil
}

// errorMessage saca el mensaje legible del error de la API ({"detail": {"status": …, "message": …}} o {"detail": "…"}).
func errorMessage(raw []byte) string {
	var e struct {
		Detail json.RawMessage `json:"detail"`
	}
	if json.Unmarshal(raw, &e) == nil && len(e.Detail) > 0 {
		var d struct{ Status, Message string }
		if json.Unmarshal(e.Detail, &d) == nil && d.Message != "" {
			return strings.TrimSpace(d.Status + ": " + d.Message)
		}
		var s string
		if json.Unmarshal(e.Detail, &s) == nil && s != "" {
			return s
		}
	}
	s := strings.TrimSpace(string(raw))
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// Voice es una voz de la cuenta (las prediseñadas y las agregadas desde la biblioteca).
type Voice struct {
	ID       string            `json:"voice_id"`
	Name     string            `json:"name"`
	Category string            `json:"category"`
	Labels   map[string]string `json:"labels"`
	Preview  string            `json:"preview_url"`
}

// Voices lista las voces que la cuenta puede usar, por nombre.
func (c *Client) Voices() ([]Voice, error) {
	raw, err := c.do(http.MethodGet, "/v1/voices", nil, "")
	if err != nil {
		return nil, err
	}
	var out struct {
		Voices []Voice `json:"voices"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	sort.Slice(out.Voices, func(i, j int) bool { return strings.ToLower(out.Voices[i].Name) < strings.ToLower(out.Voices[j].Name) })
	return out.Voices, nil
}

// VoiceID resuelve una voz dada por id o por nombre («Laura», o el comienzo de un nombre largo como «Laura - …»).
func (c *Client) VoiceID(nameOrID string) (string, error) {
	voices, err := c.Voices()
	if err != nil {
		return "", err
	}
	want := strings.ToLower(strings.TrimSpace(nameOrID))
	for _, v := range voices {
		if v.ID == nameOrID || strings.ToLower(v.Name) == want {
			return v.ID, nil
		}
	}
	for _, v := range voices {
		if strings.HasPrefix(strings.ToLower(v.Name), want+" ") {
			return v.ID, nil
		}
	}
	return "", fmt.Errorf("no hay una voz «%s» en la cuenta (pg elevenlabs voices las lista)", nameOrID)
}

// Usage es el saldo de la suscripción: caracteres (créditos) usados y el tope del período.
type Usage struct {
	Tier      string `json:"tier"`
	Used      int    `json:"character_count"`
	Limit     int    `json:"character_limit"`
	ResetUnix int64  `json:"next_character_count_reset_unix"`
}

// Usage lee el saldo (pide el permiso «User» en la llave).
func (c *Client) Usage() (Usage, error) {
	raw, err := c.do(http.MethodGet, "/v1/user/subscription", nil, "")
	if err != nil {
		return Usage{}, err
	}
	var u Usage
	return u, json.Unmarshal(raw, &u)
}

// Speech convierte texto en voz y devuelve el MP3 (44,1 kHz, 64 kbps: liviano y suficiente para voz).
func (c *Client) Speech(voiceID, text string) ([]byte, error) {
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("el texto va vacío")
	}
	path := "/v1/text-to-speech/" + url.PathEscape(voiceID) + "?output_format=mp3_44100_64"
	return c.do(http.MethodPost, path, map[string]any{"text": text, "model_id": c.Config.Model}, "audio/mpeg")
}
