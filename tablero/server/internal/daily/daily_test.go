package daily

import (
	"strings"
	"testing"
	"time"
)

// El día se nombra como se dice en la daily: «Ayer» si fue el día anterior (o el mismo, armada para mañana); si no,
// por su nombre («El viernes», dicho el lunes).
func TestSpoken(t *testing.T) {
	monday := time.Date(2026, 11, 23, 7, 30, 0, 0, time.Local)
	for day, want := range map[string]string{
		"2026-11-22": "Ayer",
		"2026-11-23": "Ayer",
		"2026-11-20": "El viernes",
		"2026-11-18": "El miércoles",
	} {
		if got := Spoken(day, monday); got != want {
			t.Errorf("%s dicho el lunes: %q, quería %q", day, got, want)
		}
	}
}

// Lo que va al modelo: por tarea, con su Jira y sus minutos, sin la línea de cómo se midieron.
func TestPrompt(t *testing.T) {
	in := Input{Day: "2026-11-18", Items: []Item{{Title: `"Finandina"`, Jira: []string{"CORE-845"}, Minutes: 100,
		Notes: []Note{{Title: "Flujo completo", Text: cleanNote("cerró autorizada\n\nMINUTOS: medidos por el lapso")}}}}}
	p := Prompt(in)
	if !strings.Contains(p, "## Finandina (CORE-845) — 100 min") || !strings.Contains(p, "- Flujo completo: cerró autorizada") || strings.Contains(p, "MINUTOS") {
		t.Fatalf("prompt:\n%s", p)
	}
}
