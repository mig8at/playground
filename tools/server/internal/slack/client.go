// Package slack es un cliente mínimo de la Slack Web API.
//
// No usa el SDK oficial de Slack a propósito: la gracia de este repo es que
// TÚ controlas cada llamada HTTP. Agregar un endpoint nuevo = agregar un método.
package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const apiBase = "https://slack.com/api"

// Client habla con la Web API usando un bot token (xoxb-...).
type Client struct {
	token string
	http  *http.Client
}

// New crea un cliente con el token dado.
func New(token string) *Client {
	return &Client{
		token: token,
		http:  &http.Client{Timeout: 15 * time.Second},
	}
}

// post envía un POST JSON a un método de la Web API (ej "conversations.create")
// y decodifica la respuesta en out. Slack SIEMPRE responde 200 con un campo
// "ok": false cuando algo falla, así que el error de negocio se maneja arriba.
func (c *Client) post(ctx context.Context, method string, body, out any) error {
	buf, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("serializando body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiBase+"/"+method, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("llamando a %s: %w", method, err)
	}
	defer resp.Body.Close()

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decodificando respuesta de %s: %w", method, err)
	}
	return nil
}

// get llama a un método de la Web API por GET con query params. Algunos métodos
// (ej. users.lookupByEmail) no aceptan JSON, así que van por aquí.
func (c *Client) get(ctx context.Context, method string, params url.Values, out any) error {
	u := apiBase + "/" + method
	if len(params) > 0 {
		u += "?" + params.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("llamando a %s: %w", method, err)
	}
	defer resp.Body.Close()

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decodificando respuesta de %s: %w", method, err)
	}
	return nil
}
