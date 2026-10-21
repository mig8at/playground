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

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
}

// token arma un JWT de prueba con ese vencimiento; la firma no importa, el conector no la verifica.
func token(exp time.Time) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"exp":%d,"email":"x@creditop.com"}`, exp.Unix())))
	return "eyJhbGciOiJSUzI1NiJ9." + payload + ".firma"
}

// withToken fija la sesión del CLI: ninguna prueba lee el token de verdad.
func withToken(t *testing.T, value string) {
	t.Helper()
	previous := playgroundToken
	playgroundToken = func() string { return value }
	t.Cleanup(func() { playgroundToken = previous })
}

func TestTheSessionGoesOnlyToTheGateway(t *testing.T) {
	vigente := token(time.Now().Add(time.Hour))
	withToken(t, vigente)
	var seen *http.Request
	transport := newSessionTransport(fakeTransport(func(r *http.Request) (*http.Response, error) {
		seen = r
		return jsonResponse(200, "{}"), nil
	}))
	for _, tc := range []struct {
		url  string
		with bool
	}{
		{DefaultURL + "/api/search?q=x", true},
		{"http://localhost:8080/api/search?q=x", false}, // un canon local con CANON_URL va sin sesión
		{"https://otro.example/api/search", false},
	} {
		req, _ := http.NewRequest(http.MethodGet, tc.url, nil)
		if _, err := transport.RoundTrip(req); err != nil {
			t.Fatalf("%s: %v", tc.url, err)
		}
		got := seen.Header.Get("Authorization")
		if tc.with && got != "Bearer "+vigente {
			t.Errorf("%s: Authorization = %q, esperaba la sesión del playground", tc.url, got)
		}
		if !tc.with && got != "" {
			t.Errorf("%s: la sesión salió hacia otro origen (%q)", tc.url, got)
		}
	}
}

func TestWithoutSessionItSaysToLogIn(t *testing.T) {
	for _, tc := range []struct {
		token, want string
	}{
		{"", "no hay sesión del playground"},
		{token(time.Now().Add(-time.Minute)), "venció"},
	} {
		withToken(t, tc.token)
		called := false
		transport := newSessionTransport(fakeTransport(func(r *http.Request) (*http.Response, error) {
			called = true
			return jsonResponse(200, "{}"), nil
		}))
		req, _ := http.NewRequest(http.MethodGet, DefaultURL+"/api/search?q=x", nil)
		_, err := transport.RoundTrip(req)
		if !errors.Is(err, ErrSession) || !strings.Contains(err.Error(), tc.want) || !strings.Contains(err.Error(), "playground login") {
			t.Errorf("token %.12q: error = %v, esperaba ErrSession con %q y playground login", tc.token, err, tc.want)
		}
		if called {
			t.Errorf("token %.12q: no debería salir el pedido sin sesión vigente", tc.token)
		}
	}
}

func TestOwnerAndGatewayRejectionsSayWhatToDo(t *testing.T) {
	withToken(t, token(time.Now().Add(time.Hour)))
	for _, tc := range []struct {
		status int
		body   string
		is     error
		want   string
	}{
		{403, `{"error":"x","nivel":"dueño"}`, ErrOwner, "no tiene el rol"},
		{401, `{"error":"el gateway pide la sesión del playground"}`, ErrSession, "playground login"},
	} {
		transport := newSessionTransport(fakeTransport(func(r *http.Request) (*http.Response, error) {
			return jsonResponse(tc.status, tc.body), nil
		}))
		req, _ := http.NewRequest(http.MethodDelete, DefaultURL+"/api/questions", nil)
		_, err := transport.RoundTrip(req)
		if !errors.Is(err, tc.is) || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%d %s: error = %v, esperaba %v con %q", tc.status, tc.body, err, tc.is, tc.want)
		}
	}
	// Otro 401/403 sigue de largo, con su cuerpo, para que lo lea quien llamó.
	transport := newSessionTransport(fakeTransport(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(403, `{"error":"sin permiso de escritura"}`), nil
	}))
	req, _ := http.NewRequest(http.MethodPost, DefaultURL+"/api/draft", nil)
	res, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("un 403 común no es un error de sesión: %v", err)
	}
	body, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(body), "sin permiso de escritura") {
		t.Errorf("el cuerpo del 403 se perdió: %q", body)
	}
}
