package main

import "testing"

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
