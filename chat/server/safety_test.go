package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Apagar y prender mueve el agente entre `agents` (lo único que lee `playground listen`) y `off`, sin perder ninguno.
func TestAgentsOnOff(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PLAYGROUND_TEAM_DIR", dir)
	list := `[{"name":"time","description":"hora","url":"http://127.0.0.1:5291/"},{"name":"fact","description":"dato","url":"http://127.0.0.1:5292/"}]`
	if err := os.WriteFile(filepath.Join(dir, "agents.json"), []byte(list), 0o600); err != nil {
		t.Fatal(err)
	}
	read := func() agentsFileShape {
		raw, _ := os.ReadFile(filepath.Join(dir, "agents.json"))
		var s agentsFileShape
		if err := json.Unmarshal(raw, &s); err != nil {
			t.Fatalf("agents.json quedó inválido: %v", err)
		}
		return s
	}
	names := func(l []ownAgent) (out []string) {
		for _, a := range l {
			out = append(out, a.Name)
		}
		return
	}

	if err := setAgentsOn("fact", false); err != nil {
		t.Fatal(err)
	}
	if s := read(); len(s.Agents) != 1 || s.Agents[0].Name != "time" || len(s.Off) != 1 || s.Off[0].Name != "fact" {
		t.Fatalf("apagar fact: agents=%v off=%v", names(s.Agents), names(s.Off))
	}
	if err := setAgentsOn("", false); err != nil {
		t.Fatal(err)
	}
	if s := read(); len(s.Agents) != 0 || len(s.Off) != 2 {
		t.Fatalf("apagar todo: agents=%v off=%v", names(s.Agents), names(s.Off))
	}
	if err := setAgentsOn("time", true); err != nil {
		t.Fatal(err)
	}
	if s := read(); len(s.Agents) != 1 || s.Agents[0].Name != "time" || s.Agents[0].URL != "http://127.0.0.1:5291/" {
		t.Fatalf("prender time: agents=%v", names(s.Agents))
	}
	if err := setAgentsOn("nadie", true); err == nil {
		t.Fatal("un agente que no existe tendría que dar error")
	}
}
