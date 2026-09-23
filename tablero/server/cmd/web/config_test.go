package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConfigDeliversToolURLs(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	response := httptest.NewRecorder()
	(&app{canonURL: "https://canon.test", tracerURL: "https://tracer.test"}).config(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	var body configResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.CanonURL != "https://canon.test" || body.TracerURL != "https://tracer.test" || body.Repos == nil {
		t.Fatalf("config = %+v", body)
	}
}
