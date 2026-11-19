package main

// UNA CORRIDA: los diez pasos del método de knowledge-drift (tools/knowledge-drift), de a uno, como un workflow de
// GitHub. Cada paso deja su estado, su duración y una línea de qué salió; la corrida se guarda entera después de cada
// cambio (`.data/runs/<n>/run.json`), así la interfaz la sigue en vivo y un reinicio no la pierde.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"
)

// Los estados de un paso y de una corrida.
const (
	stQueued  = "queued"  // todavía no le toca
	stRunning = "running" // corriendo
	stDone    = "done"    // terminó bien
	stStopped = "stopped" // frenó la corrida a propósito (verificación, sin decidir, cambios sin commitear)
	stFailed  = "failed"  // algo se rompió (un comando, el modelo)
	stSkipped = "skipped" // no hizo falta (no había nada que leer)
	stPassed  = "passed"  // la corrida terminó y aplicó
)

// Step: un paso de la corrida.
type Step struct {
	ID         string   `json:"id"`
	Label      string   `json:"label"`
	Who        string   `json:"who"` // comando · modelo
	State      string   `json:"state"`
	StartedAt  string   `json:"startedAt,omitempty"`
	FinishedAt string   `json:"finishedAt,omitempty"`
	Summary    string   `json:"summary,omitempty"` // una línea: qué salió
	Detail     []string `json:"detail,omitempty"`  // lo que hace falta para entender un freno
	Now        string   `json:"now,omitempty"`     // mientras corre: qué está haciendo
}

// Change: una fuente de knowledge que cambió en main (lo que dio `knowledge check`).
type Change struct {
	Topic string `json:"topic"`
	Repo  string `json:"repo"`
	Path  string `json:"path"`
	State string `json:"state"` // changed · missing · unreadable
}

// Run: una corrida.
type Run struct {
	ID          int      `json:"id"`
	State       string   `json:"state"` // running · passed · stopped · failed
	StartedAt   string   `json:"startedAt"`
	FinishedAt  string   `json:"finishedAt,omitempty"`
	Changes     []Change `json:"changes"`
	Fingerprint string   `json:"fingerprint"` // qué cambios tomó: una corrida frenada no se repite sobre los mismos
	Topics      []string `json:"topics"`
	Model       string   `json:"model,omitempty"`
	Steps       []Step   `json:"steps"`
	Result      string   `json:"result,omitempty"` // una línea: cómo terminó
	Commit      string   `json:"commit,omitempty"`
	// ModelDown: falló porque el modelo no contestaba (la sesión venció, el puente no responde). No cuenta como intento:
	// apenas vuelve el modelo, la misma huella se corre de nuevo.
	ModelDown bool `json:"modelDown,omitempty"`
	// Resumed: cuántas veces se retomó después de que el modelo volviera.
	Resumed int `json:"resumed,omitempty"`
	dir     string
}

// newSteps: los diez, en orden. Los ids son los de la interfaz y del registro.
func newSteps() []Step {
	steps := []Step{
		{ID: "fetch", Label: "Traer main", Who: "comando"},
		{ID: "detect", Label: "Detectar fuentes que cambiaron", Who: "comando"},
		{ID: "package", Label: "Armar paquetes (diff, PR y secciones)", Who: "comando"},
		{ID: "triage", Label: "Triaje: ¿el cambio toca lo que dice el tema?", Who: "modelo"},
		{ID: "code", Label: "Leer código de lo que el triaje no descartó", Who: "modelo"},
		{ID: "second", Label: "Segunda mirada a ciegas sobre lo descartado", Who: "modelo"},
		{ID: "final", Label: "Juntar veredictos (con las correcciones a mano)", Who: "comando"},
		{ID: "verify", Label: "Verificar contra main, independiente", Who: "modelo"},
		{ID: "apply", Label: "Aplicar: reescribir rules.md y sellar sources.json", Who: "comando"},
		{ID: "check", Label: "Comprobar y commitear", Who: "comando"},
	}
	for i := range steps {
		steps[i].State = stQueued
	}
	return steps
}

// runStore: las corridas guardadas.
type runStore struct {
	mu  sync.Mutex
	dir string // .data/runs
}

func (s *runStore) path(id int) string { return filepath.Join(s.dir, strconv.Itoa(id), "run.json") }

func (s *runStore) save(r *Run) {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, _ := json.MarshalIndent(r, "", " ")
	p := s.path(r.ID)
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if os.WriteFile(p+".tmp", raw, 0o644) == nil {
		_ = os.Rename(p+".tmp", p)
	}
}

func (s *runStore) load(id int) (*Run, error) {
	raw, err := os.ReadFile(s.path(id))
	if err != nil {
		return nil, err
	}
	var r Run
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	r.dir = filepath.Dir(s.path(id))
	return &r, nil
}

// ids: de la más nueva a la más vieja.
func (s *runStore) ids() []int {
	entries, _ := os.ReadDir(s.dir)
	var out []int
	for _, e := range entries {
		if n, err := strconv.Atoi(e.Name()); err == nil && e.IsDir() {
			out = append(out, n)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(out)))
	return out
}

func (s *runStore) next() int {
	if ids := s.ids(); len(ids) > 0 {
		return ids[0] + 1
	}
	return 1
}

// step: el paso por id.
func (r *Run) step(id string) *Step {
	for i := range r.Steps {
		if r.Steps[i].ID == id {
			return &r.Steps[i]
		}
	}
	panic("paso desconocido: " + id)
}

func now() string { return time.Now().Format(time.RFC3339) }

// Summary: lo que va en la lista de corridas.
type Summary struct {
	ID         int    `json:"id"`
	State      string `json:"state"`
	StartedAt  string `json:"startedAt"`
	FinishedAt string `json:"finishedAt,omitempty"`
	Title      string `json:"title"`
	Result     string `json:"result,omitempty"`
	StoppedAt  string `json:"stoppedAt,omitempty"`  // el paso donde frenó o falló
	Superseded bool   `json:"superseded,omitempty"` // frenada o fallada que ya no pide nada (pasó otra y sus temas están al día)
	Resumed    int    `json:"resumed,omitempty"`
}

func (r *Run) summary() Summary {
	sum := Summary{ID: r.ID, State: r.State, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt, Result: r.Result, Resumed: r.Resumed}
	n := len(r.Topics)
	sum.Title = fmt.Sprintf("%d %s", n, map[bool]string{true: "tema", false: "temas"}[n == 1])
	for _, st := range r.Steps {
		if st.State == stStopped || st.State == stFailed {
			sum.StoppedAt = st.Label
		}
	}
	return sum
}
