package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"creditop/my-tools/lib/vault"
)

func server(t *testing.T) (*httptest.Server, vault.Paths) {
	dir := t.TempDir()
	p := vault.Paths{File: filepath.Join(dir, "vault.json"), Key: filepath.Join(dir, "key")}
	return httptest.NewServer(guard(routes(p))), p
}

func call(t *testing.T, s *httptest.Server, method, path, body string, header bool) (int, map[string]any) {
	req, _ := http.NewRequest(method, s.URL+path, strings.NewReader(body))
	if header {
		req.Header.Set("X-Vault", "1")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// Sin el encabezado, o con otro Host (una página que se hace pasar por localhost), no se contesta.
func TestGuard(t *testing.T) {
	s, p := server(t)
	defer s.Close()
	if _, err := p.CreateRing("R"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.SetKey("R", "K", "secreto"); err != nil {
		t.Fatal(err)
	}
	if code, _ := call(t, s, "POST", "/api/rings/R/keys/K/reveal", "", false); code != 403 {
		t.Fatalf("sin encabezado: %d", code)
	}
	req, _ := http.NewRequest("POST", s.URL+"/api/rings/R/keys/K/reveal", nil)
	req.Header.Set("X-Vault", "1")
	req.Host = "evil.example:5237"
	res, _ := http.DefaultClient.Do(req)
	if res.StatusCode != 403 {
		t.Fatalf("otro Host: %d", res.StatusCode)
	}
	code, out := call(t, s, "POST", "/api/rings/R/keys/K/reveal", "", true)
	if code != 200 || out["value"] != "secreto" {
		t.Fatalf("%d %v", code, out)
	}
}

func TestRingsAPI(t *testing.T) {
	s, _ := server(t)
	defer s.Close()
	if code, _ := call(t, s, "POST", "/api/rings", `{"name":"Ambiente · qa"}`, true); code != 200 {
		t.Fatal(code)
	}
	if code, _ := call(t, s, "POST", "/api/rings/ambiente-qa/keys", `{"name":"db pass","value":"x"}`, true); code != 200 {
		t.Fatal(code)
	}
	code, out := call(t, s, "GET", "/api/rings", "", true)
	rings := out["rings"].([]any)
	if code != 200 || len(rings) != 1 {
		t.Fatalf("%d %v", code, out)
	}
	keys := rings[0].(map[string]any)["keys"].([]any)
	if k := keys[0].(map[string]any); k["name"] != "DB_PASS" || k["print"] == "" || k["sealed"] != nil {
		t.Fatalf("%v", k)
	}
	if code, _ := call(t, s, "DELETE", "/api/rings/ambiente-qa", "", true); code != 400 {
		t.Fatal("borró un llavero con llaves sin force")
	}
	if code, _ := call(t, s, "DELETE", "/api/rings/ambiente-qa?force=1", "", true); code != 200 {
		t.Fatal(code)
	}
}
