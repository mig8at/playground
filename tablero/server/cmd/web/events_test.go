package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// El vigía del tiempo real: sin cambios no avisa; un bloque nuevo en la pila de una tarea la nombra a ella sola; una
// entrada nueva de la bitácora se avisa como bitácora.
func TestTheWatcherReportsWhatChangedOnDisk(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "tablero", "data")
	write := func(rel, text string) {
		p := filepath.Join(root, "tablero", rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("tasks/a/task.md", "---\nid: 1\ntitle: A\n---\n")
	write("tasks/b/task.md", "---\nid: 2\ntitle: B\n---\n")
	write("data/entries/2026-11-11.jsonl", "{}\n")

	before := takeSnapshot(data)
	if got := diffSnapshots(before, takeSnapshot(data)); got != nil {
		t.Fatalf("sin cambios no hay aviso; dio %v", got)
	}

	time.Sleep(10 * time.Millisecond)
	write("tasks/a/context.jsonl", `{"title":"un bloque"}`+"\n")
	write("data/entries/2026-11-12.jsonl", "{}\n")
	got := diffSnapshots(before, takeSnapshot(data))
	tasks, _ := got["tasks"].([]string)
	if len(tasks) != 1 || tasks[0] != "a" {
		t.Errorf("cambió sólo la pila de a; dio %v", got["tasks"])
	}
	if got["entries"] != true {
		t.Errorf("la bitácora sumó un día; dio %v", got)
	}
	if got["branches"] != nil || got["pulse"] != nil {
		t.Errorf("ni ramas ni pulso cambiaron; dio %v", got)
	}
}
