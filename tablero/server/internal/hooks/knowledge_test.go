package hooks

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSessionKnowledgeDoesNotContactCanonOrRequireACopy(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++; w.WriteHeader(500) }))
	defer srv.Close()
	t.Setenv("CANON_URL", srv.URL)
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "knowledge"), 0755)
	got := knowledgeSection(root)
	if hits != 0 || !strings.Contains(got, "Canon es opcional") || strings.Contains(got, "MAPA DE CANON") {
		t.Fatalf("arranque: %d consultas, %s", hits, got)
	}
}
