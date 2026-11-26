package main

// LA VISTA QUE ARMA GEMINI. Idea de Miguel (2026-11-26): que el modelo, además del informe, diga cómo se muestra en
// Sentinel. Devuelve un JSON con un vocabulario FIJO (un titular, hallazgos, tendencias, acciones) y la interfaz lo
// dibuja (la vista «Informe», `#/report`).
//
// La regla: el modelo decide QUÉ mostrar y en qué orden; los NÚMEROS los pone Sentinel. Cada hallazgo nombra las
// señales a las que se refiere (`stage:platform`, `merchant:189`) y la interfaz las dibuja con su estado y sus números de
// AHORA, de lo guardado; el modelo no manda conteos para graficar, porque un número inventado en un tablero de
// producción es peor que no mostrar nada. Antes de guardarla, `validateView` descarta las señales que no existen,
// verifica contra main los archivos que cita y deja escrito lo que descartó.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ReportView: lo que el modelo propone mostrar.
type ReportView struct {
	Headline string          `json:"headline"`
	Level    string          `json:"level"` // green · yellow · red
	Findings []ViewFinding   `json:"findings"`
	Trends   []ViewTrend     `json:"trends"`
	Actions  []ViewAction    `json:"actions"`
	Checks   []string        `json:"checks,omitempty"` // lo que Sentinel descartó o no pudo verificar (no lo escribe el modelo)
	Files    map[string]bool `json:"files,omitempty"`  // cada ruta citada: si existe en main (lo pone Sentinel)
}

type ViewFinding struct {
	Title    string      `json:"title"`
	Severity string      `json:"severity"` // alert · warn · info
	Status   string      `json:"status"`   // open · resolved · recurring
	Since    string      `json:"since,omitempty"`
	Summary  string      `json:"summary"`
	Evidence []string    `json:"evidence"`
	Signals  []string    `json:"signals"`
	Deploy   *ViewDeploy `json:"deploy,omitempty"`
	Files    []string    `json:"files,omitempty"`
}

type ViewDeploy struct {
	Repo    string `json:"repo"`
	Version string `json:"version"`
}

type ViewTrend struct {
	Signal string `json:"signal"`
	Note   string `json:"note"`
}

type ViewAction struct {
	Text   string `json:"text"`
	Signal string `json:"signal,omitempty"`
}

// viewInstructions: lo que se le pide al modelo, al final del informe.
const viewInstructions = `Al FINAL del informe, agregá un bloque de código ` + "```json" + ` con la vista para el tablero de Sentinel, con
EXACTAMENTE este esquema (claves en inglés, textos en español, cortos: el tablero no es el informe):

{
  "headline": "una línea: cómo estuvo la semana",
  "level": "green | yellow | red",
  "findings": [
    {
      "title": "el problema en pocas palabras",
      "severity": "alert | warn | info",
      "status": "open | resolved | recurring",
      "since": "AAAA-MM-DD HH:MM, si se sabe",
      "summary": "una o dos oraciones",
      "evidence": ["el día y la sección del resumen, o el archivo del diff"],
      "signals": ["ids de la tabla «Las señales de Sentinel»"],
      "deploy": {"repo": "legacy-backend", "version": "v0.6.65"},
      "files": ["la ruta exacta del diff, si un archivo lo explica"]
    }
  ],
  "trends": [{"signal": "un id de la tabla", "note": "qué viene pasando en el mes"}],
  "actions": [{"text": "qué hacer, concreto", "signal": "un id, si aplica"}]
}

Hasta 8 hallazgos, del más grave al menos. "signals" usa SOLO ids de la tabla «Las señales de Sentinel»; no inventes
ids. No pongas números para graficar: los números los pone el tablero desde los datos. Omití "deploy" y "files" si no hay.`

// signalTable: los ids que el modelo puede citar, con su nombre: los resúmenes hablan con nombres.
func (s *sentinel) signalTable(rules Rules, now time.Time) string {
	o := s.overview(rules, now.Truncate(time.Minute))
	var b strings.Builder
	b.WriteString("# Las señales de Sentinel (los ids que puede citar la vista)\n\n")
	groups := []struct {
		title string
		list  []Subject
		all   bool
	}{
		{"Etapas del recorrido", o.Stages, true},
		{"Entidades", o.Lenders, false},
		{"Comercios", o.Merchants, false},
		{"Errores de un servicio", o.Services, true},
		{"Errores de una entidad", o.LenderErrors, false},
		{"Proveedores externos", o.Providers, true},
		{"Rechazo de CreditopX", o.Rejections, false},
	}
	for _, g := range groups {
		fmt.Fprintf(&b, "## %s\n", g.title)
		n := 0
		for _, x := range g.list {
			// De las listas largas, sólo lo que se mueve: lo que se sigue, lo que no está quieto y lo que pesa.
			if !g.all && x.State == "quiet" && !s.follow.has(x.Signal) && stakeShare(x.Stake) < 0.005 {
				continue
			}
			fmt.Fprintf(&b, "- %s · %s\n", x.Signal, x.Name)
			n++
		}
		if n == 0 {
			b.WriteString("- (ninguna)\n")
		}
		b.WriteString("\n")
	}
	b.WriteString("- all:production · Toda la originación\n\n")
	return b.String()
}

var reJSONBlock = regexp.MustCompile("(?s)```json\\s*(\\{.*?\\})\\s*```")

// parseView: el último bloque ```json del informe. Devuelve el informe sin el bloque.
func parseView(report string) (*ReportView, string, error) {
	all := reJSONBlock.FindAllStringSubmatchIndex(report, -1)
	if len(all) == 0 {
		return nil, report, fmt.Errorf("el informe no trae el bloque json de la vista")
	}
	m := all[len(all)-1]
	var v ReportView
	if err := json.Unmarshal([]byte(report[m[2]:m[3]]), &v); err != nil {
		return nil, report, fmt.Errorf("el json de la vista no se pudo leer: %w", err)
	}
	return &v, strings.TrimSpace(report[:m[0]] + report[m[1]:]), nil
}

var (
	viewLevels     = map[string]bool{"green": true, "yellow": true, "red": true}
	viewSeverities = map[string]bool{"alert": true, "warn": true, "info": true}
	viewStatuses   = map[string]bool{"open": true, "resolved": true, "recurring": true}
)

// validateView: lo que el tablero puede mostrar sin mentir. Las señales tienen que existir en lo guardado; los archivos
// se buscan en main; lo que no cumple se saca y queda escrito en Checks.
func validateView(v *ReportView, known map[string]bool) {
	if !viewLevels[v.Level] {
		v.Checks = append(v.Checks, fmt.Sprintf("nivel «%s» desconocido: quedó amarillo", v.Level))
		v.Level = "yellow"
	}
	keep := func(sig, where string) bool {
		if known[sig] {
			return true
		}
		v.Checks = append(v.Checks, fmt.Sprintf("%s: la señal «%s» no existe en Sentinel, se sacó", where, sig))
		return false
	}
	var paths []string
	if len(v.Findings) > 8 {
		v.Findings = v.Findings[:8]
	}
	for i := range v.Findings {
		f := &v.Findings[i]
		if !viewSeverities[f.Severity] {
			f.Severity = "info"
		}
		if !viewStatuses[f.Status] {
			f.Status = "open"
		}
		var sigs []string
		for _, sg := range f.Signals {
			if keep(sg, "«"+f.Title+"»") {
				sigs = append(sigs, sg)
			}
		}
		f.Signals = sigs
		paths = append(paths, f.Files...)
	}
	var trends []ViewTrend
	for _, t := range v.Trends {
		if keep(t.Signal, "tendencia") {
			trends = append(trends, t)
		}
	}
	v.Trends = trends
	for i := range v.Actions {
		if v.Actions[i].Signal != "" && !keep(v.Actions[i].Signal, "acción") {
			v.Actions[i].Signal = ""
		}
	}
	if len(paths) > 0 {
		v.Files = map[string]bool{}
		for _, p := range paths {
			v.Files[p] = pathInMain(p)
			if !v.Files[p] {
				v.Checks = append(v.Checks, fmt.Sprintf("el archivo «%s» no existe en main", p))
			}
		}
	}
}

// pathInMain: si la ruta existe en main de alguno de los repos que se despliegan.
func pathInMain(p string) bool {
	for _, repo := range []string{"legacy-backend", "frontend-monorepo", "legacy-application", "pre-approvals-service"} {
		if dir := repoDir(repo); dir != "" {
			if _, err := runTool(10*time.Second, dir, "git", "cat-file", "-e", "origin/main:"+p); err == nil {
				return true
			}
		}
	}
	return false
}

// knownSignals: todas las señales de lo guardado (lo que la vista puede nombrar).
func (s *sentinel) knownSignals(rules Rules, now time.Time) map[string]bool {
	o := s.overview(rules, now.Truncate(time.Minute))
	known := map[string]bool{"all:production": true}
	for _, list := range [][]Subject{o.Lenders, o.Merchants, o.Services, o.Liveness, o.LenderErrors, o.Stages, o.Steps, o.Providers, o.Rejections, o.Funnel} {
		for _, x := range list {
			known[x.Signal] = true
		}
	}
	return known
}

// ── lo guardado y la API ─────────────────────────────────────────────────────────────────────────────────────────

// SavedReport: el último informe, para la interfaz (`GET /api/report`).
type SavedReport struct {
	Date     string      `json:"date"`
	Markdown string      `json:"markdown"`
	View     *ReportView `json:"view,omitempty"`
	Note     string      `json:"note,omitempty"` // por qué no hay vista, si no la hay
}

// latestReport: el informe más reciente de `.data/reports` y su vista (`<día>.json`).
func (s *sentinel) latestReport() (*SavedReport, error) {
	files, _ := filepath.Glob(filepath.Join(s.reportDir(), "*.md"))
	if len(files) == 0 {
		return nil, os.ErrNotExist
	}
	sort.Strings(files)
	last := files[len(files)-1]
	raw, err := os.ReadFile(last)
	if err != nil {
		return nil, err
	}
	date := strings.TrimSuffix(filepath.Base(last), ".md")
	r := &SavedReport{Date: date, Markdown: string(raw)}
	if vraw, err := os.ReadFile(filepath.Join(s.reportDir(), date+".json")); err == nil {
		var v ReportView
		if json.Unmarshal(vraw, &v) == nil {
			r.View = &v
		}
	} else {
		r.Note = "este informe no trajo la vista para el tablero"
	}
	return r, nil
}
