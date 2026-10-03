package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestHistoricalCanonDoesNotTurnTaskLintIntoARemoteDependency(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++; w.WriteHeader(500) }))
	defer srv.Close()
	t.Setenv("CANON_URL", srv.URL)
	root := t.TempDir()
	t.Setenv("TABLERO_DATA", filepath.Join(root, "data"))
	path := filepath.Join(root, "tasks", "playground-local", "task.md")
	os.MkdirAll(filepath.Dir(path), 0755)
	os.WriteFile(path, []byte("---\nid: 96\ntitle: Local\nclase: proyecto\nstage: work\ncreated: \"2026-10-03T12:00:00Z\"\ncanon: [listado]\n---\n\n## Objetivo\nTrabajar en local.\n"), 0644)
	if code := showLint(path); code != 0 || hits != 0 {
		t.Fatalf("lint: code=%d consultas=%d", code, hits)
	}
}

func TestTaskJSONPreservesKnowledgeReferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "task.md")
	os.WriteFile(path, []byte("---\nid: 96\ntitle: Local\nstage: work\nknowledge: [lender-listing]\n---\n## Objetivo\nTrabajar en local.\n"), 0644)
	task, body, err := readTaskFile(path)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(documentJSON(task, body, nil, false))
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Task struct {
			Knowledge []string `json:"knowledge"`
		} `json:"task"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Task.Knowledge) != 1 || out.Task.Knowledge[0] != "lender-listing" {
		t.Fatalf("perdió knowledge: %s", raw)
	}
}
