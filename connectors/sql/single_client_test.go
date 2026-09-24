package sql

import (
	"regexp"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// Un cliente SQL fuera de `connectors/` es cómo empieza la deriva que este paquete vino a cerrar: hasta
// el 2026-09-24 había dos copias —la del tablero y la del trazador— con defaults y chequeos distintos.
// La regla se cablea en vez de escribirse: esta prueba recorre el código del repo y falla si alguien abre
// una base desde Go o le habla a Redash por su cuenta.
func TestNoOtherSQLClientInTheRepo(t *testing.T) {
	client := regexp.MustCompile(`(^|[^A-Za-z0-9_])sql\.Open\("|/api/query_results|/api/jobs/`)
	if offenders := repocheck.Offenders(t, client, nil); len(offenders) > 0 {
		t.Errorf("hay clientes SQL fuera de connectors/ (usá connectors/sql): %v", offenders)
	}
}
