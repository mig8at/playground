package main

import (
	"testing"
	"time"
)

// Los festivos de 2026 (el calendario oficial): los fijos, los trasladados al lunes y los de la Pascua.
func TestColombianDaysOff2026(t *testing.T) {
	want := []string{
		"2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18",
		"2026-06-08", "2026-06-15", "2026-06-29", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12",
		"2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
	}
	got := colombianDaysOff(2026)
	if len(got) != len(want) {
		t.Fatalf("%d festivos, debían ser %d: %v", len(got), len(want), got)
	}
	for _, d := range want {
		if !got[d] {
			t.Errorf("falta %s", d)
		}
	}
	monday := time.Date(2026, 11, 16, 10, 0, 0, 0, bogota)
	if !restDay(monday) || restDay(monday.AddDate(0, 0, 1)) {
		t.Fatal("el lunes 16/11/2026 es festivo y el martes no")
	}
}
