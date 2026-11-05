package main

import "testing"

func TestAffirmative(t *testing.T) {
	for in, want := range map[string]bool{"sí": true, "Sí, dale": true, "si": true, "dale": true, "ok.": true, "no": false, "sin cambios": false, "simón": false, "": false} {
		if got := affirmative.MatchString(in); got != want {
			t.Errorf("%q: %v, se esperaba %v", in, got, want)
		}
	}
}
