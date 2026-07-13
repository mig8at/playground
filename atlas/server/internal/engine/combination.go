package engine

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"creditop/atlas/server/internal/gitinfo"
)

// Combination es un "mapa" del estado deseado del monorepo distribuido: qué rama
// debería tener cada repo. Ej: todos en main; todos en staging; unos en main y
// otros en una feature. Guarda una línea base (commit por repo, capturado cuando
// el repo estaba en la rama objetivo) para rastrear drift.
type Combination struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Targets  map[string]string `json:"targets"`  // alias → rama objetivo
	Baseline map[string]string `json:"baseline"` // alias → commit corto capturado
	Created  time.Time         `json:"created"`
	Updated  time.Time         `json:"updated"`
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
			e.Scan(root) // el contenido cambió → re-index para el drift/hashes
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

// SaveCombination crea/actualiza una combinación. Captura la línea base: para
// cada repo cuya rama ACTUAL coincide con la objetivo, graba su commit actual.
func (e *Engine) SaveCombination(id, name string, targets map[string]string) (Combination, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Combination{}, fmt.Errorf("la combinación necesita un nombre")
	}
	if len(targets) == 0 {
		return Combination{}, fmt.Errorf("la combinación necesita al menos un repo→rama")
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
			cf.Combinations[i].Targets = targets
			cf.Combinations[i].Baseline = baseline
			cf.Combinations[i].Updated = now
			updated = true
			break
		}
	}
	var saved Combination
	if !updated {
		saved = Combination{ID: id, Name: name, Targets: targets, Baseline: baseline, Created: now, Updated: now}
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
