package logs

import (
	"regexp"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// Un cliente de Loki fuera de `connectors/` es cómo empezó la deriva que este paquete vino a cerrar:
// hasta el 2026-09-24 había tres —el trazador en Go, el harness en TypeScript, workers en Python, ya retirado— con
// credenciales y filtros propios, y para `qa` el del harness filtraba por un valor que no existe. La ruta
// de la API de Loki se escribe sólo acá; si aparece en el CÓDIGO de otra parte (no en un comentario),
// alguien le está hablando a Loki por su cuenta. Mira los lenguajes del repo, no sólo Go.
func TestNoOtherLokiClientInTheRepo(t *testing.T) {
	if offenders := repocheck.Offenders(t, regexp.MustCompile(`loki/api/`), nil); len(offenders) > 0 {
		t.Errorf("hay clientes de Loki fuera de connectors/ (usá connectors/logs, o `bin/pg logs` desde otro lenguaje): %v", offenders)
	}
}
