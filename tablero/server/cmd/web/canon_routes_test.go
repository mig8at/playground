package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"creditop/playground/connectors/canon"
)

func TestCanonRouteHTTP(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"etag":"one","mapa":{"stations":[{"id":"a"}],"rails":[]},"flows":{"x/context":{"titulo":"X","rutas":[{"id":"v","titulo":"V","pasos":["p"]}],"estaciones":[{"id":"p","titulo":"Paso","estacion_global":"a"}]}}}`))
	}))
	defer server.Close()
	a := &app{canonClient: canon.New(server.URL)}
	for _, tc := range []struct {
		method, ref string
		status      int
	}{
		{"GET", "x/v%23p", 200}, {"GET", "x/v%23missing", 404}, {"GET", "x", 400}, {"POST", "x/v", 405},
	} {
		w := httptest.NewRecorder()
		a.canonRoute(w, httptest.NewRequest(tc.method, "/api/canon/route?ref="+tc.ref, nil))
		if w.Code != tc.status {
			t.Errorf("%s %s: %d %s", tc.method, tc.ref, w.Code, w.Body.String())
		}
	}
}
