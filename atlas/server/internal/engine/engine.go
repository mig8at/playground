// Package engine es el núcleo compartido por el server web (WebSocket) y el
// conector MCP (stdio). Ambos apuntan al MISMO directorio de datos en disco:
//
//	el MCP CREA flujos  →  escribe flows.json
//	la UI los MUESTRA   →  el web lee flows.json y hace push por WS
//
// Por eso el estado vive en disco (JSON atómico) y no en memoria de un solo
// proceso. DataDir por defecto: ~/.creditop-atlas (override con ATLAS_DATA_DIR).
package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"creditop/atlas/server/internal/gitinfo"
	"creditop/atlas/server/internal/graph"
	"creditop/atlas/server/internal/scan"
)

// Repo es un repo indexado.
type Repo struct {
	Alias     string    `json:"alias"`
	Root      string    `json:"root"`
	Scanned   time.Time `json:"scanned"`
	NodeCount int       `json:"node_count"`
}

// Flow es un flujo guardado: un array de IDs de nodo (posiblemente de varios
// repos) con nombre. Es la pieza "Rino": una selección curada y persistida.
type Flow struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	NodeIDs     []string  `json:"node_ids"`
	// Hashes = snapshot del hash de contenido de cada archivo al momento de
	// guardar (la línea base del análisis). Al re-escanear los repos, comparar
	// contra los hashes actuales dice qué cambió → flujo desactualizado.
	Hashes  map[string]string `json:"hashes,omitempty"`
	Created time.Time         `json:"created"`
	Updated time.Time         `json:"updated"`
}

// FlowStatus reporta si un flujo sigue al día respecto de los repos indexados.
type FlowStatus struct {
	ID       string   `json:"id"`
	UpToDate bool     `json:"up_to_date"`
	HasBase  bool     `json:"has_base"` // ¿tiene línea base (snapshot de hashes)?
	Changed  []string `json:"changed"`  // ids cuyo contenido cambió
	Removed  []string `json:"removed"`  // ids que ya no están en el índice
}

type index struct {
	Repos []Repo      `json:"repos"`
	Nodes []scan.Node `json:"nodes"`
}
type flowFile struct {
	Flows []Flow `json:"flows"`
}

// Engine da acceso concurrente-seguro al estado en disco.
type Engine struct {
	mu  sync.Mutex
	dir string
}

// New abre (o crea) el engine sobre el directorio de datos.
func New() (*Engine, error) {
	dir := os.Getenv("ATLAS_DATA_DIR")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		dir = filepath.Join(home, ".creditop-atlas")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Engine{dir: dir}, nil
}

// Dir es el directorio de datos (para logs).
func (e *Engine) Dir() string { return e.dir }

func (e *Engine) indexPath() string { return filepath.Join(e.dir, "index.json") }
func (e *Engine) flowsPath() string { return filepath.Join(e.dir, "flows.json") }

// ModTimes devuelve el mtime de index/flows/combinations (para que el web
// detecte cambios hechos por el MCP y refresque la UI). Cero si no existen.
func (e *Engine) ModTimes() (idx, flows, combos time.Time) {
	if fi, err := os.Stat(e.indexPath()); err == nil {
		idx = fi.ModTime()
	}
	if fi, err := os.Stat(e.flowsPath()); err == nil {
		flows = fi.ModTime()
	}
	if fi, err := os.Stat(e.combsPath()); err == nil {
		combos = fi.ModTime()
	}
	return
}

// ── scan ─────────────────────────────────────────────────────────────────────

// Scan indexa (o re-indexa) un repo y persiste el índice. Devuelve el repo.
func (e *Engine) Scan(root string) (Repo, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	root = filepath.Clean(expandHome(root))
	fi, err := os.Stat(root)
	if err != nil || !fi.IsDir() {
		return Repo{}, fmt.Errorf("no es un directorio: %s", root)
	}
	alias := filepath.Base(root)

	nodes, err := scan.Repo(root, alias)
	if err != nil {
		return Repo{}, err
	}

	idx := e.loadIndex()
	// reemplaza nodos y repo previos con el mismo alias
	kept := idx.Nodes[:0]
	for _, n := range idx.Nodes {
		if n.Repo != alias {
			kept = append(kept, n)
		}
	}
	idx.Nodes = append(kept, nodes...)

	repo := Repo{Alias: alias, Root: root, Scanned: time.Now(), NodeCount: len(nodes)}
	repos := idx.Repos[:0]
	for _, r := range idx.Repos {
		if r.Alias != alias {
			repos = append(repos, r)
		}
	}
	idx.Repos = append(repos, repo)

	if err := writeJSON(e.indexPath(), idx); err != nil {
		return Repo{}, err
	}
	return repo, nil
}

// Repos lista los repos indexados.
func (e *Engine) Repos() []Repo {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.loadIndex().Repos
}

// Nodes devuelve todos los nodos (node-lite).
func (e *Engine) Nodes() []scan.Node {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.loadIndex().Nodes
}

// NodesByID resuelve un set de IDs a sus node-lite (en el orden dado).
func (e *Engine) NodesByID(ids []string) []scan.Node {
	e.mu.Lock()
	defer e.mu.Unlock()
	byID := map[string]scan.Node{}
	for _, n := range e.loadIndex().Nodes {
		byID[n.ID] = n
	}
	out := make([]scan.Node, 0, len(ids))
	for _, id := range ids {
		if n, ok := byID[id]; ok {
			out = append(out, n)
		}
	}
	return out
}

// Connections devuelve los edges de un nodo.
func (e *Engine) Connections(id string) []graph.Edge {
	return graph.Connections(e.Nodes(), id)
}

// RepoSummary es un repo con su desglose por lenguaje + estado git (para el mapa).
type RepoSummary struct {
	Alias     string         `json:"alias"`
	NodeCount int            `json:"node_count"`
	Langs     map[string]int `json:"langs"`
	Branch    string         `json:"branch"`
	Commit    string         `json:"commit"`
}

// RepoLink es la agregación de edges cross-repo entre dos repos por tipo.
type RepoLink struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Kind  string `json:"kind"`
	Count int    `json:"count"`
}

// Summary es la vista de nivel-repo del ecosistema: repos con lenguajes +
// enlaces cross-repo agregados. Alimenta el mapa Vue Flow.
type Summary struct {
	Repos []RepoSummary `json:"repos"`
	Links []RepoLink    `json:"links"`
}

// Summary calcula el resumen nivel-repo (lenguajes por repo + edges cross-repo
// agregados por par y tipo).
func (e *Engine) Summary() Summary {
	e.mu.Lock()
	idx := e.loadIndex()
	e.mu.Unlock()

	repoOf := map[string]string{}
	langs := map[string]map[string]int{}
	for _, n := range idx.Nodes {
		repoOf[n.ID] = n.Repo
		if langs[n.Repo] == nil {
			langs[n.Repo] = map[string]int{}
		}
		langs[n.Repo][n.Lang]++
	}

	agg := map[string]int{} // from\x00to\x00kind -> count
	for _, ed := range graph.Build(idx.Nodes) {
		a, b := repoOf[ed.From], repoOf[ed.To]
		if a == "" || b == "" || a == b {
			continue // solo cross-repo
		}
		agg[a+"\x00"+b+"\x00"+ed.Kind]++
	}

	var out Summary
	for _, r := range idx.Repos {
		branch, commit := gitinfo.State(r.Root)
		out.Repos = append(out.Repos, RepoSummary{
			Alias: r.Alias, NodeCount: r.NodeCount, Langs: langs[r.Alias],
			Branch: branch, Commit: commit,
		})
	}
	for k, c := range agg {
		p := strings.SplitN(k, "\x00", 3)
		out.Links = append(out.Links, RepoLink{From: p[0], To: p[1], Kind: p[2], Count: c})
	}
	return out
}

// RepoFiles devuelve los archivos de un repo (opcionalmente filtrados por lang)
// RANKEADOS por relevancia — como los "pesos" de Rino: rutas, modelos, servicios,
// controladores y archivos de infra primero. Devuelve el top `limit` y el total.
// Sirve para "entender el nodo" sin volcar los ~2000 archivos crudos.
func (e *Engine) RepoFiles(repo, lang string, limit int) (files []scan.Node, total int) {
	if limit <= 0 {
		limit = 80
	}
	var matched []scan.Node
	for _, n := range e.Nodes() {
		if n.Repo != repo {
			continue
		}
		if lang != "" && n.Lang != lang {
			continue
		}
		matched = append(matched, n)
	}
	total = len(matched)
	sort.SliceStable(matched, func(i, j int) bool {
		return importance(matched[i]) > importance(matched[j])
	})
	if len(matched) > limit {
		matched = matched[:limit]
	}
	return matched, total
}

// importance puntúa qué tan "central" es un archivo para entender el nodo.
func importance(n scan.Node) int {
	p := strings.ToLower(n.Path)
	score := len(n.Routes)*12 +
		len(n.Tables)*8 + len(n.TableAnchors)*6 +
		len(n.Renders)*6 + len(n.RouteNames)*4 +
		len(n.Definitions) + len(n.Imports)*2
	switch {
	case strings.Contains(p, "/routes/"), strings.HasSuffix(p, "routes.ts"):
		score += 14
	}
	if strings.Contains(p, "service") || strings.Contains(p, "controller") {
		score += 10
	}
	if strings.Contains(p, "/models/") || strings.Contains(p, "migration") {
		score += 8
	}
	if strings.Contains(p, "repository") || strings.Contains(p, "/pages/") {
		score += 6
	}
	// hunde el ruido de test/spec/mock (proporcional: un test con muchas tablas
	// no debe superar al código real que sí importa para entender el nodo)
	if strings.Contains(p, "test") || strings.Contains(p, "spec") || strings.Contains(p, "mock") || strings.Contains(p, "__fixtures__") {
		score = score/5 - 25
	}
	return score
}

// Search filtra nodos cuyo path contenga q (case-insensitive). Límite 100.
func (e *Engine) Search(q string) []scan.Node {
	q = strings.ToLower(q)
	var out []scan.Node
	for _, n := range e.Nodes() {
		if q == "" || strings.Contains(strings.ToLower(n.Path), q) {
			out = append(out, n)
			if len(out) >= 100 {
				break
			}
		}
	}
	return out
}

// Content lee el código real de los IDs pedidos. Mapa id→contenido.
func (e *Engine) Content(ids []string) (map[string]string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	idx := e.loadIndex()
	rootByAlias := map[string]string{}
	for _, r := range idx.Repos {
		rootByAlias[r.Alias] = r.Root
	}
	byID := map[string]scan.Node{}
	for _, n := range idx.Nodes {
		byID[n.ID] = n
	}
	out := map[string]string{}
	for _, id := range ids {
		n, ok := byID[id]
		if !ok {
			continue
		}
		root, ok := rootByAlias[n.Repo]
		if !ok {
			continue
		}
		b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(n.Path)))
		if err != nil {
			continue
		}
		out[id] = string(b)
	}
	return out, nil
}

// ── flows ────────────────────────────────────────────────────────────────────

// SaveFlow crea o actualiza un flujo. Si id vacío, crea uno nuevo (slug del
// nombre). Devuelve el flujo guardado.
func (e *Engine) SaveFlow(id, name, description string, nodeIDs []string) (Flow, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	name = strings.TrimSpace(name)
	if name == "" {
		return Flow{}, fmt.Errorf("el flujo necesita un nombre")
	}
	if id == "" {
		id = slug(name)
	}
	// snapshot de hashes actuales = línea base del análisis
	hashes := e.hashesFor(nodeIDs)

	ff := e.loadFlows()
	now := time.Now()
	updated := false
	for i := range ff.Flows {
		if ff.Flows[i].ID == id {
			ff.Flows[i].Name = name
			ff.Flows[i].Description = description
			ff.Flows[i].NodeIDs = nodeIDs
			ff.Flows[i].Hashes = hashes
			ff.Flows[i].Updated = now
			updated = true
			break
		}
	}
	var saved Flow
	if !updated {
		saved = Flow{ID: id, Name: name, Description: description, NodeIDs: nodeIDs, Hashes: hashes, Created: now, Updated: now}
		ff.Flows = append(ff.Flows, saved)
	}
	if err := writeJSON(e.flowsPath(), ff); err != nil {
		return Flow{}, err
	}
	for _, f := range ff.Flows {
		if f.ID == id {
			return f, nil
		}
	}
	return saved, nil
}

// hashesFor devuelve el hash de contenido actual de cada id (los que existan en
// el índice). Debe llamarse con el lock tomado (usa loadIndex sin bloquear).
func (e *Engine) hashesFor(ids []string) map[string]string {
	byID := map[string]string{}
	for _, n := range e.loadIndex().Nodes {
		byID[n.ID] = n.Hash
	}
	out := map[string]string{}
	for _, id := range ids {
		if h, ok := byID[id]; ok {
			out[id] = h
		}
	}
	return out
}

// FlowStatuses computa, con una sola lectura del índice, el estado de todos los
// flujos: si siguen al día vs la línea base o qué archivos cambiaron/desaparecieron.
func (e *Engine) FlowStatuses() map[string]FlowStatus {
	e.mu.Lock()
	defer e.mu.Unlock()
	cur := map[string]string{}
	for _, n := range e.loadIndex().Nodes {
		cur[n.ID] = n.Hash
	}
	out := map[string]FlowStatus{}
	for _, f := range e.loadFlows().Flows {
		st := FlowStatus{ID: f.ID, HasBase: len(f.Hashes) > 0, UpToDate: true}
		if !st.HasBase {
			out[f.ID] = st // sin línea base: no podemos afirmar que esté desactualizado
			continue
		}
		for _, id := range f.NodeIDs {
			base, hadBase := f.Hashes[id]
			now, inIndex := cur[id]
			if !inIndex {
				st.Removed = append(st.Removed, id)
			} else if hadBase && base != now {
				st.Changed = append(st.Changed, id)
			}
		}
		st.UpToDate = len(st.Changed) == 0 && len(st.Removed) == 0
		out[f.ID] = st
	}
	return out
}

// FlowStatus computa el estado de un flujo puntual.
func (e *Engine) FlowStatus(id string) (FlowStatus, bool) {
	st, ok := e.FlowStatuses()[id]
	return st, ok
}

// Flows lista los flujos guardados (más recientes primero).
func (e *Engine) Flows() []Flow {
	e.mu.Lock()
	defer e.mu.Unlock()
	ff := e.loadFlows()
	sort.Slice(ff.Flows, func(i, j int) bool { return ff.Flows[i].Updated.After(ff.Flows[j].Updated) })
	return ff.Flows
}

// Flow devuelve un flujo por id.
func (e *Engine) Flow(id string) (Flow, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, f := range e.loadFlows().Flows {
		if f.ID == id {
			return f, true
		}
	}
	return Flow{}, false
}

// DeleteFlow elimina un flujo por id.
func (e *Engine) DeleteFlow(id string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	ff := e.loadFlows()
	out := ff.Flows[:0]
	for _, f := range ff.Flows {
		if f.ID != id {
			out = append(out, f)
		}
	}
	ff.Flows = out
	return writeJSON(e.flowsPath(), ff)
}

// ── persistencia ─────────────────────────────────────────────────────────────

func (e *Engine) loadIndex() index {
	var idx index
	readJSON(e.indexPath(), &idx)
	return idx
}
func (e *Engine) loadFlows() flowFile {
	var ff flowFile
	readJSON(e.flowsPath(), &ff)
	return ff
}

func readJSON(path string, v any) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, v)
}

// writeJSON escribe atómicamente (temp + rename) para que un lector nunca vea
// un archivo a medio escribir.
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

func slug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}
