package engine

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ── El BUCLE DE APRENDIZAJE ────────────────────────────────────────────────────
//
// El brief rutea por match léxico contra los docs — funciona, pero no aprende.
// Este ledger cierra el ciclo: cuando una tarea se RESUELVE usando el árbol, se
// registra (enunciado → nodos que de verdad sirvieron). Las tareas siguientes
// reciben esos registros como PRECEDENTE dentro del brief ("una tarea parecida
// usó estos nodos"), que es la señal de ruteo más confiable que existe: no es
// una inferencia léxica, es uso real curado.
//
// Vive en <data-dir>/tasklog.json (runtime, junto a combinations.json): es
// memoria de USO, no documentación — no se versiona con el árbol.

// TaskRecord es una tarea resuelta: el enunciado y los nodos que sirvieron.
type TaskRecord struct {
	Task  string    `json:"task"`
	Nodes []string  `json:"nodes"`
	Note  string    `json:"note,omitempty"` // qué se hizo/decidió, para el que venga después
	At    time.Time `json:"at"`
}

type taskLogFile struct {
	Records []TaskRecord `json:"records"`
}

func (e *Engine) taskLogPath() string { return filepath.Join(e.dir, "tasklog.json") }

func (e *Engine) loadTaskLog() taskLogFile {
	var tf taskLogFile
	readJSON(e.taskLogPath(), &tf)
	return tf
}

// RecordTask registra una tarea resuelta. Valida que los nodos existan en el
// árbol (un id con typo envenenaría los precedentes). Si ya existe un registro
// con el MISMO enunciado, lo reemplaza (re-registrar es refinar, no duplicar).
func (e *Engine) RecordTask(task string, nodes []string, note string) (TaskRecord, int, error) {
	task = strings.TrimSpace(task)
	if task == "" {
		return TaskRecord{}, 0, fmt.Errorf("falta el enunciado de la tarea")
	}
	// dedupe preservando orden
	seen := map[string]bool{}
	var clean []string
	for _, n := range nodes {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		clean = append(clean, n)
	}
	if len(clean) == 0 {
		return TaskRecord{}, 0, fmt.Errorf("falta al menos un nodo que haya servido")
	}
	// validar contra el árbol ANTES de tomar e.mu (Flows toma su propio lock)
	valid := map[string]bool{}
	for _, f := range e.Flows() {
		valid[f.ID] = true
	}
	var unknown []string
	for _, n := range clean {
		if !valid[n] {
			unknown = append(unknown, n)
		}
	}
	if len(unknown) > 0 {
		return TaskRecord{}, 0, fmt.Errorf("nodos inexistentes: %s (listá los ids con context_brief)", strings.Join(unknown, ", "))
	}

	rec := TaskRecord{Task: task, Nodes: clean, Note: strings.TrimSpace(note), At: time.Now()}

	e.mu.Lock()
	defer e.mu.Unlock()
	tf := e.loadTaskLog()
	replaced := false
	for i, r := range tf.Records {
		if fold(r.Task) == fold(task) {
			tf.Records[i] = rec
			replaced = true
			break
		}
	}
	if !replaced {
		tf.Records = append(tf.Records, rec)
	}
	if err := writeJSON(e.taskLogPath(), tf); err != nil {
		return TaskRecord{}, 0, err
	}
	return rec, len(tf.Records), nil
}

// Precedent es un registro que se parece a la tarea entrante, con la evidencia.
type Precedent struct {
	Task    string   `json:"task"`
	Nodes   []string `json:"nodes"`
	Note    string   `json:"note,omitempty"`
	At      string   `json:"at"` // fecha corta: alcanza para juzgar frescura
	Matched []string `json:"matched"`
}

// Precedents devuelve las tareas registradas que se parecen a la entrante.
func (e *Engine) Precedents(task string, limit int) []Precedent {
	return precedentsFor(e.loadTaskLog().Records, task, limit)
}

// precedentsFor es la pieza pura (testeable sin engine). Exige ≥2 términos
// matcheados —un solo término compartido ("comercio") es ruido— salvo que la
// tarea entrante tenga un único término con carga semántica.
func precedentsFor(records []TaskRecord, task string, limit int) []Precedent {
	ts := terms(task)
	if len(ts) == 0 || len(records) == 0 {
		return nil
	}
	minHits := 2
	if len(ts) == 1 {
		minHits = 1
	}
	type scored struct {
		p     Precedent
		score int
		at    time.Time
	}
	var out []scored
	for _, r := range records {
		hay := fold(r.Task + " " + r.Note)
		var matched []string
		for _, t := range ts {
			if strings.Contains(hay, t) || (stem(t) != t && strings.Contains(hay, stem(t))) {
				matched = append(matched, t)
			}
		}
		if len(matched) < minHits {
			continue
		}
		out = append(out, scored{
			p: Precedent{
				Task: truncate(r.Task, 180), Nodes: r.Nodes,
				Note: truncate(r.Note, 140), At: r.At.Format("2006-01-02"), Matched: matched,
			},
			score: len(matched), at: r.At,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].score != out[j].score {
			return out[i].score > out[j].score
		}
		return out[i].at.After(out[j].at) // a igual score, el más reciente primero
	})
	if len(out) > limit {
		out = out[:limit]
	}
	ps := make([]Precedent, len(out))
	for i, s := range out {
		ps[i] = s.p
	}
	return ps
}
