package main

import (
	"testing"
	"time"
)

func TestMonthWindows(t *testing.T) {
	// El 31 de marzo contra febrero: el día se recorta al último del mes anterior.
	from, pf, pt := monthWindows(time.Date(2026, 3, 31, 10, 30, 0, 0, bogota))
	if from.Day() != 1 || from.Month() != 3 || pf.Month() != 2 || pt.Day() != 28 || pt.Hour() != 10 {
		t.Fatalf("ventanas: %v %v %v", from, pf, pt)
	}
}

func TestWindowWeight(t *testing.T) {
	// Del lunes 2 al lunes 9 de noviembre de 2026: el 2 es festivo, cuatro hábiles y un fin de semana.
	from := time.Date(2026, 11, 2, 0, 0, 0, 0, bogota)
	w := windowWeight(from, from.AddDate(0, 0, 7))
	want := 4 + 3*restDayWeight
	if w < want-0.001 || w > want+0.001 {
		t.Fatalf("peso %v, quería %v", w, want)
	}
	// Medio día hábil pesa medio.
	if w := windowWeight(from.AddDate(0, 0, 1), from.AddDate(0, 0, 1).Add(12*time.Hour)); w != 0.5 {
		t.Fatalf("medio día: %v", w)
	}
}

func TestPaceText(t *testing.T) {
	for p, want := range map[float64]string{-1: "—", 0: "−100 %", 1: "igual", 1.24: "+24 %", 0.67: "−33 %", 24.6: "×25"} {
		if got := paceText(p); got != want {
			t.Errorf("paceText(%v) = %q, quería %q", p, got, want)
		}
	}
}
