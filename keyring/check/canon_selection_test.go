package check

import "testing"

func TestCanonProbesRequireExplicitSelection(t *testing.T) {
	for _, groups := range [][]string{nil, Quick, {"services"}} {
		selected := Select(groups)
		if len(selected) == 0 {
			t.Fatalf("perdió las sondas habituales: %v", groups)
		}
		for _, probe := range selected {
			if probe.Group == "canon" {
				t.Fatalf("Canon entró por defecto en %v", groups)
			}
		}
	}
	selected := Select([]string{"canon"})
	if len(selected) != 1 || selected[0].Group != "canon" {
		t.Fatalf("se perdió la comprobación explícita: %+v", selected)
	}
	if len(Select(nil)) != len(allProbes())-1 {
		t.Fatal("se retiraron sondas habituales además de Canon")
	}
}
