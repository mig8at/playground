package main

import (
	"math"
	"testing"
	"time"
)

// chronosLevel: con los pisos de Sentinel, una señal casi constante no marca por salirse apenas del rango, y un error
// sólo marca si además supera el mínimo y ×1,5 lo esperado.
func TestChronosLevelFloors(t *testing.T) {
	r := defaultRules()
	q := []float64{1435, 1436, 1438, 1440, 1445, 1450, 1460} // p0,5 … p99,5
	if got := chronosLevel("logs:self-manager-api", 1432, q, r); got != levelOK {
		t.Fatalf("una caída de 8 líneas sobre 1.440 marcó %d", got)
	}
	vol := []float64{15, 18, 22, 33, 45, 52, 56}
	if got := chronosLevel("all:production", 12, vol, r); got != levelAlert {
		t.Fatalf("12 contra un rango 15–56 debía ser alerta, dio %d", got)
	}
	errs := []float64{19, 22, 30, 55, 80, 100, 115}
	if got := chronosLevel("service:x", 168, errs, r); got != levelAlert {
		t.Fatalf("168 errores contra 55 esperados debía ser alerta, dio %d", got)
	}
	small := []float64{0, 0, 1, 2, 4, 6, 8}
	if got := chronosLevel("service:x", 9, small, r); got != levelOK {
		t.Fatalf("9 errores (menos del mínimo de 10) marcó %d", got)
	}
}

// hourly suma los 12 bloques de cada hora y deja NaN en los días que no están guardados.
func TestHourly(t *testing.T) {
	arr := &[bucketsPerDay]int{}
	for b := 12; b < 24; b++ {
		arr[b] = 2 // la 1 de la mañana: 24
	}
	se := &series{total: map[string]*[bucketsPerDay]int{"2026-11-17": arr}}
	from := time.Date(2026, 11, 17, 0, 0, 0, 0, bogota)
	got := hourly(se, map[string]bool{"2026-11-17": true}, from, from.Add(26*time.Hour))
	if got[0] != 0 || got[1] != 24 || !math.IsNaN(got[24]) || len(got) != 26 {
		t.Fatalf("%v", got[:3])
	}
	flags := restFlags(time.Date(2026, 11, 13, 23, 0, 0, 0, bogota), 2) // viernes 23 h, sábado 0 h
	if flags[0] != 0 || flags[1] != 1 {
		t.Fatalf("%v", flags)
	}
}
