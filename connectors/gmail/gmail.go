// Package gmail lee el correo de UNA persona con su propio OAuth, sólo lectura (`gmail.readonly`): no manda, no borra
// ni marca nada. Comparte el cliente OAuth de escritorio de drive/ (`DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`) y su
// baile de login; la sesión es aparte, en `connectors/.auth/gmail.json`, para que cerrar una no cierre la otra. El
// proyecto de Google Cloud de ese cliente tiene que tener habilitada la Gmail API.
package gmail

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"creditop/playground/connectors/drive"
	"creditop/playground/connectors/env"
)

// Scope es el único permiso que se pide.
const Scope = "https://www.googleapis.com/auth/gmail.readonly"

// API es la base de la Gmail API.
const API = "https://gmail.googleapis.com/gmail/v1/users/me"

// Session es lo que queda guardado después del login.
type Session struct {
	Email        string    `json:"email"`
	RefreshToken string    `json:"refresh_token"`
	Scope        string    `json:"scope"`
	At           time.Time `json:"at"`
}

// SessionPath es `connectors/.auth/gmail.json`.
func SessionPath() (string, error) {
	dir, err := env.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, ".auth", "gmail.json"), nil
}

// LoadSession lee la sesión guardada. Sin archivo, el error dice qué correr.
func LoadSession() (Session, error) {
	var s Session
	p, err := SessionPath()
	if err != nil {
		return s, err
	}
	b, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return s, errors.New("no hay sesión de Gmail: corré `bin/pg gmail login` (abre el navegador con tu cuenta)")
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(b, &s); err != nil || s.RefreshToken == "" {
		return s, fmt.Errorf("la sesión de Gmail en %s no sirve: `bin/pg gmail login` de nuevo", p)
	}
	return s, nil
}

func saveSession(s Session) (string, error) {
	p, err := SessionPath()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return "", err
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	return p, os.WriteFile(p, b, 0o600)
}

// Login abre el consentimiento de Google para leer el correo y guarda la sesión con la dirección de la cuenta.
func Login(ctx context.Context, open func(authURL string), wait time.Duration) (Session, error) {
	oc, err := drive.LoadOAuthClient()
	if err != nil {
		return Session{}, err
	}
	g, err := drive.Authorize(ctx, oc, Scope, open, wait)
	if err != nil {
		return Session{}, err
	}
	if !strings.Contains(g.Scope, Scope) {
		return Session{}, errors.New("no se aceptó el permiso de leer el correo: hay que marcarlo en la pantalla de Google")
	}
	s := Session{RefreshToken: g.RefreshToken, Scope: g.Scope, At: time.Now().UTC()}
	c := New(oc, s)
	c.access, c.expires = g.AccessToken, time.Now().Add(time.Duration(g.ExpiresIn)*time.Second)
	p, err := c.Profile(ctx)
	if err != nil {
		return Session{}, err
	}
	s.Email = p.Email
	if _, err := saveSession(s); err != nil {
		return Session{}, err
	}
	return s, nil
}

// Logout revoca el refresh token y borra el archivo.
func Logout(ctx context.Context) (revoked bool, err error) {
	p, err := SessionPath()
	if err != nil {
		return false, err
	}
	if s, err := LoadSession(); err == nil {
		form := url.Values{"token": {s.RefreshToken}}
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, drive.RevokeURL, strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if resp, err := http.DefaultClient.Do(req); err == nil {
			resp.Body.Close()
			revoked = resp.StatusCode == http.StatusOK
		}
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return revoked, err
	}
	return revoked, nil
}

// Client hace GETs a la Gmail API con un access token que renueva solo.
type Client struct {
	oauth drive.OAuthClient
	sess  Session
	http  *http.Client
	base  string

	mu      sync.Mutex
	access  string
	expires time.Time
}

// New arma el cliente con una sesión.
func New(oauth drive.OAuthClient, sess Session) *Client {
	return &Client{oauth: oauth, sess: sess, base: API, http: &http.Client{Timeout: time.Minute}}
}

// Open junta el cliente OAuth y la sesión de `pg gmail login`.
func Open() (*Client, error) {
	oc, err := drive.LoadOAuthClient()
	if err != nil {
		return nil, err
	}
	s, err := LoadSession()
	if err != nil {
		return nil, err
	}
	return New(oc, s), nil
}

// Email es la cuenta de la sesión.
func (c *Client) Email() string { return c.sess.Email }

func (c *Client) token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.access != "" && time.Until(c.expires) > time.Minute {
		return c.access, nil
	}
	access, expiresIn, err := drive.RefreshAccess(ctx, c.oauth, c.sess.RefreshToken)
	if err != nil {
		if strings.Contains(err.Error(), "invalid_grant") {
			return "", errors.New("la sesión de Gmail venció o se revocó: `bin/pg gmail login` de nuevo")
		}
		return "", err
	}
	c.access, c.expires = access, time.Now().Add(time.Duration(expiresIn)*time.Second)
	return c.access, nil
}

func (c *Client) getJSON(ctx context.Context, path string, q url.Values, out any) error {
	tok, err := c.token(ctx)
	if err != nil {
		return err
	}
	u := c.base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 30_000_000))
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		msg := e.Error.Message
		if msg == "" {
			msg = strings.TrimSpace(string(body))
		}
		if resp.StatusCode == http.StatusForbidden && strings.Contains(msg, "has not been used") {
			msg += " (habilitá la Gmail API en el proyecto de Google Cloud del cliente OAuth)"
		}
		return fmt.Errorf("Gmail: HTTP %d: %s", resp.StatusCode, msg)
	}
	return json.Unmarshal(body, out)
}

// Profile es la cuenta de la sesión.
type Profile struct {
	Email    string `json:"emailAddress"`
	Messages int    `json:"messagesTotal"`
}

// Profile valida la credencial y dice de quién es.
func (c *Client) Profile(ctx context.Context) (Profile, error) {
	var p Profile
	return p, c.getJSON(ctx, "/profile", nil, &p)
}

// Search devuelve los ids de los mensajes que cumplen `q` (la misma sintaxis que el buscador de Gmail), los más
// nuevos primero, hasta `max`.
func (c *Client) Search(ctx context.Context, q string, max int) ([]string, error) {
	var out []string
	page := ""
	for len(out) < max {
		v := url.Values{"q": {q}, "maxResults": {fmt.Sprint(min(max-len(out), 100))}}
		if page != "" {
			v.Set("pageToken", page)
		}
		var r struct {
			Messages []struct {
				ID string `json:"id"`
			} `json:"messages"`
			Next string `json:"nextPageToken"`
		}
		if err := c.getJSON(ctx, "/messages", v, &r); err != nil {
			return nil, err
		}
		for _, m := range r.Messages {
			out = append(out, m.ID)
		}
		if r.Next == "" || len(r.Messages) == 0 {
			break
		}
		page = r.Next
	}
	return out, nil
}

// Message es un correo, ya leído en lo que interesa.
type Message struct {
	ID       string    `json:"id"`
	ThreadID string    `json:"threadId"`
	From     string    `json:"from"`
	To       string    `json:"to"`
	Cc       string    `json:"cc,omitempty"`
	Subject  string    `json:"subject"`
	Date     time.Time `json:"date"`
	Snippet  string    `json:"snippet"`
	Body     string    `json:"body,omitempty"` // texto; sólo con Get(…, true)
	Labels   []string  `json:"labels,omitempty"`
}

type part struct {
	MimeType string `json:"mimeType"`
	Headers  []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"headers"`
	Body struct {
		Data string `json:"data"`
	} `json:"body"`
	Parts []part `json:"parts"`
}

type rawMessage struct {
	ID           string   `json:"id"`
	ThreadID     string   `json:"threadId"`
	Snippet      string   `json:"snippet"`
	LabelIDs     []string `json:"labelIds"`
	InternalDate string   `json:"internalDate"`
	Payload      part     `json:"payload"`
}

// Get lee un mensaje. Con `body`, también su texto (el text/plain, o el HTML pasado a texto).
func (c *Client) Get(ctx context.Context, id string, body bool) (Message, error) {
	v := url.Values{"format": {"metadata"}, "metadataHeaders": {"From", "To", "Cc", "Subject", "Date"}}
	if body {
		v = url.Values{"format": {"full"}}
	}
	var r rawMessage
	if err := c.getJSON(ctx, "/messages/"+url.PathEscape(id), v, &r); err != nil {
		return Message{}, err
	}
	return parse(r, body), nil
}

func parse(r rawMessage, body bool) Message {
	m := Message{ID: r.ID, ThreadID: r.ThreadID, Snippet: html.UnescapeString(r.Snippet), Labels: r.LabelIDs}
	for _, h := range r.Payload.Headers {
		switch strings.ToLower(h.Name) {
		case "from":
			m.From = h.Value
		case "to":
			m.To = h.Value
		case "cc":
			m.Cc = h.Value
		case "subject":
			m.Subject = h.Value
		}
	}
	var ms int64
	if _, err := fmt.Sscan(r.InternalDate, &ms); err == nil {
		m.Date = time.UnixMilli(ms)
	}
	if body {
		if t := find(r.Payload, "text/plain"); t != "" {
			m.Body = t
		} else {
			m.Body = htmlToText(find(r.Payload, "text/html"))
		}
	}
	return m
}

// find devuelve el primer cuerpo del tipo pedido, recorriendo las partes.
func find(p part, mime string) string {
	if p.MimeType == mime && p.Body.Data != "" {
		b, err := base64.URLEncoding.DecodeString(p.Body.Data)
		if err != nil {
			b, _ = base64.RawURLEncoding.DecodeString(p.Body.Data)
		}
		return string(b)
	}
	for _, sub := range p.Parts {
		if t := find(sub, mime); t != "" {
			return t
		}
	}
	return ""
}

// Thread devuelve los mensajes de un hilo, en orden, sólo con sus encabezados.
func (c *Client) Thread(ctx context.Context, id string) ([]Message, error) {
	return c.thread(ctx, id, false)
}

// ThreadFull es Thread con el texto de cada mensaje.
func (c *Client) ThreadFull(ctx context.Context, id string) ([]Message, error) {
	return c.thread(ctx, id, true)
}

func (c *Client) thread(ctx context.Context, id string, body bool) ([]Message, error) {
	v := url.Values{"format": {"metadata"}, "metadataHeaders": {"From", "To", "Cc", "Subject", "Date"}}
	if body {
		v = url.Values{"format": {"full"}}
	}
	var r struct {
		Messages []rawMessage `json:"messages"`
	}
	if err := c.getJSON(ctx, "/threads/"+url.PathEscape(id), v, &r); err != nil {
		return nil, err
	}
	out := make([]Message, 0, len(r.Messages))
	for _, m := range r.Messages {
		out = append(out, parse(m, body))
	}
	return out, nil
}

var (
	blockTags = regexp.MustCompile(`(?i)<\s*(br|/p|/div|/tr|/li|/h[1-6])[^>]*>`)
	dropTags  = regexp.MustCompile(`(?is)<(script|style|head)[^>]*>.*?</\s*(script|style|head)\s*>`)
	anyTag    = regexp.MustCompile(`(?s)<[^>]+>`)
	blank     = regexp.MustCompile(`\n[ \t]*\n[ \t\n]*`)
)

// htmlToText deja el texto legible de un correo HTML: saltos donde había bloques, sin etiquetas ni scripts.
func htmlToText(s string) string {
	s = dropTags.ReplaceAllString(s, "")
	s = blockTags.ReplaceAllString(s, "\n")
	s = anyTag.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	return strings.TrimSpace(blank.ReplaceAllString(s, "\n\n"))
}
