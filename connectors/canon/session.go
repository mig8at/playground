package canon

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

/* LA SESIÓN DEL PLAYGROUND, la del CLI del equipo. Canon de producción se alcanza por el gateway del home
 * (`https://playground.creditop.com/api/t/canon/…`), que lo llama por la red interna con la sesión de quien pide:
 * no hay puerta de Google en el medio ni cookies que copiar del navegador. La sesión es la que deja
 * `playground login` en `~/.config/creditop-playground/token.json`; viaja en `Authorization: Bearer` y sólo al
 * gateway. Canon sabe por ella quién sos (las rutas de nivel dueño piden el rol admin), y la llave de escritura va
 * aparte, en `x-canon-key`. */

const playgroundLogin = "`playground login` (el CLI del playground compartido)"

// ErrSession es lo que devuelve el cliente cuando no hay sesión del playground, venció, o el gateway no la reconoce.
var ErrSession = errors.New("canon pide la sesión del playground")

// ErrOwner es lo que devuelve el cliente cuando una ruta de nivel dueño no te reconoce como admin.
var ErrOwner = errors.New("canon pide la sesión del playground de un admin")

// playgroundToken lee el token del CLI (`playground login`); se cambia en las pruebas.
var playgroundToken = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(home, ".config", "creditop-playground", "token.json"))
	if err != nil {
		return ""
	}
	var saved struct {
		Token string `json:"token"`
	}
	if json.Unmarshal(raw, &saved) != nil {
		return ""
	}
	return strings.TrimSpace(saved.Token)
}

// sessionTransport pone la sesión en los pedidos al gateway del home y traduce su falta en un error que dice qué
// hacer. No toca los pedidos a ningún otro origen (un canon local con CANON_URL va sin sesión).
type sessionTransport struct {
	base http.RoundTripper
	host string
}

func newSessionTransport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	host := ""
	if u, err := url.Parse(DefaultURL); err == nil {
		host = u.Host
	}
	return sessionTransport{base: base, host: host}
}

func (t sessionTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Host != t.host {
		return t.base.RoundTrip(req)
	}
	token := playgroundToken()
	if token == "" {
		return nil, sessionError("no hay sesión del playground en esta máquina: corré " + playgroundLogin)
	}
	if expiry, ok := sessionExpiry(token); ok && time.Now().After(expiry) {
		return nil, sessionError("la sesión del playground venció el " + expiry.Local().Format("2006-01-02 15:04") + ": corré " + playgroundLogin)
	}
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := t.base.RoundTrip(req)
	if err != nil {
		return res, err
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return ownerCheck(res)
	}
	return res, nil
}

func sessionError(detail string) error { return errors.Join(ErrSession, errors.New(detail)) }

/* ownerCheck: un 401 o 403 que dice «nivel dueño» (canon) o que viene del gateway sin sesión se vuelve un error
 * que explica qué hacer, en vez de llegar como un JSON de error que cada llamada lee a su manera. Cualquier otro
 * 401/403 sigue de largo con su cuerpo intacto. */
func ownerCheck(res *http.Response) (*http.Response, error) {
	body, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	res.Body.Close()
	if err != nil {
		return nil, err
	}
	var answer struct {
		Level string `json:"nivel"`
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &answer)
	switch {
	case answer.Level == "dueño":
		return nil, errors.Join(ErrOwner, errors.New("canon no te reconoce como admin: esa cuenta no tiene el rol (`pg canon yo` dice quién te ve canon)"))
	case res.StatusCode == http.StatusUnauthorized && strings.Contains(answer.Error, "sesión del playground"):
		return nil, sessionError("el gateway no reconoce tu sesión: corré " + playgroundLogin)
	}
	res.Body = io.NopCloser(bytes.NewReader(body))
	return res, nil
}

// sessionExpiry lee el vencimiento (`exp`) del token, SIN verificar la firma: sirve para decir «venció», nunca
// para decidir quién es. Eso lo hace canon.
func sessionExpiry(token string) (time.Time, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return time.Time{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, false
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if json.Unmarshal(raw, &claims) != nil || claims.Exp == 0 {
		return time.Time{}, false
	}
	return time.Unix(claims.Exp, 0), true
}
