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
		"pruebas/demo/build.sh",
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

// Un parche cambia sólo lo que dice: cada texto buscado tiene que estar una vez; se aplican todos o ninguno, y lo que
// falla vuelve explicado, sin tocar el archivo.
func TestPatchChangesOnlyWhatItSays(t *testing.T) {
	a := &app{root: t.TempDir()}
	const path = "pruebas/demo/estilo.css"
	a.writeSandbox(path, "h1 { color: red }\n.btn { color: red }  \n.pie { margin: 0 }\n")
	read := func() string {
		raw, _ := os.ReadFile(filepath.Join(a.root, sandboxDir, "demo", "estilo.css"))
		return string(raw)
	}
	hunk := func(find, repl string) string {
		return "<<<<<<< BUSCAR\n" + find + "\n=======\n" + repl + "\n>>>>>>> REEMPLAZAR"
	}
	// Dos cambios en un parche; el segundo coincide salvo por los espacios del final del renglón.
	note, exit, err := a.patchSandbox(path, hunk("h1 { color: red }", "h1 { color: blue }")+"\n"+hunk(".btn { color: red }", ".btn { color: green }"))
	if err != nil || exit != 0 || !strings.Contains(note, "2 cambio(s)") {
		t.Fatalf("parche: %q %d %v", note, exit, err)
	}
	if got := read(); !strings.Contains(got, "h1 { color: blue }") || !strings.Contains(got, ".btn { color: green }") || !strings.Contains(got, ".pie { margin: 0 }") {
		t.Errorf("quedó %q", got)
	}
	before := read()
	// Un texto que no está, o que está más de una vez, no cambia nada (ni el cambio bueno que venía antes).
	for name, patch := range map[string]string{
		"no está":      hunk(".pie { margin: 0 }", ".pie { margin: 1px }") + "\n" + hunk("no existe", "x"),
		"está dos":     hunk("color", "colour"),
		"sin la forma": "cambiá el color por favor",
	} {
		note, exit, err := a.patchSandbox(path, patch)
		if err != nil || exit == 0 || read() != before {
			t.Errorf("%s: tenía que fallar sin tocar el archivo: %q %d %v", name, note, exit, err)
		}
	}
	if note, exit, _ := a.patchSandbox("pruebas/demo/nuevo.css", hunk("a", "b")); exit == 0 || !strings.Contains(note, "no existe") {
		t.Errorf("parchar uno que no existe: %q", note)
	}
	// Del bloque ```parche sale un comando «parchar», antes que los comandos de la misma respuesta.
	got := parseCommands("```comando\nprobar pruebas/demo\n```\n\n```parche pruebas/demo/estilo.css\n" + hunk("a", "b") + "\n```")
	if len(got) != 2 || got[0].Cmd != "parchar pruebas/demo/estilo.css" || got[0].Content == "" || got[1].Cmd != "probar pruebas/demo" {
		t.Errorf("orden y forma: %+v", got)
	}
}

// El freno: una conversación que escribió en la carpeta no puede cerrar si no probó después, o si el último `probar`
// dejó problemas; una que no escribió nada, o que probó y quedó bien, sí.
func TestSandboxPendingBlocksClosingUntested(t *testing.T) {
	msg := func(cmds ...Command) Message { return Message{Role: "model", Commands: cmds} }
	run := func(cmd string, exit int) Command { return Command{Cmd: cmd, Status: "corrido", Exit: exit} }
	cases := []struct {
		name string
		msgs []Message
		want string
	}{
		{"sin escribir nada", []Message{msg(run("trampas", 0))}, ""},
		{"escribió y nunca probó", []Message{msg(run("escribir pruebas/demo/index.html", 0))}, "después del último `probar`"},
		{"probó y quedó bien", []Message{msg(run("escribir pruebas/demo/index.html", 0), run("probar pruebas/demo", 0))}, ""},
		{"probó con problemas", []Message{msg(run("escribir pruebas/demo/index.html", 0), run("probar pruebas/demo", 1))}, "dejó problemas"},
		{"parchó después de probar", []Message{msg(run("probar pruebas/demo", 0)), msg(run("parchar pruebas/demo/a.css", 0))}, "después del último `probar`"},
		{"un parche que no se aplicó no cuenta como escritura", []Message{msg(run("escribir pruebas/demo/index.html", 0), run("probar pruebas/demo", 0)), msg(run("parchar pruebas/demo/a.css", 1))}, ""},
		{"lo descartado no cuenta", []Message{msg(Command{Cmd: "escribir pruebas/demo/index.html", Status: "descartado"})}, ""},
	}
	for _, c := range cases {
		got := sandboxPending(Conversation{Messages: c.msgs}, func(string) string { return "pagina" })
		if (c.want == "") != (got == "") || !strings.Contains(got, c.want) {
			t.Errorf("%s: %q", c.name, got)
		}
	}
	// Un proyecto sin ninguna página (una nota suelta) no tiene qué probar: no frena.
	onlyNote := Conversation{Messages: []Message{msg(run("escribir pruebas/notas/nota.txt", 0))}}
	if got := sandboxPending(onlyNote, func(string) string { return "" }); got != "" {
		t.Errorf("sin página no tiene que frenar: %q", got)
	}
	// Una API en Rust se comprueba con probar-api, no con probar: compilar solo no alcanza para cerrar.
	rust := func(string) string { return "rust" }
	wrote := msg(run("escribir pruebas/api/src/main.rs", 0), run("compilar pruebas/api", 0))
	if got := sandboxPending(Conversation{Messages: []Message{wrote}}, rust); !strings.Contains(got, "probar-api pruebas/api") {
		t.Errorf("Rust sin probar-api tiene que frenar: %q", got)
	}
	if got := sandboxPending(Conversation{Messages: []Message{wrote, msg(run("probar-api pruebas/api", 0))}}, rust); got != "" {
		t.Errorf("Rust probado y en verde no frena: %q", got)
	}
	if got := sandboxPending(Conversation{Messages: []Message{wrote, msg(run("probar-api pruebas/api", 1))}}, rust); !strings.Contains(got, "dejó problemas") {
		t.Errorf("Rust con un criterio en rojo frena: %q", got)
	}
	// La consola: mirar no obliga a nada; un comando que CAMBIÓ archivos cuenta como escritura y hay que volver a probar.
	green := []Message{wrote, msg(run("probar-api pruebas/api", 0))}
	look := Command{Cmd: "consola pruebas/api con-api curl -s localhost:8080/tareas", Status: "corrido"}
	if got := sandboxPending(Conversation{Messages: append(green, msg(look))}, rust); got != "" {
		t.Errorf("mirar con la consola no frena: %q", got)
	}
	edit := Command{Cmd: "consola pruebas/api sed -i s/a/b/ src/main.rs", Status: "corrido", Touched: true}
	if got := sandboxPending(Conversation{Messages: append(green, msg(edit))}, rust); !strings.Contains(got, "probar-api pruebas/api") {
		t.Errorf("la consola que tocó archivos tiene que frenar: %q", got)
	}
	// El resumen de probar-api, en datos, sale de sus ✓ y ✗.
	rep := checkTextReport("La API levantó.\n\nCRITERIOS (2):\n  ✓ lista vacía\n  ✗ crea una tarea — POST /tareas: esperaba estado 201 y dio 404. Contestó (404): \n\nRESULTADO: 1 problema(s) para corregir.")
	if rep.Problems != 1 || len(rep.Criteria) != 2 || !rep.Criteria[0].OK || rep.Criteria[1].OK || !strings.Contains(rep.Criteria[1].Detail, "404") {
		t.Errorf("resumen: %+v", rep)
	}
}

// El cambio de una escritura: renglones que entran y que salen, con contexto, y las cuentas.
func TestLineDiffShowsOnlyWhatChanged(t *testing.T) {
	before := "uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\nocho"
	after := "uno\ndos\nTRES\ncuatro\ncinco\nseis\nsiete\nocho\nnueve"
	ch := lineDiff(before, after)
	if ch.Added != 2 || ch.Removed != 1 || ch.New {
		t.Fatalf("cuentas: %+v", ch)
	}
	for _, want := range []string{"-tres\n", "+TRES\n", "+nueve\n", " dos\n", "@@\n"} {
		if !strings.Contains(ch.Diff, want) {
			t.Errorf("falta %q en:\n%s", want, ch.Diff)
		}
	}
	if strings.Contains(ch.Diff, " uno\n") == false && strings.Contains(ch.Diff, " seis\n") {
		t.Errorf("contexto de más:\n%s", ch.Diff)
	}
	if n := lineDiff("", "a\nb"); !n.New || n.Added != 2 || n.Diff != "+a\n+b\n" {
		t.Errorf("uno nuevo: %+v", n)
	}
	a := &app{root: t.TempDir()}
	a.writeSandbox("pruebas/demo/a.css", "h1 { color: red }\np { margin: 0 }\n")
	_, _, change, err := a.patchSandboxChange("pruebas/demo/a.css", "<<<<<<< BUSCAR\nh1 { color: red }\n=======\nh1 { color: blue }\n>>>>>>> REEMPLAZAR")
	if err != nil || change.Added != 1 || change.Removed != 1 || !strings.Contains(change.Diff, "+h1 { color: blue }") {
		t.Errorf("el parche tiene que traer su cambio: %+v %v", change, err)
	}
}
