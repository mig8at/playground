package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// FlowDef es la definición EDITABLE de un flujo. Layout por flujo (carpeta):
//
//	server/data/flows/<id>/
//	├── map.json   ← SOLO estructura: name/combination/group/kind + files "repo/relpath"
//	└── doc.md     ← TODA la prosa: qué es el flujo + documentación VIVA (qué se hizo,
//	                 decisiones, cómo ajustar). Markdown editable a mano; internamente
//	                 se carga como Flow.Description (header del copy, MCP, UI).
//
// Se sigue aceptando el layout legado plano <id>.json (description inline); al
// re-guardar migra solo a la carpeta. La línea base de hashes (drift) va aparte
// en baselines.json del dir de datos, para no ensuciar las definiciones.
type FlowDef struct {
	Name        string   `json:"name"`
	Combination string   `json:"combination,omitempty"`
	Group       string   `json:"group,omitempty"`
	Kind        string   `json:"kind,omitempty"`
	Description string   `json:"description,omitempty"` // solo en el layout legado; en el nuevo la prosa vive en doc.md
	Files       []string `json:"files"`                 // "repo/relpath", ej "legacy-backend/Modules/Onboarding/App/Http/Controllers/AbacoController.php"
}

// resolveFlowsDir ubica server/data/flows: env CONTEXT_FLOWS_DIR, o relativo al
// binario (server/bin/context-mcp → ../data/flows), o al cwd (web corre en server/).
func resolveFlowsDir() string {
	if d := os.Getenv("CONTEXT_FLOWS_DIR"); d != "" {
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

// loadFlowsFromDefs lee server/data/flows (carpetas <id>/{map.json,doc.md} y el
// layout legado <id>.json) y los resuelve a []Flow con los node IDs actuales +
// la línea base de hashes. doc.md se carga como Description (prosa completa).
func (e *Engine) loadFlowsFromDefs() flowFile {
	byPath, _ := e.pathMaps()
	baselines := e.loadBaselines()
	entries, _ := os.ReadDir(e.flowsDir)
	var out flowFile
	for _, en := range entries {
		var (
			id               string
			def              FlowDef
			created, updated time.Time
		)
		switch {
		case en.IsDir():
			// layout nuevo: <id>/map.json (+ doc.md opcional)
			id = en.Name()
			mapPath := filepath.Join(e.flowsDir, id, "map.json")
			fi, err := os.Stat(mapPath)
			if err != nil {
				continue // carpeta ajena, sin map.json
			}
			readJSON(mapPath, &def)
			created, updated = fi.ModTime(), fi.ModTime()
			docPath := filepath.Join(e.flowsDir, id, "doc.md")
			if doc, err := os.ReadFile(docPath); err == nil && strings.TrimSpace(string(doc)) != "" {
				def.Description = strings.TrimSpace(string(doc))
				if dfi, err := os.Stat(docPath); err == nil && dfi.ModTime().After(updated) {
					updated = dfi.ModTime()
				}
			}
		case filepath.Ext(en.Name()) == ".json":
			// layout legado plano: <id>.json con description inline
			id = strings.TrimSuffix(en.Name(), ".json")
			readJSON(filepath.Join(e.flowsDir, en.Name()), &def)
			if fi, err := en.Info(); err == nil {
				created, updated = fi.ModTime(), fi.ModTime()
			}
		default:
			continue
		}
		if def.Name == "" {
			def.Name = id
		}
		var ids []string
		for _, f := range def.Files {
			if nid, ok := byPath[strings.TrimSpace(f)]; ok {
				ids = append(ids, nid)
			}
		}
		out.Flows = append(out.Flows, Flow{
			ID: id, Name: def.Name, Description: def.Description,
			Combination: def.Combination, Group: def.Group, Kind: def.Kind,
			NodeIDs: ids, Hashes: baselines[id], Created: created, Updated: updated,
		})
	}
	sort.Slice(out.Flows, func(i, j int) bool { return out.Flows[i].Created.Before(out.Flows[j].Created) })
	return out
}

// saveFlowDef escribe la definición editable en el layout por carpeta
// (<id>/map.json + prosa → <id>/doc.md) + actualiza la línea base de hashes.
// Si existe el archivo plano legado <id>.json, lo migra (lo borra).
func (e *Engine) saveFlowDef(id string, def FlowDef, nodeIDs []string) error {
	dir := filepath.Join(e.flowsDir, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
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
	// la prosa vive en doc.md; map.json queda solo con estructura. Si no vino
	// description, el doc.md existente se CONSERVA (no se pisa).
	doc := strings.TrimSpace(def.Description)
	def.Description = ""
	if err := writeJSON(filepath.Join(dir, "map.json"), def); err != nil {
		return err
	}
	if doc != "" {
		if err := os.WriteFile(filepath.Join(dir, "doc.md"), []byte(doc+"\n"), 0o644); err != nil {
			return err
		}
	}
	_ = os.Remove(filepath.Join(e.flowsDir, id+".json")) // migra el layout legado
	bl := e.loadBaselines()
	bl[id] = e.hashesFor(nodeIDs)
	return writeJSON(e.baselinesPath(), bl)
}

func (e *Engine) deleteFlowDef(id string) error {
	_ = os.RemoveAll(filepath.Join(e.flowsDir, id))
	_ = os.Remove(filepath.Join(e.flowsDir, id+".json"))
	bl := e.loadBaselines()
	delete(bl, id)
	return writeJSON(e.baselinesPath(), bl)
}

// Doc devuelve la documentación viva (doc.md) de un flujo y su ruta en disco.
func (e *Engine) Doc(id string) (content, path string, err error) {
	path = filepath.Join(e.flowsDir, id, "doc.md")
	b, err := os.ReadFile(path)
	if err != nil {
		return "", path, err
	}
	return string(b), path, nil
}

// SaveDoc escribe la documentación viva (doc.md) de un flujo (reemplazo completo)
// y devuelve la ruta. El flujo debe existir (tener map.json o def legada).
func (e *Engine) SaveDoc(id, content string) (string, error) {
	if _, ok := e.Flow(id); !ok {
		return "", fmt.Errorf("flujo no encontrado: %s", id)
	}
	dir := filepath.Join(e.flowsDir, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "doc.md")
	return path, os.WriteFile(path, []byte(strings.TrimSpace(content)+"\n"), 0o644)
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
