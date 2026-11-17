package hooks

import (
	"strings"
	"testing"
	"time"
)

func TestParsePorcelainReadsCodesAndRenames(t *testing.T) {
	out := "M  harness/harness.json\x00 M tablero/a.go\x00R  nuevo.go\x00viejo.go\x00?? jarvis/flows/x.json\x00"
	got := parsePorcelain(out, t.TempDir())
	if len(got) != 4 {
		t.Fatalf("quería 4 entradas, dio %d: %+v", len(got), got)
	}
	if !got[0].staged || got[1].staged || got[2].path != "nuevo.go" || got[3].code != "??" || got[3].staged {
		t.Fatalf("códigos mal leídos: %+v", got)
	}
}

func TestStaleListsOnlyOldChangesGroupedAndStagedFirst(t *testing.T) {
	now := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
	ago := func(h int) time.Time { return now.Add(-time.Duration(h) * time.Hour) }
	out := formatStale([]pendingChange{
		{path: "tablero/tasks/jarvis/context.jsonl", code: " M", mod: ago(70)},
		{path: "jarvis/flows/a/1.json", code: "??", mod: ago(119)},
		{path: "jarvis/flows/a/2.json", code: "??", mod: ago(118)},
		{path: "harness/harness.json", code: "M ", staged: true, mod: ago(30)},
		{path: "chat/server/main.go", code: " M", mod: ago(2)}, // reciente: de una sesión viva
		{path: "borrado.go", code: " D"},                       // sin fecha ni staged: no se sabe
	}, now)
	for _, want := range []string{"4 cambio(s)", "● staged harness/harness.json · hace 30h",
		"jarvis/flows/a/ (2 nuevos) · hace 4d", "tablero/tasks/jarvis/context.jsonl · hace 2d"} {
		if !strings.Contains(out, want) {
			t.Errorf("falta %q en:\n%s", want, out)
		}
	}
	if strings.Contains(out, "chat/server") || strings.Contains(out, "borrado.go") {
		t.Errorf("lo reciente y el borrado sin fecha no van:\n%s", out)
	}
	if strings.Index(out, "harness.json") > strings.Index(out, "jarvis/flows") {
		t.Errorf("lo staged va primero:\n%s", out)
	}
}

func TestStaleSaysNothingWhenAllIsFresh(t *testing.T) {
	now := time.Now()
	if out := formatStale([]pendingChange{{path: "a.go", code: " M", mod: now}}, now); out != "" {
		t.Fatalf("sin nada viejo, nada que decir; dio:\n%s", out)
	}
}

func TestStaleCapsTheList(t *testing.T) {
	now := time.Now()
	var cs []pendingChange
	for i := 0; i < staleLines+3; i++ {
		cs = append(cs, pendingChange{path: string(rune('a'+i)) + ".go", code: " M", mod: now.Add(-72 * time.Hour)})
	}
	if out := formatStale(cs, now); !strings.Contains(out, "… y 3 más") {
		t.Fatalf("quería el corte con «… y 3 más»:\n%s", out)
	}
}
