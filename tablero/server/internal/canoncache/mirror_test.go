package canoncache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"creditop/playground/connectors/canon"
)

// sha es la fórmula de canon, escrita aparte para que la prueba no se valide con el código que prueba.
func sha(files map[string]string) string {
	keys := make([]string, 0, len(files))
	for k := range files {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	h := sha256.New()
	for _, k := range keys {
		fmt.Fprintf(h, "%d:%s%d:%s", len(k), k, len(files[k]), files[k])
	}
	return hex.EncodeToString(h.Sum(nil))
}

func exportServer(t *testing.T, etag string, files map[string]string, hash string, hits *int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hits++
		h := hash
		if h == "" {
			h = sha(files)
		}
		json.NewEncoder(w).Encode(map[string]any{"etag": etag, "sha256": h, "files": files, "exportado": "2026-09-28T01:00:00Z"})
	}))
}

func TestMirrorSyncsOnlyWhenTheCorpusChanged(t *testing.T) {
	dir, hits := t.TempDir(), 0
	files := map[string]string{"content/kyc/context.md": "# KYC\n", "content/kyc/map.json": "{}"}
	srv := exportServer(t, `"v1"`, files, "", &hits)
	defer srv.Close()
	client, now := canon.New(srv.URL), time.Now()

	m, changed, err := SyncMirror(context.Background(), client, "x", dir, `"v1"`, now)
	if err != nil || !changed || m.Files != 2 {
		t.Fatalf("primera copia: %+v %v %v", m, changed, err)
	}
	got, _ := os.ReadFile(filepath.Join(MirrorDir(dir), "content", "kyc", "context.md"))
	if string(got) != "# KYC\n" {
		t.Fatalf("contenido %q", got)
	}
	if info, _ := os.Stat(filepath.Join(MirrorDir(dir), "content", "kyc", "context.md")); info.Mode().Perm()&0o222 != 0 {
		t.Errorf("la copia tiene que quedar de sólo lectura: %v", info.Mode())
	}
	// mismo ETag: no se baja nada
	if _, changed, _ := SyncMirror(context.Background(), client, "x", dir, `"v1"`, now); changed || hits != 1 {
		t.Fatalf("con el mismo ETag bajó igual (%d pedidos)", hits)
	}
	// ETag nuevo: se baja y se reemplaza entera (un archivo que ya no está, se va)
	delete(files, "content/kyc/map.json")
	if _, changed, err := SyncMirror(context.Background(), client, "x", dir, `"v2"`, now); !changed || err != nil {
		t.Fatalf("ETag nuevo: %v %v", changed, err)
	}
	if _, err := os.Stat(filepath.Join(MirrorDir(dir), "content", "kyc", "map.json")); !os.IsNotExist(err) {
		t.Error("un archivo que salió del corpus sigue en la copia")
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "canon.*")); len(left) != 0 {
		t.Errorf("quedaron carpetas temporales: %v", left)
	}
}

// Un export que no coincide con su hash, o que trae una ruta fuera de content/, no toca la copia que hay.
func TestMirrorKeepsTheOldCopyOnABadExport(t *testing.T) {
	dir, hits := t.TempDir(), 0
	good := exportServer(t, `"v1"`, map[string]string{"content/a/context.md": "bien"}, "", &hits)
	defer good.Close()
	if _, _, err := SyncMirror(context.Background(), canon.New(good.URL), "x", dir, `"v1"`, time.Now()); err != nil {
		t.Fatal(err)
	}
	for name, srv := range map[string]*httptest.Server{
		"hash":  exportServer(t, `"v2"`, map[string]string{"content/a/context.md": "cortado"}, "deadbeef", &hits),
		"ruta":  exportServer(t, `"v3"`, map[string]string{"content/../../x.md": "fuera"}, "", &hits),
		"fuera": exportServer(t, `"v4"`, map[string]string{"otra/x.md": "fuera"}, "", &hits),
	} {
		_, changed, err := SyncMirror(context.Background(), canon.New(srv.URL), "x", dir, `"v9"`, time.Now())
		srv.Close()
		if err == nil || changed {
			t.Errorf("%s: se aceptó (%v)", name, err)
		}
		m, _ := LoadMirror(dir)
		got, _ := os.ReadFile(filepath.Join(MirrorDir(dir), "content", "a", "context.md"))
		if m.ETag != `"v1"` || string(got) != "bien" {
			t.Errorf("%s: la copia cambió: %+v %q", name, m, got)
		}
	}
}
