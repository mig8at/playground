package main

import (
	"testing"
	"time"
)

// Un comercio que no se sigue no avisa; uno que se sigue, sí; las entidades avisan siempre. Con «all», todos.
func TestMerchantNoticesOnlyWhenFollowed(t *testing.T) {
	f := openFollowing(t.TempDir())
	if err := f.add("merchant:12"); err != nil {
		t.Fatal(err)
	}
	if err := f.add("service:legacy-backend"); err == nil {
		t.Fatal("un servicio no se sigue: ya está siempre a la vista")
	}
	rules := defaultRules()
	o := &Overview{Rules: rules, Merchants: []Subject{
		{Signal: "merchant:12", Kind: "merchant", Name: "Seguido", State: "alert"},
		{Signal: "merchant:99", Kind: "merchant", Name: "Otro", State: "alert"},
	}, Lenders: []Subject{{Signal: "lender:6", Kind: "lender", Name: "Entidad", State: "alert"}}}
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}, follows: f.has}
	n.observe(o, time.Now())
	got := map[Signal]bool{}
	for _, x := range n.notices {
		got[x.Signal] = true
	}
	if !got["merchant:12"] || got["merchant:99"] || !got["lender:6"] {
		t.Fatalf("avisos: %v", got)
	}
	if n.Episodes["merchant:99"] == nil {
		t.Fatal("el episodio del que no se sigue se lleva igual")
	}

	// Lo sigue en medio del episodio: avisa en la pasada siguiente.
	if err := f.add("merchant:99"); err != nil {
		t.Fatal(err)
	}
	n.observe(o, time.Now().Add(10*time.Minute))
	if len(n.notices) != 3 || n.notices[2].Signal != "merchant:99" {
		t.Fatalf("después de seguirlo: %+v", n.notices)
	}

	// Lo guardado vuelve al reabrir, y sacar uno lo saca.
	g := openFollowing(f.path[:len(f.path)-len("/following.json")])
	if !g.has("merchant:12") || !g.has("merchant:99") {
		t.Fatalf("al reabrir: %v", g.all())
	}
	_ = g.remove("merchant:12")
	if g.has("merchant:12") || len(g.all()) != 1 {
		t.Fatalf("al sacar: %v", g.all())
	}

	rules.Notify.Merchants = "all"
	all := &notifier{dry: true, Episodes: map[Signal]*episode{}, follows: openFollowing(t.TempDir()).has}
	all.observe(&Overview{Rules: rules, Merchants: o.Merchants}, time.Now())
	if len(all.notices) != 2 {
		t.Fatalf("con merchants=all avisan todos: %+v", all.notices)
	}
}
