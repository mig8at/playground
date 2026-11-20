package main

import (
	"testing"
	"time"
)

// Una sesión cuya meta terminó (o que nunca tuvo una) se cierra a los doneIdle; una con su Claude en una meta, recién
// a los idle. Lo que abrió la persona no entra nunca, y `cleanup` manual cierra las terminadas sin esperar.
func TestCleanupPlanDoneVersusWorking(t *testing.T) {
	tabs := NewTabs(nil)
	person := tabs.Get("") // de la persona
	done := tabs.NewBy(true)
	working := tabs.NewBy(true)
	if err := working.Asker.Begin("una meta que sigue", ""); err != nil {
		t.Fatal(err)
	}
	tabs.NewBy(true) // la última, vacía: no se toca
	now := time.Now().Add(5 * time.Minute)

	ids := func(items []CleanupItem) map[string]bool {
		m := map[string]bool{}
		for _, it := range items {
			m[it.Session] = true
		}
		return m
	}
	got := ids(tabs.Plan(now, 10*time.Minute, false))
	if !got[done.ID] || got[working.ID] || got[person.ID] || len(got) != 1 {
		t.Fatalf("a los 5 min tendría que cerrarse sólo la terminada (%s), el plan: %v", done.ID, got)
	}
	got = ids(tabs.Plan(time.Now().Add(15*time.Minute), 10*time.Minute, false))
	if !got[working.ID] {
		t.Fatalf("a los 15 min sin un comando, la que trabaja también (se olvidó): %v", got)
	}
	got = ids(tabs.Plan(time.Now(), 10*time.Minute, true))
	if !got[done.ID] || got[working.ID] {
		t.Fatalf("cleanup manual: la terminada ya, la que trabaja no: %v", got)
	}
	working.Asker.End()
	if closed := tabs.Sweep(time.Now().Add(5*time.Minute), 10*time.Minute); len(closed) != 2 {
		t.Fatalf("terminada la meta, a los 5 min se cierran las dos: %v", closed)
	}
	if tabs.Get(person.ID) == nil {
		t.Fatal("la de la persona no se cierra nunca")
	}
}
