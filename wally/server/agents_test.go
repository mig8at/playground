package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

// El contexto precargado de un agente lleva quién es, el texto vigente de cada tema y el estado de sus fuentes.
func TestAgentContext(t *testing.T) {
	root, _ := filepath.Abs("../..")
	a := &app{root: root}
	ag := Agent{Name: "Pikachu", Intent: "tener al día KYC", Topics: []string{"identity-validation", "otp-source-and-bypass"}}
	got, err := a.agentContext(context.Background(), ag)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Sos **Pikachu**", "===== tema identity-validation =====", "----- sus fuentes -----", "===== fin de otp-source-and-bypass ====="} {
		if !strings.Contains(got, want) {
			t.Errorf("falta %q", want)
		}
	}
	t.Logf("%d caracteres precargados", len(got))
}
