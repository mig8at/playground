package slack

import (
	"regexp"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// Hasta el 2026-09-24 el trazador leía #tech-ops con su propio cliente HTTP. Un cliente de Slack fuera
// de acá es también uno que puede escribir en un canal sin pasar por el guard.
func TestNoOtherSlackClientInTheRepo(t *testing.T) {
	client := regexp.MustCompile(`slack\.com/api`)
	if offenders := repocheck.Offenders(t, client, nil); len(offenders) > 0 {
		t.Errorf("hay clientes de Slack fuera de connectors/ (usá connectors/slack): %v", offenders)
	}
}
