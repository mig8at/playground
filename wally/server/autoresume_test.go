package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func autoApp(t *testing.T, ask func(ctx context.Context, job poolJob) (string, string, error)) *app {
	t.Helper()
	cfg := &configStore{file: filepath.Join(t.TempDir(), "none.json")}
	cfg.load()
	a := &app{root: filepath.Join("..", ".."), silent: true, config: cfg, testAsk: ask,
		store: &store{file: filepath.Join(t.TempDir(), "conv.json"), convs: map[string]*Conversation{}}}
	return a
}

func postAuto(t *testing.T, a *app, id, body string) int {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/conversations/"+id+"/auto", strings.NewReader(body))
	req.SetPathValue("id", id)
	a.startAuto(rec, req)
	return rec.Code
}

// Si el proveedor falla, la corrida reintenta; si igual no contesta, termina con la pregunta anotada, y «retomar»
// la vuelve a hacer tal cual. Una respuesta que llega borra lo anotado.
func TestAutoRetriesAndResumes(t *testing.T) {
	old := retryWaits
	retryWaits = []time.Duration{time.Millisecond, time.Millisecond}
	defer func() { retryWaits = old }()

	var calls atomic.Int32
	var failing atomic.Bool
	failing.Store(true)
	var lastText atomic.Value
	a := autoApp(t, func(ctx context.Context, job poolJob) (string, string, error) {
		calls.Add(1)
		lastText.Store(job.Text)
		if failing.Load() {
			return "", "", errors.New("la página no cargó")
		}
		return "listo, nada más", "", nil
	})
	a.store.convs["c"] = &Conversation{ID: "c", Mode: "assistant"}

	// Falla las tres veces (la primera y dos reintentos): termina, con la pregunta anotada.
	if code := postAuto(t, a, "c", `{"text":"armá algo"}`); code != 202 {
		t.Fatalf("arrancar: %d", code)
	}
	st := waitAuto(t, a, "c")
	if calls.Load() != 3 {
		t.Errorf("tenía que intentar 3 veces, intentó %d", calls.Load())
	}
	if !strings.Contains(st.Stopped, "se puede retomar") {
		t.Errorf("el porqué: %q", st.Stopped)
	}
	r := a.store.convs["c"].AutoResume
	if r == nil || r.Text != "armá algo" {
		t.Fatalf("no quedó anotada la pregunta: %+v", r)
	}

	// Retomar, ahora con el proveedor andando: hace ESA pregunta, termina bien y borra lo anotado.
	failing.Store(false)
	if code := postAuto(t, a, "c", `{"resume":true}`); code != 202 {
		t.Fatalf("retomar: %d", code)
	}
	st = waitAuto(t, a, "c")
	if st.Stopped != "" {
		t.Errorf("retomada tenía que terminar bien: %q", st.Stopped)
	}
	if !strings.Contains(lastText.Load().(string), "armá algo") {
		t.Errorf("no repitió la pregunta que quedó: %q", lastText.Load())
	}
	c := a.store.convs["c"]
	if c.AutoResume != nil || len(c.Messages) != 2 || c.Messages[0].Text != "armá algo" {
		t.Errorf("después de retomar: resume=%+v, %d mensajes", c.AutoResume, len(c.Messages))
	}
	// Sin nada anotado, retomar es un 409.
	if code := postAuto(t, a, "c", `{"resume":true}`); code != 409 {
		t.Errorf("retomar sin nada: %d", code)
	}
}

// Un reintento que contesta sigue la corrida como si nada.
func TestAutoRetrySucceeds(t *testing.T) {
	old := retryWaits
	retryWaits = []time.Duration{time.Millisecond, time.Millisecond}
	defer func() { retryWaits = old }()
	var calls atomic.Int32
	a := autoApp(t, func(ctx context.Context, job poolJob) (string, string, error) {
		if calls.Add(1) == 1 {
			return "", "", errors.New("se trabó el chat")
		}
		return "hecho", "", nil
	})
	a.store.convs["c"] = &Conversation{ID: "c", Mode: "assistant"}
	postAuto(t, a, "c", `{"text":"hola"}`)
	if st := waitAuto(t, a, "c"); st.Stopped != "" || calls.Load() != 2 || a.store.convs["c"].AutoResume != nil {
		t.Errorf("stopped=%q llamadas=%d resume=%+v", st.Stopped, calls.Load(), a.store.convs["c"].AutoResume)
	}
}

// Una corrida retomada revisa lo que escribió la cortada: empieza en el último pedido de Miguel.
func TestResumedRunStartsAtTheLastRequest(t *testing.T) {
	msgs := []Message{
		{Role: "user", Text: "En cuota: agregá 48 meses"},
		{Role: "model", Commands: []Command{{Cmd: "patch sandbox/cuota/index.html", Status: "ran"}}},
	}
	if i := lastRequestIndex(msgs); i != 0 || lastWrittenProject(msgs, i) != "cuota" {
		t.Errorf("desde %d: %q", i, lastWrittenProject(msgs, i))
	}
	msgs = append(msgs, Message{Role: "user", Text: "Listo: corrí el comando (la salida va arriba). Seguí."})
	if i := lastRequestIndex(msgs); i != 0 {
		t.Errorf("una vuelta automática no es un pedido: %d", i)
	}
}
