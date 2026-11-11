package main

/* Una corrida guardada: en su carpeta quedan las fotos de cada paso (las deja recordStep), steps.json y run.json
 * (lo que lee el reproductor de la interfaz) y script.spec.ts (el recorrido como prueba de Playwright). */

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ReportInfo es lo que acompaña al reporte cuando lo pide ask: la meta, cómo terminó y lo que costó.
type ReportInfo struct {
	Goal    string         `json:"meta"`
	Result  string         `json:"result"`
	Keyword string         `json:"keyword,omitempty"` // LISTO · NO PUDE · NECESITO · CONFIRMAR
	Rounds  []string       `json:"rounds,omitempty"`
	Cost    float64        `json:"usd,omitempty"`
	Turns   int            `json:"turns,omitempty"`
	Seconds float64        `json:"seg,omitempty"`
	Model   string         `json:"model,omitempty"`
	Tokens  map[string]int `json:"tokens,omitempty"`
	Source  string         `json:"source,omitempty"` // ask · evals · a mano
}

// RunMeta es el run.json de una corrida: lo que necesita la lista de corridas de la interfaz.
type RunMeta struct {
	ID      string    `json:"id"`
	Site    string    `json:"site"`
	Start   string    `json:"start"`
	At      time.Time `json:"at"`
	Steps   int       `json:"steps"`
	Failed  int       `json:"failed"`
	Sources int       `json:"sources"`
	Device  string    `json:"device,omitempty"`
	ReportInfo
}

// LiveReport escribe el paso a paso de la corrida actual y devuelve la carpeta.
func (r *Runner) LiveReport(info ReportInfo) (string, error) {
	l := r.liveSession()
	if l == nil {
		return "", errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	steps := append([]Step{}, l.steps...)
	sources := append([]Source{}, l.sources...)
	dir := l.runDir
	site, start, device := l.site, l.start, l.device
	l.mu.Unlock()
	if len(steps) == 0 && len(sources) == 0 {
		return "", errors.New("la corrida no tiene pasos ni páginas consultadas todavía")
	}
	if dir == "" { // una investigación que sólo leyó: igual tiene su carpeta
		dir = filepath.Join(r.store.dir, "runs", time.Now().Format("2006-01-02_15-04-05"))
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", err
		}
		l.mu.Lock()
		l.runDir = dir
		l.mu.Unlock()
	}
	script := r.LiveScript()
	failed := 0
	for _, s := range steps {
		if !s.OK {
			failed++
		}
	}
	began := time.Now()
	if len(steps) > 0 {
		began = steps[0].At
	} else if len(sources) > 0 {
		began = sources[0].At
	}

	if err := os.WriteFile(filepath.Join(dir, "script.spec.ts"), []byte(script), 0o644); err != nil {
		return "", err
	}
	// Para la interfaz: la corrida en JSON (la lista de corridas y su visor leen esto, no el html).
	if info.Source == "" {
		info.Source = "a mano"
	}
	meta := RunMeta{ID: filepath.Base(dir), Site: site.Name, Start: start, At: began, Steps: len(steps), Failed: failed, Sources: len(sources), Device: device, ReportInfo: info}
	if err := writeJSONFile(filepath.Join(dir, "run.json"), meta); err != nil {
		return "", err
	}
	if err := writeJSONFile(filepath.Join(dir, "steps.json"), map[string]any{"steps": steps, "sources": sources}); err != nil {
		return "", err
	}
	hub.Publish("runs", r.store.Runs())
	return dir, nil
}

// Runs lista las corridas que tienen reporte, de la más nueva a la más vieja.
func (s *Store) Runs() []RunMeta {
	dirs, _ := filepath.Glob(filepath.Join(s.dir, "runs", "*", "run.json"))
	out := []RunMeta{}
	for _, p := range dirs {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var m RunMeta
		if json.Unmarshal(b, &m) == nil {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

// Run devuelve una corrida completa: su run.json, sus pasos y fuentes, y el script.
func (s *Store) Run(id string) (map[string]any, error) {
	if strings.ContainsAny(id, "/\\") || strings.HasPrefix(id, ".") {
		return nil, errors.New("corrida inválida")
	}
	dir := filepath.Join(s.dir, "runs", id)
	var meta RunMeta
	b, err := os.ReadFile(filepath.Join(dir, "run.json"))
	if err != nil {
		return nil, fmt.Errorf("no hay una corrida %s con reporte", id)
	}
	_ = json.Unmarshal(b, &meta)
	var detail struct {
		Steps   []Step   `json:"steps"`
		Sources []Source `json:"sources"`
	}
	if b, err := os.ReadFile(filepath.Join(dir, "steps.json")); err == nil {
		_ = json.Unmarshal(b, &detail)
	}
	script, _ := os.ReadFile(filepath.Join(dir, "script.spec.ts"))
	return map[string]any{"run": meta, "steps": detail.Steps, "sources": detail.Sources, "script": string(script)}, nil
}
