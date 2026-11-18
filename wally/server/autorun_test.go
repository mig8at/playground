package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func waitAuto(t *testing.T, a *app, id string) *autoState {
	t.Helper()
	for i := 0; i < 200; i++ {
		if st := a.autoView(id); st != nil && !st.Ended.IsZero() {
			return st
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("la corrida no terminó")
	return nil
}

// La corrida la lleva el servidor: arranca sin que nadie espere, corre los comandos propuestos (los de la lista), deja
// lo hecho guardado y termina con su porqué; no se pueden dos a la vez en la misma conversación; frenar una que no
// anda es un 409.
func TestAutoRunLivesInTheServer(t *testing.T) {
	root := t.TempDir()
	a := &app{root: filepath.Join("..", ".."), silent: true,
		store: &store{file: filepath.Join(root, "conv.json"), convs: map[string]*Conversation{}}}
	// Una respuesta que pidió un comando de la lista (ayuda lee wally/skills, sin red ni modelo).
	a.store.convs["c1"] = &Conversation{ID: "c1", Mode: "assistant", Messages: []Message{
		{ID: "u1", Role: "user", Text: "hola"},
		{ID: "m1", Role: "model", Text: "pido", Commands: []Command{{ID: "k1", Cmd: "help", Status: "proposed"}}},
	}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/conversations/c1/auto", strings.NewReader(`{"rounds":3}`))
	req.SetPathValue("id", "c1")
	a.startAuto(rec, req)
	if rec.Code != 202 {
		t.Fatalf("arrancar: %d %s", rec.Code, rec.Body.String())
	}
	// Una segunda, con la primera andando o recién terminada: si todavía anda, 409.
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/conversations/c1/auto", strings.NewReader(`{}`))
	req2.SetPathValue("id", "c1")
	a.startAuto(rec2, req2)
	st := waitAuto(t, a, "c1")
	if rec2.Code != 409 && rec2.Code != 202 {
		t.Errorf("la segunda: %d", rec2.Code)
	}
	// El comando se corrió y quedó guardado, aunque después la pregunta al modelo falle (acá no hay pool).
	if got := a.store.convs["c1"].Messages[1].Commands[0]; got.Status != "ran" || got.Output == nil {
		t.Errorf("el comando no quedó corrido: %+v", got)
	}
	if st.Stopped == "" || st.Round != 1 {
		t.Errorf("sin modelo tiene que terminar con su porqué, en la vuelta 1: %+v", st)
	}
	// Frenar una que no anda.
	rec3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodPost, "/api/conversations/c1/auto/stop", nil)
	req3.SetPathValue("id", "c1")
	a.stopAuto(rec3, req3)
	if rec3.Code != 409 {
		t.Errorf("frenar una que no anda: %d", rec3.Code)
	}
	// Una que ya contestó sin pedir nada y no escribió nada: termina bien, sin preguntar.
	a.store.convs["c2"] = &Conversation{ID: "c2", Messages: []Message{{ID: "u", Role: "user"}, {ID: "m", Role: "model", Text: "listo"}}}
	rec4 := httptest.NewRecorder()
	req4 := httptest.NewRequest(http.MethodPost, "/api/conversations/c2/auto", strings.NewReader(`{}`))
	req4.SetPathValue("id", "c2")
	a.startAuto(rec4, req4)
	if st := waitAuto(t, a, "c2"); st.Stopped != "" || st.Round != 0 {
		t.Errorf("sin nada pendiente: %+v", st)
	}
}
