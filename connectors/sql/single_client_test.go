package sql

import (
	"regexp"
	"testing"

	"creditop/my-tools/connectors/internal/repocheck"
)

// Un cliente SQL fuera de `connectors/` es cómo empieza la deriva que este paquete vino a cerrar: hasta
// el 2026-09-24 había dos copias —la del tablero y la del trazador— con defaults y chequeos distintos.
// La regla se cablea en vez de escribirse: esta prueba recorre el código del repo y falla si alguien abre
// una base desde Go o le habla a Redash por su cuenta.
func TestNoOtherSQLClientInTheRepo(t *testing.T) {
	client := regexp.MustCompile(`(^|[^A-Za-z0-9_])sql\.Open\("|/api/query_results|/api/jobs/`)
	allowed := map[string]string{
		// Se creó como copia suelta a propósito (c7d840cc, 2026-11-03): sin connectors, harness ni bin/pg, con todo en
		// su .env, para que funcione fuera de my-tools. Si vuelve a usar el conector, esta excepción deja de matchear
		// y la prueba pide borrarla.
		"ecommerce/": "copia independiente de my-tools, decidida al crearla (era ecommerce-v2 hasta el 2026-11-09)",
	}
	if offenders := repocheck.Offenders(t, client, allowed); len(offenders) > 0 {
		t.Errorf("hay clientes SQL fuera de connectors/ (usá connectors/sql): %v", offenders)
	}
}
