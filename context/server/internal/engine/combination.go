package engine

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"creditop/context/server/internal/gitinfo"
)

// Combination es un "mapa" del estado deseado del monorepo distribuido: qué rama
// debería tener cada repo. Ej: todos en main; todos en staging; unos en main y
// otros en una feature. Guarda una línea base (commit por repo, capturado cuando
// el repo estaba en la rama objetivo) para rastrear drift.
type Combination struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Parent   string            `json:"parent,omitempty"` // id del workspace padre (deriva sus ramas)
	Targets  map[string]string `json:"targets"`          // alias → rama objetivo
	Baseline map[string]string `json:"baseline"`         // alias → commit corto capturado
	Tasks    []Task            `json:"tasks,omitempty"`  // checklist de la tarea del workspace (progreso)
	Created  time.Time         `json:"created"`
	Updated  time.Time         `json:"updated"`
}

// Task es un ítem del checklist de un workspace: para saber en qué parte de la tarea se quedó.
type Task struct {
	Text string `json:"text"`
	Done bool   `json:"done"`
}

type combFile struct {
	Combinations []Combination `json:"combinations"`
}

func (e *Engine) combsPath() string { return filepath.Join(e.dir, "combinations.json") }
func (e *Engine) loadCombs() combFile {
	var cf combFile
	readJSON(e.combsPath(), &cf)
	return cf
}

// RepoRoot resuelve la raíz en disco de un repo por alias (con lock).
func (e *Engine) RepoRoot(alias string) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.repoRoot(alias)
}

// AlignResult reporta qué pasó al alinear un repo. Si Error != "", el usuario
// debe resolverlo manual (Manual trae el comando sugerido).
type AlignResult struct {
	Alias    string `json:"alias"`
	Target   string `json:"target"`
	Was      string `json:"was"`
	Now      string `json:"now"`
	Switched bool   `json:"switched"`
	Pulled   bool   `json:"pulled"`
	Error    string `json:"error,omitempty"`
	Manual   string `json:"manual,omitempty"`
}

// AlignCombination alinea los repos a las ramas de la combinación: checkout a la
// rama objetivo + git pull --ff-only, y re-escanea si el contenido cambió. Si el
// árbol está sucio o el checkout/pull falla, NO fuerza nada: devuelve el error y
// el comando manual sugerido. Nunca genera merges/conflictos (ff-only).
func (e *Engine) AlignCombination(comboID string) []AlignResult {
	c, ok := e.Combination(comboID)
	if !ok {
		return nil
	}
	var aliases []string
	for a := range c.Targets {
		aliases = append(aliases, a)
	}
	sort.Strings(aliases)

	var results []AlignResult
	for _, alias := range aliases {
		target := c.Targets[alias]
		root := e.RepoRoot(alias)
		r := AlignResult{Alias: alias, Target: target, Manual: fmt.Sprintf("cd %s && git checkout %s && git pull", root, target)}
		if root == "" {
			r.Error = "repo no indexado"
			results = append(results, r)
			continue
		}
		beforeBranch, beforeCommit := gitinfo.State(root)
		r.Was, r.Now = beforeBranch, beforeBranch

		if !gitinfo.IsClean(root) {
			r.Error = "cambios sin commitear — hacelo manual"
			results = append(results, r)
			continue
		}
		if beforeBranch != target {
			if err := gitinfo.Checkout(root, target); err != nil {
				r.Error = "checkout falló: " + err.Error()
				results = append(results, r)
				continue
			}
			r.Switched = true
		}
		if err := gitinfo.Pull(root); err != nil {
			r.Error = "pull falló: " + err.Error() // el checkout quedó; el pull no
		} else {
			r.Pulled = true
		}
		afterBranch, afterCommit := gitinfo.State(root)
		r.Now = afterBranch
		if r.Switched || afterCommit != beforeCommit {
			e.Scan(root, alias) // el contenido cambió → re-index para el drift/hashes (conservando el alias)
		}
		results = append(results, r)
	}
	return results
}

// repoRoot resuelve la raíz en disco de un repo por alias (sin lock).
func (e *Engine) repoRoot(alias string) string {
	for _, r := range e.loadIndex().Repos {
		if r.Alias == alias {
			return r.Root
		}
	}
	return ""
}

// RepoGit devuelve la rama y el commit actuales de un repo.
func (e *Engine) RepoGit(alias string) (branch, commit string) {
	e.mu.Lock()
	root := e.repoRoot(alias)
	e.mu.Unlock()
	if root == "" {
		return "", ""
	}
	return gitinfo.State(root)
}

// RepoBranches lista las ramas locales de un repo.
func (e *Engine) RepoBranches(alias string) []string {
	e.mu.Lock()
	root := e.repoRoot(alias)
	e.mu.Unlock()
	if root == "" {
		return nil
	}
	return gitinfo.Branches(root)
}

// BranchOp reporta qué pasó con la rama de un repo al crear/borrar.
type BranchOp struct {
	Alias     string `json:"alias"`
	Branch    string `json:"branch"`
	Done      bool   `json:"done"`                // se creó / se borró
	Skipped   string `json:"skipped,omitempty"`   // motivo si no se hizo (ya existe / no existe / …)
	Published bool   `json:"published,omitempty"` // (al borrar) estaba en origin → la remota QUEDA
	Error     string `json:"error,omitempty"`
}

var protectedBranches = map[string]bool{
	"main": true, "master": true, "develop": true, "staging": true, "production": true,
}

// ownBranches son las ramas que el workspace INTRODUCE respecto de su padre
// (rama distinta a la del padre) y que NO son protegidas. Son las únicas que se
// crean/borran; las heredadas (== padre) y las protegidas nunca se tocan.
func (e *Engine) ownBranches(c Combination) (own, parentTargets map[string]string) {
	parentTargets = map[string]string{}
	if c.Parent != "" {
		if p, ok := e.Combination(c.Parent); ok {
			parentTargets = p.Targets
		}
	}
	own = map[string]string{}
	for alias, br := range c.Targets {
		if protectedBranches[br] || parentTargets[alias] == br {
			continue
		}
		own[alias] = br
	}
	return
}

func sortedKeys(m map[string]string) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// CreateBranches crea (git checkout -b) las ramas PROPIAS del workspace que aún no
// existen localmente. La BASE (de dónde se corta) por repo viene en `bases`
// (alias→rama base, ej {"application":"main","legacy-backend":"staging"}); si no
// se especifica, cae a la rama del padre. Solo con árbol limpio.
func (e *Engine) CreateBranches(comboID string, bases map[string]string) []BranchOp {
	c, ok := e.Combination(comboID)
	if !ok {
		return nil
	}
	own, parentTargets := e.ownBranches(c)
	var out []BranchOp
	for _, alias := range sortedKeys(own) {
		branch := own[alias]
		op := BranchOp{Alias: alias, Branch: branch}
		root := e.RepoRoot(alias)
		base := parentTargets[alias]
		if b, ok := bases[alias]; ok && b != "" {
			base = b
		}
		switch {
		case root == "":
			op.Error = "repo no indexado"
		case gitinfo.BranchExists(root, branch):
			op.Skipped = "ya existe"
		case !gitinfo.IsClean(root):
			op.Error = "cambios sin commitear"
		default:
			if err := gitinfo.CreateBranch(root, branch, base); err != nil {
				op.Error = err.Error()
			} else {
				op.Done = true
			}
		}
		out = append(out, op)
	}
	return out
}

// DeleteBranches borra LOCALMENTE las ramas PROPIAS del workspace. NUNCA toca el
// remoto: si la rama está publicada, la del remoto QUEDA (op.Published=true). Si
// está parado en la rama a borrar, primero hace checkout a la del padre (o main).
func (e *Engine) DeleteBranches(comboID string) []BranchOp {
	c, ok := e.Combination(comboID)
	if !ok {
		return nil
	}
	own, parentTargets := e.ownBranches(c)
	var out []BranchOp
	for _, alias := range sortedKeys(own) {
		branch := own[alias]
		op := BranchOp{Alias: alias, Branch: branch}
		root := e.RepoRoot(alias)
		if root == "" {
			op.Error = "repo no indexado"
			out = append(out, op)
			continue
		}
		if !gitinfo.BranchExists(root, branch) {
			op.Skipped = "no existe localmente"
			out = append(out, op)
			continue
		}
		op.Published = gitinfo.Published(root, branch)
		if cur, _ := gitinfo.State(root); cur == branch {
			fallback := parentTargets[alias]
			if fallback == "" || fallback == branch {
				fallback = "main"
			}
			if err := gitinfo.Checkout(root, fallback); err != nil {
				op.Error = "no pude salir de la rama: " + err.Error()
				out = append(out, op)
				continue
			}
		}
		if err := gitinfo.DeleteLocalBranch(root, branch); err != nil {
			op.Error = err.Error()
		} else {
			op.Done = true
		}
		out = append(out, op)
	}
	return out
}

// SaveCombination crea/actualiza un workspace. Captura la línea base: para
// cada repo cuya rama ACTUAL coincide con la objetivo, graba su commit actual.
// parent (opcional) enlaza el workspace a su padre: hereda su flujo si no tiene
// uno propio.
func (e *Engine) SaveCombination(id, name, parent string, targets map[string]string) (Combination, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Combination{}, fmt.Errorf("el workspace necesita un nombre")
	}
	if len(targets) == 0 {
		return Combination{}, fmt.Errorf("el workspace necesita al menos un repo→rama")
	}
	if id == "" {
		id = slug(name)
	}

	baseline := map[string]string{}
	for alias, target := range targets {
		br, commit := e.RepoGit(alias)
		if br == target {
			baseline[alias] = commit
		}
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	cf := e.loadCombs()
	now := time.Now()
	updated := false
	for i := range cf.Combinations {
		if cf.Combinations[i].ID == id {
			cf.Combinations[i].Name = name
			cf.Combinations[i].Parent = parent
			cf.Combinations[i].Targets = targets
			cf.Combinations[i].Baseline = baseline
			cf.Combinations[i].Updated = now
			updated = true
			break
		}
	}
	var saved Combination
	if !updated {
		saved = Combination{ID: id, Name: name, Parent: parent, Targets: targets, Baseline: baseline, Created: now, Updated: now}
		cf.Combinations = append(cf.Combinations, saved)
	}
	if err := writeJSON(e.combsPath(), cf); err != nil {
		return Combination{}, err
	}
	for _, c := range cf.Combinations {
		if c.ID == id {
			return c, nil
		}
	}
	return saved, nil
}

// Combinations lista las combinaciones (más recientes primero).
func (e *Engine) Combinations() []Combination {
	e.mu.Lock()
	cf := e.loadCombs()
	e.mu.Unlock()
	sort.Slice(cf.Combinations, func(i, j int) bool { return cf.Combinations[i].Updated.After(cf.Combinations[j].Updated) })
	return cf.Combinations
}

// Combination devuelve una por id.
func (e *Engine) Combination(id string) (Combination, bool) {
	for _, c := range e.Combinations() {
		if c.ID == id {
			return c, true
		}
	}
	return Combination{}, false
}

// DeleteCombination elimina una combinación.
func (e *Engine) DeleteCombination(id string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	cf := e.loadCombs()
	out := cf.Combinations[:0]
	for _, c := range cf.Combinations {
		if c.ID != id {
			out = append(out, c)
		}
	}
	cf.Combinations = out
	return writeJSON(e.combsPath(), cf)
}

// SetTasks reemplaza el checklist de un workspace (persistido en combinations.json).
func (e *Engine) SetTasks(id string, tasks []Task) (Combination, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	cf := e.loadCombs()
	for i := range cf.Combinations {
		if cf.Combinations[i].ID == id {
			cf.Combinations[i].Tasks = tasks
			cf.Combinations[i].Updated = time.Now()
			if err := writeJSON(e.combsPath(), cf); err != nil {
				return Combination{}, err
			}
			return cf.Combinations[i], nil
		}
	}
	return Combination{}, fmt.Errorf("workspace %q no existe", id)
}

// RepoAlign es el estado de alineación de un repo dentro de una combinación.
type RepoAlign struct {
	Alias   string `json:"alias"`
	Target  string `json:"target"`
	Current string `json:"current"` // rama actual
	Commit  string `json:"commit"`  // commit actual
	State   string `json:"state"`   // aligned | off | moved
}

// CombStatus reporta si la combinación coincide con el estado git actual.
type CombStatus struct {
	ID      string      `json:"id"`
	Aligned bool        `json:"aligned"` // todos los repos en su rama objetivo y sin moverse
	Repos   []RepoAlign `json:"repos"`
}

// CombinationStatus compara la combinación con el estado git actual de cada repo.
func (e *Engine) CombinationStatus(id string) (CombStatus, bool) {
	c, ok := e.Combination(id)
	if !ok {
		return CombStatus{}, false
	}
	st := CombStatus{ID: id, Aligned: true}
	// orden estable por alias
	var aliases []string
	for a := range c.Targets {
		aliases = append(aliases, a)
	}
	sort.Strings(aliases)
	for _, a := range aliases {
		target := c.Targets[a]
		br, commit := e.RepoGit(a)
		ra := RepoAlign{Alias: a, Target: target, Current: br, Commit: commit}
		switch {
		case br != target:
			ra.State = "off"
			st.Aligned = false
		case c.Baseline[a] != "" && commit != c.Baseline[a]:
			ra.State = "moved"
			st.Aligned = false
		default:
			ra.State = "aligned"
		}
		st.Repos = append(st.Repos, ra)
	}
	return st, true
}
