package main

import "testing"

// Lo que una spec puede correr: la lista cerrada, sin shell, y el harness nunca contra prod.
func TestCheckRefuses(t *testing.T) {
	ok := []string{
		"make harness-case TARGET=local SUITE=harness/suites/compuerta-prami.json",
		"E2E_TARGET=local make harness-doctor TARGET=local",
		"bin/pg sql --target prod --query 'SELECT 1'",
		"go test ./cmd/agent",
	}
	for _, c := range ok {
		if _, _, why := check(c); why != "" {
			t.Errorf("%q no debería rechazarse: %s", c, why)
		}
	}
	refused := []string{
		"make harness-case TARGET=prod",
		"E2E_TARGET=prod make harness-listing",
		"make harness-case TARGET=local && rm -rf x",
		"rm -rf tablero",
		"make fresh",
		"npx playwright test",
		"bin/pg admin client-disable --apply",
		"echo $(whoami)",
	}
	for _, c := range refused {
		if _, _, why := check(c); why == "" {
			t.Errorf("%q debería rechazarse", c)
		}
	}
}

func TestSplitKeepsQuotedWords(t *testing.T) {
	got, err := split(`make harness-case CASES='pullman;motai' TARGET=local`)
	if err == nil && len(got) == 4 && got[2] == "CASES=pullman;motai" {
		return
	}
	t.Fatalf("split: %q %v", got, err)
}
