package jev

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Estas pruebas no salen a la red: el pedido va a un servidor falso. No persiguen cobertura: cada una
// fija una promesa del transporte que, rota, filtraría algo o aceptaría una respuesta que no se pidió.

// connectorsDir arma una carpeta connectors/ de juguete con ese .env y se para en ella.
func connectorsDir(t *testing.T, dotenv string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "connectors", "env"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "connectors", ".env"), []byte(dotenv), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(root)
}

func TestTheTokenIsReadAsTextAndTheProcessWins(t *testing.T) {
	connectorsDir(t, "OTRA=nada\nexport JEV_TOKEN=\"del-archivo\"\nrm -rf /tmp/x\n")
	t.Setenv("JEV_TOKEN", "")
	t.Setenv("TYPESAFE_API_KEY", "")
	if got, err := Token(); err != nil || got != "del-archivo" {
		t.Errorf("Token() = %q, %v; quería el del archivo", got, err)
	}
	t.Setenv("JEV_TOKEN", "del-entorno")
	if got, _ := Token(); got != "del-entorno" {
		t.Errorf("Token() = %q; el proceso tenía que ganar", got)
	}
}

func TestAMissingTokenIsAnErrorNotAnEmptyHeader(t *testing.T) {
	connectorsDir(t, "OTRA=nada\n")
	t.Setenv("JEV_TOKEN", "")
	t.Setenv("TYPESAFE_API_KEY", "")
	if got, err := Token(); err == nil || got != "" {
		t.Errorf("sin token tenía que fallar; dio %q, %v", got, err)
	}
}

func fake(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := New("secreto")
	c.Endpoint = srv.URL + "/v1/systemone"
	return c
}

func echo(answer, body any) (any, error) { return []any{answer, body}, nil }

func TestItSendsBearerAndReturnsWhatTheValidatorAccepts(t *testing.T) {
	var auth, path string
	var sent map[string]any
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&sent)
		fmt.Fprint(w, `{"ok": true}`)
	})
	got, err := Request(context.Background(), c, map[string]any{"q": 1}, echo)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(got) != "[map[ok:true] map[q:1]]" || auth != "Bearer secreto" || path != "/v1/systemone" || sent["q"] != float64(1) {
		t.Errorf("got=%v auth=%q path=%q sent=%v", got, auth, path, sent)
	}
	if c.http.Timeout > 15e9 {
		t.Errorf("el timeout tiene que ser ≤15 s: %v", c.http.Timeout)
	}
}

func TestAnHTTPErrorDoesNotLeakTheBodyOrTheToken(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		fmt.Fprint(w, "token secreto invalido")
	})
	_, err := Request(context.Background(), c, map[string]any{}, echo)
	if err == nil || err.Error() != "Jev HTTP 401" || !IsError(err) {
		t.Errorf("err = %v; quería exactamente «Jev HTTP 401»", err)
	}
}

func TestARedirectIsAnErrorAndTheTokenDoesNotFollowIt(t *testing.T) {
	followed := false
	var c *Client
	c = fake(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/otro" {
			followed = true
			return
		}
		http.Redirect(w, r, "/otro", http.StatusFound)
	})
	_, err := Request(context.Background(), c, map[string]any{}, echo)
	if followed || err == nil || err.Error() != "Jev HTTP 302" {
		t.Errorf("siguió=%v err=%v; quería «Jev HTTP 302» sin seguir", followed, err)
	}
}

func TestAnOversizedOrInvalidAnswerIsRejected(t *testing.T) {
	for want, body := range map[string]string{
		"respuesta demasiado grande": `"` + strings.Repeat("x", maxAnswer+1) + `"`,
		"respuesta JSON inválida":    "no es json",
	} {
		c := fake(t, func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, body) })
		if _, err := Request(context.Background(), c, map[string]any{}, echo); err == nil || err.Error() != want {
			t.Errorf("err = %v; quería %q", err, want)
		}
	}
}
