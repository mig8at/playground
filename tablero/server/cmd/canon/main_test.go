package main

import (
	"strings"
	"testing"

	"creditop/playground/connectors/canon"
)

// La lista por etapas: cada tema en su etapa, y los que no tienen estación como transversales. Ninguno se
// pierde: un tema que no aparece es un tema que nadie sabe que existe.
func TestCompactStagesListsEveryTopic(t *testing.T) {
	topics := []canon.TopicSummary{{Topic: "actores"}, {Topic: "canales"}, {Topic: "cartera"}}
	stages := []canon.Stage{{Title: "ENTRADA", Topics: []string{"canales"}}, {Title: "PAGOS", Topics: []string{"cartera"}}}
	got := compactStages(topics, stages)
	for _, want := range []string{"entrada", "canales", "pagos", "cartera", "transversales", "actores"} {
		if !strings.Contains(got, want) {
			t.Errorf("falta %q en:\n%s", want, got)
		}
	}
}
