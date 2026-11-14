package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// LO QUE SE HIZO CON JARVIS. Jarvis guarda cada sesión en su carpeta (`jarvis/.data/runs/<id>/`: la meta, el
// resultado, una foto por paso y el script) y, si terminó en LISTO, un flujo en `jarvis/flows/<sitio>/`. No sabe
// de tareas y no escribe en el tablero (decisión de Miguel, 2026-11-13): es el cierre el que LEE las corridas del
// lapso y las pone en la propuesta del bloque, para que el registro del día diga qué se corrió, con qué resultado
// y dónde verlo. Como con los commits, el lapso no sabe de tareas: quien escribe el bloque saca las ajenas.

// jarvisUI es la interfaz de Jarvis, donde una corrida se ve como video con sus pasos. En el bloque va como
// `jarvis:<id>`, el tipo de enlace de la pila; la URL es para la salida por consola.
const jarvisUI = "http://localhost:5202/#/corrida/"

// jarvisRun es una corrida de Jarvis dentro del lapso.
type jarvisRun struct {
	ID      string    `json:"id"`
	At      time.Time `json:"at"`
	Site    string    `json:"site"`
	Goal    string    `json:"goal"`
	Keyword string    `json:"keyword,omitempty"` // LISTO · NO PUDE · NECESITO · CONFIRMAR
	Result  string    `json:"result,omitempty"`
	Steps   int       `json:"steps"`
	Failed  int       `json:"failed"`
	Flow    string    `json:"flow,omitempty"` // el nombre del flujo que salió de esta corrida, si lo hubo
	URL     string    `json:"url"`
}

// jarvisDirs: dónde guarda Jarvis sus corridas y sus flujos, con las mismas variables que su servidor.
func jarvisDirs(myTools string) (runs, flows string) {
	data := os.Getenv("JARVIS_DATA")
	if data == "" {
		data = filepath.Join(myTools, "jarvis", ".data")
	}
	flows = os.Getenv("JARVIS_FLOWS")
	if flows == "" {
		flows = os.Getenv("JARVIS_FLUJOS")
	}
	if flows == "" {
		flows = filepath.Join(myTools, "jarvis", "flows")
	}
	return filepath.Join(data, "runs"), flows
}

// flowNames: de qué corrida salió cada flujo (el campo `run` del JSON del flujo).
func flowNames(dir string) map[string]string {
	out := map[string]string{}
	files, _ := filepath.Glob(filepath.Join(dir, "*", "*.json"))
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var fl struct {
			Name string `json:"name"`
			Run  string `json:"run"`
		}
		if json.Unmarshal(b, &fl) == nil && fl.Run != "" {
			out[fl.Run] = fl.Name
		}
	}
	return out
}

// jarvisRuns: las corridas que empezaron entre `since` y `until`, en orden.
func jarvisRuns(myTools string, since, until time.Time) []jarvisRun {
	runsDir, flowsDir := jarvisDirs(myTools)
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		return nil
	}
	var flows map[string]string
	var out []jarvisRun
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(runsDir, e.Name(), "run.json"))
		if err != nil {
			continue
		}
		var r struct {
			ID      string `json:"id"`
			Site    string `json:"site"`
			At      string `json:"at"`
			Steps   int    `json:"steps"`
			Failed  int    `json:"failed"`
			Meta    string `json:"meta"`
			Result  string `json:"result"`
			Keyword string `json:"keyword"`
		}
		if json.Unmarshal(b, &r) != nil {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, r.At)
		if err != nil || at.Before(since) || at.After(until) {
			continue
		}
		if r.ID == "" {
			r.ID = e.Name()
		}
		if flows == nil {
			flows = flowNames(flowsDir)
		}
		out = append(out, jarvisRun{
			ID: r.ID, At: at, Site: r.Site, Goal: r.Meta, Keyword: r.Keyword, Steps: r.Steps, Failed: r.Failed,
			Result: strings.TrimSpace(strings.TrimPrefix(r.Result, r.Keyword+":")), Flow: flows[r.ID], URL: jarvisUI + r.ID,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// oneLine deja un texto en una línea y lo corta: un resultado de Jarvis puede ser un párrafo.
func oneLine(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > max {
		return string(r[:max-1]) + "…"
	}
	return s
}

// jarvisSection es la parte del bloque que nombra lo corrido con Jarvis.
func jarvisSection(runs []jarvisRun) string {
	if len(runs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Con Jarvis (las corridas del lapso; sacá las que no son de esta tarea):\n")
	for _, r := range runs {
		goal := strings.NewReplacer("[", "(", "]", ")").Replace(oneLine(r.Goal, 120))
		fmt.Fprintf(&b, "- %s · [%s](jarvis:%s) en %s, %d pasos", r.At.Format("15:04"), goal, r.ID, r.Site, r.Steps)
		if r.Failed > 0 {
			fmt.Fprintf(&b, " (%d fallaron)", r.Failed)
		}
		if r.Keyword != "" {
			fmt.Fprintf(&b, ". %s", r.Keyword)
			if r.Result != "" {
				b.WriteString(": " + oneLine(r.Result, 200))
			}
		}
		if r.Flow != "" {
			fmt.Fprintf(&b, ". Quedó como flujo «%s»", oneLine(r.Flow, 100))
		}
		b.WriteString("\n")
	}
	return b.String()
}
