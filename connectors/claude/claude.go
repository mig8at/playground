// Package claude es la conexión de my-tools con CLAUDE: el mismo modelo que canon usa en producción (Claude Sonnet
// 5.5 en el Bedrock de CreditOp), por el puente `/api/model` que canon deja para usarlo desde una máquina sin
// credenciales de AWS. Lo usan Wally (su proveedor por defecto) y lo que corre en segundo plano o agendado
// (`bin/pg model ask`, con el modelo elegido en la configuración de Cockpit).
//
// EL CAMINO (medido el 2026-11-18): `canon.playground.creditop.com` pide Google en el balanceador aunque lleve la
// llave (302), así que se llega por el GATEWAY del home del playground compartido, como el CLI `playground`:
//
//	POST https://playground.creditop.com/api/t/canon/api/model/stream
//	  Authorization: Bearer <la sesión de `playground login`, ~/.config/creditop-playground/token.json>
//	  x-canon-key:   <la llave de canon que habilita el puente>
//
// Con stream y no `/api/model`: sin stream el puente corta a los 55 s. Los eventos son los de Anthropic
// (`content_block_delta` con `text_delta`, `message_delta`, `error`), reenviados como SSE.
//
// LA LLAVE no se copia (una copia de una credencial vence sin avisar): `CANON_PROXY_KEY` del proceso, o la de
// `tools/canon/.env` del clon del playground compartido (`CANON_PROXY_KEY` o `CANON_WRITE_KEY`, lo mismo que lee canon
// en local).
//
// Límites del puente: 4 invocaciones a la vez por instancia (compartidas con canon), 8 MiB de cuerpo, 16.384 tokens
// de salida. Lo paga la empresa.
package claude

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
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

// MaxTokens: lo más que deja el puente (`GET /api/model`: max_tokens 16384).
const MaxTokens = 16384

// Client habla con el puente. Root es la raíz de my-tools: de ahí se llega al clon del playground compartido.
type Client struct {
	Root string
	Base string // el home del playground; vacío: PLAYGROUND_URL o producción
	HTTP *http.Client
}

func New(root string) *Client { return &Client{Root: root} }

func (c *Client) base() string {
	if c.Base != "" {
		return strings.TrimRight(c.Base, "/")
	}
	if u := strings.TrimRight(os.Getenv("PLAYGROUND_URL"), "/"); u != "" {
		return u
	}
	return "https://playground.creditop.com"
}

// noRedirect: un 302 es el login de Google del balanceador, no la respuesta: se muestra, no se sigue.
func (c *Client) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// ErrSession: falta la sesión del playground o venció; se arregla con `playground login`.
var ErrSession = errors.New("sesión del playground")

// Session: el token de `playground login`.
func Session() (string, error) {
	home, _ := os.UserHomeDir()
	raw, err := os.ReadFile(filepath.Join(home, ".config", "creditop-playground", "token.json"))
	if err != nil {
		return "", fmt.Errorf("%w: no hay, corré `playground login`", ErrSession)
	}
	var saved struct {
		Token string `json:"token"`
	}
	if json.Unmarshal(raw, &saved) != nil || saved.Token == "" {
		return "", fmt.Errorf("%w: está rota, corré `playground login`", ErrSession)
	}
	if parts := strings.Split(saved.Token, "."); len(parts) == 3 {
		var claims struct {
			Exp int64 `json:"exp"`
		}
		if body, err := base64.RawURLEncoding.DecodeString(parts[1]); err == nil && json.Unmarshal(body, &claims) == nil &&
			claims.Exp > 0 && time.Unix(claims.Exp, 0).Before(time.Now()) {
			return "", fmt.Errorf("%w: venció, corré `playground login`", ErrSession)
		}
	}
	return saved.Token, nil
}

// Key: la llave del puente, de donde ya vive.
func (c *Client) Key() (string, error) {
	if k := strings.TrimSpace(os.Getenv("CANON_PROXY_KEY")); k != "" {
		return k, nil
	}
	file := filepath.Join(filepath.Dir(c.Root), "github", "playground", "tools", "canon", ".env")
	raw, err := os.ReadFile(file)
	if err != nil {
		return "", fmt.Errorf("sin la llave del puente de canon: no está CANON_PROXY_KEY ni %s", file)
	}
	vals := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok && !strings.HasPrefix(k, "#") {
			vals[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
		}
	}
	for _, k := range []string{"CANON_PROXY_KEY", "CANON_WRITE_KEY"} {
		if vals[k] != "" {
			return vals[k], nil
		}
	}
	return "", fmt.Errorf("sin la llave del puente de canon en %s", file)
}

func (c *Client) request(ctx context.Context, method, path string, body []byte) (*http.Request, error) {
	token, err := Session()
	if err != nil {
		return nil, err
	}
	key, err := c.Key()
	if err != nil {
		return nil, err
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base()+"/api/t/canon"+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("x-canon-key", key)
	req.Header.Set("Accept", "application/json, text/event-stream")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

// answerError: lo que vino en vez de una respuesta, dicho para quien lo lee.
func answerError(res *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	var e struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(raw, &e)
	switch {
	case res.StatusCode == http.StatusFound || res.StatusCode == http.StatusUnauthorized && e.Error == "":
		return fmt.Errorf("%w: el playground pidió entrar de nuevo, corré `playground login`", ErrSession)
	case res.StatusCode == http.StatusTooManyRequests:
		return errors.New("el puente de canon está ocupado (4 a la vez): reintentá en unos segundos")
	case e.Error != "":
		return fmt.Errorf("el puente de canon contestó %d: %s", res.StatusCode, e.Error)
	}
	return fmt.Errorf("el puente de canon contestó %d", res.StatusCode)
}

// Request: una pregunta. System es opcional; MaxTokens 0 es el tope del puente.
type Request struct {
	Prompt    string
	System    string
	MaxTokens int
}

// Answer: lo que contestó, con por qué terminó (end_turn, max_tokens…).
type Answer struct {
	Text       string `json:"text"`
	StopReason string `json:"stopReason"`
}

// Ask: la pregunta como un mensaje, por stream.
func (c *Client) Ask(ctx context.Context, in Request) (Answer, error) {
	tokens := in.MaxTokens
	if tokens <= 0 || tokens > MaxTokens {
		tokens = MaxTokens
	}
	payload := map[string]any{
		"max_tokens": tokens,
		"messages":   []map[string]any{{"role": "user", "content": in.Prompt}},
	}
	if in.System != "" {
		payload["system"] = in.System
	}
	body, _ := json.Marshal(payload)
	req, err := c.request(ctx, http.MethodPost, "/api/model/stream", body)
	if err != nil {
		return Answer{}, err
	}
	res, err := c.http().Do(req)
	if err != nil {
		return Answer{}, fmt.Errorf("no se pudo llegar al playground: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Answer{}, answerError(res)
	}
	return ReadStream(res.Body)
}

// ReadStream junta el texto de los eventos de Anthropic. Un `error` del stream, o un corte sin texto, es un error.
func ReadStream(r io.Reader) (Answer, error) {
	var out strings.Builder
	stop := ""
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var ev struct {
			Type  string `json:"type"`
			Delta struct {
				Type       string `json:"type"`
				Text       string `json:"text"`
				StopReason string `json:"stop_reason"`
			} `json:"delta"`
			Error struct {
				Type    string `json:"type"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(data), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "content_block_delta":
			if ev.Delta.Type == "text_delta" {
				out.WriteString(ev.Delta.Text)
			}
		case "message_delta":
			if ev.Delta.StopReason != "" {
				stop = ev.Delta.StopReason
			}
		case "error":
			msg := ev.Error.Message
			if msg == "" {
				msg = ev.Error.Type
			}
			return Answer{}, fmt.Errorf("Claude cortó: %s", msg)
		}
	}
	if err := sc.Err(); err != nil {
		return Answer{}, fmt.Errorf("el stream se cortó: %w", err)
	}
	text := strings.TrimSpace(out.String())
	if text == "" {
		if stop != "" {
			return Answer{}, fmt.Errorf("Claude no devolvió texto (terminó por %s)", stop)
		}
		return Answer{}, errors.New("Claude no devolvió texto")
	}
	return Answer{Text: text, StopReason: stop}, nil
}

// Info: qué modelo atiende el puente, sin invocarlo (`GET /api/model`).
type Info struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Region   string `json:"region"`
}

func (c *Client) Info(ctx context.Context) (Info, error) {
	req, err := c.request(ctx, http.MethodGet, "/api/model", nil)
	if err != nil {
		return Info{}, err
	}
	res, err := c.http().Do(req)
	if err != nil {
		return Info{}, fmt.Errorf("no se pudo llegar al playground: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Info{}, answerError(res)
	}
	var info Info
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		return Info{}, fmt.Errorf("el puente contestó algo que no es su ficha: %w", err)
	}
	return info, nil
}
