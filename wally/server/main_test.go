package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Borrar un bloque lo saca de lo guardado y, con eso, del contexto que viaja en la próxima pregunta: AI Studio no
// recuerda nada (chat temporal), así que lo que queda guardado ES la conversación.
func TestRemovingABlockTakesItOutOfTheNextQuestion(t *testing.T) {
	st := &store{file: filepath.Join(t.TempDir(), "conversations.json"), convs: map[string]*Conversation{}}
	now := time.Now()
	st.convs["c1"] = &Conversation{ID: "c1", Title: "colores", Messages: []Message{
		{ID: "u1", Role: "user", Text: "Nombrá tres colores primarios", At: now},
		{ID: "m1", Role: "model", Text: "Rojo, amarillo, azul", At: now},
		{ID: "u2", Role: "user", Text: "Ahora decime un número del uno al diez", At: now},
		{ID: "m2", Role: "model", Text: "Siete", At: now},
	}}
	a := &app{store: st}
	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/conversations/{id}/messages/{mid}", a.removeMessage)

	for _, mid := range []string{"u2", "m2"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("DELETE", "/api/conversations/c1/messages/"+mid, nil))
		if rec.Code != 200 {
			t.Fatalf("borrar %s: %d %s", mid, rec.Code, rec.Body)
		}
	}
	var got Conversation
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("DELETE", "/api/conversations/c1/messages/nada", nil))
	if rec.Code != 404 {
		t.Errorf("un bloque que no existe tenía que dar 404, dio %d", rec.Code)
	}
	got = *st.convs["c1"]
	if len(got.Messages) != 2 || got.Messages[1].ID != "m1" {
		t.Fatalf("quedaron %v", got.Messages)
	}

	// Lo guardado en disco también.
	reload := &store{file: st.file}
	if err := reload.load(); err != nil {
		t.Fatal(err)
	}
	if n := len(reload.convs["c1"].Messages); n != 2 {
		t.Errorf("en disco quedaron %d bloques", n)
	}

	// Y el texto de la próxima pregunta lleva sólo lo que quedó, con la pregunta nueva al final.
	text := transcript(got.Messages, "¿Cuál es el más cálido?")
	for _, want := range []string{"tres colores primarios", "Rojo, amarillo, azul", "¿Cuál es el más cálido?"} {
		if !strings.Contains(text, want) {
			t.Errorf("falta %q en:\n%s", want, text)
		}
	}
	for _, gone := range []string{"número del uno al diez", "Siete"} {
		if strings.Contains(text, gone) {
			t.Errorf("el bloque borrado %q siguió viajando", gone)
		}
	}
	if transcript(nil, "hola") != "hola" {
		t.Error("sin historia, la pregunta tiene que ir sola")
	}
}

// Los bloques guardados antes de que se pudieran borrar no tenían id: al cargar se les pone uno y se guarda.
func TestOldBlocksGetAnIDOnLoad(t *testing.T) {
	file := filepath.Join(t.TempDir(), "conversations.json")
	old := []*Conversation{{ID: "c1", Messages: []Message{{Role: "user", Text: "hola"}, {Role: "model", Text: "qué tal"}}}}
	st := &store{file: file, convs: map[string]*Conversation{"c1": old[0]}}
	if err := st.save(); err != nil {
		t.Fatal(err)
	}
	loaded := &store{file: file}
	if err := loaded.load(); err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, m := range loaded.convs["c1"].Messages {
		if m.ID == "" || ids[m.ID] {
			t.Fatalf("id vacío o repetido: %+v", loaded.convs["c1"].Messages)
		}
		ids[m.ID] = true
	}
	raw, _ := json.Marshal(loaded.convs["c1"])
	if !strings.Contains(string(raw), `"id":`) {
		t.Error("el id no se guarda")
	}
}
