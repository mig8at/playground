package drive

// El login: OAuth de escritorio con PKCE y redirección a loopback (127.0.0.1 en un puerto libre), que es
// lo que Google recomienda para una app de consola. Lo corre UNA PERSONA: abre el navegador, elige su
// cuenta y acepta el permiso de sólo lectura. Lo único que queda en disco es el refresh token.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/connectors/env"
)

// Los extremos de OAuth de Google.
const (
	AuthURL   = "https://accounts.google.com/o/oauth2/v2/auth"
	TokenURL  = "https://oauth2.googleapis.com/token"
	RevokeURL = "https://oauth2.googleapis.com/revoke"
)

// Session es lo que queda guardado después del login.
type Session struct {
	Email        string    `json:"email"`
	RefreshToken string    `json:"refresh_token"`
	Scope        string    `json:"scope"`
	At           time.Time `json:"at"`
}

// SessionPath es `connectors/.auth/drive.json`.
func SessionPath() (string, error) {
	dir, err := env.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, ".auth", "drive.json"), nil
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
		return s, errors.New("no hay sesión de Drive: corré `bin/pg drive login` (abre el navegador con tu cuenta)")
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(b, &s); err != nil || s.RefreshToken == "" {
		return s, fmt.Errorf("la sesión de Drive en %s no sirve: `bin/pg drive login` de nuevo", p)
	}
	return s, nil
}

// SaveSession la escribe con permisos 600, en una carpeta 700.
func SaveSession(s Session) (string, error) {
	p, err := SessionPath()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return "", err
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return "", err
	}
	return p, os.Rename(tmp, p)
}

// Logout revoca el refresh token en Google y borra el archivo. Si Google no contesta, borra igual: el
// token queda huérfano pero no en disco, y se revoca desde myaccount.google.com/permissions.
func Logout(ctx context.Context) (revoked bool, err error) {
	p, err := SessionPath()
	if err != nil {
		return false, err
	}
	if s, err := LoadSession(); err == nil {
		form := url.Values{"token": {s.RefreshToken}}
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, RevokeURL, strings.NewReader(form.Encode()))
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

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

func postToken(ctx context.Context, hc *http.Client, form url.Values) (tokenResponse, error) {
	var t tokenResponse
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return t, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := hc.Do(req)
	if err != nil {
		return t, err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1_000_000)).Decode(&t); err != nil {
		return t, fmt.Errorf("token de Google: HTTP %d ilegible", resp.StatusCode)
	}
	if t.Error != "" {
		return t, fmt.Errorf("token de Google: %s %s", t.Error, t.Description)
	}
	return t, nil
}

func refresh(ctx context.Context, hc *http.Client, oc OAuthClient, refreshToken string) (tokenResponse, error) {
	t, err := postToken(ctx, hc, url.Values{
		"client_id":     {oc.ID},
		"client_secret": {oc.Secret},
		"refresh_token": {refreshToken},
		"grant_type":    {"refresh_token"},
	})
	if err != nil && strings.Contains(err.Error(), "invalid_grant") {
		return t, errors.New("la sesión de Drive venció o se revocó: `bin/pg drive login` de nuevo")
	}
	return t, err
}

// Login hace el baile completo: levanta el loopback, le pasa a `open` la URL de consentimiento, espera
// el código (hasta `wait`), lo cambia por tokens y guarda la sesión con el correo de la cuenta.
func Login(ctx context.Context, oc OAuthClient, open func(authURL string), wait time.Duration) (Session, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return Session{}, err
	}
	defer ln.Close()
	redirect := fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)

	verifier, state := randomString(48), randomString(24)
	sum := sha256.Sum256([]byte(verifier))
	auth := AuthURL + "?" + url.Values{
		"client_id":             {oc.ID},
		"redirect_uri":          {redirect},
		"response_type":         {"code"},
		"scope":                 {Scope + " email"},
		"access_type":           {"offline"},
		"prompt":                {"consent"},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}.Encode()

	type result struct {
		code string
		err  error
	}
	got := make(chan result, 1)
	srv := &http.Server{ReadHeaderTimeout: 10 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		var res result
		switch {
		case q.Get("state") != state:
			res.err = errors.New("el state no coincide: se descarta la respuesta")
		case q.Get("error") != "":
			res.err = fmt.Errorf("Google devolvió %s", q.Get("error"))
		case q.Get("code") == "":
			http.NotFound(w, r)
			return
		default:
			res.code = q.Get("code")
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if res.err != nil {
			fmt.Fprintf(w, "<p>No se pudo: %s. Volvé a la terminal.</p>", res.err)
		} else {
			fmt.Fprint(w, "<p>Listo: ya podés cerrar esta pestaña y volver a la terminal.</p>")
		}
		select {
		case got <- res:
		default:
		}
	})}
	go srv.Serve(ln)
	defer srv.Close()

	open(auth)

	var res result
	select {
	case res = <-got:
	case <-time.After(wait):
		return Session{}, fmt.Errorf("pasaron %s sin respuesta del navegador", wait)
	case <-ctx.Done():
		return Session{}, ctx.Err()
	}
	if res.err != nil {
		return Session{}, res.err
	}

	hc := &http.Client{Timeout: 30 * time.Second}
	t, err := postToken(ctx, hc, url.Values{
		"client_id":     {oc.ID},
		"client_secret": {oc.Secret},
		"code":          {res.code},
		"code_verifier": {verifier},
		"redirect_uri":  {redirect},
		"grant_type":    {"authorization_code"},
	})
	if err != nil {
		return Session{}, err
	}
	if t.RefreshToken == "" {
		return Session{}, errors.New("Google no devolvió refresh token: quitá el acceso en myaccount.google.com/permissions y volvé a entrar")
	}
	if !strings.Contains(t.Scope, Scope) {
		return Session{}, errors.New("no se aceptó el permiso de lectura de Drive: hay que marcarlo en la pantalla de Google")
	}
	s := Session{RefreshToken: t.RefreshToken, Scope: t.Scope, At: time.Now().UTC()}
	c := New(oc, s)
	c.access, c.expires = t.AccessToken, time.Now().Add(time.Duration(t.ExpiresIn)*time.Second)
	u, err := c.Me(ctx)
	if err != nil {
		return Session{}, err
	}
	s.Email = u.Email
	if _, err := SaveSession(s); err != nil {
		return Session{}, err
	}
	return s, nil
}

func randomString(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
