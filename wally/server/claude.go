package main

// CLAUDE, POR EL PUENTE DE CANON (Miguel, 2026-11-18: «dejémoslo por defecto para lo agéntico; Gemini o DeepSeek, si
// los quiero, opcionales»). El mismo modelo que canon usa en producción —Claude Sonnet 5.5 en Bedrock de la cuenta de
// CreditOp— por el puente `/api/model` que canon deja para usarlo desde una máquina sin credenciales de AWS.
//
// Es el único proveedor que NO va por la web ni por el pool: es una API. Y es el único que no saca el contexto de
// CreditOp afuera (las webs gratis lo dejan en Google, en China o 30 días en OpenAI): queda en la cuenta de AWS de la
// empresa. Por eso los agentes pueden ir por él sin el permiso de `agentsOther`.
//
// EL CAMINO (medido el 2026-11-18): `canon.playground.creditop.com` pide Google en el balanceador aunque lleve la llave
// (302), así que se llega por el GATEWAY del home del playground compartido, como el CLI `playground`:
//
//	POST https://playground.creditop.com/api/t/canon/api/model/stream
//	  Authorization: Bearer <la sesión de `playground login`, ~/.config/creditop-playground/token.json>
//	  x-canon-key:   <la llave de canon que habilita el puente>
//
// Con stream y no `/api/model`: sin stream el puente corta a los 55 s, y una respuesta larga de agente se pasa. Los
// eventos son los de Anthropic (`content_block_delta` con `text_delta`, `message_delta`, `error`), reenviados como SSE.
//
// LA LLAVE no se copia: se lee de donde ya está (una copia de una credencial vence sin avisar). `CANON_PROXY_KEY` del
// proceso, o la de `tools/canon/.env` del clon del playground compartido (`CANON_PROXY_KEY` o `CANON_WRITE_KEY`, lo
// mismo que lee canon en local).
//
// Límites del puente: 4 invocaciones a la vez por instancia (compartidas con canon), 8 MiB de cuerpo, 16.384 tokens
// de salida. Lo paga la empresa: cada vuelta reenvía toda la conversación (chat «temporal», como Gemini).

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

const claudeProvider = "claude"

// claudeMaxTokens: lo más que deja el puente (`GET /api/model`: max_tokens 16384).
const claudeMaxTokens = 16384

func claudeBase() string {
	if u := strings.TrimRight(os.Getenv("PLAYGROUND_URL"), "/"); u != "" {
		return u
	}
	return "https://playground.creditop.com"
}

// claudeSession: el token de `playground login`. Vencido o ausente, el error dice qué hacer.
func claudeSession() (string, error) {
	home, _ := os.UserHomeDir()
	raw, err := os.ReadFile(filepath.Join(home, ".config", "creditop-playground", "token.json"))
	if err != nil {
		return "", errors.New("sin sesión del playground: corré `playground login`")
	}
	var saved struct {
		Token string `json:"token"`
	}
	if json.Unmarshal(raw, &saved) != nil || saved.Token == "" {
		return "", errors.New("la sesión del playground está rota: corré `playground login`")
	}
	parts := strings.Split(saved.Token, ".")
	if len(parts) == 3 {
		var claims struct {
			Exp int64 `json:"exp"`
		}
		if body, err := base64.RawURLEncoding.DecodeString(parts[1]); err == nil && json.Unmarshal(body, &claims) == nil &&
			claims.Exp > 0 && time.Unix(claims.Exp, 0).Before(time.Now()) {
			return "", errors.New("la sesión del playground venció: corré `playground login`")
		}
	}
	return saved.Token, nil
}

// claudeKey: la llave del puente, de donde ya vive.
func (a *app) claudeKey() (string, error) {
	if k := strings.TrimSpace(os.Getenv("CANON_PROXY_KEY")); k != "" {
		return k, nil
	}
	file := filepath.Join(filepath.Dir(a.root), "github", "playground", "tools", "canon", ".env")
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

func (a *app) claudeRequest(ctx context.Context, method, path string, body []byte) (*http.Request, error) {
	token, err := claudeSession()
	if err != nil {
		return nil, err
	}
	key, err := a.claudeKey()
	if err != nil {
		return nil, err
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, claudeBase()+"/api/t/canon"+path, rd)
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

// noRedirect: un 302 es el login de Google del balanceador, no la respuesta: se muestra, no se sigue.
var claudeHTTP = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// claudeError: lo que vino en vez de una respuesta, dicho para quien lo lee.
func claudeError(res *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	var e struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(raw, &e)
	switch {
	case res.StatusCode == http.StatusFound || res.StatusCode == http.StatusUnauthorized && e.Error == "":
		return errors.New("el playground pidió entrar de nuevo: corré `playground login`")
	case res.StatusCode == http.StatusTooManyRequests:
		return errors.New("el puente de canon está ocupado (4 a la vez): reintentá en unos segundos")
	case e.Error != "":
		return fmt.Errorf("el puente de canon contestó %d: %s", res.StatusCode, e.Error)
	}
	return fmt.Errorf("el puente de canon contestó %d", res.StatusCode)
}

// askClaude: la pregunta entera como un mensaje (Wally ya armó la transcripción), por stream. Devuelve el texto.
func (a *app) askClaude(ctx context.Context, text string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"max_tokens": claudeMaxTokens,
		"messages":   []map[string]any{{"role": "user", "content": text}},
	})
	req, err := a.claudeRequest(ctx, http.MethodPost, "/api/model/stream", body)
	if err != nil {
		return "", err
	}
	res, err := claudeHTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("no se pudo llegar al playground: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", claudeError(res)
	}
	return readClaudeStream(res.Body)
}

// readClaudeStream junta el texto de los eventos de Anthropic. Un `error` del stream, o un corte por tokens sin texto,
// es un error; uno por tokens CON texto se devuelve con su aviso al final (que el modelo pida seguir).
func readClaudeStream(r io.Reader) (string, error) {
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
			return "", fmt.Errorf("Claude cortó: %s", msg)
		}
	}
	if err := sc.Err(); err != nil {
		return "", fmt.Errorf("el stream se cortó: %w", err)
	}
	text := strings.TrimSpace(out.String())
	if text == "" {
		if stop != "" {
			return "", fmt.Errorf("Claude no devolvió texto (terminó por %s)", stop)
		}
		return "", errors.New("Claude no devolvió texto")
	}
	if stop == "max_tokens" {
		text += "\n\n(la respuesta llegó al tope de largo y se cortó acá)"
	}
	return text, nil
}

// checkClaude: si se le puede preguntar, sin preguntar nada (`GET /api/model` dice el modelo y la región).
func (a *app) checkClaude(ctx context.Context) providerStatus {
	now := time.Now()
	req, err := a.claudeRequest(ctx, http.MethodGet, "/api/model", nil)
	if err != nil {
		return providerStatus{State: "sin-sesion", Detail: err.Error(), Checked: now}
	}
	res, err := claudeHTTP.Do(req)
	if err != nil {
		return providerStatus{State: "error", Detail: "no se pudo llegar al playground: " + err.Error(), Checked: now}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		e := claudeError(res)
		state := "error"
		if strings.Contains(e.Error(), "playground login") {
			state = "sin-sesion"
		}
		return providerStatus{State: state, Detail: e.Error(), Checked: now}
	}
	var info struct {
		Model  string `json:"model"`
		Region string `json:"region"`
	}
	_ = json.NewDecoder(res.Body).Decode(&info)
	return providerStatus{State: "listo", Detail: fmt.Sprintf("%s en Bedrock (%s), por el puente de canon", info.Model, info.Region), Checked: now}
}
