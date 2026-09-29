package canon

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"creditop/playground/connectors/env"
)

/* LA PUERTA DE GOOGLE. Canon en producción está detrás de un balanceador que pide iniciar sesión con Google:
 * sin la cookie de sesión (`AWSELBAuthSessionCookie-0`) contesta un 302 a accounts.google.com, y el cliente
 * lo seguía hasta leer el HTML del login como si fuera JSON. Su valor vive en `connectors/.env.prod` como
 * `AUTH_GOOGLE`, se renueva a mano cuando vence, y sólo se manda al origen de canon de producción. */

const (
	sessionCookie = "AWSELBAuthSessionCookie-0"
	sessionKey    = "AUTH_GOOGLE"
)

// ErrSession es lo que devuelve el cliente cuando el balanceador pide sesión: no hay cookie, o venció.
var ErrSession = errors.New("canon pide sesión de Google")

// sessionValue lee AUTH_GOOGLE del proceso o de `connectors/.env.prod`; se cambia en las pruebas.
var sessionValue = func() string {
	values, err := env.Load("prod")
	if err != nil {
		return ""
	}
	return values.Get(sessionKey)
}

// sessionTransport agrega la cookie a los pedidos hacia canon de producción y traduce el redireccionamiento
// al login de Google en un error que dice qué hacer. No toca los pedidos a ningún otro origen.
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
	value := ""
	if req.URL.Host == t.host {
		if value = sessionValue(); value != "" {
			req = req.Clone(req.Context())
			req.AddCookie(&http.Cookie{Name: sessionCookie, Value: value})
		}
	}
	res, err := t.base.RoundTrip(req)
	if err != nil || req.URL.Host != t.host || !isLoginRedirect(res) {
		return res, err
	}
	res.Body.Close()
	if value == "" {
		return nil, sessionError("no hay " + sessionKey + ": ponelo en connectors/.env.prod (la cookie " + sessionCookie + ", que sale de entrar a canon con Google)")
	}
	return nil, sessionError(sessionKey + " venció: renovalo en connectors/.env.prod (la cookie " + sessionCookie + " de una sesión nueva en canon)")
}

func sessionError(detail string) error { return errors.Join(ErrSession, errors.New(detail)) }

func isLoginRedirect(res *http.Response) bool {
	if res.StatusCode < 300 || res.StatusCode > 399 {
		return false
	}
	location, err := res.Location()
	return err == nil && strings.HasSuffix(location.Hostname(), "google.com")
}
