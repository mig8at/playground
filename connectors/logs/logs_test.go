package logs

// No persiguen cobertura: cada una fija una conducta que ya dio, o podía dar, una respuesta equivocada.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// El ambiente local leyendo un Loki remoto mostraría la solicitud de otra persona: se frena.
func TestLocalNeverReadsARemoteLoki(t *testing.T) {
	remote := Config{Target: "local", URL: "https://logs-prod-036.grafana.net", User: "1", Token: "t"}
	if why := remote.Missing(); !strings.Contains(why, "REMOTO") {
		t.Errorf("local → remoto tenía que frenarse; dio %q", why)
	}
	if why := (Config{Target: "local", URL: "http://localhost:3100"}).Missing(); why != "" {
		t.Errorf("un Loki local sin credenciales tiene que poder leerse; dio %q", why)
	}
	if why := (Config{Target: "dev", URL: "https://logs-prod-036.grafana.net"}).Missing(); why == "" {
		t.Error("Grafana Cloud sin credenciales tenía que decir qué falta")
	}
}

// Sin token no se manda cabecera (un Loki local rechaza una vacía); con usuario va el basic de Grafana
// Cloud; y el tenant viaja en su cabecera.
func TestAuthHeaders(t *testing.T) {
	var got http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Clone()
		_, _ = w.Write([]byte(`{"data":{"result":[{"stream":{"service_name":"x"},"values":[["1","hola"]]}]}}`))
	}))
	defer server.Close()
	cl := New(Config{Target: "local", URL: server.URL}, time.Second)
	if _, err := cl.Range("{a=\"b\"}", time.Now().Add(-time.Minute), time.Now(), 10, "forward"); err != nil {
		t.Fatal(err)
	}
	if got.Get("Authorization") != "" {
		t.Errorf("sin token mandó Authorization %q", got.Get("Authorization"))
	}
	cl = New(Config{Target: "dev", URL: server.URL, User: "1339770", Token: "glc_x", Tenant: "t1"}, time.Second)
	streams, err := cl.Range("{a=\"b\"}", time.Now().Add(-time.Minute), time.Now(), 10, "forward")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got.Get("Authorization"), "Basic ") || got.Get("X-Scope-OrgID") != "t1" {
		t.Errorf("cabeceras = %v", got)
	}
	if len(streams) != 1 || streams[0].Labels["service_name"] != "x" || streams[0].Values[0][1] != "hola" {
		t.Errorf("streams = %+v", streams)
	}
}

// Un error de Loki vuelve traducido a su causa, no como un status pelado.
func TestErrorsAreExplained(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("legacy auth cannot be upgraded because the host is not found"))
	}))
	defer server.Close()
	_, err := New(Config{Target: "dev", URL: server.URL, Token: "glc_x"}, time.Second).Range("{}", time.Now(), time.Now(), 1, "forward")
	if err == nil || !strings.Contains(err.Error(), "Falta LOKI_USER") {
		t.Errorf("err = %v", err)
	}
}

func TestNormalizeURLKeepsOnlyTheOrigin(t *testing.T) {
	for in, want := range map[string]string{
		"logs-prod-036.grafana.net/loki/api/v1/query_range": "https://logs-prod-036.grafana.net",
		"http://localhost:3100/":                            "http://localhost:3100",
		"":                                                  "",
	} {
		if got := NormalizeURL(in); got != want {
			t.Errorf("NormalizeURL(%q) = %q, quería %q", in, got, want)
		}
	}
}

// Las claves salen de connectors/.env.<target>, con los nombres de legacy-backend como alias.
func TestLoadConfigReadsTheConnectorsFile(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "connectors", "env"), 0o755)
	os.WriteFile(filepath.Join(root, "connectors", ".env.qa"),
		[]byte("GRAFANA_LOKI_ENDPOINT=logs-prod-036.grafana.net/loki/api/v1/push\nLOKI_USER=1\nLOKI_TOKEN=t\nLOKI_ENV=development|develop\nLOKI_SERVICE=CreditopDev\n"), 0o600)
	wd, _ := os.Getwd()
	defer os.Chdir(wd)
	os.Chdir(root)
	c, _, err := LoadConfig("qa")
	if err != nil {
		t.Fatal(err)
	}
	if c.URL != "https://logs-prod-036.grafana.net" || c.Env != "development|develop" || c.Service != "CreditopDev" || c.Missing() != "" {
		t.Errorf("config = %+v", c)
	}
}
