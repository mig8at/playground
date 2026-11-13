package review

import "testing"

func TestRemoteSlug(t *testing.T) {
	for url, want := range map[string]string{
		"git@github.com-mig:Creditop-SAS/legacy-backend.git": "Creditop-SAS/legacy-backend",
		"git@github.com:Creditop-SAS/playground.git":         "Creditop-SAS/playground",
		"https://github.com/google/elephant-goldfish-model":  "google/elephant-goldfish-model",
		"ssh://git@github.com/owner/name.git":                "owner/name",
		"git@gitlab.com:owner/name.git":                      "",
	} {
		got := ""
		if m := reRemote.FindStringSubmatch(url); m != nil {
			got = m[1]
		}
		if got != want {
			t.Errorf("%s → %q, quería %q", url, got, want)
		}
	}
}

// Dos clones del mismo repo traen la misma rama: queda la del clon que se llama como el repo.
func TestDedupe(t *testing.T) {
	task := &Task{Slug: "t"}
	in := []Branch{
		{Repo: "legacy-backend-finandina", Slug: "Creditop-SAS/legacy-backend", Name: "fix/x", Updated: "2026-11-13", Task: task},
		{Repo: "legacy-backend", Slug: "Creditop-SAS/legacy-backend", Name: "fix/x", Updated: "2026-11-12"},
		{Repo: "legacy-backend", Slug: "Creditop-SAS/legacy-backend", Name: "fix/y", Updated: "2026-11-12"},
	}
	out := dedupe(in)
	if len(out) != 2 || out[0].Repo != "legacy-backend" || out[0].Task != task {
		t.Fatalf("dedupe = %+v", out)
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
