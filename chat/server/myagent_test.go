package main

import (
	"os"
	"strings"
	"testing"
)

// Tu agente lee el playground: las credenciales y los lectores de terminal tienen que quedar negados, y la lista de
// comandos permitidos no puede traer nada que escriba.
func TestMyAgentPermissions(t *testing.T) {
	denied := strings.Join(deniedTools(), ",")
	for _, must := range []string{"Read(**/.env)", "Read(**/.env.*)", "Read(**/secrets/**)", "Bash(cat:*)", "Bash(grep:*)", "Bash(rg:*)", "Bash(find:*)", "Bash(sh:*)", "Bash(curl:*)"} {
		if !strings.Contains(denied, must) {
			t.Errorf("falta negar %s", must)
		}
	}
	for _, c := range playgroundReadCommands {
		for _, bad := range []string{"harness", "--apply", "create", "delete", "post", "admin", "fresh", "migrate"} {
			if strings.Contains(c, bad) {
				t.Errorf("el comando permitido %q parece escribir (%s)", c, bad)
			}
		}
	}
	for id, alias := range claudeAlias {
		if !myAgentModels[id] || alias == "" {
			t.Errorf("el modelo %s no tiene alias de Claude Code", id)
		}
	}
	if os.Getenv("PRINT_DENIED") != "" {
		t.Log(denied)
	}
}
