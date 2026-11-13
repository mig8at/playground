package review

import (
	"context"
	"testing"
)

func TestRemoteSlug(t *testing.T) {
	for url, want := range map[string]string{
		"git@github.com-mig:Creditop-SAS/legacy-backend.git": "Creditop-SAS/legacy-backend",
		"git@github.com:Creditop-SAS/playground.git":         "Creditop-SAS/playground",
		"https://github.com/google/elephant-goldfish-model":  "google/elephant-goldfish-model",
		"ssh://git@github.com/owner/name.git":                "owner/name",
		"git@gitlab.com:owner/name.git":                      "",
	} {
		if got := slugOfURL(url); got != want {
			t.Errorf("%s → %q, quería %q", url, got, want)
		}
	}
}

func TestParsePRURL(t *testing.T) {
	slug, n, err := ParsePRURL("https://github.com/Creditop-SAS/legacy-backend/pull/1693/files#diff-1")
	if err != nil || slug != "Creditop-SAS/legacy-backend" || n != 1693 {
		t.Errorf("= %q %d %v", slug, n, err)
	}
	if _, _, err := ParsePRURL("https://github.com/Creditop-SAS/legacy-backend/issues/3"); err == nil {
		t.Error("una issue no es un PR")
	}
}

// Los repos principales van primero aunque estén vacíos; dentro, del más reciente al más viejo.
func TestGroup(t *testing.T) {
	prs := []PR{
		{Slug: "Creditop-SAS/vtex", Number: 1, Updated: "2026-11-10"},
		{Slug: "Creditop-SAS/legacy-backend", Number: 2, Updated: "2026-11-01"},
		{Slug: "Creditop-SAS/legacy-backend", Number: 3, Updated: "2026-11-12"},
	}
	bs := group(context.Background(), prs)
	if len(bs) != 4 || bs[0].Name != "legacy-backend" || bs[1].Name != "frontend-monorepo" || bs[3].Name != "vtex" {
		t.Fatalf("bloques = %+v", bs)
	}
	if bs[0].PRs[0].Number != 3 || len(bs[1].PRs) != 0 {
		t.Errorf("orden dentro del bloque: %+v", bs[0].PRs)
	}
}

// Una rama de una tarea: por nombre, por patrón y con el repo delante.
func TestForBranch(t *testing.T) {
	a, b, c := Task{Slug: "a"}, Task{Slug: "b"}, Task{Slug: "c"}
	ts := Tasks{
		{pattern: "fix/x", task: a},
		{repo: "vtex", pattern: "fix/x", task: b},
		{pattern: "feat/abaco-*", task: c},
	}
	if got := ts.ForBranch("vtex", "fix/x"); got == nil || got.Slug != "b" {
		t.Errorf("con repo: %v", got)
	}
	if got := ts.ForBranch("legacy-backend", "fix/x"); got == nil || got.Slug != "a" {
		t.Errorf("sin repo: %v", got)
	}
	if got := ts.ForBranch("x", "feat/abaco-cupo"); got == nil || got.Slug != "c" {
		t.Errorf("patrón: %v", got)
	}
	if got := ts.ForBranch("x", "otra"); got != nil {
		t.Errorf("ninguna: %v", got)
	}
}
