package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"creditop/playground/knowledge"
)

func TestTaskReadsLocalReferencesAndKeepsHistoricalCanonOptional(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "task.md")
	os.WriteFile(path, []byte("---\nid: 1\ntitle: Listado\nknowledge: [lender-listing]\ncanon: [listado]\n---\n## Objetivo\nComprobar el listado\n"), 0644)
	entry := readTaskFile(path, nil)
	if len(entry.Knowledge) != 1 || entry.Knowledge[0] != "lender-listing" || len(entry.Nodes) != 1 {
		t.Fatalf("referencias: %+v", entry)
	}
	base := filepath.Join(dir, "knowledge", "lender-listing")
	os.MkdirAll(base, 0755)
	os.WriteFile(filepath.Join(base, "rules.md"), []byte("# Listado\n\n## Monto\nEl pedido decide el monto.\n"), 0644)
	meta := knowledge.Metadata{Version: 1, Title: "Listado", Summary: "Monto del pedido", ReviewedAt: "2026-10-03T12:00:00Z", Sources: []knowledge.Source{{Repo: "backend", Path: "Rule.php", Commit: strings.Repeat("a", 40), Blob: strings.Repeat("b", 40), Sections: []string{"monto"}}}}
	raw, _ := json.Marshal(meta)
	os.WriteFile(filepath.Join(base, "sources.json"), raw, 0644)
	c := buildKnowledgeContext(entry.Knowledge, filepath.Join(dir, "knowledge"))
	if len(c.Topics) != 1 || c.Error != "" || c.Topics[0].Sections[0].Text != "El pedido decide el monto." {
		t.Fatalf("contexto: %+v", c)
	}
	c = buildKnowledgeContext([]string{"missing"}, filepath.Join(dir, "knowledge"))
	if len(c.Missing) != 1 {
		t.Fatal("silenció una referencia desconocida")
	}
	// La retoma completa incluye el tema local aun con referencias históricas de Canon.
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++; w.WriteHeader(500) }))
	defer srv.Close()
	t.Setenv("CANON_URL", srv.URL)
	// Layout descubre la raíz por tools/repos.json; el fixture no depende del repositorio real.
	os.MkdirAll(filepath.Join(dir, "tools"), 0755)
	os.WriteFile(filepath.Join(dir, "tools", "repos.json"), []byte("{}"), 0644)
	os.MkdirAll(filepath.Join(dir, "tablero", "data"), 0755)
	stdout := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	code := resume(filepath.Join(dir, "tablero", "data"), []task{entry}, branchesSnap{}, "1", true, "", false, 12000, "")
	writer.Close()
	os.Stdout = stdout
	raw, _ = io.ReadAll(reader)
	reader.Close()
	var out struct {
		Knowledge knowledge.Context `json:"knowledge"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%v: %s", err, raw)
	}
	if code != 0 || hits != 0 || len(out.Knowledge.Topics) != 1 {
		t.Fatalf("retoma: code=%d hits=%d contexto=%+v", code, hits, out)
	}
}
