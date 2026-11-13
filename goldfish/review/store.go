package review

// LO GUARDADO: cada validación en goldfish/.runs/<id>/run.json (fuera de git).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

var storeMu sync.Mutex

// Save escribe la validación (atómico: la interfaz puede estar leyéndola).
func Save(playground string, r *Run) error {
	storeMu.Lock()
	defer storeMu.Unlock()
	dir := filepath.Join(RunsDir(playground), r.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, "run.json.tmp")
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, "run.json"))
}

// Load: una validación por su id.
func Load(playground, id string) (*Run, error) {
	if id != filepath.Base(id) || id == "" || id == "." || id == ".." {
		return nil, os.ErrNotExist
	}
	raw, err := os.ReadFile(filepath.Join(RunsDir(playground), id, "run.json"))
	if err != nil {
		return nil, err
	}
	var r Run
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// List: todas las validaciones, de la más nueva a la más vieja.
func List(playground string) []*Run {
	entries, _ := os.ReadDir(RunsDir(playground))
	var out []*Run
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if r, err := Load(playground, e.Name()); err == nil {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Started > out[j].Started })
	return out
}

// withLastRuns: a cada PR, su última validación.
func withLastRuns(playground string, bs []RepoBlock) []RepoBlock {
	last := map[string]string{}
	for _, r := range List(playground) {
		if r.PR == nil || r.Slug == "" {
			continue
		}
		if k := r.PR.Key(); last[k] == "" {
			last[k] = r.ID
		}
	}
	for i := range bs {
		for j := range bs[i].PRs {
			bs[i].PRs[j].LastRunID = last[bs[i].PRs[j].Key()]
		}
	}
	return bs
}
