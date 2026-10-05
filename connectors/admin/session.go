package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/connectors/env"
)

// La sesión se guarda en `connectors/.auth/sessions/admin-<ambiente>.json` (fuera de git, permisos 600): el formato es
// el MISMO que lee el harness en TypeScript (`pkg/sessions.ts`), así los dos lados comparten la sesión. Dice QUIÉN
// entró, y nunca se imprime su contenido.

// StoredCookie es una cookie guardada, con los nombres de campo del formato compartido.
type StoredCookie struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	Expires  float64 `json:"expires"`
	HTTPOnly bool    `json:"httpOnly"`
	Secure   bool    `json:"secure"`
	SameSite string  `json:"sameSite,omitempty"`
}

// StoredSession es una sesión guardada.
type StoredSession struct {
	Version   int            `json:"version"`
	Kind      string         `json:"kind"`
	Target    string         `json:"target"`
	User      string         `json:"user"`
	Who       *string        `json:"who"`
	Origin    string         `json:"origin"`
	CreatedAt string         `json:"createdAt"`
	Cookies   []StoredCookie `json:"cookies"`
}

func playgroundRoot() (string, error) {
	dir, err := env.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Dir(dir), nil
}

func sessionPath(target string) (string, error) {
	if _, err := BaseFor(target); err != nil {
		return "", err
	}
	root, err := playgroundRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "connectors", ".auth", "sessions", "admin-"+target+".json"), nil
}

// ReadSession lee la sesión guardada; nil si no hay.
func ReadSession(target string) (*StoredSession, error) {
	path, err := sessionPath(target)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	legacy := false
	if os.IsNotExist(err) {
		if _, tombErr := os.Stat(path + ".signed-out"); tombErr == nil {
			return nil, nil
		}
	}
	if os.IsNotExist(err) {
		root, rootErr := playgroundRoot()
		if rootErr != nil {
			return nil, rootErr
		}
		raw, err = os.ReadFile(filepath.Join(root, "harness", ".auth", "sessions", "admin-"+target+".json"))
		legacy = err == nil
		if os.IsNotExist(err) {
			return nil, nil
		}
	}
	if err != nil {
		return nil, err
	}
	var s StoredSession
	if err := json.Unmarshal(raw, &s); err != nil || s.Version != 1 {
		return nil, nil
	}
	base, err := BaseFor(target)
	if err != nil {
		return nil, err
	}
	if s.Kind != "admin" || s.Target != target || s.Origin != base || s.User == "" {
		return nil, nil
	}
	if target != "local" {
		values, err := env.Load(target)
		if err != nil {
			return nil, err
		}
		if user := values.Get("ADMIN_USER"); user != "" && user != s.User {
			return nil, nil
		}
	}
	if legacy {
		if _, err := WriteSession(&s); err != nil {
			return nil, err
		}
	}
	return &s, nil
}

// WriteSession guarda la sesión con permisos 600 y devuelve dónde.
func WriteSession(s *StoredSession) (string, error) {
	if s == nil {
		return "", errors.New("sesión vacía")
	}
	base, err := BaseFor(s.Target)
	if err != nil {
		return "", err
	}
	if s.Version != 1 || s.Kind != "admin" || s.Origin != base || s.User == "" {
		return "", errors.New("metadatos de sesión inválidos")
	}
	path, err := sessionPath(s.Target)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.Chmod(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".admin-session-*.tmp")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return "", err
	}
	_ = os.Remove(path + ".signed-out")
	return path, nil
}

// RemoveSession cierra también la lectura de backups antiguos: nunca resucitan al consultar status.
func RemoveSession(target string) (bool, error) {
	path, err := sessionPath(target)
	if err != nil {
		return false, err
	}
	_, statErr := os.Stat(path)
	removed := statErr == nil
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return false, err
	}
	if err := os.WriteFile(path+".signed-out", []byte(""), 0o600); err != nil {
		return false, err
	}
	return removed, nil
}

func hostMatches(host, domain string) bool {
	d := strings.TrimPrefix(domain, ".")
	return host == d || strings.HasSuffix(host, "."+d)
}

// FromSession arma un cliente con una sesión guardada: sólo las cookies que le aplican al host del admin.
func FromSession(s *StoredSession) (*Client, error) {
	u, err := url.Parse(s.Origin)
	if err != nil {
		return nil, err
	}
	c := New(s.Origin)
	c.User = s.User
	if s.Who != nil {
		c.Who = *s.Who
	}
	for _, sc := range s.Cookies {
		if !hostMatches(u.Hostname(), sc.Domain) {
			continue
		}
		c.jar.set(&http.Cookie{Name: sc.Name, Value: sc.Value, Domain: sc.Domain, Path: sc.Path})
	}
	return c, nil
}

func (c *Client) toSession(target, user, who string) *StoredSession {
	s := &StoredSession{
		Version: 1, Kind: "admin", Target: target, User: user, Origin: c.Base,
		CreatedAt: time.Now().UTC().Format(time.RFC3339), Cookies: []StoredCookie{},
	}
	if who != "" {
		s.Who = &who
	}
	for _, ck := range c.jar.m {
		exp := float64(-1)
		if !ck.Expires.IsZero() {
			exp = float64(ck.Expires.Unix())
		}
		same := ""
		switch ck.SameSite {
		case http.SameSiteLaxMode:
			same = "Lax"
		case http.SameSiteStrictMode:
			same = "Strict"
		case http.SameSiteNoneMode:
			same = "None"
		}
		s.Cookies = append(s.Cookies, StoredCookie{Name: ck.Name, Value: ck.Value, Domain: ck.Domain, Path: ck.Path, Expires: exp, HTTPOnly: ck.HttpOnly, Secure: ck.Secure, SameSite: same})
	}
	return s
}

// Credentials lee ADMIN_USER y ADMIN_PASS de `connectors/.env.<ambiente>` (el proceso gana). Sólo de ahí: una credencial de
// un archivo viejo puede ser de OTRA persona, y entrar con ella a un ambiente compartido es elegir una identidad que nadie
// eligió.
func Credentials(target string) (user, pass string, err error) {
	v, err := env.Load(target)
	if err != nil {
		return "", "", err
	}
	user, pass = v.Get("ADMIN_USER"), v.Get("ADMIN_PASS")
	if user == "" || pass == "" {
		return "", "", fmt.Errorf("faltan tus credenciales del admin de %s: poné ADMIN_USER y ADMIN_PASS en connectors/.env.%s", target, target)
	}
	return user, pass, nil
}

// Login entra al admin de un ambiente remoto con usuario y contraseña, por HTTP: GET /login (cookies y token CSRF) y POST /login.
// Es lo que teclea una contraseña: lo corre una persona (`pg admin login`), no se ofrece como herramienta del modelo.
func Login(ctx context.Context, target, user, pass string) (*Client, *StoredSession, error) {
	base, err := BaseFor(target)
	if err != nil {
		return nil, nil, err
	}
	if target == "local" {
		return nil, nil, errors.New("local no usa contraseña: la sesión la emite la propia app (usá `pg admin login --target local`)")
	}
	c := New(base)
	if _, err := c.Get(ctx, "/login"); err != nil && !errors.Is(err, ErrNoSession) {
		return nil, nil, fmt.Errorf("no pude abrir el login: %w", err)
	}
	r, err := c.PostForm(ctx, "/login", "/login", url.Values{"email": {user}, "password": {pass}})
	if err != nil {
		return nil, nil, fmt.Errorf("el login falló: %w", err)
	}
	if r.Status == http.StatusTooManyRequests {
		return nil, nil, errors.New("el admin pidió esperar (HTTP 429): demasiados intentos de login")
	}
	if r.Status == 419 {
		return nil, nil, errors.New("el admin rechazó el token CSRF (HTTP 419)")
	}
	if r.Location == "" || isLoginRedirect(r.Location) || r.Status >= 400 {
		msg := "credenciales rechazadas"
		if r.Status >= 400 {
			msg = fmt.Sprintf("HTTP %d", r.Status)
		}
		if back, err := c.Get(ctx, "/login"); err == nil && back.Page != nil {
			if e, ok := back.Page.Props["errors"].(map[string]any); ok && len(e) > 0 {
				for _, v := range e {
					msg = fmt.Sprint(v)
					break
				}
			}
		}
		return nil, nil, fmt.Errorf("el admin no dejó entrar: %s", msg)
	}
	c.User = user
	who, err := c.Probe(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("entré pero la sesión no sirve: %w", err)
	}
	c.Who = who
	return c, c.toSession(target, user, who), nil
}

// LoginLocal pide la sesión del admin LOCAL a la propia app (`connectors/admin/local-session`, con el guard real de Laravel y sólo
// con APP_ENV=local): no hay contraseña de por medio.
func LoginLocal(ctx context.Context) (*Client, *StoredSession, error) {
	base, err := BaseFor("local")
	if err != nil {
		return nil, nil, err
	}
	root, err := playgroundRoot()
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, filepath.Join(root, "connectors", "admin", "local-session")).Output()
	if err != nil {
		return nil, nil, fmt.Errorf("no pude emitir la sesión local (¿el admin local está arriba y APP_ENV=local?): %w", err)
	}
	var s struct {
		Cookie string `json:"cookie"`
		Value  string `json:"value"`
		Email  string `json:"email"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(firstJSONLine(string(out)))), &s); err != nil || s.Cookie == "" {
		return nil, nil, errors.New("admin-session no devolvió una sesión")
	}
	c := New(base)
	c.User = s.Email
	u, _ := url.Parse(base)
	c.jar.set(&http.Cookie{Name: s.Cookie, Value: s.Value, Domain: u.Hostname(), Path: "/", HttpOnly: true})
	who, err := c.Probe(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("la sesión local no sirvió: %w", err)
	}
	c.Who = who
	return c, c.toSession("local", s.Email, who), nil
}

func firstJSONLine(s string) string {
	for _, l := range strings.Split(s, "\n") {
		if strings.HasPrefix(strings.TrimSpace(l), "{") {
			return l
		}
	}
	return s
}

// Open devuelve un cliente con la sesión GUARDADA, comprobada contra el servidor. Sin sesión, o con una vencida, falla diciendo
// cómo conseguirla: NUNCA entra por su cuenta con una credencial. La excepción es local, donde la sesión la emite la propia app
// sin contraseña y se renueva sola.
func Open(ctx context.Context, target string) (*Client, error) {
	if _, err := BaseFor(target); err != nil {
		return nil, err
	}
	how := fmt.Sprintf("entrá con: pg admin login --target %s", target)
	s, err := ReadSession(target)
	if err != nil {
		return nil, err
	}
	renewLocal := func() (*Client, error) {
		c, ns, err := LoginLocal(ctx)
		if err != nil {
			return nil, err
		}
		if _, err := WriteSession(ns); err != nil {
			return nil, err
		}
		return c, nil
	}
	if s == nil {
		if target == "local" {
			return renewLocal()
		}
		return nil, fmt.Errorf("%w: no hay sesión guardada para %s (%s)", ErrNoSession, target, how)
	}
	c, err := FromSession(s)
	if err != nil {
		return nil, err
	}
	who, err := c.Probe(ctx)
	switch {
	case errors.Is(err, ErrNoSession) && target == "local":
		return renewLocal()
	case errors.Is(err, ErrNoSession):
		return nil, fmt.Errorf("%w: la sesión de %s (%s) venció (%s)", ErrNoSession, target, s.User, how)
	case err != nil:
		return nil, fmt.Errorf("el admin de %s no contestó: %w", target, err)
	}
	if who != "" {
		c.Who = who
	}
	return c, nil
}
