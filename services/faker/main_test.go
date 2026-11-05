package main

import (
	"encoding/json"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// Las personas son inventadas y no traen nada que pueda ser de alguien: ni cédula, ni celular, y el correo es de
// example.com, sin tildes.
func TestPersonas(t *testing.T) {
	srv := httptest.NewServer(handler(rand.New(rand.NewSource(1))))
	defer srv.Close()

	res, err := http.Get(srv.URL + "/personas?n=20")
	if err != nil {
		t.Fatal(err)
	}
	var list []map[string]string
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 20 {
		t.Fatalf("pedí 20, llegaron %d", len(list))
	}
	mail := regexp.MustCompile(`^[a-z]+\.[a-z]+\.\d{3}@example\.com$`)
	for _, p := range list {
		if len(p) != 4 || p["nombres"] == "" || len(strings.Fields(p["apellidos"])) != 2 || p["ciudad"] == "" {
			t.Errorf("persona incompleta o con campos de más: %v", p)
		}
		if names := strings.Fields(p["nombres"]); len(names) == 2 && (contains(femaleNames, names[0]) != contains(femaleNames, names[1])) {
			t.Errorf("mezcla nombres de mujer y de hombre: %q", p["nombres"])
		}
		if !mail.MatchString(p["correo"]) {
			t.Errorf("correo raro: %q", p["correo"])
		}
	}

	res, _ = http.Get(srv.URL + "/personas?n=999")
	_ = json.NewDecoder(res.Body).Decode(&list)
	if len(list) != 50 {
		t.Errorf("el tope es 50, llegaron %d", len(list))
	}
}

// El esquema declara justo las rutas que el servicio contesta, y /health dice que está vivo.
func TestSchemaAndHealth(t *testing.T) {
	srv := httptest.NewServer(handler(rand.New(rand.NewSource(1))))
	defer srv.Close()

	var doc struct {
		OpenAPI string                    `json:"openapi"`
		Paths   map[string]map[string]any `json:"paths"`
	}
	res, err := http.Get(srv.URL + "/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewDecoder(res.Body).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(doc.OpenAPI, "3.1") {
		t.Errorf("openapi = %q", doc.OpenAPI)
	}
	for path := range doc.Paths {
		res, err := http.Get(srv.URL + path)
		if err != nil || res.StatusCode != http.StatusOK {
			t.Errorf("el esquema declara GET %s y no contesta 200 (%v)", path, err)
		}
	}
	if len(doc.Paths) != 3 {
		t.Errorf("esperaba 3 rutas, el esquema trae %d", len(doc.Paths))
	}

	var health map[string]string
	res, _ = http.Get(srv.URL + "/health")
	_ = json.NewDecoder(res.Body).Decode(&health)
	if health["status"] != "ok" || health["desde"] == "" {
		t.Errorf("health = %v", health)
	}
}

// Con la misma X-Semilla salen las mismas personas; una semilla que no es entero se rechaza.
func TestSeed(t *testing.T) {
	srv := httptest.NewServer(handler(rand.New(rand.NewSource(1))))
	defer srv.Close()
	get := func(seed string) (int, string) {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/personas?n=3", nil)
		if seed != "" {
			req.Header.Set("X-Semilla", seed)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var b strings.Builder
		_, _ = io.Copy(&b, res.Body)
		return res.StatusCode, b.String()
	}
	_, a := get("42")
	_, b := get("42")
	_, c := get("7")
	if a != b {
		t.Errorf("la misma semilla dio personas distintas:\n%s\n%s", a, b)
	}
	if a == c {
		t.Errorf("semillas distintas dieron lo mismo")
	}
	if code, _ := get("cuarenta"); code != http.StatusBadRequest {
		t.Errorf("semilla inválida: %d", code)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
