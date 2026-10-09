package canon

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

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

/* Y LA SESIÓN DEL PLAYGROUND, que es otra cosa. La cookie de Google sólo abre la puerta del balanceador: canon
 * NO la usa para saber quién sos (cualquiera inventa la cabecera que el balanceador agrega detrás). Quién sos lo
 * dice `playground_sesion`, el token firmado que entrega el home en `/entrar`, y sólo con él abren las rutas de
 * nivel dueño (borrar preguntas, roles, conversaciones). Vive en `connectors/.env.prod` como `PLAYGROUND_SESION`,
 * se copia de la cookie del navegador cuando vence, y viaja como cookie —no como `Authorization`, que ya lleva
 * la llave de escritura—, sólo al origen de canon de producción. */
const (
	playgroundCookie = "playground_sesion"
	playgroundKey    = "PLAYGROUND_SESION"
)

// ErrOwner es lo que devuelve el cliente cuando una ruta de nivel dueño no sabe quién sos: falta la sesión del
// playground, venció, o la cuenta no tiene el rol.
var ErrOwner = errors.New("canon pide la sesión del playground de un admin")

// playgroundValue lee PLAYGROUND_SESION del proceso o de `connectors/.env.prod`; se cambia en las pruebas.
var playgroundValue = func() string {
	values, err := env.Load("prod")
	if err != nil {
		return ""
	}
	return values.Get(playgroundKey)
}

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
	value, playground := "", ""
	if req.URL.Host == t.host {
		value, playground = sessionValue(), playgroundValue()
		if value != "" || playground != "" {
			req = req.Clone(req.Context())
		}
		if value != "" {
			req.AddCookie(&http.Cookie{Name: sessionCookie, Value: value})
		}
		if playground != "" {
			req.AddCookie(&http.Cookie{Name: playgroundCookie, Value: playground})
		}
	}
	res, err := t.base.RoundTrip(req)
	if err != nil || req.URL.Host != t.host {
		return res, err
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return ownerCheck(res, playground)
	}
	if !isLoginRedirect(res) {
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

/* ownerCheck: un 401 o 403 de canon que dice «nivel dueño» se vuelve un error que explica qué hacer, en vez de
 * llegar como un JSON de error que cada llamada lee a su manera (y alguna leía como «no hay nada»). Cualquier
 * otro 401/403 sigue de largo con su cuerpo intacto. */
func ownerCheck(res *http.Response, playground string) (*http.Response, error) {
	body, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	res.Body.Close()
	if err != nil {
		return nil, err
	}
	var answer struct {
		Level string `json:"nivel"`
	}
	if json.Unmarshal(body, &answer) != nil || answer.Level != "dueño" {
		res.Body = io.NopCloser(bytes.NewReader(body))
		return res, nil
	}
	if playground == "" {
		return nil, errors.Join(ErrOwner, errors.New("no hay "+playgroundKey+": ponelo en connectors/.env.prod (la cookie "+playgroundCookie+" del navegador, con tu sesión abierta en el playground)"))
	}
	if expiry, ok := sessionExpiry(playground); ok && time.Now().After(expiry) {
		return nil, errors.Join(ErrOwner, errors.New(playgroundKey+" venció el "+expiry.Local().Format("2006-01-02 15:04")+": copiá de nuevo la cookie "+playgroundCookie+" del navegador"))
	}
	return nil, errors.Join(ErrOwner, errors.New("canon no reconoce "+playgroundKey+" como la sesión de un admin: o no es la cookie "+playgroundCookie+" completa, o esa cuenta no tiene el rol (`pg canon yo` dice quién ve canon)"))
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
