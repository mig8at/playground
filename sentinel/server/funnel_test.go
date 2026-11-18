package main

import (
	"strings"
	"testing"
	"time"
)

// El embudo se mide contra su conversión de siempre a esa hora: que se perfile la mitad de lo de siempre es alerta;
// la de siempre, normal; con pocas solicitudes no se habla.
func TestFunnelRate(t *testing.T) {
	now := time.Date(2026, 11, 18, 10, 0, 0, 0, bogota)
	total := map[string]*[bucketsPerDay]int{}
	from := map[string]*[bucketsPerDay]int{}
	have := map[string]bool{}
	put := func(day time.Time, entered, profiled int) {
		key := day.Format("2006-01-02")
		a, b := &[bucketsPerDay]int{}, &[bucketsPerDay]int{}
		for m := 0; m < 60; m += 5 {
			bk := bucketOf(day.Add(-time.Hour).Add(time.Duration(m) * time.Minute))
			a[bk], b[bk] = entered/12, profiled/12
		}
		from[key], total[key], have[key] = a, b, true
	}
	day := now
	for i := 0; i < 8; {
		day = day.AddDate(0, 0, -1)
		if !restDay(day) {
			put(day, 120, 108) // 90 % de siempre
			i++
		}
	}
	e := evaluator{rules: defaultRules(), data: map[Signal]*series{"funnel:profiled": {total: total, approved: from, denied: map[string]*[bucketsPerDay]int{}}},
		have: have, ceils: map[string]float64{}}

	put(now, 120, 48) // hoy entran igual y se perfila el 40 %
	ev := e.eval("funnel:profiled", now)
	if ev.Level != levelAlert || ev.Funnel == nil || ev.Funnel.Reached != 48 || !strings.Contains(ev.Why, "se perfilaron") {
		t.Fatalf("nivel %d · %+v · %s", ev.Level, ev.Funnel, ev.Why)
	}
	put(now, 120, 108)
	if ev := e.eval("funnel:profiled", now); ev.Level != levelOK {
		t.Fatalf("la conversión de siempre debía ser normal: %d · %s", ev.Level, ev.Why)
	}
	put(now, 24, 0)
	if ev := e.eval("funnel:profiled", now); ev.Level != levelQuiet {
		t.Fatalf("con 24 solicitudes no se habla: %d · %s", ev.Level, ev.Why)
	}
}

// La plata en juego: lo de todo el flujo pesa todo; una entidad, su parte; un servicio, nada.
func TestStakeOf(t *testing.T) {
	s := Stakes{Total: 1000, Count: 10, Lenders: map[int]Stake{6: {Share: 0.25, PerDay: 250.0 / stakeDays}}, Merchant: map[int]Stake{94: {Share: 0.1}}}
	if st := s.stakeOf("all", 0, "all:production"); st == nil || st.Share != 1 {
		t.Fatalf("toda la originación: %+v", st)
	}
	if st := s.stakeOf("reject", 6, "reject:6"); st == nil || st.Share != 0.25 {
		t.Fatalf("el rechazo de una entidad pesa lo de la entidad: %+v", st)
	}
	if st := s.stakeOf("step", 94, "step:otp@94"); st == nil || st.Share != 0.1 {
		t.Fatalf("la pantalla de un comercio pesa lo del comercio: %+v", st)
	}
	if st := s.stakeOf("service", 0, "service:legacy-backend"); st != nil {
		t.Fatalf("un servicio no tiene peso que decir: %+v", st)
	}
	if got := stakeText(&Stake{Share: 0.18, PerDay: 90e6}); got != "mueve 18 % de lo desembolsado (~$90,0 millones por día)" {
		t.Fatalf("texto: %q", got)
	}
	if got := moneyText(13775e6); got != "$13.775 millones" {
		t.Fatalf("plata: %q", got)
	}
}
