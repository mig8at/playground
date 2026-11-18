package main

import "testing"

// Los pasos nacen en espera (si no, el ejecutor los salta y la corrida «pasa» sin hacer nada: pasó el 2026-11-18).
func TestNewStepsAreQueued(t *testing.T) {
	steps := newSteps()
	if len(steps) != 10 {
		t.Fatalf("son diez pasos: %d", len(steps))
	}
	for _, s := range steps {
		if s.State != stQueued {
			t.Fatalf("%s nace %q", s.ID, s.State)
		}
	}
}

// La huella de los cambios no depende del orden: los mismos cambios son la misma corrida.
func TestFingerprintIgnoresOrder(t *testing.T) {
	a := []Change{{Topic: "x", Repo: "r", Path: "a", State: "changed"}, {Topic: "y", Repo: "r", Path: "b", State: "changed"}}
	b := []Change{a[1], a[0]}
	if fingerprint(a) != fingerprint(b) {
		t.Fatal("mismo conjunto, distinta huella")
	}
	if fingerprint(a) == fingerprint(a[:1]) {
		t.Fatal("otro conjunto, misma huella")
	}
}

// Un paquete de código llega con su diff y su archivo adentro: el modelo no puede correr git.
func TestExpandFindsGitDiff(t *testing.T) {
	m := reGitDiff.FindStringSubmatch("- infra:.github/x.yml: `git -C /tmp/r diff abc123 origin/main -- .github/x.yml`")
	if m == nil || m[1] != "/tmp/r" || m[2] != "abc123" || m[3] != "origin/main" || m[4] != ".github/x.yml" {
		t.Fatalf("partes: %q", m)
	}
}
