package main

import (
	"strings"
	"testing"
	"time"
)

// Un jueves: 2026-10-22.
var thursday = time.Date(2026, 10, 22, 15, 4, 0, 0, time.Local)

func TestAskedDays(t *testing.T) {
	cases := []struct{ question, first, last, label string }{
		{"¿cómo te fue ayer?", "2026-10-21", "2026-10-21", "ayer"},
		{"¿y hoy?", "2026-10-22", "2026-10-22", "hoy"},
		{"¿y antier?", "2026-10-20", "2026-10-20", "anteayer"},
		{"¿como le fue hace una semana?", "2026-10-15", "2026-10-15", "el jueves 15 de octubre"},
		{"¿qué hizo hace 3 días?", "2026-10-19", "2026-10-19", "el lunes 19 de octubre"},
		{"¿que hizo el lunes de esta semana?", "2026-10-19", "2026-10-19", "el lunes 19 de octubre"},
		{"¿qué hizo el Miércoles?", "2026-10-21", "2026-10-21", "el miércoles 21 de octubre"},
		{"¿qué hizo el jueves?", "2026-10-22", "2026-10-22", "el jueves 22 de octubre"},
		{"¿y el viernes de la semana pasada?", "2026-10-16", "2026-10-16", "el viernes 16 de octubre"},
		{"¿qué hizo la semana pasada?", "2026-10-12", "2026-10-18", "la semana pasada (del 12 de octubre al 18 de octubre)"},
		{"¿cómo le fue esta semana?", "2026-10-19", "2026-10-22", "esta semana (del 19 de octubre a hoy)"},
		{"¿qué hizo el 2026-10-14?", "2026-10-14", "2026-10-14", "el miércoles 14 de octubre"},
		{"¿y el 14/10?", "2026-10-14", "2026-10-14", "el miércoles 14 de octubre"},
		{"¿y el 14 de octubre?", "2026-10-14", "2026-10-14", "el miércoles 14 de octubre"},
		{"¿y el 24 de diciembre?", "2025-12-24", "2025-12-24", "el miércoles 24 de diciembre"},
	}
	for _, c := range cases {
		days, label, ok := askedDays(c.question, thursday)
		if !ok || days[0] != c.first || days[len(days)-1] != c.last || label != c.label {
			t.Errorf("%q → %v %q %v; quería %s…%s %q", c.question, days, label, ok, c.first, c.last, c.label)
		}
	}
}

func TestAskedDaysSinDia(t *testing.T) {
	for _, q := range []string{"hola", "¿cómo va el sprint?", "¿qué tareas tiene activas?"} {
		if days, _, ok := askedDays(q, thursday); ok {
			t.Errorf("%q no nombra un día y dio %v", q, days)
		}
	}
}

func TestPlainDaySummaryNombraElDia(t *testing.T) {
	got := plainDaySummary("Miguel", "el lunes 19 de octubre", nil, 0)
	if !strings.HasPrefix(got, "El lunes 19 de octubre Miguel no registró") {
		t.Errorf("resumen: %q", got)
	}
}
