package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func repo(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "init", "-q")
	git(t, dir, "commit", "-q", "--allow-empty", "-m", "inicio")
}

func TestTheProposalTakesOnlyTheTasksCommitsAndTimeNotYetLogged(t *testing.T) {
	now := time.Now()
	data := t.TempDir()
	entries := filepath.Join(data, "entries")
	if err := os.MkdirAll(entries, 0o755); err != nil {
		t.Fatal(err)
	}
	// Dos entradas de hoy, de tareas distintas: el lapso arranca donde terminó la ÚLTIMA.
	start := now.Add(-50 * time.Minute).Truncate(time.Minute)
	lines := `{"day":"` + now.Format("2006-01-02") + `","minutes":10,"startedAt":"` + start.Format(time.RFC3339) + `"}` + "\n" +
		`{"day":"` + now.Format("2006-01-02") + `","minutes":20,"startedAt":"` + start.Add(10*time.Minute).Format(time.RFC3339) + `"}` + "\n"
	if err := os.WriteFile(filepath.Join(entries, now.Format("2006-01")+".jsonl"), []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}

	playground := filepath.Join(t.TempDir(), "playground")
	repo(t, playground)
	git(t, playground, "commit", "-q", "--allow-empty", "-m", "tablero: el cierre propone")
	git(t, playground, "commit", "-q", "--allow-empty", "-m", "canon: otra sesión, otra tarea")
	git(t, playground, "commit", "-q", "--allow-empty", "-m", "pg: algo de la tarea 84")

	repos := t.TempDir()
	vtex := filepath.Join(repos, "vtex")
	repo(t, vtex)
	git(t, vtex, "checkout", "-q", "-b", "feat/core-800-vtex-payment-link")
	git(t, vtex, "commit", "-q", "--allow-empty", "-m", "feat: el conector")
	git(t, vtex, "worktree", "add", "-q", filepath.Join(repos, "vtex-otra"), "-b", "otra")
	other := filepath.Join(repos, "shopify")
	repo(t, other)
	git(t, other, "checkout", "-q", "-b", "feat/core-801-shopify-payment-link")
	git(t, other, "commit", "-q", "--allow-empty", "-m", "feat: la app")

	tk := task{ID: 84, Slug: "tablero", Branches: []string{"vtex:payment-link"}}
	p, err := propose(data, tk, now, playground, repos)
	if err != nil {
		t.Fatal(err)
	}
	if want := start.Add(30 * time.Minute).Format("15:04"); p.Since != want {
		t.Fatalf("el lapso arranca a las %s, quería %s (el final de la última entrada)", p.Since, want)
	}
	var got []string
	for _, rc := range p.Commits {
		for _, l := range rc.Lines {
			_, subject, _ := strings.Cut(l, " ")
			got = append(got, rc.Repo+": "+subject)
		}
	}
	want := "playground: pg: algo de la tarea 84 · playground: tablero: el cierre propone · vtex: feat: el conector"
	if strings.Join(got, " · ") != want {
		t.Fatalf("commits = %q\nquería     %q", strings.Join(got, " · "), want)
	}
	if !strings.Contains(p.BlockBody, "Resultado: 1 commits de la tarea en vtex.") || !strings.Contains(p.WorklogCmd, "--lapso "+p.Since+"-"+p.Until) {
		t.Fatalf("propuesta incompleta:\n%s\n%s", p.BlockBody, p.WorklogCmd)
	}
}
