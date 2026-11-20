package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// La API de práctica: crear le pone id, la lista los devuelve en orden, PUT reemplaza conservando el id y DELETE borra.
func TestPracticeAPI(t *testing.T) {
	p := newPracticeAPI()
	do := func(method, path, body string) (int, string) {
		w := httptest.NewRecorder()
		p.ServeHTTP(w, httptest.NewRequest(method, path, strings.NewReader(body)))
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	if code, b := do(http.MethodPost, "/api/products", `{"name":"Casco","price":350000}`); code != 201 || !strings.Contains(b, `"id":1`) {
		t.Fatalf("crear: %d %s", code, b)
	}
	_, _ = do(http.MethodPost, "/api/products", `{"name":"Guantes"}`)
	if _, b := do(http.MethodGet, "/api/products", ""); !strings.Contains(b, "Casco") || strings.Index(b, "Casco") > strings.Index(b, "Guantes") {
		t.Fatalf("lista en orden: %s", b)
	}
	if code, b := do(http.MethodPut, "/api/products/1", `{"name":"Casco urbano"}`); code != 200 || !strings.Contains(b, `"id":1`) {
		t.Fatalf("reemplazar: %d %s", code, b)
	}
	if code, _ := do(http.MethodDelete, "/api/products/2", ""); code != 200 {
		t.Fatalf("borrar: %d", code)
	}
	if code, _ := do(http.MethodGet, "/api/products/2", ""); code != 404 {
		t.Fatal("borrado no tendría que estar")
	}
	if code, _ := do(http.MethodPost, "/api/products", `no es json`); code != 400 {
		t.Fatal("un cuerpo que no es JSON tiene que negarse")
	}
}
