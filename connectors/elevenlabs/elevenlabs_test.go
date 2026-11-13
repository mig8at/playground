package elevenlabs

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fake contesta como la API de ElevenLabs y comprueba que la llave vaya en la cabecera, nunca en la URL.
func fake(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("xi-api-key") != "k" || r.URL.Query().Get("xi-api-key") != "" {
			t.Errorf("la llave tiene que ir en la cabecera xi-api-key: %s", r.URL)
		}
		h(w, r)
	}))
	t.Cleanup(server.Close)
	old := API
	API = server.URL
	t.Cleanup(func() { API = old })
	return New(Config{Key: "k", Model: DefaultModel})
}

const voicesJSON = `{"voices":[{"voice_id":"v2","name":"Laura","category":"premade","labels":{"gender":"female"}},
{"voice_id":"v1","name":"Adam - deep narrator","category":"premade","labels":{"gender":"male"}}]}`

func TestVoicesAndVoiceIDByNameOrID(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, voicesJSON) })
	voices, err := c.Voices()
	if err != nil || len(voices) != 2 || voices[0].Name != "Adam - deep narrator" {
		t.Fatalf("voces mal ordenadas o leídas: %+v %v", voices, err)
	}
	for in, want := range map[string]string{"Laura": "v2", "laura": "v2", "v1": "v1", "Adam": "v1"} {
		if got, err := c.VoiceID(in); err != nil || got != want {
			t.Errorf("VoiceID(%q) = %q, %v; esperaba %q", in, got, err, want)
		}
	}
	if _, err := c.VoiceID("Nadie"); err == nil {
		t.Error("una voz que no existe tiene que dar error")
	}
}

func TestSpeechSendsTextAndModel(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/text-to-speech/v2" || r.URL.Query().Get("output_format") != "mp3_44100_64" {
			t.Errorf("pedido inesperado: %s %s", r.Method, r.URL)
		}
		var b map[string]string
		_ = json.NewDecoder(r.Body).Decode(&b)
		if b["text"] != "Hola" || b["model_id"] != DefaultModel {
			t.Errorf("cuerpo inesperado: %v", b)
		}
		io.WriteString(w, "ID3audio")
	})
	audio, err := c.Speech("v2", "Hola")
	if err != nil || string(audio) != "ID3audio" {
		t.Fatalf("Speech = %q, %v", audio, err)
	}
}

func TestErrorsAreReadable(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		io.WriteString(w, `{"detail":{"status":"quota_exceeded","message":"This request exceeds your quota."}}`)
	})
	_, err := c.Speech("v2", "Hola")
	var e *Error
	if !errors.As(err, &e) || e.Status != 429 || !strings.Contains(e.Message, "exceeds your quota") {
		t.Fatalf("error ilegible: %v", err)
	}
}

func TestUsage(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"tier":"starter","character_count":1200,"character_limit":30000,"next_character_count_reset_unix":1790000000}`)
	})
	u, err := c.Usage()
	if err != nil || u.Used != 1200 || u.Limit != 30000 || u.Tier != "starter" {
		t.Fatalf("Usage = %+v, %v", u, err)
	}
}
