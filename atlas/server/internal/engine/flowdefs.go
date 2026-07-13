package engine

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// FlowDef es la definición EDITABLE de un flujo: vive en server/data/flows/<id>.json,
// pensada para editar a mano. Los archivos se listan como "repo/relpath" (no IDs
// opacos), así se leen y editan fácil. La línea base de hashes (para el drift) se
// guarda aparte, en baselines.json del dir de datos, para no ensuciar este archivo.
type FlowDef struct {
	Name        string   `json:"name"`
	Combination string   `json:"combination,omitempty"`
	Group       string   `json:"group,omitempty"`
	Kind        string   `json:"kind,omitempty"`
	Description string   `json:"description,omitempty"`
	Files       []string `json:"files"` // "repo/relpath", ej "legacy-backend/Modules/Onboarding/App/Http/Controllers/AbacoController.php"
}

// resolveFlowsDir ubica server/data/flows: env ATLAS_FLOWS_DIR, o relativo al
// binario (server/bin/atlas-mcp → ../data/flows), o al cwd (web corre en server/).
func resolveFlowsDir() string {
	if d := os.Getenv("ATLAS_FLOWS_DIR"); d != "" {
		return d
	}
	var cands []string
	if exe, err := os.Executable(); err == nil {
		cands = append(cands, filepath.Join(filepath.Dir(filepath.Dir(exe)), "data", "flows"))
	}
	if wd, err := os.Getwd(); err == nil {
		cands = append(cands, filepath.Join(wd, "data", "flows"))
	}
	for _, c := range cands {
		if fi, err := os.Stat(c); err == nil && fi.IsDir() {
			return c
		}
	}
	if len(cands) > 0 {
		return cands[len(cands)-1] // default: cwd/data/flows (lo crea el primer save)
	}
	return "data/flows"
}

func (e *Engine) baselinesPath() string { return filepath.Join(e.dir, "baselines.json") }

// pathMaps arma, del índice actual, "repo/path" ↔ nodeID (para resolver defs).
func (e *Engine) pathMaps() (byPath, byID map[string]string) {
	byPath, byID = map[string]string{}, map[string]string{}
	for _, n := range e.loadIndex().Nodes {
		key := n.Repo + "/" + n.Path
		byPath[key] = n.ID
		byID[n.ID] = key
	}
	return
}

// loadFlowsFromDefs lee server/data/flows/*.json y los resuelve a []Flow con los
// node IDs actuales + la línea base de hashes.
func (e *Engine) loadFlowsFromDefs() flowFile {
	byPath, _ := e.pathMaps()
	baselines := e.loadBaselines()
	entries, _ := os.ReadDir(e.flowsDir)
	var out flowFile
	for _, en := range entries {
		if en.IsDir() || filepath.Ext(en.Name()) != ".json" {
			continue
		}
		id := strings.TrimSuffix(en.Name(), ".json")
		var def FlowDef
		readJSON(filepath.Join(e.flowsDir, en.Name()), &def)
		if def.Name == "" {
			def.Name = id
		}
		var ids []string
		for _, f := range def.Files {
			if nid, ok := byPath[strings.TrimSpace(f)]; ok {
				ids = append(ids, nid)
			}
		}
		var mod time.Time
		if fi, err := en.Info(); err == nil {
			mod = fi.ModTime()
		}
		out.Flows = append(out.Flows, Flow{
			ID: id, Name: def.Name, Description: def.Description,
			Combination: def.Combination, Group: def.Group, Kind: def.Kind,
			NodeIDs: ids, Hashes: baselines[id], Created: mod, Updated: mod,
		})
	}
	sort.Slice(out.Flows, func(i, j int) bool { return out.Flows[i].Created.Before(out.Flows[j].Created) })
	return out
}

// saveFlowDef escribe el archivo editable + actualiza la línea base de hashes.
func (e *Engine) saveFlowDef(id string, def FlowDef, nodeIDs []string) error {
	if err := os.MkdirAll(e.flowsDir, 0o755); err != nil {
		return err
	}
	// files como "repo/path" (editable), en el orden de nodeIDs
	_, byID := e.pathMaps()
	def.Files = def.Files[:0]
	for _, nid := range nodeIDs {
		if p, ok := byID[nid]; ok {
			def.Files = append(def.Files, p)
		}
	}
	if err := writeJSON(filepath.Join(e.flowsDir, id+".json"), def); err != nil {
		return err
	}
	bl := e.loadBaselines()
	bl[id] = e.hashesFor(nodeIDs)
	return writeJSON(e.baselinesPath(), bl)
}

func (e *Engine) deleteFlowDef(id string) error {
	_ = os.Remove(filepath.Join(e.flowsDir, id+".json"))
	bl := e.loadBaselines()
	delete(bl, id)
	return writeJSON(e.baselinesPath(), bl)
}

func (e *Engine) loadBaselines() map[string]map[string]string {
	m := map[string]map[string]string{}
	readJSON(e.baselinesPath(), &m)
	if m == nil {
		m = map[string]map[string]string{}
	}
	return m
}

// FlowsDir es la carpeta de definiciones editables (para logs).
func (e *Engine) FlowsDir() string { return e.flowsDir }
