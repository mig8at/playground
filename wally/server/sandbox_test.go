package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// La carpeta de pruebas: se escribe sólo adentro, con tipos fijos; lo anterior queda en el historial; lo raro se niega.
func TestSandboxWritesOnlyInsideItsFolder(t *testing.T) {
	a := &app{root: t.TempDir()}
	if _, err := a.writeSandbox("pruebas/demo/index.html", "<h1>uno</h1>"); err != nil {
		t.Fatal(err)
	}
	note, err := a.writeSandbox("pruebas/demo/index.html", "<h1>dos</h1>")
	if err != nil || !strings.Contains(note, ".historial") {
		t.Fatalf("la segunda escritura tiene que guardar la anterior: %q %v", note, err)
	}
	got, _ := os.ReadFile(filepath.Join(a.root, sandboxDir, "demo", "index.html"))
	if string(got) != "<h1>dos</h1>" {
		t.Errorf("quedó %q", got)
	}
	if old, _ := filepath.Glob(filepath.Join(a.root, sandboxDir, ".historial", "demo", "index.html.*")); len(old) != 1 {
		t.Errorf("historial: %v", old)
	}
	for _, bad := range []string{
		"pruebas/index.html",        // sin proyecto
		"pruebas/demo/../../x.html", // sale
		"pruebas/demo/.env",         // oculto
		"pruebas/demo/run.sh",       // tipo no permitido
		"pruebas/demo/a.php",
		"wally/WALLY.md",
		"/etc/hosts.txt",
		"pruebas/Demo Con Espacio/a.html",
	} {
		if _, err := a.writeSandbox(bad, "x"); err == nil {
			t.Errorf("%q tenía que rechazarse", bad)
		}
	}
	if _, err := a.writeSandbox("pruebas/demo/grande.js", strings.Repeat("x", sandboxMaxBytes+1)); err == nil {
		t.Error("un archivo por encima del tope tenía que rechazarse")
	}
	// Un enlace simbólico adentro no saca la escritura de la carpeta.
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(a.root, sandboxDir, "fuga")); err == nil {
		if _, err := a.writeSandbox("pruebas/fuga/a.html", "x"); err == nil {
			t.Error("escribir por un enlace que sale de la carpeta tenía que rechazarse")
		}
	}
	list, _ := a.listSandbox("")
	if !strings.Contains(list, "pruebas/demo/index.html") || strings.Contains(list, ".historial") {
		t.Errorf("listar: %q", list)
	}
}

// Los archivos salen de los bloques ```archivo; uno fuera de la carpeta queda «no permitido» y sin contenido.
func TestFileBlocksBecomeWriteCommands(t *testing.T) {
	answer := "Va la página:\n\n```archivo pruebas/demo/index.html\n<!doctype html>\n<h1>hola</h1>\n```\n\ny el estilo:\n\n```archivo pruebas/demo/css/base.css\nh1 { color: red }\n```\n\n```archivo ../../.zshrc\nmalo\n```\n\n```comando\nprobar pruebas/demo\n```"
	got := parseCommands(answer)
	if len(got) != 4 {
		t.Fatalf("esperaba 4 comandos, hay %d: %+v", len(got), got)
	}
	by := map[string]Command{}
	for _, c := range got {
		by[c.Cmd] = c
	}
	if c := by["escribir pruebas/demo/index.html"]; c.Status != "propuesto" || c.Content != "<!doctype html>\n<h1>hola</h1>" {
		t.Errorf("index: %+v", c)
	}
	if c := by["escribir ../../.zshrc"]; c.Status != "no-permitido" || c.Content != "" {
		t.Errorf("lo de afuera: %+v", c)
	}
	if c := by["probar pruebas/demo"]; c.Status != "propuesto" {
		t.Errorf("probar: %+v", c)
	}
}

// Lo que escribió un modelo se sirve aislado: sin pedidos, sin formularios, sin ver lo de Wally; y nada oculto.
func TestSandboxIsServedIsolated(t *testing.T) {
	a := &app{root: t.TempDir()}
	a.writeSandbox("pruebas/demo/index.html", "<h1>hola</h1>")
	rec := httptest.NewRecorder()
	a.serveSandbox(rec, httptest.NewRequest(http.MethodGet, "/pruebas/demo/", nil))
	csp := rec.Header().Get("Content-Security-Policy")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "hola") {
		t.Fatalf("no sirvió el index: %d %q", rec.Code, rec.Body.String())
	}
	for _, want := range []string{"sandbox allow-scripts", "connect-src 'none'", "form-action 'none'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("falta %q en la política: %q", want, csp)
		}
	}
	for _, bad := range []string{"/pruebas/.historial/demo/x", "/pruebas/demo/../../server/main.go", "/pruebas/demo/.env"} {
		rec := httptest.NewRecorder()
		a.serveSandbox(rec, httptest.NewRequest(http.MethodGet, bad, nil))
		if rec.Code == 200 {
			t.Errorf("%s no tenía que servirse", bad)
		}
	}
}
