package main

import (
	"testing"
	"time"

	"creditop/playground/connectors/gmail"
)

func msg(id string, ago time.Duration) gmail.Message {
	return gmail.Message{ID: id, ThreadID: "t" + id, Subject: "s" + id, Date: time.Now().Add(-ago)}
}

func TestTheFirstReadDoesNotNotifyAndLaterOnlyTheNewOnes(t *testing.T) {
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	// Estreno: dos correos viejos. No avisa ninguno y no cuentan como sin ver.
	if fresh := s.update("shopify", "from:shopify.com", []gmail.Message{msg("a", time.Hour), msg("b", 2*time.Hour)}, now); len(fresh) != 0 {
		t.Fatalf("el estreno avisó %d", len(fresh))
	}
	if _, unread := s.view(""); unread != 0 {
		t.Fatalf("lo de antes de estrenar cuenta como sin ver: %d", unread)
	}
	// Llega uno: avisa ése solo, una vez.
	fresh := s.update("shopify", "from:shopify.com", []gmail.Message{msg("c", time.Minute), msg("a", time.Hour), msg("b", 2*time.Hour)}, now)
	if len(fresh) != 1 || fresh[0].ID != "c" {
		t.Fatalf("tenía que avisar sólo «c»: %+v", fresh)
	}
	if again := s.update("shopify", "from:shopify.com", []gmail.Message{msg("c", time.Minute)}, now); len(again) != 0 {
		t.Fatal("avisó dos veces el mismo correo")
	}
	views, unread := s.view("miguel@creditop.com")
	if unread != 1 || views[0].Unread != 1 || views[0].Messages[0].ID != "c" || !views[0].Messages[0].Unread {
		t.Fatalf("«c» es el único sin ver y va primero: %+v", views[0])
	}
	if err := s.markRead(s.unreadIDs("shopify"), now); err != nil {
		t.Fatal(err)
	}
	if _, unread := s.view(""); unread != 0 {
		t.Fatal("marcar visto el seguimiento no los vio todos")
	}

	// Lo guardado sobrevive a un reinicio: no vuelve a avisar.
	s2, err := openStore(s.path[:len(s.path)-len("/state.json")])
	if err != nil {
		t.Fatal(err)
	}
	if fresh := s2.update("shopify", "from:shopify.com", []gmail.Message{msg("c", time.Minute)}, now); len(fresh) != 0 {
		t.Fatal("después de reiniciar volvió a avisar")
	}
}

func TestWatchesGetASlugAndChangingTheQueryStartsOver(t *testing.T) {
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(s.watches()) != 2 {
		t.Fatalf("arranca con Shopify y VTEX: %+v", s.watches())
	}
	w, err := s.addWatch(Watch{Name: "Soporte de Shopify", Query: "from:support@shopify.com"})
	if err != nil || w.ID != "soporte-de-shopify" {
		t.Fatalf("id: %+v %v", w, err)
	}
	if _, err := s.addWatch(Watch{Name: "x"}); err == nil {
		t.Fatal("sin búsqueda no se agrega")
	}
	s.update(w.ID, "from:support@shopify.com", []gmail.Message{msg("z", time.Hour)}, time.Now())
	w.Query = "from:shopify.com subject:ticket"
	if _, err := s.addWatch(w); err != nil {
		t.Fatal(err)
	}
	if fresh := s.update(w.ID, "from:support@shopify.com", []gmail.Message{msg("x", time.Minute)}, time.Now()); fresh != nil {
		t.Fatal("una lectura con la búsqueda vieja, que terminó después del cambio, no guarda ni avisa")
	}
	if got := s.known(w.ID); len(got) != 0 {
		t.Fatalf("quedaron los correos de la búsqueda vieja: %v", got)
	}
	if fresh := s.update(w.ID, w.Query, []gmail.Message{msg("y", time.Minute)}, time.Now()); len(fresh) != 0 {
		t.Fatal("con otra búsqueda se vuelve a estrenar: no avisa lo que ya había")
	}
	if err := s.removeWatch(w.ID); err != nil || len(s.watches()) != 2 {
		t.Fatalf("no se sacó: %v", err)
	}
}

func TestThreadURLOpensTheAccountThatRead(t *testing.T) {
	if got := threadURL("miguel@creditop.com", "abc"); got != "https://mail.google.com/mail/?authuser=miguel@creditop.com#all/abc" {
		t.Fatal(got)
	}
	if sender("Patrick Elder (Shopify) <support@shopify.com>") != "Patrick Elder (Shopify)" || sender("a@b.com") != "a@b.com" {
		t.Fatal("el remitente del aviso")
	}
}
