package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// La clave y el id terminan en una RUTA DE DISCO: cualquier cosa que no tenga su forma exacta se
// rechaza antes de tocar el sistema de archivos.
func TestScreenRejectsWhatIsNotAKeyAndANode(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.export = func(context.Context, string, []string) (map[string][]byte, error) {
		t.Fatal("no debería pedir nada a Figma")
		return nil, nil
	}
	for _, q := range []string{
		"key=../../etc&id=1:2", "key=SsvFsK5tLvR1jNT3Hh6znD&id=../x", "key=SsvFsK5tLvR1jNT3Hh6znD&id=1:2/../3",
		"key=corta&id=1:2", "key=SsvFsK5tLvR1jNT3Hh6znD&id=",
	} {
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/screen?"+q, nil))
		if rec.Code != 400 {
			t.Errorf("%s: HTTP %d, quería 400", q, rec.Code)
		}
	}
}

// Una imagen se baja UNA vez aunque la pidan varios a la vez (la UI y la tanda de fondo), y la
// segunda vez sale del disco.
func TestScreenDownloadsOnceAndServesFromDisk(t *testing.T) {
	s := newServer(nil, t.TempDir())
	var calls int32
	s.export = func(_ context.Context, key string, ids []string) (map[string][]byte, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(50 * time.Millisecond)
		out := map[string][]byte{}
		for _, id := range ids {
			out[id] = []byte("PNG-" + id)
		}
		return out, nil
	}
	s.versions["SsvFsK5tLvR1jNT3Hh6znD"] = "v1"
	get := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/screen?key=SsvFsK5tLvR1jNT3Hh6znD&id=334:2735", nil))
		return rec
	}
	done := make(chan *httptest.ResponseRecorder, 3)
	for i := 0; i < 3; i++ {
		go func() { done <- get() }()
	}
	for i := 0; i < 3; i++ {
		if rec := <-done; rec.Code != 200 || rec.Body.String() != "PNG-334:2735" {
			t.Fatalf("respuesta %d: %q", rec.Code, rec.Body.String())
		}
	}
	if calls != 1 {
		t.Errorf("tres pedidos a la vez tienen que bajar una sola vez; bajaron %d", calls)
	}
	if rec := get(); rec.Code != 200 || calls != 1 {
		t.Errorf("la cuarta sale del disco: HTTP %d, bajadas %d", rec.Code, calls)
	}
	if _, err := os.Stat(s.imagePath("SsvFsK5tLvR1jNT3Hh6znD", "v1", "334:2735")); err != nil {
		t.Errorf("no quedó en disco: %v", err)
	}
	if !strings.Contains(s.imagePath("SsvFsK5tLvR1jNT3Hh6znD", "v2", "334:2735"), "v2") {
		t.Error("otra versión del archivo va a otra ruta: la imagen vieja no se sirve después de un cambio")
	}
}

// Una pantalla que Figma no pudo exportar es un error visible, no una imagen vacía guardada.
func TestAnEmptyExportIsAnError(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.export = func(context.Context, string, []string) (map[string][]byte, error) {
		return map[string][]byte{}, nil
	}
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/screen?key=SsvFsK5tLvR1jNT3Hh6znD&id=1:2", nil))
	if rec.Code == http.StatusOK {
		t.Fatal("una exportación vacía no puede servirse como imagen")
	}
	if _, err := os.Stat(s.imagePath("SsvFsK5tLvR1jNT3Hh6znD", "", "1:2")); err == nil {
		t.Error("una exportación vacía no puede quedar en disco")
	}
}

// Abrir un archivo lo anota una vez (y actualiza cuándo), y se puede sacar: la biblioteca es una
// preferencia de esta máquina y no crece con cada apertura.
func TestLibraryRemembersOpenedFilesOnce(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.library.opened("SsvFsK5tLvR1jNT3Hh6znD", "flujo ecommerce")
	s.library.opened("SsvFsK5tLvR1jNT3Hh6znD", "flujo ecommerce v2")
	s.library.opened("AbCdEf1234567", "alta")
	lib := s.library.read()
	if len(lib.Opened) != 2 || lib.Opened[0].Name != "flujo ecommerce v2" {
		t.Fatalf("abiertos: %+v", lib.Opened)
	}
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest("DELETE", "/api/library?file=AbCdEf1234567", nil))
	if rec.Code != 200 || len(s.library.read().Opened) != 1 {
		t.Errorf("sacar un archivo: HTTP %d, quedan %+v", rec.Code, s.library.read().Opened)
	}
	rec = httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest("POST", "/api/library", strings.NewReader(`{}`)))
	if rec.Code != 400 {
		t.Errorf("sin url no se suma nada: HTTP %d", rec.Code)
	}
}
