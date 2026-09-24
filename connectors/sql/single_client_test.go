package sql

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Un cliente SQL fuera de `connectors/` es cómo empieza la deriva que este paquete vino a cerrar: hasta
// el 2026-09-24 había dos copias —la del tablero y la del trazador— con defaults y chequeos distintos.
// La regla se cablea en vez de escribirse: esta prueba recorre el Go del módulo y falla si alguien abre
// una base o le habla a Redash por su cuenta. Los módulos anidados (`plantillas`, con su SQLite, y
// `tablero/tools/rename/go`) son otros módulos y no cuentan.
func TestNoOtherSQLClientInTheModule(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatalf("no encontré el go.mod de la raíz en %s", root)
	}
	client := regexp.MustCompile(`(^|[^A-Za-z0-9_])sql\.Open\("|/api/query_results|/api/jobs/`)
	var offenders []string
	scanned := 0
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == "node_modules" || strings.HasPrefix(name, ".") && p != root {
				return filepath.SkipDir
			}
			if p != root {
				if _, err := os.Stat(filepath.Join(p, "go.mod")); err == nil {
					return filepath.SkipDir // otro módulo
				}
			}
			if rel, _ := filepath.Rel(root, p); rel == "connectors" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		scanned++
		raw, err := os.ReadFile(p)
		if err == nil && client.Match(raw) {
			rel, _ := filepath.Rel(root, p)
			offenders = append(offenders, rel)
		}
		return nil
	})
	if scanned < 50 {
		t.Fatalf("sólo recorrí %d archivos de Go: el chequeo no miró el módulo", scanned)
	}
	if len(offenders) > 0 {
		t.Errorf("hay clientes SQL fuera de connectors/ (usá connectors/sql): %v", offenders)
	}
}
