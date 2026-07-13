package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Analysis es el documento persistido por flujo: el "primer análisis" (auto,
// desde node-lite) MÁS los campos de enriquecimiento (role/note por archivo y
// un summary libre) que se conservan entre re-exportaciones. Vive en
// <ATLAS_DATA_DIR>/analysis/<id>.json para acumular conocimiento con el tiempo.
type Analysis struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Exported    time.Time      `json:"exported"`
	Summary     string         `json:"summary"` // enriquecible: análisis libre del flujo
	Files       []AnalysisFile `json:"files"`
}

// AnalysisFile es un archivo del flujo con su node-lite + slots enriquecibles.
type AnalysisFile struct {
	ID          string   `json:"id"`
	Repo        string   `json:"repo"`
	Path        string   `json:"path"`
	Lang        string   `json:"lang"`
	Hash        string   `json:"hash"` // hash de contenido al exportar (para detectar cambios)
	Definitions []string `json:"definitions,omitempty"`
	Routes      []string `json:"routes,omitempty"`
	Tables      []string `json:"tables,omitempty"`
	Role        string   `json:"role"` // enriquecible: qué hace en el flujo
	Note        string   `json:"note"` // enriquecible: nota libre
}

func (e *Engine) analysisDir() string { return filepath.Join(e.dir, "analysis") }
func (e *Engine) analysisPath(id string) string {
	return filepath.Join(e.analysisDir(), id+".json")
}

// AnalysisDir es la carpeta de análisis (para logs / UI).
func (e *Engine) AnalysisDir() string { return e.analysisDir() }

// ExportAnalysis vuelca el flujo a analysis/<id>.json. Es el "primer análisis":
// arma los archivos desde el node-lite actual, pero PRESERVA el enriquecimiento
// (role/note/summary) de un análisis previo si existe.
func (e *Engine) ExportAnalysis(flowID string) (string, error) {
	f, ok := e.Flow(flowID)
	if !ok {
		return "", fmt.Errorf("flujo no encontrado: %s", flowID)
	}
	if err := os.MkdirAll(e.analysisDir(), 0o755); err != nil {
		return "", err
	}

	// enriquecimiento previo (si lo hay) para no pisarlo
	prevRole, prevNote := map[string]string{}, map[string]string{}
	prevSummary := ""
	if old, err := e.GetAnalysis(flowID); err == nil {
		prevSummary = old.Summary
		for _, af := range old.Files {
			if af.Role != "" {
				prevRole[af.ID] = af.Role
			}
			if af.Note != "" {
				prevNote[af.ID] = af.Note
			}
		}
	}

	a := Analysis{
		ID: f.ID, Name: f.Name, Description: f.Description,
		Exported: time.Now(), Summary: prevSummary,
	}
	for _, n := range e.NodesByID(f.NodeIDs) {
		var routes []string
		for _, r := range n.Routes {
			routes = append(routes, fmt.Sprintf("%s %s", r.Method, r.Path))
		}
		a.Files = append(a.Files, AnalysisFile{
			ID: n.ID, Repo: n.Repo, Path: n.Path, Lang: n.Lang, Hash: n.Hash,
			Definitions: n.Definitions, Routes: routes, Tables: n.Tables,
			Role: prevRole[n.ID], Note: prevNote[n.ID],
		})
	}

	path := e.analysisPath(flowID)
	if err := writeJSON(path, a); err != nil {
		return "", err
	}
	return path, nil
}

// GetAnalysis lee analysis/<id>.json.
func (e *Engine) GetAnalysis(id string) (Analysis, error) {
	var a Analysis
	b, err := os.ReadFile(e.analysisPath(id))
	if err != nil {
		return a, err
	}
	if err := json.Unmarshal(b, &a); err != nil {
		return a, err
	}
	return a, nil
}

// ListAnalyses lista los ids con análisis guardado.
func (e *Engine) ListAnalyses() []string {
	entries, err := os.ReadDir(e.analysisDir())
	if err != nil {
		return nil
	}
	var ids []string
	for _, en := range entries {
		if name := en.Name(); filepath.Ext(name) == ".json" {
			ids = append(ids, name[:len(name)-len(".json")])
		}
	}
	sort.Strings(ids)
	return ids
}

// EnrichAnalysis fusiona enriquecimiento en el análisis: summary (si no vacío) y
// role/note por archivo (por id). Exporta primero si aún no existe.
func (e *Engine) EnrichAnalysis(id, summary string, files map[string][2]string) (Analysis, error) {
	if _, err := e.GetAnalysis(id); err != nil {
		if _, eerr := e.ExportAnalysis(id); eerr != nil {
			return Analysis{}, eerr
		}
	}
	a, err := e.GetAnalysis(id)
	if err != nil {
		return Analysis{}, err
	}
	if summary != "" {
		a.Summary = summary
	}
	for i := range a.Files {
		if rn, ok := files[a.Files[i].ID]; ok {
			if rn[0] != "" {
				a.Files[i].Role = rn[0]
			}
			if rn[1] != "" {
				a.Files[i].Note = rn[1]
			}
		}
	}
	a.Exported = time.Now()
	if err := writeJSON(e.analysisPath(id), a); err != nil {
		return Analysis{}, err
	}
	return a, nil
}
