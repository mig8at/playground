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

// Un comercio chico que se sigue mira 3 horas (o 6) si en una no alcanza; el mismo sin seguir sigue en «poco volumen».
func TestFollowedSmallMerchantUsesLongerWindow(t *testing.T) {
	now := time.Date(2026, 11, 12, 15, 0, 0, 0, bogota) // jueves
	se := &series{map[string]*[bucketsPerDay]int{}, map[string]*[bucketsPerDay]int{}, map[string]*[bucketsPerDay]int{}}
	have := map[string]bool{}
	// Los días hábiles anteriores: una solicitud cada 30 minutos entre las 9 y las 18 (2 por hora); hoy, ninguna.
	for d := 1; d <= 14; d++ {
		day := now.AddDate(0, 0, -d)
		if weekend(day) {
			continue
		}
		date := day.Format("2006-01-02")
		have[date] = true
		arr := &[bucketsPerDay]int{}
		for b := 9 * 12; b < 18*12; b += 6 {
			arr[b] = 1
		}
		se.total[date] = arr
	}
	have[now.Format("2006-01-02")] = true
	followed := map[Signal]bool{}
	e := evaluator{rules: defaultRules(), data: map[Signal]*series{"merchant:94": se}, have: have, ceils: map[string]float64{},
		follows: func(s Signal) bool { return followed[s] }}

	if ev := e.eval("merchant:94", now); ev.Minutes != 60 || ev.Level != levelQuiet {
		t.Fatalf("sin seguir: %d min, nivel %d (%s)", ev.Minutes, ev.Level, ev.Why)
	}
	followed["merchant:94"] = true
	ev := e.eval("merchant:94", now)
	// Ya se compara (no es «poco volumen»); que alerte lo decide la estadística: 0 contra 6 en 3 horas es z −2,45.
	if ev.Minutes != 180 || ev.Median != 6 || ev.Level == levelQuiet {
		t.Fatalf("seguido: %d min, mediana %v, nivel %d (%s)", ev.Minutes, ev.Median, ev.Level, ev.Why)
	}
	if want := "entraron 0 en las últimas 3 horas"; len(ev.Why) < len(want) || ev.Why[:len(want)] != want {
		t.Fatalf("el porqué: %s", ev.Why)
	}
}

// Cada tarjeta lleva SUS señales aunque la lista de servicios se ordene después (pasó: quedaban cruzadas).
func TestAppsKeepTheirOwnSignals(t *testing.T) {
	o := &Overview{
		Services: []Subject{{Signal: "service:b", Kind: "service", Name: "b", Median: 1}, {Signal: "service:a", Kind: "service", Name: "a", Median: 9}},
		Liveness: []Subject{{Signal: "logs:a", Kind: "logs", Name: "a · líneas", Median: 900}, {Signal: "logs:b", Kind: "logs", Name: "b · líneas", Median: 100}},
	}
	apps := (&sentinel{}).apps(o)
	sortSubjects(o.Services)
	sortSubjects(o.Liveness)
	for _, a := range apps {
		if a.Errors.Signal != "service:"+a.Service || a.Lines.Signal != "logs:"+a.Service {
			t.Fatalf("%s lleva %s y %s", a.Service, a.Errors.Signal, a.Lines.Signal)
		}
	}
}
