package atlassian

import (
	"regexp"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// Jira y Confluence comparten credenciales y cliente: son UN conector. La ruta va pegada a una comilla
// para que la prosa que la nombra —en una descripción, en un mensaje— no cuente.
func TestNoOtherAtlassianClientInTheRepo(t *testing.T) {
	client := regexp.MustCompile(`(["'\x60]|\})(/wiki)?/rest/(api/[23]|api|agile)/`)
	if offenders := repocheck.Offenders(t, client, nil); len(offenders) > 0 {
		t.Errorf("hay clientes de Atlassian fuera de connectors/ (usá connectors/atlassian): %v", offenders)
	}
}
