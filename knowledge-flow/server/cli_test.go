package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// decide escribe overrides.json con las claves que lee `drift.py final` y rechaza lo que el paso «Juntar» o el
// verificador no podrían usar: una sección que no existe, un «change» sin texto, una evidencia que no parsea.
func TestDecide(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "knowledge-flow", ".data", "runs", "7")
	_ = os.MkdirAll(filepath.Join(dir, "drift"), 0o755)
	r := &Run{ID: 7, State: stStopped, Steps: newSteps()}
	raw, _ := json.Marshal(r)
	_ = os.WriteFile(filepath.Join(dir, "run.json"), raw, 0o644)
	_ = os.WriteFile(filepath.Join(dir, "drift", "secciones.json"),
		[]byte(`{"t#a": {"topic": "t", "prose": "x", "files": ["infra:a.yml"]}}`), 0o644)

	for _, c := range []struct {
		args []string
		code int
	}{
		{[]string{"decide", "7", "t#nope", "--verdict", "keep", "--why", "w"}, 3},
		{[]string{"decide", "7", "t#a", "--verdict", "change", "--why", "w"}, 2},
		{[]string{"decide", "7", "t#a", "--verdict", "maybe", "--why", "w"}, 2},
		{[]string{"decide", "7", "t#a", "--verdict", "change", "--why", "w", "--text", "## T\nx"}, 2},
		{[]string{"decide", "7", "t#a", "--verdict", "change", "--why", "w", "--text", "x", "--evidence", "other:b.yml"}, 2},
		{[]string{"decide", "7", "t#a", "--verdict", "change", "--why", "w", "--text", "nuevo", "--evidence", "infra:b.yml:3 (nota)"}, 0},
		{[]string{"decide", "8", "t#a", "--verdict", "keep", "--why", "w"}, 3},
	} {
		if got := runCLI(root, c.args); got != c.code {
			t.Errorf("%v → %d, quería %d", c.args, got, c.code)
		}
	}
	var ov map[string]override
	raw, _ = os.ReadFile(filepath.Join(dir, "drift", "overrides.json"))
	if err := json.Unmarshal(raw, &ov); err != nil || ov["t#a"].Verdict != "cambia" || ov["t#a"].NewText != "nuevo" {
		t.Fatalf("overrides.json: %s", raw)
	}
}
