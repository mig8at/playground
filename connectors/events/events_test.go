package events

// No persiguen cobertura: cada una fija una regla que ya dio, o podía dar, una respuesta equivocada.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Los ambientes que no escriben lo dicen, y un token de escritura o un ambiente vacío no se consultan.
func TestMissingSaysWhyAnEnvironmentCannotBeRead(t *testing.T) {
	ok := Config{Target: "qa", Token: "phx_x", Env: "staging", Project: "238530"}
	if why := ok.Missing(); why != "" {
		t.Errorf("qa con todo tenía que poder leerse; dio %q", why)
	}
	for _, c := range []struct {
		cfg  Config
		want string
	}{
		{Config{Target: "local", Token: "phx_x", Env: "x"}, "front local"},
		{Config{Target: "dev", Token: "phx_x", Env: "dev"}, "front LOCAL"},
		{Config{Target: "prod", Token: "phc_escritura", Env: "production"}, "phx_"},
		{Config{Target: "prod", Env: "production"}, "falta POSTHOG_TOKEN"},
		{Config{Target: "prod", Token: "phx_x"}, "homónima de prod"},
	} {
		if why := c.cfg.Missing(); !strings.Contains(why, c.want) {
			t.Errorf("%+v: quería %q, dio %q", c.cfg, c.want, why)
		}
	}
}

func TestTheIngestionHostBecomesTheReadAPI(t *testing.T) {
	for in, want := range map[string]string{
		"us.i.posthog.com":                 "https://us.posthog.com",
		"https://us.i.posthog.com/decide/": "https://us.posthog.com",
		"https://eu.posthog.com/api/x":     "https://eu.posthog.com",
	} {
		if got := NormalizeAPI(in); got != want {
			t.Errorf("NormalizeAPI(%q) = %q, quería %q", in, got, want)
		}
	}
}

// El filtro tolerante acepta los eventos sin ambiente ($pageview, $identify): sin eso, el recorrido de una
// solicitud perdía justo lo que uno viene a ver. Y una comilla no rompe la consulta.
func TestEnvironmentFilters(t *testing.T) {
	c := Config{Env: "o'hara"}
	if c.EnvFilter() != ` AND properties.environment = 'o\'hara'` {
		t.Errorf("estricto = %s", c.EnvFilter())
	}
	if !strings.Contains(c.EnvFilterTolerant(), "IS NULL") {
		t.Errorf("tolerante = %s", c.EnvFilterTolerant())
	}
	if (Config{}).EnvFilter() != "" {
		t.Error("sin ambiente no hay filtro")
	}
}

func TestHogQLSendsTheQueryAndReadsColumns(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/projects/238530/query/" || r.Header.Get("Authorization") != "Bearer phx_x" {
			t.Errorf("pedido %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		var body struct {
			Query struct{ Kind, Query string } `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Query.Kind != "HogQLQuery" || !strings.HasPrefix(body.Query.Query, "SELECT") {
			t.Errorf("body = %+v", body)
		}
		_, _ = w.Write([]byte(`{"columns":["event"],"results":[["auth_otp_result"]]}`))
	}))
	defer server.Close()
	cols, rows, err := New(Config{API: server.URL, Token: "phx_x", Project: "238530"}, time.Second).HogQL("SELECT event FROM events")
	if err != nil || len(cols) != 1 || rows[0][0] != "auth_otp_result" {
		t.Errorf("cols=%v rows=%v err=%v", cols, rows, err)
	}
}

func TestLoadConfigReadsTheConnectorsFile(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "connectors", "env"), 0o755)
	os.WriteFile(filepath.Join(root, "connectors", ".env.qa"),
		[]byte("VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com\nPOSTHOG_TOKEN=phx_x\nPOSTHOG_PROJECT_ID=238530\nPOSTHOG_ENV=staging\n"), 0o600)
	wd, _ := os.Getwd()
	defer os.Chdir(wd)
	os.Chdir(root)
	c, _, err := LoadConfig("qa")
	if err != nil || c.API != "https://us.posthog.com" || c.Project != "238530" || c.Missing() != "" {
		t.Errorf("config = %+v, err %v", c, err)
	}
}

// Un cliente de PostHog fuera de `connectors/` es cómo empezó la deriva: el trazador y el harness tenían
// cada uno el suyo, y las reglas de qué ambiente no escribe sólo las sabía uno.
func TestNoOtherPostHogClientInTheRepo(t *testing.T) {
	root, _ := filepath.Abs("../..")
	out, err := exec.Command("git", "-C", root, "ls-files", "-co", "--exclude-standard").Output()
	if err != nil {
		t.Fatal(err)
	}
	code := regexp.MustCompile(`\.(go|ts|mjs|js|py)$`)
	comment := regexp.MustCompile(`^\s*(//|#|\*|/\*)`)
	client := regexp.MustCompile(`posthog\.com/api|/api/projects/|/query/`)
	var offenders []string
	scanned := 0
	for _, rel := range strings.Split(string(out), "\n") {
		if !code.MatchString(rel) || strings.HasPrefix(rel, "connectors/") || strings.Contains(rel, "node_modules/") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			continue
		}
		scanned++
		for i, line := range strings.Split(string(raw), "\n") {
			if client.MatchString(line) && !comment.MatchString(line) {
				offenders = append(offenders, rel+":"+strconv.Itoa(i+1))
			}
		}
	}
	if scanned < 100 {
		t.Fatalf("sólo recorrí %d archivos", scanned)
	}
	if len(offenders) > 0 {
		t.Errorf("hay clientes de PostHog fuera de connectors/ (usá connectors/events, o `bin/pg events`): %v", offenders)
	}
}
