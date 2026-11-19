package main

import (
	"fmt"
	"testing"
)

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

// Una corrida que falló porque el modelo no contestaba se reintenta sobre los mismos cambios, siempre; una que falló
// por otra cosa, hasta maxFailedTries; una frenada, nunca (pasó el 2026-11-19: tres corridas con la sesión vencida
// dejaron esos temas viejos aunque la sesión volviera).
func TestRetryAfterFailure(t *testing.T) {
	f := &flow{runs: &runStore{dir: t.TempDir()}}
	save := func(id int, state string, down bool) *Run {
		r := &Run{ID: id, State: state, Fingerprint: "fp", ModelDown: down}
		f.runs.save(r)
		return r
	}
	if r := save(1, stFailed, true); !f.retryable(r, "fp") {
		t.Fatal("sin modelo tiene que reintentar")
	}
	if r := save(2, stFailed, false); !f.retryable(r, "fp") {
		t.Fatal("el primer fallo de otra cosa se reintenta")
	}
	save(3, stFailed, false)
	if r := save(4, stFailed, false); f.retryable(r, "fp") {
		t.Fatalf("después de %d fallos seguidos no se insiste", maxFailedTries)
	}
	if r := save(5, stStopped, false); f.retryable(r, "fp") {
		t.Fatal("una frenada espera a que la mires")
	}
}

func TestModelUnavailable(t *testing.T) {
	if !modelUnavailable(fmt.Errorf("grupo-1.md: Claude: %w", fmt.Errorf("sesión del playground: venció, corré `playground login`"))) {
		t.Fatal("la sesión vencida es el modelo caído")
	}
	if modelUnavailable(fmt.Errorf("drift.py final: sin_decidir")) {
		t.Fatal("un error del método no es el modelo")
	}
}

// Retomar una corrida que cayó por el modelo vuelve a poner en espera el paso que falló (y los que siguen ya estaban en
// espera): los pasos hechos no se repiten.
func TestResumeRequeuesTheFailedStep(t *testing.T) {
	f := &flow{runs: &runStore{dir: t.TempDir()}}
	r := &Run{ID: 1, State: stFailed, ModelDown: true, Result: "falló", Steps: newSteps()}
	r.step("package").State = stDone
	r.step("triage").State = stFailed
	r = f.resume(r)
	if r.State != stRunning || r.ModelDown || r.Result != "" || r.Resumed != 1 {
		t.Fatalf("la corrida no quedó en marcha: %+v", r)
	}
	if r.step("package").State != stDone || r.step("triage").State != stQueued {
		t.Fatalf("pasos: package %s · triage %s", r.step("package").State, r.step("triage").State)
	}
}

// Se borran las frenadas y las falladas; las que pasaron no (están atadas a un commit). Y un número borrado no se reusa.
func TestDeleteRunAndNumbers(t *testing.T) {
	dir := t.TempDir()
	f := &flow{runs: &runStore{dir: dir + "/runs"}}
	for id, st := range map[int]string{1: stPassed, 2: stFailed, 3: stStopped} {
		f.runs.save(&Run{ID: id, State: st})
	}
	if f.deleteRun(1) == nil {
		t.Fatal("una que pasó no se borra")
	}
	if err := f.deleteRun(2); err != nil {
		t.Fatal(err)
	}
	if err := f.deleteRun(3); err != nil {
		t.Fatal(err)
	}
	if n := f.runs.next(); n != 2 {
		t.Fatalf("después de la #1 sigue la #2: %d", n)
	}
	if n := f.runs.next(); n != 3 {
		t.Fatalf("la #2 ya se dio: %d", n)
	}
}
