package repos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// El orden de la lista importa: el índice de logs se arma recorriendo los repos en ese orden, y un map
// de Go lo pierde en silencio.
func TestIndexedOrderFollowsTheFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "repos.json"), []byte(`{"indexed":{"zeta":"~/z","alfa":"~/a","medio":"m"},"citable_only":{},"extensions":[".go"]}`), 0o644)
	if got := strings.Join(New(dir).IndexedOrder(), ","); got != "zeta,alfa,medio" {
		t.Errorf("orden = %s", got)
	}
}
