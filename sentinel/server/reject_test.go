package main

import (
	"strings"
	"testing"
	"time"
)

// El rechazo de una entidad CreditopX se mide contra su tasa de siempre a esa hora: el doble es alerta y nombra el cambio
// de política de las horas anteriores; su tasa de siempre, normal; un punto más con mucho volumen, tampoco.
func TestRejectRate(t *testing.T) {
	now := time.Date(2026, 11, 18, 10, 0, 0, 0, bogota)
	total := map[string]*[bucketsPerDay]int{}
	denied := map[string]*[bucketsPerDay]int{}
	have := map[string]bool{}
	put := func(day time.Time, offers, rejects int) {
		key := day.Format("2006-01-02")
		c, d := &[bucketsPerDay]int{}, &[bucketsPerDay]int{}
		for m := 0; m < 60; m += 5 {
			b := bucketOf(day.Add(-time.Hour).Add(time.Duration(m) * time.Minute))
			c[b], d[b] = offers/12, rejects/12
		}
		total[key], denied[key], have[key] = c, d, true
	}
	day := now
	for i := 0; i < 8; {
		day = day.AddDate(0, 0, -1)
		if !restDay(day) {
			put(day, 120, 24) // 20 % de siempre
			i++
		}
	}
	policy := PolicyChange{LenderID: 187, Lender: "Crédito Directo X LB", Version: 6, At: now.Add(-3 * time.Hour).Format(time.RFC3339)}
	e := evaluator{rules: defaultRules(), data: map[Signal]*series{"reject:187": {total: total, denied: denied}}, have: have,
		ceils: map[string]float64{}, policies: []PolicyChange{policy}}

	put(now, 120, 60) // hoy, la mitad
	ev := e.eval("reject:187", now)
	if ev.Level != levelAlert || ev.Reject == nil || ev.Reject.Rejects != 60 || !strings.Contains(ev.Why, "versión 6") {
		t.Fatalf("nivel %d · %+v · %s", ev.Level, ev.Reject, ev.Why)
	}
	put(now, 120, 24)
	if ev := e.eval("reject:187", now); ev.Level != levelOK {
		t.Fatalf("la tasa de siempre debía ser normal: %d · %s", ev.Level, ev.Why)
	}
	put(now, 1200, 264) // 22 % con mucho volumen: z alto, pero dos puntos no son un cambio
	if ev := e.eval("reject:187", now); ev.Level != levelOK {
		t.Fatalf("dos puntos más no debían avisar: %d · %s", ev.Level, ev.Why)
	}
	put(now, 12, 12)
	if ev := e.eval("reject:187", now); ev.Level != levelQuiet {
		t.Fatalf("con 12 ofertas no se habla: %d · %s", ev.Level, ev.Why)
	}
	// El cambio de política de otra entidad no se nombra; para todas, sí.
	if p, ok := e.policyBefore("reject:6", now); ok {
		t.Fatalf("nombró la política de otra entidad: %+v", p)
	}
	if _, ok := e.policyBefore("reject:all", now); !ok {
		t.Fatal("para todas tenía que nombrar el cambio de política")
	}
}
