package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"creditop/playground/chat/cli"
)

func msg(id, dir, text string) cli.Message {
	return cli.Message{ID: id, Dir: dir, Text: text, Time: "2026-11-09T20:00:00Z", From: cli.Person{Email: "duncan@creditop.com"}}
}

// Lo que pasa por el listen se guarda una vez y sobrevive a reabrir (reiniciar el servidor); una línea cortada se salta.
func TestHistoryKeepsMessagesOnceAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	h, _ := openHistory(dir)
	fresh, err := h.add([]cli.Message{msg("a1", "in", "hola"), msg("a2", "in", "chao")})
	if err != nil || len(fresh) != 2 {
		t.Fatalf("primera vez: %d nuevos, %v", len(fresh), err)
	}
	// El listen devuelve otra vez lo mismo más uno nuevo: sólo el nuevo se guarda.
	fresh, _ = h.add([]cli.Message{msg("a1", "in", "hola"), msg("a2", "in", "chao"), msg("a3", "in", "otra")})
	if len(fresh) != 1 || fresh[0].ID != "a3" {
		t.Fatalf("segunda vez: %+v", fresh)
	}
	// Un apagón a mitad de escribir deja una línea cortada.
	f, _ := os.OpenFile(filepath.Join(dir, "messages.jsonl"), os.O_APPEND|os.O_WRONLY, 0o600)
	_, _ = f.WriteString(`{"id":"cortad`)
	f.Close()
	again, _ := openHistory(dir)
	if got := again.all(); len(got) != 3 || got[2].Text != "otra" {
		t.Fatalf("después de reabrir: %+v", got)
	}
	// Un mandado y un recibido con el mismo id del home son dos mensajes distintos.
	if fresh, _ := again.add([]cli.Message{msg("a1", "out", "mío")}); len(fresh) != 1 {
		t.Fatalf("el mandado con el mismo id no se guardó")
	}
}

// Un adjunto bajado se recuerda entre reinicios, pero sólo si el archivo sigue ahí.
func TestHistoryRemembersDownloadedFiles(t *testing.T) {
	dir := t.TempDir()
	h, _ := openHistory(dir)
	img := filepath.Join(dir, "foto.jpg")
	_ = os.WriteFile(img, []byte("x"), 0o600)
	h.rememberFile("f1", img)
	h.rememberFile("f2", filepath.Join(dir, "no-existe.jpg"))
	again, _ := openHistory(dir)
	if p, ok := again.savedFile("f1"); !ok || p != img {
		t.Fatalf("f1: %q %v", p, ok)
	}
	if _, ok := again.savedFile("f2"); ok {
		t.Fatalf("f2 no está en disco: no debería darse por bajado")
	}
}

// La copia de las conversaciones: {} si no hay, se reemplaza entera y rechaza lo que no es un objeto.
func TestConversationsCopy(t *testing.T) {
	prev := chatHistory
	defer func() { chatHistory = prev }()
	chatHistory, _ = openHistory(t.TempDir())
	mux := http.NewServeMux()
	historyHandlers(mux)
	call := func(method, body string) (int, string) {
		r := httptest.NewRequest(method, "/api/conversations", strings.NewReader(body))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	if code, body := call("GET", ""); code != 200 || body != "{}" {
		t.Fatalf("vacío: %d %s", code, body)
	}
	if code, _ := call("PUT", `{"duncan@creditop.com":{"messages":[]}}`); code != 200 {
		t.Fatalf("guardar: %d", code)
	}
	if code, body := call("GET", ""); code != 200 || !strings.Contains(body, "duncan@creditop.com") {
		t.Fatalf("leer: %d %s", code, body)
	}
	if code, _ := call("PUT", `[1,2]`); code != 400 {
		t.Fatalf("una lista tiene que ser 400, fue %d", code)
	}
}
