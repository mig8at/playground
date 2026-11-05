package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Un servicio con la convención devuelve esquema y salud; uno sin ella dice qué le falta, sin romper.
func TestReadSchema(t *testing.T) {
	full := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/openapi.json":
			_, _ = w.Write([]byte(`{"openapi":"3.1.0","paths":{"/x":{"get":{}}}}`))
		case "/health":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer full.Close()
	got := readSchema(context.Background(), full.URL)
	if got["schemaError"] != "" || got["healthError"] != "" || got["schema"] == nil {
		t.Errorf("con la convención: %v", got)
	}

	bare := httptest.NewServer(http.NotFoundHandler())
	defer bare.Close()
	got = readSchema(context.Background(), bare.URL)
	if got["schemaError"] != "no tiene /openapi.json" || got["healthError"] != "no tiene /health" {
		t.Errorf("sin la convención: %v", got)
	}

	got = readSchema(context.Background(), "http://127.0.0.1:1")
	if got["schemaError"] != "no contesta: prendelo primero" {
		t.Errorf("apagado: %v", got)
	}
}
