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

/* exportServer imita a canon: el header ETag es el sha de los archivos, y con If-None-Match igual
 * contesta 304 —salvo `old`, que imita una instancia anterior al 2026-09-27 y contesta 200 siempre—. */
func exportServer(t *testing.T, files map[string]string, hash string, old bool, hits *int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hits++
		h := hash
		if h == "" {
			h = sha(files)
		}
		tag := `"` + h + `"`
		w.Header().Set("ETag", tag)
		if !old && r.Header.Get("If-None-Match") == tag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"etag": `"corpus"`, "sha256": h, "files": files, "exportado": "2026-09-28T01:00:00Z"})
	}))
}

func TestMirrorSyncsOnlyWhenTheCorpusChanged(t *testing.T) {
	for _, old := range []bool{false, true} {
		dir, hits := t.TempDir(), 0
		files := map[string]string{"content/kyc/context.md": "# KYC\n", "content/kyc/map.json": "{}"}
		srv := exportServer(t, files, "", old, &hits)
		client, now := canon.New(srv.URL), time.Now()

		m, changed, err := SyncMirror(context.Background(), client, "x", dir, now)
		if err != nil || !changed || m.Files != 2 || m.ExportTag == "" {
			t.Fatalf("old=%v primera copia: %+v %v %v", old, m, changed, err)
		}
		got, _ := os.ReadFile(filepath.Join(MirrorDir(dir), "content", "kyc", "context.md"))
		if string(got) != "# KYC\n" {
			t.Fatalf("contenido %q", got)
		}
		if info, _ := os.Stat(filepath.Join(MirrorDir(dir), "content", "kyc", "context.md")); info.Mode().Perm()&0o222 != 0 {
			t.Errorf("la copia tiene que quedar de sólo lectura: %v", info.Mode())
		}
		// nada cambió: 304 (o, en una instancia vieja, el mismo sha) y no se reescribe
		if _, changed, err := SyncMirror(context.Background(), client, "x", dir, now); changed || err != nil {
			t.Fatalf("old=%v sin cambios reescribió: %v %v", old, changed, err)
		}
		// una copia sin tag (anterior a ese campo) lo recupera sin reescribir, y la vez siguiente ya pide el 304
		m, _ = LoadMirror(dir)
		m.ExportTag = ""
		if err := saveManifest(dir, m); err != nil {
			t.Fatal(err)
		}
		if _, changed, _ := SyncMirror(context.Background(), client, "x", dir, now); changed {
			t.Fatalf("old=%v sin tag reescribió la copia", old)
		}
		if m, _ := LoadMirror(dir); m.ExportTag == "" {
			t.Fatalf("old=%v la copia no recuperó su tag", old)
		}
		// cambió un archivo: se baja y se reemplaza entera (lo que salió del corpus, se va)
		delete(files, "content/kyc/map.json")
		files["content/diccionario.json"] = "{}"
		if _, changed, err := SyncMirror(context.Background(), client, "x", dir, now); !changed || err != nil {
			t.Fatalf("old=%v con cambios: %v %v", old, changed, err)
		}
		if _, err := os.Stat(filepath.Join(MirrorDir(dir), "content", "kyc", "map.json")); !os.IsNotExist(err) {
			t.Error("un archivo que salió del corpus sigue en la copia")
		}
		if left, _ := filepath.Glob(filepath.Join(dir, "canon.*")); len(left) != 0 {
			t.Errorf("quedaron carpetas temporales: %v", left)
		}
		srv.Close()
	}
}

// Un export que no coincide con su hash, o que trae una ruta fuera de content/, no toca la copia que hay.
func TestMirrorKeepsTheOldCopyOnABadExport(t *testing.T) {
	dir, hits := t.TempDir(), 0
	good := exportServer(t, map[string]string{"content/a/context.md": "bien"}, "", false, &hits)
	defer good.Close()
	if _, _, err := SyncMirror(context.Background(), canon.New(good.URL), "x", dir, time.Now()); err != nil {
		t.Fatal(err)
	}
	for name, srv := range map[string]*httptest.Server{
		"hash":  exportServer(t, map[string]string{"content/a/context.md": "cortado"}, "deadbeef", false, &hits),
		"ruta":  exportServer(t, map[string]string{"content/../../x.md": "fuera"}, "", false, &hits),
		"fuera": exportServer(t, map[string]string{"otra/x.md": "fuera"}, "", false, &hits),
	} {
		_, changed, err := SyncMirror(context.Background(), canon.New(srv.URL), "x", dir, time.Now())
		srv.Close()
		if err == nil || changed {
			t.Errorf("%s: se aceptó (%v)", name, err)
		}
		m, _ := LoadMirror(dir)
		got, _ := os.ReadFile(filepath.Join(MirrorDir(dir), "content", "a", "context.md"))
		if m.SHA256 != sha(map[string]string{"content/a/context.md": "bien"}) || string(got) != "bien" {
			t.Errorf("%s: la copia cambió: %+v %q", name, m, got)
		}
	}
}
