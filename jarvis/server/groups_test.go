package main

import (
	"net/http/httptest"
	"net/url"
	"testing"
)

// Dos trabajos en paralelo, cada uno en su grupo: un pedido con grupo y sin pestaña va a la última sesión de ESE
// grupo, aunque después se haya abierto otra en otro grupo. Es lo que evita que se pisen.
func TestGroupRoutesToItsOwnSession(t *testing.T) {
	tabs := NewTabs(nil)
	vtex, err := tabs.NewIn(true, "VTEX", "")
	if err != nil {
		t.Fatal(err)
	}
	shop, err := tabs.NewIn(true, "Shopify", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := tabs.Get(""); got != shop {
		t.Fatalf("sin grupo ni pestaña tendría que seguir yendo a la última (%s)", shop.ID)
	}
	for name, want := range map[string]*Tab{"VTEX": vtex, "vtex": vtex, "  Shopify ": shop} {
		r := httptest.NewRequest("GET", "/api/live/state", nil)
		r.Header.Set(groupHeader, url.QueryEscape(name))
		if got := tabs.pick(httptest.NewRecorder(), r); got != want {
			t.Errorf("con grupo %q tendría que ir a la sesión %s", name, want.ID)
		}
	}
	// Una sesión nueva del mismo grupo pasa a ser su default.
	vtex2, _ := tabs.NewIn(true, "vtex", "")
	if got := tabs.ByGroup("VTEX"); got != vtex2 {
		t.Fatalf("la última del grupo tendría que ser %s", vtex2.ID)
	}
	// Un grupo que no existe es un 404, no la última de todas en silencio.
	r := httptest.NewRequest("GET", "/api/live/state", nil)
	r.Header.Set(groupHeader, "nadie")
	w := httptest.NewRecorder()
	if got := tabs.pick(w, r); got != nil || w.Code != 404 {
		t.Fatalf("un grupo sin sesiones tendría que dar 404, dio %d", w.Code)
	}
	// --session gana sobre el grupo.
	r = httptest.NewRequest("GET", "/api/live/state", nil)
	r.Header.Set(groupHeader, "VTEX")
	r.Header.Set(tabHeader, shop.ID)
	if got := tabs.pick(httptest.NewRecorder(), r); got != shop {
		t.Fatal("con --session explícita tendría que ir a esa, no a la del grupo")
	}
}

// Cada grupo nuevo toma un color libre; el mismo grupo (escrito distinto) comparte nombre y color; un color pedido lo
// cambia para todo el grupo; uno que Chrome no conoce se niega.
func TestGroupNamesAndColors(t *testing.T) {
	tabs := NewTabs(nil)
	a, _ := tabs.NewIn(true, "Créditos VTEX", "")
	b, _ := tabs.NewIn(true, "Shopify", "")
	c, _ := tabs.NewIn(true, "creditos   vtex", "")
	if a.Color == "" || a.Color == b.Color {
		t.Fatalf("dos grupos tendrían que tener colores distintos: %q y %q", a.Color, b.Color)
	}
	if c.Group != "Créditos VTEX" || c.Color != a.Color {
		t.Fatalf("el mismo grupo tendría que quedar con su primer nombre y su color, quedó %q %q", c.Group, c.Color)
	}
	if _, _, err := tabs.SetGroup(c, "Créditos VTEX", "red"); err != nil {
		t.Fatal(err)
	}
	if a.Color != "red" {
		t.Fatalf("cambiar el color de un grupo lo cambia para todas sus sesiones, quedó %q", a.Color)
	}
	if _, _, err := tabs.SetGroup(a, "x", "violeta"); err == nil {
		t.Fatal("un color que Chrome no conoce tendría que negarse")
	}
	if _, _, err := tabs.SetGroup(a, "un nombre larguísimo que no entra en la tira de pestañas de Chrome", ""); err == nil {
		t.Fatal("un nombre de más de 40 letras tendría que negarse")
	}
	if name, color, _ := tabs.SetGroup(b, "", ""); name != "" || color != "" {
		t.Fatal("sin nombre la sesión vuelve al grupo «Jarvis» de siempre")
	}
	if info := tabs.Info(); info[1].Group != "Créditos VTEX" || info[1].Color != "red" {
		t.Fatalf("Info tendría que mostrar el grupo y su color: %+v", info[1])
	}
}

// Dos `start` a la vez nunca toman la misma sesión: la primera toma la vacía que siempre queda, la segunda una nueva,
// cada una en su grupo. Y una sesión reservada de un grupo no la toma otra meta del mismo grupo.
func TestClaimInParallelNeverSharesASession(t *testing.T) {
	tabs := NewTabs(nil)
	got := make(chan *Tab, 8)
	for i := 0; i < 8; i++ {
		go func(i int) {
			tab, err := tabs.Claim(true, []string{"A", "B"}[i%2], "")
			if err != nil {
				t.Error(err)
			}
			got <- tab
		}(i)
	}
	seen := map[string]bool{}
	for i := 0; i < 8; i++ {
		tab := <-got
		if seen[tab.ID] {
			t.Fatalf("dos metas tomaron la sesión %s", tab.ID)
		}
		seen[tab.ID] = true
	}
	if n := len(tabs.All()); n != 8 {
		t.Fatalf("tendrían que quedar 8 sesiones (la vacía reusada + 7 nuevas), quedaron %d", n)
	}
	// Pasada la reserva, una sesión libre del grupo se reusa en vez de abrir otra.
	a := tabs.ByGroup("A")
	tabs.mu.Lock()
	a.claimed = a.claimed.Add(-2 * claimHold)
	tabs.mu.Unlock()
	if again, _ := tabs.Claim(true, "a", ""); again != a {
		t.Fatalf("una sesión libre del grupo tendría que reusarse")
	}
}
