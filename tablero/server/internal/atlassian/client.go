// Package atlassian es un cliente mínimo de la REST API de Jira Cloud (v3).
//
// Autenticación: Basic con email + API token (base64 "email:token").
// El API token se crea en https://id.atlassian.com/manage-profile/security/api-tokens
package atlassian

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client habla con una instancia de Jira Cloud (https://<site>.atlassian.net).
type Client struct {
	baseURL string
	email   string
	token   string
	http    *http.Client
}

// New crea un cliente. baseURL es la URL del sitio, ej https://miempresa.atlassian.net
func New(baseURL, email, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		email:   email,
		token:   token,
		http:    &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *Client) authHeader() string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(c.email+":"+c.token))
}

// do ejecuta una request contra la REST API y, si out != nil, decodifica el JSON.
// A diferencia de Slack, Atlassian sí usa códigos HTTP: cualquier 4xx/5xx es error.
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("serializando body: %w", err)
		}
		reader = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", c.authHeader())
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("llamando a %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("%s %s -> HTTP %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(b)))
	}

	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("decodificando respuesta de %s: %w", path, err)
		}
	}
	return nil
}
