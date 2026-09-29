package canon

import (
	"regexp"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// canon lo lee todo el equipo: un segundo cliente con otro origen por defecto o sin la llave de escritura
// en el lugar correcto escribe donde nadie mira. Las rutas de la API se escriben sólo acá.
func TestNoOtherCanonClientInTheRepo(t *testing.T) {
	client := regexp.MustCompile(`["'\x60]/api/(search|read|code|propose|draft|globalmap)\b`)
	if offenders := repocheck.Offenders(t, client, map[string]string{
		"visor/server/main.go": "el visor declara SU PROPIA ruta /api/search para su buscador; no le habla a canon",
	}); len(offenders) > 0 {
		t.Errorf("hay clientes de canon fuera de connectors/ (usá connectors/canon): %v", offenders)
	}
}
