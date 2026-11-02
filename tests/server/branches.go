package main

// Las ramas de las integraciones con tiendas: en qué ramas vive cada una y hasta dónde llegó (ambientes y PR), como
// la consola de ramas del tablero. La medición es la del tablero (`bin/pg tarea ramas`, que corre su cmd/branches):
// lee lo que dejó el último `git fetch` de cada repo, no sale a la red, y actualiza su snapshot.

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// storeTasks: la tarea del tablero de cada tienda (su `ramas:` declara los patrones).
var storeTasks = []struct{ Store, Task string }{
	{"Shopify", "integracion-shopify"},
	{"VTEX", "integracion-vtex"},
}

type BranchPR struct {
	Number   int    `json:"number"`
	State    string `json:"state"`
	Base     string `json:"base"`
	URL      string `json:"url"`
	Revision string `json:"revision"`
	Draft    bool   `json:"draft"`
}

type StoreBranch struct {
	Repo    string          `json:"repo"`
	Branch  string          `json:"branch"`
	Commit  string          `json:"commit"`
	Subject string          `json:"subject"`
	In      map[string]bool `json:"in"`
	PR      *BranchPR       `json:"pr,omitempty"`
}

type StoreBranches struct {
	Store    string        `json:"store"`
	Task     string        `json:"task"`
	Pattern  string        `json:"pattern"`
	Branches []StoreBranch `json:"branches"`
	Error    string        `json:"error,omitempty"`
}

type BranchesReport struct {
	MeasuredAt string          `json:"measuredAt"`
	Stores     []StoreBranches `json:"stores"`
}

// MeasureStoreBranches mide las dos tareas en paralelo (cada una tarda unos segundos de git).
func MeasureStoreBranches(ctx context.Context) BranchesReport {
	out := make([]StoreBranches, len(storeTasks))
	done := make(chan struct{}, len(storeTasks))
	for i, st := range storeTasks {
		go func(i int, store, task string) {
			defer func() { done <- struct{}{} }()
			out[i] = measureTaskBranches(ctx, store, task)
		}(i, st.Store, st.Task)
	}
	for range storeTasks {
		<-done
	}
	return BranchesReport{MeasuredAt: time.Now().Format(time.RFC3339), Stores: out}
}

func measureTaskBranches(ctx context.Context, store, task string) StoreBranches {
	res := StoreBranches{Store: store, Task: task, Branches: []StoreBranch{}}
	cmd := exec.CommandContext(ctx, filepath.Join(repoRoot(), "bin", "pg"), "tarea", "ramas", "--tarea", task, "--json")
	raw, err := cmd.Output()
	if err != nil {
		res.Error = fmt.Sprintf("bin/pg tarea ramas: %v", err)
		return res
	}
	// La salida trae el resumen en texto y el snapshot en JSON: el JSON arranca en la primera llave.
	text := string(raw)
	start := strings.Index(text, "{")
	if start < 0 {
		res.Error = "bin/pg tarea ramas no devolvió JSON"
		return res
	}
	var snap struct {
		Tasks map[string]struct {
			Pattern  string        `json:"pattern"`
			Branches []StoreBranch `json:"branches"`
		} `json:"tasks"`
	}
	if err := json.NewDecoder(strings.NewReader(text[start:])).Decode(&snap); err != nil {
		res.Error = "no pude leer las ramas: " + err.Error()
		return res
	}
	for _, t := range snap.Tasks {
		res.Pattern = t.Pattern
		res.Branches = append(res.Branches, t.Branches...)
	}
	return res
}
