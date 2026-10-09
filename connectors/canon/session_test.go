package canon

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type fakeTransport func(*http.Request) (*http.Response, error)

func (f fakeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func response(status int, location string) *http.Response {
	res := &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}
	if location != "" {
		res.Header.Set("Location", location)
	}
	return res
}

// withSession fija la cookie de Google y deja SIN sesión del playground: ninguna prueba lee el .env de verdad.
func withSession(t *testing.T, value string) {
	t.Helper()
	previous, previousPlayground := sessionValue, playgroundValue
	sessionValue = func() string { return value }
	playgroundValue = func() string { return "" }
	t.Cleanup(func() { sessionValue, playgroundValue = previous, previousPlayground })
}

func withPlayground(t *testing.T, value string) {
	t.Helper()
	previous := playgroundValue
	playgroundValue = func() string { return value }
	t.Cleanup(func() { playgroundValue = previous })
}

// token arma un JWT de prueba con ese vencimiento; la firma no importa, el conector no la verifica.
func token(exp time.Time) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"exp":%d,"email":"x@creditop.com"}`, exp.Unix())))
	return "eyJhbGciOiJSUzI1NiJ9." + payload + ".firma"
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
}

func TestPlaygroundSessionGoesOnlyToProductionCanon(t *testing.T) {
	withSession(t, "google")
	withPlayground(t, "sesion-del-playground")
	var seen *http.Request
	transport := newSessionTransport(fakeTransport(func(r *http.Request) (*http.Response, error) {
		seen = r
		return response(200, ""), nil
	}))
	for _, tc := range []struct {
		url  string
		want bool
	}{
		{DefaultURL + "/api/questions", true},
		{"http://localhost:8080/api/questions", false},
	} {
		req, _ := http.NewRequest(http.MethodGet, tc.url, nil)
		if _, err := transport.RoundTrip(req); err != nil {
			t.Fatal(err)
		}
		cookie, err := seen.Cookie(playgroundCookie)
		if got := err == nil && cookie.Value == "sesion-del-playground"; got != tc.want {
			t.Errorf("%s: sesión del playground enviada = %v, esperaba %v", tc.url, got, tc.want)
		}
		if google, err := seen.Cookie(sessionCookie); tc.want && (err != nil || google.Value != "google") {
			t.Errorf("%s: la cookie de Google tiene que seguir viajando junto a la del playground", tc.url)
		}
	}
}

func TestOwnerRouteSaysWhatIsMissing(t *testing.T) {
	owner := `{"error":"esta ruta es de nivel dueño","nivel":"dueño"}`
	vencido := token(time.Now().Add(-time.Hour))
	for _, tc := range []struct{ playground, want string }{
		{"", "no hay PLAYGROUND_SESION"},
		{vencido, "PLAYGROUND_SESION venció"},
		{token(time.Now().Add(time.Hour)), "no reconoce PLAYGROUND_SESION"},
		{"no-es-un-jwt", "no reconoce PLAYGROUND_SESION"},
	} {
		withSession(t, "google")
		withPlayground(t, tc.playground)
		transport := newSessionTransport(fakeTransport(func(*http.Request) (*http.Response, error) {
			return jsonResponse(401, owner), nil
		}))
		req, _ := http.NewRequest(http.MethodDelete, DefaultURL+"/api/questions", nil)
		_, err := transport.RoundTrip(req)
		if !errors.Is(err, ErrOwner) || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("sesión %.12q: error = %v, esperaba ErrOwner con %q", tc.playground, err, tc.want)
		}
		if tc.playground != "" && err != nil && strings.Contains(err.Error(), tc.playground) {
			t.Errorf("el error no debe imprimir el token: %v", err)
		}
	}
}

func TestOtherUnauthorizedAnswersKeepTheirBody(t *testing.T) {
	withSession(t, "google")
	body := `{"error":"llave inválida"}`
	transport := newSessionTransport(fakeTransport(func(*http.Request) (*http.Response, error) {
		return jsonResponse(403, body), nil
	}))
	req, _ := http.NewRequest(http.MethodPost, DefaultURL+"/api/draft", nil)
	res, err := transport.RoundTrip(req)
	if err != nil || res.StatusCode != 403 {
		t.Fatalf("un 403 que no es de nivel dueño debe pasar tal cual: %v %v", res, err)
	}
	if got, _ := io.ReadAll(res.Body); string(got) != body {
		t.Errorf("el cuerpo tiene que llegar intacto: %q", got)
	}
}

func TestSessionCookieGoesOnlyToProductionCanon(t *testing.T) {
	withSession(t, "valor-de-sesion")
	var seen *http.Request
	transport := newSessionTransport(fakeTransport(func(r *http.Request) (*http.Response, error) {
		seen = r
		return response(200, ""), nil
	}))

	for _, tc := range []struct {
		url  string
		want bool
	}{
		{DefaultURL + "/api/search", true},
		{"http://localhost:8080/api/search", false},
		{"https://otro.ejemplo.com/api/search", false},
	} {
		req, _ := http.NewRequest(http.MethodGet, tc.url, nil)
		if _, err := transport.RoundTrip(req); err != nil {
			t.Fatal(err)
		}
		cookie, err := seen.Cookie(sessionCookie)
		if got := err == nil && cookie.Value == "valor-de-sesion"; got != tc.want {
			t.Errorf("%s: cookie enviada = %v, esperaba %v", tc.url, got, tc.want)
		}
	}
}

func TestLoginRedirectSaysWhatToDo(t *testing.T) {
	login := "https://accounts.google.com/o/oauth2/v2/auth?client_id=x"
	for _, tc := range []struct{ session, want string }{
		{"", "no hay AUTH_GOOGLE"},
		{"vencida", "AUTH_GOOGLE venció"},
	} {
		withSession(t, tc.session)
		transport := newSessionTransport(fakeTransport(func(*http.Request) (*http.Response, error) {
			return response(302, login), nil
		}))
		req, _ := http.NewRequest(http.MethodGet, DefaultURL+"/api/search", nil)
		_, err := transport.RoundTrip(req)
		if !errors.Is(err, ErrSession) || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("sesión %q: error = %v, esperaba ErrSession con %q", tc.session, err, tc.want)
		}
		if strings.Contains(err.Error(), tc.session) && tc.session != "" {
			t.Errorf("el error no debe imprimir el valor de la cookie: %v", err)
		}
	}
}

func TestOtherRedirectsAndLocalCanonPassThrough(t *testing.T) {
	withSession(t, "x")
	transport := newSessionTransport(fakeTransport(func(r *http.Request) (*http.Response, error) {
		return response(302, "https://accounts.google.com/login"), nil
	}))
	// Un canon local que redirige no es la puerta de Google de producción: no se reinterpreta.
	req, _ := http.NewRequest(http.MethodGet, "http://localhost:8080/api/search", nil)
	res, err := transport.RoundTrip(req)
	if err != nil || res.StatusCode != 302 {
		t.Fatalf("un origen que no es canon de producción debe pasar tal cual: %v %v", res, err)
	}

	same := newSessionTransport(fakeTransport(func(*http.Request) (*http.Response, error) {
		return response(302, DefaultURL+"/api/other"), nil
	}))
	req, _ = http.NewRequest(http.MethodGet, DefaultURL+"/api/search", nil)
	if _, err := same.RoundTrip(req); err != nil {
		t.Fatalf("un redireccionamiento dentro de canon no es un login: %v", err)
	}
}
