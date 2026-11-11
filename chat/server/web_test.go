package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGuard(t *testing.T) {
	ok := guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	cases := []struct {
		name, method, host, origin string
		want                       int
	}{
		{"la interfaz por Vite", "POST", "localhost:5184", "http://localhost:5184", 200},
		{"la app de escritorio", "POST", "127.0.0.1:5185", "http://127.0.0.1:5185", 200},
		{"bin/chat, sin Origin", "POST", "127.0.0.1:5185", "", 200},
		{"una página cualquiera manda", "POST", "127.0.0.1:5185", "https://evil.example", 403},
		{"una página cualquiera lee", "GET", "127.0.0.1:5185", "https://evil.example", 200},
		{"DNS rebinding", "GET", "evil.example:5185", "", 403},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, "/api/send", nil)
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		w := httptest.NewRecorder()
		ok.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s: %d, quería %d", c.name, w.Code, c.want)
		}
	}
}
