package knowledge

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"creditop/playground/connectors/repos"
)

func TestSourceChecksCatchDriftAndMissingEvidence(t *testing.T) {
	dir := t.TempDir()
	repo := filepath.Join(dir, "backend")
	os.MkdirAll(repo, 0755)
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repo, "-c", "user.name=Knowledge test", "-c", "user.email=knowledge@example.invalid"}, args...)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	git("init", "-b", "main")
	os.WriteFile(filepath.Join(repo, "Rule.php"), []byte("primera regla"), 0644)
	git("add", "Rule.php")
	git("commit", "-m", "baseline")
	commit, blob := git("rev-parse", "main"), git("rev-parse", "main:Rule.php")
	tools := filepath.Join(dir, "tools")
	os.MkdirAll(tools, 0755)
	raw, _ := json.Marshal(map[string]any{"indexed": map[string]string{"backend": repo}})
	os.WriteFile(filepath.Join(tools, "repos.json"), raw, 0644)
	l := Library{Topics: []Topic{{ID: "rule", Metadata: Metadata{Sources: []Source{{Repo: "backend", Path: "Rule.php", Commit: commit, Blob: blob}}}}}}
	check := func(want string) {
		t.Helper()
		states, err := l.Check(repos.New(tools))
		if len(states) != 1 || states[0].State != want || (err != nil) != (want != "unchanged") {
			t.Fatalf("quería %s, dio %+v %v", want, states, err)
		}
	}
	check("unchanged")
	os.WriteFile(filepath.Join(repo, "Rule.php"), []byte("regla que cambió"), 0644)
	git("add", "Rule.php")
	git("commit", "-m", "changed")
	check("changed")
	git("rm", "Rule.php")
	git("commit", "-m", "removed")
	check("missing")
	l.Topics[0].Sources[0].Blob = strings.Repeat("b", 40)
	check("invalid")
	l.Topics[0].Sources[0].Repo = "unknown"
	check("unavailable")
	if _, err := (Library{}).Check(repos.New(tools)); err == nil {
		t.Fatal("un catálogo vacío pasó como comprobado")
	}
}
