// Package jira es un cliente mínimo de la REST API de Jira Cloud (v3), copiado
// del conector de playground/tools (internal/atlassian). Autenticación Basic con
// email + API token (base64 "email:token").
//
// Está DEJADO CABLEADO en el server de Context para, más adelante, SINCRONIZAR
// las tareas de los workspaces con issues/ramas de Jira. Hoy solo expone la
// conexión (FromEnv + GetMyself para validar) y lectura de issues (SearchIssues);
// la sincronización tarea↔rama en sí está PENDIENTE (ver cmd/web syncTasks).
package jira

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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

// FromEnv arma el cliente desde ATLASSIAN_SITE / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN
// (las MISMAS variables que usan los conectores de playground/tools; se pueden dejar
// en context/server/.env). Devuelve nil si falta alguna → la app corre igual "sin Jira".
func FromEnv() *Client {
	site, email, token := os.Getenv("ATLASSIAN_SITE"), os.Getenv("ATLASSIAN_EMAIL"), os.Getenv("ATLASSIAN_API_TOKEN")
	if site == "" || email == "" || token == "" {
		return nil
	}
	return New(site, email, token)
}

// Site devuelve la URL base del sitio Jira (para mostrar en el estado).
func (c *Client) Site() string { return c.baseURL }

func (c *Client) authHeader() string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(c.email+":"+c.token))
}

// do ejecuta una request contra la REST API y, si out != nil, decodifica el JSON.
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

// Myself es el usuario autenticado (GET /rest/api/3/myself). Sirve para validar
// las credenciales (¿la conexión está viva?).
type Myself struct {
	AccountID    string `json:"accountId"`
	DisplayName  string `json:"displayName"`
	EmailAddress string `json:"emailAddress"`
}

// GetMyself valida las credenciales y devuelve quién eres. Solo lectura.
func (c *Client) GetMyself(ctx context.Context) (*Myself, error) {
	var m Myself
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/myself", nil, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// Issue es la vista mínima de un issue.
type Issue struct {
	Key     string `json:"key"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
}

type searchJQLResp struct {
	Issues []struct {
		Key    string `json:"key"`
		Fields struct {
			Summary string `json:"summary"`
			Status  struct {
				Name string `json:"name"`
			} `json:"status"`
		} `json:"fields"`
	} `json:"issues"`
	NextPageToken string `json:"nextPageToken"`
}

// SearchIssues corre una consulta JQL (POST /rest/api/3/search/jql). Solo lectura.
// Es la base del futuro sync: traer los issues del sprint/tablero para mapearlos
// a las tareas de un workspace y a sus ramas.
func (c *Client) SearchIssues(ctx context.Context, jql string, maxResults int) ([]Issue, error) {
	if maxResults <= 0 || maxResults > 100 {
		maxResults = 25
	}
	body := map[string]any{
		"jql":        jql,
		"maxResults": maxResults,
		"fields":     []string{"summary", "status"},
	}
	var raw searchJQLResp
	if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", body, &raw); err != nil {
		return nil, err
	}
	issues := make([]Issue, 0, len(raw.Issues))
	for _, it := range raw.Issues {
		issues = append(issues, Issue{Key: it.Key, Summary: it.Fields.Summary, Status: it.Fields.Status.Name})
	}
	return issues, nil
}
