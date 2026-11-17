package main

// LOS TEMAS DE KNOWLEDGE para la interfaz: `GET /api/topics` (id, título y cuántas fuentes suyas cambiaron en main),
// que usa el formulario de un agente. Vivía en groups.go, que se sacó el 2026-11-17 con los grupos de agentes.

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// pendingTopics: los temas con fuentes que cambiaron en main desde su revisión (lo mismo que knowledge-check).
func (a *app) pendingTopics(ctx context.Context) (map[string][]source, error) {
	dirs, err := os.ReadDir(filepath.Join(a.root, "knowledge"))
	if err != nil {
		return nil, err
	}
	out := map[string][]source{}
	for _, d := range dirs {
		if !d.IsDir() || !topicID.MatchString(d.Name()) {
			continue
		}
		sources, err := a.topicSources(d.Name())
		if err != nil {
			continue
		}
		for _, s := range sources {
			dir, ref, err := a.repoDir(s.Repo)
			if err != nil {
				continue
			}
			blob, err := git(ctx, dir, "rev-parse", ref+":"+s.Path)
			if err != nil || strings.TrimSpace(blob) != s.Blob {
				out[d.Name()] = append(out[d.Name()], s)
			}
		}
	}
	return out, nil
}

// listTopics: los temas de knowledge con su título, para elegir qué revisar al armar un grupo; y cuáles tienen fuentes
// cambiadas en main.
func (a *app) listTopics(w http.ResponseWriter, r *http.Request) {
	dirs, err := os.ReadDir(filepath.Join(a.root, "knowledge"))
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	pending, _ := a.pendingTopics(r.Context())
	type topic struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Changed int    `json:"changed"`
	}
	var out []topic
	for _, d := range dirs {
		if !d.IsDir() || !topicID.MatchString(d.Name()) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(a.root, "knowledge", d.Name(), "rules.md"))
		if err != nil {
			continue
		}
		title := d.Name()
		if line := strings.SplitN(string(raw), "\n", 2)[0]; strings.HasPrefix(line, "# ") {
			title = strings.TrimPrefix(line, "# ")
		}
		out = append(out, topic{d.Name(), title, len(pending[d.Name()])})
	}
	writeJSON(w, 200, map[string]any{"topics": out})
}
