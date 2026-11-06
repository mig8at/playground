package main

import (
	"net/http/httptest"
	"testing"
	"time"
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

// Las pestañas que abre Claude y deja sin uso se cierran solas; las de la persona, la última que se abrió, una que se
// está mirando y la única que queda, nunca. Un comando de Claude o una acción de la persona cuentan como uso; un GET
// de la interfaz (que consulta todas solas), no.
func TestSweepClosesIdleClaudeTabs(t *testing.T) {
	tabs := NewTabs(nil)
	person := tabs.Get("")      // la inicial: de la persona
	old := tabs.NewBy(true)     // de Claude, sin uso
	watched := tabs.NewBy(true) // de Claude, la está mirando la interfaz
	used := tabs.NewBy(true)    // de Claude, recién usada por un comando
	last := tabs.NewBy(true)    // de Claude, la última que se abrió
	now := time.Now().Add(20 * time.Minute)
	stopWatching := tabs.Watch(watched)

	r := httptest.NewRequest("GET", "/api/live/state", nil)
	r.Header.Set(tabHeader, used.ID)
	r.Header.Set(clientHeader, "cli")
	used.lastUsed = now.Add(-time.Minute)
	ui := httptest.NewRequest("GET", "/api/live/state", nil)
	ui.Header.Set(tabHeader, old.ID)
	tabs.pick(httptest.NewRecorder(), ui) // la interfaz consultando: no es uso

	closed := tabs.Sweep(now, 10*time.Minute)
	if len(closed) != 1 || closed[0] != old.ID {
		t.Fatalf("tendría que cerrar sólo la de Claude sin uso (%s), cerró %v", old.ID, closed)
	}
	for _, keep := range []*Tab{person, watched, used, last} {
		if tabs.Get(keep.ID) == nil {
			t.Fatalf("cerró la %s, que no tenía que cerrar", keep.ID)
		}
	}

	stopWatching()
	if closed := tabs.Sweep(time.Now().Add(5*time.Minute), 10*time.Minute); len(closed) != 0 {
		t.Fatalf("recién dejada de mirar cuenta como usada: no tendría que cerrar nada, cerró %v", closed)
	}
	if closed := tabs.Sweep(time.Now().Add(30*time.Minute), 10*time.Minute); len(closed) != 2 {
		t.Fatalf("a los 30 min sin uso tendría que cerrar la mirada y la usada (2), cerró %v", closed)
	}
	if closed := tabs.Sweep(time.Now().Add(time.Hour), 0); closed != nil {
		t.Fatalf("con el cierre apagado (0) no cierra nada, cerró %v", closed)
	}
}

func TestPickCountsCLIAndActionsAsUse(t *testing.T) {
	tabs := NewTabs(nil)
	tab := tabs.NewBy(true)
	stale := time.Now().Add(-time.Hour)
	for _, c := range []struct {
		method, client string
		use            bool
	}{{"GET", "", false}, {"GET", "cli", true}, {"POST", "", true}} {
		tab.lastUsed = stale
		r := httptest.NewRequest(c.method, "/api/live/act", nil)
		r.Header.Set(tabHeader, tab.ID)
		if c.client != "" {
			r.Header.Set(clientHeader, c.client)
		}
		tabs.pick(httptest.NewRecorder(), r)
		if got := tab.lastUsed.After(stale); got != c.use {
			t.Fatalf("%s %q: uso=%v, tendría que ser %v", c.method, c.client, got, c.use)
		}
	}
}

func TestIdleLimit(t *testing.T) {
	for env, want := range map[string]time.Duration{"": tabIdleDefault, "0": 0, "15m": 15 * time.Minute, "nada": tabIdleDefault, "-5m": tabIdleDefault} {
		if got := IdleLimit(env); got != want {
			t.Fatalf("IdleLimit(%q) = %s, tendría que ser %s", env, got, want)
		}
	}
}
