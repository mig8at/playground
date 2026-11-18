package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
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
	text := transcript(got.Messages, "¿Cuál es el más cálido?", nil, nil)
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
	if transcript(nil, "hola", nil, nil) != "hola" {
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

// upload hace lo que hace la interfaz: un multipart con el campo «file».
func upload(t *testing.T, mux *http.ServeMux, name string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, _ := mw.CreateFormFile("file", name)
	part.Write(content)
	mw.Close()
	req := httptest.NewRequest("POST", "/api/files", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// Un archivo de texto se guarda con su ficha y viaja en la pregunta, delimitado con su nombre; un binario se rechaza
// (subirlo a AI Studio lo dejaría en Drive); y borrar el bloque que lo trajo lo borra del disco.
func TestAFileTravelsInTheQuestionAndGoesAwayWithItsBlock(t *testing.T) {
	root := t.TempDir()
	st := &store{file: filepath.Join(root, "wally", ".data", "conversations.json"), convs: map[string]*Conversation{}}
	a := &app{store: st, root: root}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/files", a.upload)
	mux.HandleFunc("GET /api/files/{id}", a.readFile)
	mux.HandleFunc("DELETE /api/conversations/{id}/messages/{mid}", a.removeMessage)

	rec := upload(t, mux, "errores.log", []byte("2026-11-17 ERROR timeout en Experian\r\n2026-11-17 ERROR timeout en Experian\n"))
	if rec.Code != 200 {
		t.Fatalf("subir: %d %s", rec.Code, rec.Body)
	}
	var att Attachment
	json.Unmarshal(rec.Body.Bytes(), &att)
	if att.Kind != "texto" || att.Chars == 0 || att.Name != "errores.log" {
		t.Fatalf("ficha: %+v", att)
	}
	read := httptest.NewRecorder()
	mux.ServeHTTP(read, httptest.NewRequest("GET", "/api/files/"+att.ID, nil))
	if !strings.Contains(read.Body.String(), "timeout en Experian") || strings.Contains(read.Body.String(), "\r") {
		t.Errorf("el texto guardado: %q", read.Body.String())
	}

	if rec := upload(t, mux, "foto.png", []byte{0x89, 'P', 'N', 'G', 0, 0, 0, 0x0d, 0, 1, 2, 3}); rec.Code != 415 {
		t.Errorf("un binario tenía que rechazarse con 415, dio %d %s", rec.Code, rec.Body)
	}

	// En la pregunta: el texto del archivo, delimitado; en la conversación, sólo su ficha.
	text := transcript(nil, "¿Qué error se repite?", []Attachment{att}, a.fileText)
	for _, want := range []string{"¿Qué error se repite?", "archivo adjunto: «errores.log»", "timeout en Experian", "fin de «errores.log»"} {
		if !strings.Contains(text, want) {
			t.Errorf("falta %q en:\n%s", want, text)
		}
	}
	st.convs["c1"] = &Conversation{ID: "c1", Messages: []Message{
		{ID: "u1", Role: "user", Text: "¿Qué error se repite?", Files: []Attachment{att}},
		{ID: "m1", Role: "model", Text: "El timeout de Experian."},
	}}
	follow := transcript(st.convs["c1"].Messages, "¿Y cuántas veces?", nil, a.fileText)
	if !strings.Contains(follow, "timeout en Experian\n2026-11-17") {
		t.Errorf("el archivo de una pregunta anterior tiene que seguir viajando:\n%s", follow)
	}

	del := httptest.NewRecorder()
	mux.ServeHTTP(del, httptest.NewRequest("DELETE", "/api/conversations/c1/messages/u1", nil))
	if del.Code != 200 {
		t.Fatalf("borrar el bloque: %d", del.Code)
	}
	if _, err := os.Stat(filepath.Join(a.filesDir(), att.ID+".txt")); !os.IsNotExist(err) {
		t.Error("el archivo tenía que borrarse con su bloque")
	}
	if strings.Contains(transcript(st.convs["c1"].Messages, "x", nil, a.fileText), "Experian\n2026") {
		t.Error("el archivo borrado siguió viajando")
	}
}

// Un chat de proveedor sigue sólo si tiene exactamente lo que Wally guarda; lo nuevo son las salidas que llegaron
// después de su respuesta y la pregunta de ahora.
func TestProviderChatContinuesOnlyWithTheSameBlocks(t *testing.T) {
	out := &Attachment{ID: "o1", Name: "salida: trampas", Kind: "salida"}
	history := []Message{
		{ID: "u1", Role: "user", Text: "hola"},
		{ID: "m1", Role: "model", Text: "pido", Commands: []Command{{Cmd: "trampas", Status: "corrido", Output: out}, {Cmd: "rm -rf", Status: "no-permitido"}}},
	}
	pc := &ProviderChat{URL: "https://x/1", Base: "b", Sent: []string{"u1", "m1"}}
	if !pc.canContinue("b", history) {
		t.Fatal("con los mismos bloques y la misma base tiene que seguir")
	}
	if pc.canContinue("otra", history) {
		t.Error("con otra base (WALLY.md o la precarga cambiaron) no sigue")
	}
	if pc.canContinue("b", history[1:]) {
		t.Error("con un bloque borrado no sigue")
	}
	read := func(id string) (string, error) { return "F-1 · algo", nil }
	got := delta(history, pc, "seguí", nil, read)
	if !strings.Contains(got, "F-1 · algo") || !strings.Contains(got, "no está en la lista") || !strings.HasSuffix(got, "seguí") || strings.Contains(got, "hola") {
		t.Errorf("delta: %q", got)
	}
	pc.Outputs = []string{"o1"}
	if got := delta(history[:1], &ProviderChat{Sent: []string{"u1"}}, "otra", nil, read); got != "otra" {
		t.Errorf("sin nada nuevo va sólo la pregunta: %q", got)
	}
}
