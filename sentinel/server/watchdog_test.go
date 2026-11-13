package main

import (
	"strings"
	"testing"
	"time"
)

// El perro guardián: una pasada que lleva más de 2× el intervalo sin avanzar avisa UNA vez «Sentinel no está mirando»,
// sin esperar a que la pasada devuelva (colgada, no devuelve nunca). Una pasada que avanza, o ninguna, no avisa.
func TestWatchdogWarnsOnceWhenThePassStalls(t *testing.T) {
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}}
	s := &sentinel{notifier: n}
	now := time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)
	limit := 10 * time.Minute

	if s.checkStuck(now, limit) {
		t.Fatal("sin pasada corriendo no hay nada colgado")
	}
	s.running, s.progressAt = true, now.Add(-9*time.Minute)
	if s.checkStuck(now, limit) || len(n.notices) != 0 {
		t.Fatalf("9 min con límite de 10 no es un cuelgue: %+v", n.notices)
	}
	s.progressAt = now.Add(-11 * time.Minute)
	if !s.checkStuck(now, limit) {
		t.Fatal("11 min sin avanzar con límite de 10: tenía que avisar")
	}
	if len(n.notices) != 1 || n.notices[0].Level != "stale" || !strings.Contains(n.notices[0].Text, "11 min") {
		t.Fatalf("esperaba un aviso «stale» de 11 min: %+v", n.notices)
	}
	if s.err == "" {
		t.Fatal("la interfaz también tiene que enterarse (s.err)")
	}
	// La mirada siguiente la sigue viendo colgada, pero no repite el aviso.
	if !s.checkStuck(now.Add(time.Minute), limit) || len(n.notices) != 1 {
		t.Fatalf("el aviso se repitió: %+v", n.notices)
	}
	// Cuando la pasada por fin devuelve un error, `failed` tampoco avisa de nuevo: ya está avisado.
	n.failed(errTest("timeout"), now.Add(45*time.Minute))
	if len(n.notices) != 1 {
		t.Fatalf("failed repitió el aviso del perro guardián: %+v", n.notices)
	}
	// Y cuando una pasada termina bien, avisa que volvió y queda rearmado.
	n.observe(&Overview{}, now.Add(50*time.Minute))
	if len(n.notices) != 2 || n.notices[1].Level != "recovered" || n.StaleNotified || n.FailingSince != "" {
		t.Fatalf("esperaba «volvió a leer producción» y el estado limpio: %+v", n.notices)
	}
}

// Cada paso de la carga inicial es una señal de vida: una historia que tarda (29 días, ~11 min) no es un cuelgue.
func TestWatchdogDoesNotTakeLoadingForAStall(t *testing.T) {
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}}
	s := &sentinel{notifier: n, running: true, progressAt: time.Now().Add(-time.Hour)}
	s.setLoading("") // un paso de la carga
	if s.checkStuck(time.Now(), 10*time.Minute) || len(n.notices) != 0 {
		t.Fatalf("la carga avanzó recién: no tenía que avisar (%+v)", n.notices)
	}
}

type errTest string

func (e errTest) Error() string { return string(e) }

// Un proceso de afuera que no termina se corta al vencer el plazo, y el error lo dice.
func TestRunToolCutsAHungProcess(t *testing.T) {
	start := time.Now()
	_, err := runTool(200*time.Millisecond, "", "sleep", "30")
	if err == nil || !strings.Contains(err.Error(), "no contestó") {
		t.Fatalf("esperaba el error del plazo, dio %v", err)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("tardó %s en cortar un proceso con plazo de 200 ms", time.Since(start))
	}
	if out, err := runTool(5*time.Second, "", "echo", "hola"); err != nil || strings.TrimSpace(string(out)) != "hola" {
		t.Fatalf("un proceso sano: %q, %v", out, err)
	}
}

// Las consultas de Loki se leen por separado y se juntan SUMANDO: los errores de una entidad salen de dos fuentes.
func TestFreshMergeAdds(t *testing.T) {
	a, b := Fresh{}, Fresh{}
	a.add("2026-11-12", "lerr:6", "total", 10, 3)
	b.add("2026-11-12", "lerr:6", "total", 10, 4)
	b.add("2026-11-12", "lerr:6", "total", 11, 1)
	b.add("2026-11-13", "service:x", "total", 0, 2)
	a.merge(b)
	if got := a["2026-11-12"]["lerr:6"].Total; got[10] != 7 || got[11] != 1 {
		t.Fatalf("esperaba 7 y 1, dio %v", got)
	}
	if a["2026-11-13"]["service:x"].Total[0] != 2 {
		t.Fatalf("faltó el día nuevo: %v", a)
	}
}
