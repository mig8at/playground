package traps

import (
	"strings"
	"testing"
)

// El documento real pone las trampas justo después del último índice, sin un `## ` en el medio. Si el
// índice se extendiera hasta el próximo `## `, «citaría» todas las anclas de abajo y nunca faltaría
// ninguna: el chequeo estaría muerto para el último índice, que es lo que pasó hasta el 2026-09-23.
func TestTheLastIndexEndsAtTheFirstTrap(t *testing.T) {
	doc := strings.Split(strings.Join([]string{
		"# Trampas",
		"## Índice · por síntoma",
		"- se traba → F-01, F-02",
		"## Índice · de una línea",
		"- F-01 · la primera",
		"### F-01 · la primera",
		"texto",
		"### F-02 · la segunda, que el índice de una línea no nombra",
	}, "\n"), "\n")
	total, failures := ReviewIndex(doc)
	if total != 2 {
		t.Fatalf("anclas = %d, quería 2", total)
	}
	if len(failures) != 1 || !strings.Contains(failures[0], "«Índice · de una línea» no cita 1: F-02") {
		t.Errorf("fallas = %q", failures)
	}
}

func TestAnIndexCitingAMissingTrapFails(t *testing.T) {
	_, failures := ReviewIndex([]string{"## Índice", "- F-07", "### F-01 · única"})
	joined := strings.Join(failures, "\n")
	if !strings.Contains(joined, "no cita 1: F-01") || !strings.Contains(joined, "cita F-07, sin ancla") {
		t.Errorf("fallas = %q", failures)
	}
}

func TestTrapsWithoutAnyIndexFail(t *testing.T) {
	if _, failures := ReviewIndex([]string{"### F-01 · suelta"}); len(failures) != 1 || !strings.Contains(failures[0], "sin-índice") {
		t.Errorf("fallas = %q", failures)
	}
}
