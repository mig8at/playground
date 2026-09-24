package atlassian

import (
	"regexp"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// Jira y Confluence comparten credenciales y cliente: son UN conector. La ruta va pegada a una comilla
// para que la prosa que la nombra —las descripciones de las herramientas de `jira-mcp`— no cuente.
func TestNoOtherAtlassianClientInTheRepo(t *testing.T) {
	client := regexp.MustCompile(`(["'\x60]|\})(/wiki)?/rest/(api/[23]|api|agile)/`)
	allowed := map[string]string{
		"tools/confluence.py": "el cliente de Confluence sigue en Python hasta que se porte (fase 5 de la tarea #90)",
	}
	if offenders := repocheck.Offenders(t, client, allowed); len(offenders) > 0 {
		t.Errorf("hay clientes de Atlassian fuera de connectors/ (usá connectors/atlassian): %v", offenders)
	}
}
