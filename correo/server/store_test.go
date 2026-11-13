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
	if fresh := s.update("shopify", defaultWatches[0].Query, []gmail.Message{msg("a", time.Hour), msg("b", 2*time.Hour)}, now); len(fresh) != 0 {
		t.Fatalf("el estreno avisó %d", len(fresh))
	}
	if _, unread := s.view(""); unread != 0 {
		t.Fatalf("lo de antes de estrenar cuenta como sin ver: %d", unread)
	}
	// Llega uno: avisa ése solo, una vez.
	fresh := s.update("shopify", defaultWatches[0].Query, []gmail.Message{msg("c", time.Minute), msg("a", time.Hour), msg("b", 2*time.Hour)}, now)
	if len(fresh) != 1 || fresh[0].ID != "c" {
		t.Fatalf("tenía que avisar sólo «c»: %+v", fresh)
	}
	if again := s.update("shopify", defaultWatches[0].Query, []gmail.Message{msg("c", time.Minute)}, now); len(again) != 0 {
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
	if fresh := s2.update("shopify", defaultWatches[0].Query, []gmail.Message{msg("c", time.Minute)}, now); len(fresh) != 0 {
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

func TestEachMailIsUnreadPendingOrRepliedByTheThread(t *testing.T) {
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	q := defaultWatches[1].Query
	now := time.Now()
	s.update("vtex", q, nil, now) // estreno vacío: desde acá avisa
	old := gmail.Message{ID: "a", ThreadID: "t1", Date: now.Add(-48 * time.Hour)}
	seen := gmail.Message{ID: "b", ThreadID: "t2", Date: now.Add(-3 * time.Hour)}
	fresh := gmail.Message{ID: "c", ThreadID: "t3", Date: now.Add(-time.Hour)}
	s.update("vtex", q, []gmail.Message{fresh, seen, old}, now)
	_ = s.markRead([]string{"b"}, now)
	// t1: Miguel contestó después (desde Gmail, sin abrirlo acá). t2 y t3: lo último es de ellos.
	me := "miguel@creditop.com"
	s.setThreads(map[string]Thread{
		"t1": threadOf([]gmail.Message{{From: "VTEX <support@vtexhelp.zendesk.com>", Date: old.Date}, {From: "Miguel <" + me + ">", Date: old.Date.Add(time.Hour)}}, me),
		"t2": threadOf([]gmail.Message{{From: "Miguel <" + me + ">", Date: seen.Date.Add(-time.Hour)}, {From: "VTEX", Date: seen.Date}}, me),
		"t3": threadOf([]gmail.Message{{From: "VTEX", Date: fresh.Date}}, me),
	})
	views, unread := s.view(me)
	got := map[string]string{}
	for _, m := range views[1].Messages {
		got[m.ID] = m.Status
	}
	if got["a"] != "replied" || got["b"] != "pending" || got["c"] != "unread" {
		t.Fatalf("estados: %v", got)
	}
	if views[1].Unread != 1 || views[1].Pending != 1 || unread != 1 {
		t.Fatalf("conteos: sin ver %d (total %d), por responder %d", views[1].Unread, unread, views[1].Pending)
	}
	if views[1].Week != 3 {
		t.Fatalf("los tres llegaron esta semana: %d", views[1].Week)
	}
}

func TestAnAutomaticAckCanBeMarkedAsNoReplyAndBack(t *testing.T) {
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	q := defaultWatches[1].Query
	now := time.Now()
	s.update("vtex", q, nil, now)
	ack := gmail.Message{ID: "ack", ThreadID: "t", Subject: "[VTEX] Ticket #1 received", Date: now.Add(-time.Hour)}
	s.update("vtex", q, []gmail.Message{ack}, now)
	status := func() (string, int, int) {
		v, _ := s.view("")
		return v[1].Messages[0].Status, v[1].Unread, v[1].Pending
	}
	if st, u, _ := status(); st != "unread" || u != 1 {
		t.Fatalf("recién llegado: %s, %d sin ver", st, u)
	}
	if err := s.markNoReply([]string{"ack"}, false, now); err != nil {
		t.Fatal(err)
	}
	if st, u, p := status(); st != "noreply" || u != 0 || p != 0 {
		t.Fatalf("marcado: %s, %d sin ver, %d por responder", st, u, p)
	}
	_ = s.markNoReply([]string{"ack"}, true, now)
	if st, _, p := status(); st != "pending" || p != 1 {
		t.Fatalf("desmarcado vuelve a por responder (ya visto): %s, %d", st, p)
	}
}

func TestTheQuotedPartOfAReplyIsNotSentAgain(t *testing.T) {
	body := "Thanks, we will check.\n\nOn Wed, Nov 12, 2026 at 9:55 AM VTEX Support <support@vtexhelp.zendesk.com> wrote:\n> Hello Miguel\n> old text"
	if got := cleanBody(body); got != "Thanks, we will check." {
		t.Fatalf("%q", got)
	}
	if got := cleanBody("> sólo citado\nlo nuevo"); got != "lo nuevo" {
		t.Fatalf("%q", got)
	}
}
