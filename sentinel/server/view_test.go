package main

import (
	"strings"
	"testing"
)

func TestParseAndValidateView(t *testing.T) {
	report := "# Informe\n\nTexto.\n\n```json\n" + `{
  "headline": "Semana con un despliegue roto",
  "level": "naranja",
  "findings": [
    {"title": "Columna que no existe", "severity": "alert", "status": "open", "summary": "…", "evidence": ["26/11"],
     "signals": ["stage:platform", "stage:inventada"], "files": ["no/existe/Nada.php"]},
    {"title": "Raro", "severity": "grave", "status": "quien-sabe", "summary": "…", "signals": []}
  ],
  "trends": [{"signal": "merchant:189", "note": "baja"}, {"signal": "merchant:999999", "note": "?"}],
  "actions": [{"text": "mirar", "signal": "lender:inventada"}]
}` + "\n```\n"
	v, rest, err := parseView(report)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rest, "```json") || !strings.Contains(rest, "Texto.") {
		t.Errorf("el informe tiene que quedar sin el bloque: %q", rest)
	}
	validateView(v, map[string]bool{"stage:platform": true, "merchant:189": true})
	if v.Level != "yellow" {
		t.Errorf("un nivel inválido queda amarillo: %s", v.Level)
	}
	if got := v.Findings[0].Signals; len(got) != 1 || got[0] != "stage:platform" {
		t.Errorf("la señal inventada se saca: %v", got)
	}
	if v.Findings[1].Severity != "info" || v.Findings[1].Status != "open" {
		t.Errorf("gravedad y estado inválidos se normalizan: %+v", v.Findings[1])
	}
	if len(v.Trends) != 1 || v.Actions[0].Signal != "" {
		t.Errorf("tendencias y acciones sin señales inventadas: %+v %+v", v.Trends, v.Actions)
	}
	if v.Files["no/existe/Nada.php"] {
		t.Error("un archivo que no existe en main queda marcado")
	}
	if len(v.Checks) < 4 {
		t.Errorf("lo descartado queda escrito: %v", v.Checks)
	}
}

func TestParseViewWithoutBlock(t *testing.T) {
	if _, rest, err := parseView("sólo texto"); err == nil || rest != "sólo texto" {
		t.Error("sin bloque: error y el informe intacto")
	}
}
