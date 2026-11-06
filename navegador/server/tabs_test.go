package main

import (
	"net/http/httptest"
	"testing"
)

// Sin pestaña, un pedido cae en la última que se abrió; cerrarla devuelve el default a la anterior, y cerrar la única
// abre otra vacía (siempre hay dónde caer). Una pestaña que no existe es un 404, no la última en silencio.
func TestTabsDefaultAndClose(t *testing.T) {
	tabs := NewTabs(nil)
	first := tabs.Get("")
	second := tabs.New()
	if got := tabs.Get(""); got != second {
		t.Fatalf("sin pestaña tendría que ir a la última (%s), fue a %s", second.ID, got.ID)
	}
	if err := tabs.Close(second.ID); err != nil {
		t.Fatal(err)
	}
	if got := tabs.Get(""); got != first {
		t.Fatalf("cerrada la última, el default tendría que volver a %s, es %s", first.ID, got.ID)
	}
	if err := tabs.Close(first.ID); err != nil {
		t.Fatal(err)
	}
	if all := tabs.All(); len(all) != 1 || all[0] == first {
		t.Fatalf("cerrar la única tendría que dejar una nueva vacía, quedaron %d", len(all))
	}
	if err := tabs.Close("99"); err == nil {
		t.Fatal("cerrar una que no existe tendría que fallar")
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/live/state", nil)
	r.Header.Set(tabHeader, "99")
	if tabs.pick(w, r) != nil || w.Code != 404 {
		t.Fatalf("una pestaña que no existe tendría que dar 404, dio %d", w.Code)
	}
}
