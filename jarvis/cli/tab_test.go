package main

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

// --sesion N sale de los argumentos esté donde esté, y fija la pestaña de este comando.
func TestTakeTabFlag(t *testing.T) {
	tabID = ""
	got := takeTabFlag([]string{"jarvis", "fill", "--sesion", "2", "3", "hola"})
	if want := []string{"jarvis", "fill", "3", "hola"}; !reflect.DeepEqual(got, want) || tabID != "2" {
		t.Fatalf("quedó %v con pestaña %q", got, tabID)
	}
	tabID = ""
}

// Todo pedido a la API tiene que llevar la pestaña: uno que arma su propio http.Get le habla a la última que se abrió
// (le pasó a `shot`, que sacaba la foto de otra pestaña). call y shot son los únicos que arman el pedido.
func TestEveryAPIRequestCarriesTheTab(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"http.Get(", "http.Post(", "http.Head("} {
		if strings.Contains(string(src), bad) {
			t.Errorf("main.go usa %s: ese pedido no lleva X-Jarvis-Tab", bad)
		}
	}
	if n := strings.Count(string(src), `"X-Jarvis-Tab"`); n < 2 {
		t.Errorf("el encabezado de la pestaña aparece %d veces; call y shot lo ponen", n)
	}
}
