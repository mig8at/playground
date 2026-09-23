package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConfigEntregaURLsDeHerramientas(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	response := httptest.NewRecorder()
	(&app{canonURL: "https://canon.test", tracerURL: "https://tracer.test", harnessURL: "http://harness.test"}).config(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		CanonURL   string `json:"canonUrl"`
		TracerURL  string `json:"tracerUrl"`
		HarnessURL string `json:"harnessUrl"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.CanonURL != "https://canon.test" || body.TracerURL != "https://tracer.test" || body.HarnessURL != "http://harness.test" {
		t.Fatalf("config = %+v", body)
	}
}

func TestCanonReferencesEntregaMetadatosSinCopiarContenido(t *testing.T) {
	canon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/read" || r.URL.Query().Get("ids") != "listado/context" {
			t.Fatalf("consulta inesperada: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"nodes":[{"id":"listado/context","title":"El listado","summary":"Cómo se arma.","areas":[],"repos":{}}]}`))
	}))
	defer canon.Close()

	request := httptest.NewRequest(http.MethodGet, "/api/canon/references?ids=listado", nil)
	response := httptest.NewRecorder()
	(&app{canonURL: canon.URL}).canonReferences(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		CanonURL   string `json:"canonUrl"`
		References []struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			Summary string `json:"summary"`
		} `json:"references"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.CanonURL != canon.URL || len(body.References) != 1 || body.References[0].ID != "listado/context" || body.References[0].Title != "El listado" {
		t.Fatalf("respuesta = %+v", body)
	}
}

func TestCanonReferencesRequiereIDs(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/canon/references", nil)
	response := httptest.NewRecorder()
	(&app{}).canonReferences(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, quería 400", response.Code)
	}
}
