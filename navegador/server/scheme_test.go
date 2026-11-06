package main

import "testing"

func TestWithScheme(t *testing.T) {
	for in, want := range map[string]string{
		"g.co/sc":          "https://g.co/sc",
		"127.0.0.1:5217/":  "http://127.0.0.1:5217/",
		"localhost:5206":   "http://localhost:5206",
		"http://x.com":     "http://x.com",
		"grafana.algo.com": "https://grafana.algo.com",
	} {
		if got := withScheme(in); got != want {
			t.Errorf("%q: %q, se esperaba %q", in, got, want)
		}
	}
}
