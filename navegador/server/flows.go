package main

/* Los flujos: cómo se hace algo en una app, guardado para repetirlo sin Claude o para enseñarlo. Son JSON
 * versionados en git (como los flujos del harness), uno por archivo: navegador/flujos/<app>/<id>.json. Nacen de una
 * corrida que terminó bien (Claude los crea según lo que la persona pidió) y cada repetición completa los da por
 * verificados con la fecha. Las fotos no van en git: el video es el de la corrida de origen, si está en .data. */

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"encoding/json"

	"golang.org/x/text/unicode/norm"
)

type Flow struct {
	ID       string     `json:"-"`
	App      string     `json:"-"`
	Name     string     `json:"nombre"`
	Goal     string     `json:"meta"`
	Start    string     `json:"inicio"`
	Device   string     `json:"dispositivo,omitempty"`
	Created  time.Time  `json:"creado"`
	Verified time.Time  `json:"verificado,omitempty"`
	Source   string     `json:"corrida,omitempty"`        // la corrida donde se grabó (su video, si está en .data)
	LastRun  string     `json:"ultima_corrida,omitempty"` // la última repetición
	Steps    []FlowStep `json:"pasos"`
}

type FlowStep struct {
	Action      string `json:"accion"`
	Target      string `json:"objetivo,omitempty"`
	Value       string `json:"valor,omitempty"`
	Instruction string `json:"instruccion,omitempty"`
	Why         string `json:"porque,omitempty"`
	Secret      bool   `json:"secreto,omitempty"`
	// Param: el paso escribe o elige un DATO (su nombre es el del campo); su valor es el de por defecto y se
	// puede cambiar al reproducir. Pause: acá para y lo hace la persona, aunque el flujo corra automático.
	Param string `json:"dato,omitempty"`
	Pause bool   `json:"pausa,omitempty"`
	Ref   *Ref   `json:"ref,omitempty"`
	Code  string `json:"codigo,omitempty"` // la línea de Playwright, para leerla
}

// FlowSummary es lo que lista la interfaz.
type FlowSummary struct {
	App      string    `json:"app"`
	ID       string    `json:"id"`
	Name     string    `json:"nombre"`
	Goal     string    `json:"meta"`
	Steps    int       `json:"pasos"`
	Created  time.Time `json:"creado"`
	Verified time.Time `json:"verificado"`
	Source   string    `json:"corrida"`
	Device   string    `json:"dispositivo,omitempty"`
	Params   int       `json:"datos"`
	Photo    string    `json:"foto,omitempty"` // la última foto de su corrida (la tarjeta de la galería)
}

func flowsDir() string {
	if d := os.Getenv("NAVEGADOR_FLUJOS"); d != "" {
		return d
	}
	return filepath.Join(navegadorDir(), "flujos")
}

var flowIDJunk = regexp.MustCompile(`[^a-z0-9]+`)

// flowsMu ordena las escrituras de flujos (ediciones y verificaciones que llegan juntas).
var flowsMu sync.Mutex

// slugify: «Agregá Crédito Ya en modo pruebas» → agrega-credito-ya-en-modo-pruebas (con tope).
func slugify(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		if r < 0x300 || r > 0x36f { // sin las tildes
			b.WriteRune(r)
		}
	}
	id := strings.Trim(flowIDJunk.ReplaceAllString(b.String(), "-"), "-")
	if len(id) > 60 {
		id = strings.Trim(id[:60], "-")
	}
	if id == "" {
		id = "flujo"
	}
	return id
}

// appFor es la app de una URL: la del registro con ese puerto, o el host.
func appFor(start string) string {
	u, err := url.Parse(start)
	if err != nil {
		return "otros"
	}
	for _, a := range listApps() {
		if strings.HasSuffix(u.Host, fmt.Sprintf(":%d", a.Port)) && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost") {
			return a.ID
		}
	}
	return slugify(u.Host)
}

func listFlows() []FlowSummary {
	files, _ := filepath.Glob(filepath.Join(flowsDir(), "*", "*.json"))
	out := []FlowSummary{}
	for _, f := range files {
		fl, err := readFlow(f)
		if err != nil {
			continue
		}
		sum := FlowSummary{App: fl.App, ID: fl.ID, Name: fl.Name, Goal: fl.Goal, Steps: len(fl.Steps), Created: fl.Created, Verified: fl.Verified, Source: fl.Source, Device: fl.Device}
		for _, st := range fl.Steps {
			if st.Param != "" {
				sum.Params++
			}
		}
		for _, run := range []string{fl.LastRun, fl.Source} {
			if run == "" {
				continue
			}
			shots, _ := filepath.Glob(filepath.Join(dataDir(), "corridas", run, "[0-9][0-9].png"))
			if len(shots) > 0 {
				sort.Strings(shots)
				sum.Photo = "/api/corridas/" + run + "/" + filepath.Base(shots[len(shots)-1])
				break
			}
		}
		out = append(out, sum)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].App != out[j].App {
			return out[i].App < out[j].App
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func readFlow(path string) (Flow, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Flow{}, err
	}
	var fl Flow
	if err := json.Unmarshal(b, &fl); err != nil {
		return Flow{}, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	fl.ID = strings.TrimSuffix(filepath.Base(path), ".json")
	fl.App = filepath.Base(filepath.Dir(path))
	return fl, nil
}

func flowPath(app, id string) (string, error) {
	if app == "" || id == "" || strings.ContainsAny(app+id, "/\\") || strings.HasPrefix(app, ".") || strings.HasPrefix(id, ".") {
		return "", errors.New("flujo inválido")
	}
	return filepath.Join(flowsDir(), app, id+".json"), nil
}

func getFlow(app, id string) (Flow, error) {
	p, err := flowPath(app, id)
	if err != nil {
		return Flow{}, err
	}
	return readFlow(p)
}

func writeFlow(fl Flow) error {
	p, err := flowPath(fl.App, fl.ID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(fl, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(p, append(b, '\n'), 0o644); err != nil {
		return err
	}
	hub.Publish("flows", listFlows())
	return nil
}

// SaveFlow guarda una corrida como flujo: sus pasos repetibles, con la instrucción en palabras de cada uno.
func (s *Store) SaveFlow(runID, name string) (Flow, error) {
	data, err := s.Run(runID)
	if err != nil {
		return Flow{}, err
	}
	meta, _ := data["corrida"].(RunMeta)
	all, _ := data["pasos"].([]Step)
	fl := Flow{Name: strings.TrimSpace(name), Goal: meta.Goal, Start: meta.Start, Device: meta.Device, Created: time.Now(), Source: runID}
	if fl.Name == "" {
		fl.Name = meta.Goal
	}
	if fl.Name == "" {
		return Flow{}, errors.New("el flujo necesita un nombre")
	}
	for _, st := range all {
		if !replayable(st) {
			continue
		}
		fs := FlowStep{Action: st.Action, Target: st.Target, Value: st.Value, Instruction: stepInstruction(st), Why: st.Why, Secret: st.Secret, Ref: st.Ref, Code: st.Code}
		if (st.Action == "fill" || st.Action == "select") && !st.Secret {
			fs.Param = st.Target
		}
		fs.Pause = st.Secret // una llave la escribe siempre la persona
		fl.Steps = append(fl.Steps, fs)
	}
	if len(fl.Steps) == 0 {
		return Flow{}, errors.New("la corrida no tiene pasos para repetir")
	}
	fl.App = appFor(meta.Start)
	base := slugify(fl.Name)
	fl.ID = base
	for i := 2; ; i++ {
		p, _ := flowPath(fl.App, fl.ID)
		if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) {
			break
		}
		fl.ID = fmt.Sprintf("%s-%d", base, i)
	}
	return fl, writeFlow(fl)
}

// flowSteps convierte los pasos de un flujo en pasos para la repetición, con los valores que la persona cambió
// al reproducir (por número de paso).
func flowSteps(fl Flow, values map[int]string) []Step {
	out := make([]Step, 0, len(fl.Steps))
	for i, s := range fl.Steps {
		st := Step{OK: true, Action: s.Action, Target: s.Target, Value: s.Value, Guide: s.Instruction, Why: s.Why, Secret: s.Secret, Ref: s.Ref, Code: s.Code, Pause: s.Pause}
		if v, ok := values[i]; ok && s.Param != "" {
			st.Value = v
			st.Guide = stepInstruction(Step{Action: s.Action, Target: s.Target, Value: v})
		}
		out = append(out, st)
	}
	return out
}

// updateFlow guarda lo que la persona cambió en un flujo: el nombre, el valor de cada dato y dónde para.
func updateFlow(app, id, name string, steps []struct {
	Value *string `json:"valor"`
	Pause *bool   `json:"pausa"`
}) (Flow, error) {
	// Leer, cambiar y escribir con turno: dos ediciones seguidas desde la interfaz (un dato y una pausa) se pisaban.
	flowsMu.Lock()
	defer flowsMu.Unlock()
	fl, err := getFlow(app, id)
	if err != nil {
		return fl, err
	}
	if strings.TrimSpace(name) != "" {
		fl.Name = strings.TrimSpace(name)
	}
	for i, s := range steps {
		if i >= len(fl.Steps) {
			break
		}
		if s.Value != nil && fl.Steps[i].Param != "" {
			fl.Steps[i].Value = *s.Value
			fl.Steps[i].Instruction = stepInstruction(Step{Action: fl.Steps[i].Action, Target: fl.Steps[i].Target, Value: *s.Value})
		}
		if s.Pause != nil && !fl.Steps[i].Secret {
			fl.Steps[i].Pause = *s.Pause
		}
	}
	return fl, writeFlow(fl)
}

func deleteFlow(app, id string) error {
	p, err := flowPath(app, id)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil {
		return err
	}
	hub.Publish("flows", listFlows())
	return nil
}
