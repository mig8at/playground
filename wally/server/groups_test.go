package main

import (
	"strings"
	"testing"
)

// La línea RESUMEN se encuentra aunque el modelo la decore (negrita, viñeta), y gana la última.
func TestTheSummaryLineIsFoundEvenDecorated(t *testing.T) {
	answer := "### Propuesta · x#y\nVeredicto: sigue cierta\n\nRESUMEN: borrador viejo\n\n- **RESUMEN:** 3 siguen ciertas; #y cambió\n"
	m := summaryLine.FindAllStringSubmatch(answer, -1)
	if len(m) == 0 || strings.TrimSpace(m[len(m)-1][1]) != "3 siguen ciertas; #y cambió" {
		t.Fatalf("quedó %q", m)
	}
}

// El pedido a un agente dice qué tema, qué cambió y que cierre con RESUMEN; el plan nombra a los agentes y los temas.
func TestTheBriefAndThePlanSayWhatToDo(t *testing.T) {
	brief := agentBrief("EVA", task{Topic: "motai-renting", Changed: []source{{Repo: "legacy-backend", Path: "a/B.php"}}})
	for _, want := range []string{"EVA", "`motai-renting`", "legacy-backend:a/B.php", "RESUMEN:", "No escribís nada"} {
		if !strings.Contains(brief, want) {
			t.Errorf("falta %q en el pedido:\n%s", want, brief)
		}
	}
	review := agentBrief("M-O", task{Topic: "admin-panel"})
	if !strings.Contains(review, "revisar el tema `admin-panel`") || !strings.Contains(review, "buscar") {
		t.Errorf("el pedido de revisión: %s", review)
	}
	plan := planText([]task{{Topic: "a"}, {Topic: "b", Changed: []source{{}}}}, "gemini-3.8-flash")
	for _, want := range []string{"EVA y M-O", "2 temas", "`a`: revisar", "`b`: poner al día (1 fuente"} {
		if !strings.Contains(plan, want) {
			t.Errorf("falta %q en el plan:\n%s", want, plan)
		}
	}
}
