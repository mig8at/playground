package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Lo anotado se pide por número de orden (sólo lo nuevo) y no crece sin fin: con más de devlogMax, lo más viejo se cae.
func TestDevlogSinceAndCap(t *testing.T) {
	d := newDevlog()
	d.addConsole(ConsoleEntry{Level: "log", Text: "hola"})
	d.addNet(NetEntry{Method: "GET", URL: "http://x/api", Status: 200})
	c, n, last := d.since(0)
	if len(c) != 1 || len(n) != 1 || last != 2 {
		t.Fatalf("desde 0: %d de consola, %d de red, último %d", len(c), len(n), last)
	}
	d.addConsole(ConsoleEntry{Level: "error", Text: "se rompió"})
	if c, n, _ := d.since(last); len(c) != 1 || c[0].Text != "se rompió" || len(n) != 0 {
		t.Fatalf("desde %d tendría que venir sólo lo nuevo: %+v %+v", last, c, n)
	}
	for i := 0; i < devlogMax+50; i++ {
		d.addNet(NetEntry{Method: "GET", URL: "http://x/" + itoa(i)})
	}
	if _, n, _ := d.since(0); len(n) != devlogMax {
		t.Fatalf("la red tendría que quedar en %d, quedó en %d", devlogMax, len(n))
	}
}

func itoa(n int) string { return string(rune('a'+n%26)) + string(rune('a'+(n/26)%26)) }

// Lo de una corrida queda con ella: sólo lo anotado desde que empezó (no lo de una corrida anterior de la misma
// sesión), y se lee después por su id o con «last» aunque la sesión ya no exista.
func TestDevlogSavedWithTheRun(t *testing.T) {
	root := t.TempDir()
	s := &Store{dir: root}
	dir := filepath.Join(root, "runs", "2026-11-20_16-00-00")
	l := &live{dev: newDevlog()}
	l.dev.addConsole(ConsoleEntry{Level: "log", Text: "de la corrida anterior"})
	l.devFrom = l.dev.mark() // empieza la corrida
	l.runDir = dir
	l.dev.addConsole(ConsoleEntry{Level: "error", Text: "se rompió"})
	l.dev.addNet(NetEntry{Method: "GET", URL: "http://x/api", Status: 500})
	if err := l.saveDevlog(); err != nil {
		t.Fatal(err)
	}
	_ = writeJSONFile(filepath.Join(dir, "run.json"), RunMeta{ID: "2026-11-20_16-00-00"})
	for _, id := range []string{"2026-11-20_16-00-00", "last"} {
		d, real, err := s.RunDevLog(id)
		if err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		if real != "2026-11-20_16-00-00" || len(d.Console) != 1 || d.Console[0].Text != "se rompió" || len(d.Network) != 1 {
			t.Fatalf("%s: tendría que traer sólo lo de la corrida: %s %+v %+v", id, real, d.Console, d.Network)
		}
	}
	// Una sesión que se cerró sin finish (sin run.json) también es «last» si es la más nueva.
	l2 := &live{dev: newDevlog(), runDir: filepath.Join(root, "runs", "2026-11-20_16-05-00")}
	l2.dev.addConsole(ConsoleEntry{Level: "warning", Text: "sin finish"})
	if err := l2.saveDevlog(); err != nil {
		t.Fatal(err)
	}
	if d, real, err := s.RunDevLog("last"); err != nil || real != "2026-11-20_16-05-00" || d.Console[0].Text != "sin finish" {
		t.Fatalf("«last» tendría que ser la más nueva aunque no tenga reporte: %s %v", real, err)
	}
	if _, _, err := s.RunDevLog("../otra"); err == nil {
		t.Fatal("un id con ruta tiene que negarse")
	}
}

// El cuerpo de un pedido que escribe se guarda para poder repetirlo, pero una credencial nunca: queda tapada, en un
// JSON (también anidada) y en un formulario.
func TestRedactBody(t *testing.T) {
	got := redactBody(`{"name":"Casco","price":350000,"auth":{"apiKey":"abc"},"password":"x"}`, "application/json")
	for _, bad := range []string{"abc", `"x"`} {
		if strings.Contains(got, bad) {
			t.Fatalf("quedó una credencial: %s", got)
		}
	}
	if !strings.Contains(got, `"name":"Casco"`) || !strings.Contains(got, `"price":350000`) {
		t.Fatalf("lo que no es credencial tiene que quedar igual: %s", got)
	}
	if f := redactBody("user=ana&pwd=123&stock=4", "application/x-www-form-urlencoded"); strings.Contains(f, "123") || !strings.Contains(f, "stock=4") {
		t.Fatalf("formulario: %s", f)
	}
}

func TestIsSecretKey(t *testing.T) {
	for k, want := range map[string]bool{"password": true, "apiKey": true, "api_key": true, "X-Auth-Token": true, "cardNumber": true,
		"sessionId": true, "shipping": false, "author": false, "name": false, "price": false, "pinned": false, "keyword": false} {
		if got := isSecretKey(k); got != want {
			t.Errorf("isSecretKey(%q) = %v, quería %v", k, got, want)
		}
	}
}
