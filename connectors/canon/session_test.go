package canon

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
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

func withSession(t *testing.T, value string) {
	t.Helper()
	previous := sessionValue
	sessionValue = func() string { return value }
	t.Cleanup(func() { sessionValue = previous })
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
