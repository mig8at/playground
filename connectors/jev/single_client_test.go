package jev

import (
	"regexp"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// Jev queda como transporte sin uso: el día que aterrice uno, tiene que pasar por acá, que es donde
// están las promesas de no filtrar el token ni seguir redirecciones.
func TestNoOtherJevClientInTheRepo(t *testing.T) {
	if offenders := repocheck.Offenders(t, regexp.MustCompile(`api\.typesafe\.ai`), nil); len(offenders) > 0 {
		t.Errorf("hay clientes de Jev fuera de connectors/ (usá connectors/jev): %v", offenders)
	}
}
