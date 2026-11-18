package main

import (
	"strings"
	"testing"
	"time"
)

// Lo que pasa a alerta y se avisa queda para explicarlo, una vez; «para mirar» no.
func TestAlertedIsTakenOnce(t *testing.T) {
	n := &notifier{dry: true, Episodes: map[Signal]*episode{},
		deliver: func(string, string, string, bool) (string, error) { return "prueba", nil }}
	now := time.Date(2026, 11, 18, 10, 0, 0, 0, bogota)
	o := &Overview{Rules: defaultRules(),
		All:      Subject{Signal: "all:production", State: "ok"},
		Services: []Subject{{Signal: "service:otp-service", Name: "otp-service · errores", State: "alert", Why: "130 contra 0"}},
		Lenders:  []Subject{{Signal: "lender:24", Name: "Credifamilia", State: "warn", Why: "pocas"}}}
	n.observe(o, now)
	got := n.takeAlerted()
	if len(got) != 1 || got[0].Signal != "service:otp-service" {
		t.Fatalf("para explicar: %+v", got)
	}
	if again := n.takeAlerted(); len(again) != 0 {
		t.Fatalf("se toma una sola vez: %+v", again)
	}
	n.observe(o, now.Add(5*time.Minute)) // sigue en alerta: ya se avisó, no se vuelve a explicar
	if again := n.takeAlerted(); len(again) != 0 {
		t.Fatalf("la misma alerta no se explica dos veces: %+v", again)
	}
	n.explained("service:otp-service", "por un despliegue")
	if n.explanations()["service:otp-service"] != "por un despliegue" {
		t.Fatal("el porqué queda en el episodio")
	}
}

// El semáforo del dictamen es el primero que aparece; las notas de Noctowl llegan sin «Cómo trabajás».
func TestVerdictLevelAndNotes(t *testing.T) {
	if l := verdictLevel("**Dictamen: 🟡 hay que echarle ojo** … nada 🔴"); l != "yellow" {
		t.Fatalf("nivel: %s", l)
	}
	if l := verdictLevel("sin semáforo"); l != "" {
		t.Fatalf("sin semáforo: %s", l)
	}
	notes := noctowlNotes("../..")
	if notes == "" || strings.Contains(notes, "## Cómo trabajás") || !strings.Contains(notes, "## Cómo decide Sentinel") {
		t.Fatalf("notas de Noctowl: %.200s", notes)
	}
}
