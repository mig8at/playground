package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Sin perfil, un sitio trabaja de fondo; `front` lo trae; «seguir» trae todos; borrar el perfil vuelve a fondo. Y lo
// que se guarda se vuelve a leer igual (otro proceso, el mismo archivo).
func TestFocusStoreDecides(t *testing.T) {
	path := filepath.Join(t.TempDir(), "focus.json")
	s := &FocusStore{path: path}
	if s.WantsFront("admin.shopify.com") {
		t.Fatal("un sitio sin perfil tendría que trabajar de fondo")
	}
	if err := s.Set("admin.shopify.com", &FocusProfile{Mode: focusFront, Source: "manual"}); err != nil {
		t.Fatal(err)
	}
	if !s.WantsFront("admin.shopify.com") || s.WantsFront("localhost:5207") {
		t.Fatal("sólo el sitio «front» va al frente")
	}
	if err := s.SetFollow(true); err != nil {
		t.Fatal(err)
	}
	if !s.WantsFront("localhost:5207") {
		t.Fatal("siguiendo a Claude, todo va al frente")
	}
	again := &FocusStore{path: path}
	if p := again.Get("admin.shopify.com"); p == nil || p.Mode != focusFront || p.Updated == "" || !again.View().Follow {
		t.Fatalf("el archivo no guardó lo que se puso: %+v", p)
	}
	_ = s.SetFollow(false)
	_ = s.Set("admin.shopify.com", nil)
	if s.WantsFront("admin.shopify.com") {
		t.Fatal("sin perfil vuelve a fondo")
	}
	if err := s.Set("x.com", &FocusProfile{Mode: "siempre"}); err == nil {
		t.Fatal("un modo que no existe tendría que negarse")
	}
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), "\n  ") {
		t.Fatal("el archivo va con sangría, para leer el cambio en el diff")
	}
}

func TestFocusHostAndTimeouts(t *testing.T) {
	for in, want := range map[string]string{
		"https://www.Admin.Shopify.com/store/x": "admin.shopify.com",
		"http://localhost:5207/?b=1":            "localhost:5207",
		"about:blank":                           "",
	} {
		if got := focusHost(in); got != want {
			t.Errorf("%q → %q, quería %q", in, got, want)
		}
	}
	if !isTimeoutErr(errors.New("locator.click: Timeout 10000ms exceeded")) {
		t.Error("un timeout de Playwright cuenta")
	}
	if isTimeoutErr(errors.New("no hay ningún elemento «Guardar»")) || isTimeoutErr(nil) {
		t.Error("un elemento que no está no es culpa del fondo")
	}
}
