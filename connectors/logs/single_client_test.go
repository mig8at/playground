package logs

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Un cliente de Loki fuera de `connectors/` es cómo empezó la deriva que este paquete vino a cerrar:
// hasta el 2026-09-24 había tres —el trazador en Go, el harness en TypeScript, workers en Python, ya retirado— con
// credenciales y filtros propios, y para `qa` el del harness filtraba por un valor que no existe. La ruta
// de la API de Loki se escribe sólo acá; si aparece en el CÓDIGO de otra parte (no en un comentario),
// alguien le está hablando a Loki por su cuenta. Mira los lenguajes del repo, no sólo Go.
func TestNoOtherLokiClientInTheRepo(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("git", "-C", root, "ls-files", "-co", "--exclude-standard").Output()
	if err != nil {
		t.Fatalf("git ls-files: %v", err)
	}
	code := regexp.MustCompile(`\.(go|ts|mjs|js|py)$`)
	comment := regexp.MustCompile(`^\s*(//|#|\*|/\*)`)
	var offenders []string
	scanned := 0
	for _, rel := range strings.Split(string(out), "\n") {
		if !code.MatchString(rel) || strings.HasPrefix(rel, "connectors/") || strings.Contains(rel, "node_modules/") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			continue
		}
		scanned++
		for i, line := range strings.Split(string(raw), "\n") {
			if strings.Contains(line, "loki/api/") && !comment.MatchString(line) {
				offenders = append(offenders, rel+":"+strconv.Itoa(i+1))
			}
		}
	}
	if scanned < 100 {
		t.Fatalf("sólo recorrí %d archivos: el chequeo no miró el repo", scanned)
	}
	if len(offenders) > 0 {
		t.Errorf("hay clientes de Loki fuera de connectors/ (usá connectors/logs, o `bin/pg logs` desde otro lenguaje): %v", offenders)
	}
}
