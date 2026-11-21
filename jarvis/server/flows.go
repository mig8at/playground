package main

/* Los flujos: cómo se hace algo en una app, guardado para repetirlo sin Claude o para enseñarlo. Son JSON
 * versionados en git (como los flujos del harness), uno por archivo: jarvis/flows/<app>/<id>.json. Nacen de una
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
	Name     string     `json:"name"`
	Goal     string     `json:"meta"`
	Start    string     `json:"start"`
	Device   string     `json:"device,omitempty"`
	Created  time.Time  `json:"created"`
	Verified time.Time  `json:"verified,omitempty"`
	Source   string     `json:"run,omitempty"`     // la corrida donde se grabó (su video, si está en .data)
	LastRun  string     `json:"lastRun,omitempty"` // la última repetición
	Updated  time.Time  `json:"updated,omitempty"` // la última vez que una grabación igual lo actualizó (SaveFlow)
	Steps    []FlowStep `json:"steps"`
	// Repairs: los arreglos que propuso una repetición que encontró un elemento cambiado (repair.go). No se aplican
	// solos: `bin/jarvis flows repairs <app>/<id> --apply` (o --discard).
	Repairs []FlowRepair `json:"repairs,omitempty"`
}

type FlowStep struct {
	Action      string `json:"action"`
	Target      string `json:"target,omitempty"`
	Value       string `json:"value,omitempty"`
	Instruction string `json:"instruction,omitempty"`
	Why         string `json:"why,omitempty"`
	Secret      bool   `json:"secret,omitempty"`
	// Param: el paso escribe o elige un DATO (su nombre es el del campo); su valor es el de por defecto y se
	// puede cambiar al reproducir. Pause: acá para y lo hace la persona, aunque el flujo corra automático.
	Param string `json:"param,omitempty"`
	Pause bool   `json:"pause,omitempty"`
	Ref   *Ref   `json:"ref,omitempty"`
	Code  string `json:"code,omitempty"` // la línea de Playwright, para leerla
}

// FlowSummary es lo que lista la interfaz.
type FlowSummary struct {
	App      string    `json:"app"`
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Goal     string    `json:"meta"`
	Steps    int       `json:"steps"`
	Created  time.Time `json:"created"`
	Verified time.Time `json:"verified"`
	Source   string    `json:"run"`
	Device   string    `json:"device,omitempty"`
	Params   int       `json:"params"`
	Photo    string    `json:"photo,omitempty"`   // la última foto de su corrida (la tarjeta de la galería)
	Repairs  int       `json:"repairs,omitempty"` // arreglos propuestos que esperan que la persona los apruebe (repair.go)
}

// envFirst devuelve la primera variable que esté puesta (la nueva y, después, su nombre de antes).
func envFirst(names ...string) string {
	for _, n := range names {
		if v := os.Getenv(n); v != "" {
			return v
		}
	}
	return ""
}

func flowsDir() string {
	if d := envFirst("JARVIS_FLOWS", "JARVIS_FLUJOS"); d != "" {
		return d
	}
	return filepath.Join(jarvisDir(), "flows")
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
		id = "flow"
	}
	return id
}

// appFor es la app de una URL: la del registro con ese puerto, o el host.
func appFor(start string) string {
	u, err := url.Parse(start)
	if err != nil {
		return "otros"
	}
	// Un proyecto con nombre propio que agrupa ese host (VTEX, Grafana…).
	for id, p := range listProjects() {
		for _, h := range p.Hosts {
			if strings.EqualFold(h, u.Host) {
				return id
			}
		}
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
		if b := filepath.Base(f); b == "project.json" || b == "proyecto.json" {
			continue
		}
		fl, err := readFlow(f)
		if err != nil {
			continue
		}
		sum := FlowSummary{App: fl.App, ID: fl.ID, Name: fl.Name, Goal: fl.Goal, Steps: len(fl.Steps), Created: fl.Created, Verified: fl.Verified, Source: fl.Source, Device: fl.Device, Repairs: len(fl.Repairs)}
		for _, st := range fl.Steps {
			if st.Param != "" {
				sum.Params++
			}
		}
		for _, run := range []string{fl.LastRun, fl.Source} {
			if run == "" {
				continue
			}
			shots, _ := filepath.Glob(filepath.Join(dataDir(), "runs", run, "[0-9][0-9].png"))
			if len(shots) > 0 {
				sort.Strings(shots)
				sum.Photo = "/api/run-files/" + run + "/" + filepath.Base(shots[len(shots)-1])
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

// SaveOpts: a qué flujo va una grabación. Into ("<app>/<id>") actualiza ése; New fuerza uno nuevo aunque ya haya uno
// igual. Sin nada, una grabación con el MISMO recorrido que un flujo de la app (o el mismo nombre) lo actualiza.
type SaveOpts struct {
	Into string
	New  bool
}

// SaveFlow guarda una corrida como flujo: sus pasos repetibles, con la instrucción en palabras de cada uno. Devuelve
// también cómo: "new" (uno nuevo), "same-steps" (actualizó el que tiene el mismo recorrido), "same-name" (el que se
// llama igual) o "into" (el que se pidió).
func (s *Store) SaveFlow(runID, name string, opts SaveOpts) (Flow, string, error) {
	data, err := s.Run(runID)
	if err != nil {
		return Flow{}, "", err
	}
	meta, _ := data["run"].(RunMeta)
	all, _ := data["steps"].([]Step)
	fl := Flow{Name: strings.TrimSpace(name), Goal: meta.Goal, Start: meta.Start, Device: meta.Device, Created: time.Now(), Source: runID}
	if fl.Name == "" {
		fl.Name = meta.Goal
	}
	if fl.Name == "" {
		return Flow{}, "", errors.New("el flujo necesita un nombre")
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
		return Flow{}, "", errors.New("la corrida no tiene pasos para repetir")
	}
	fl.App = appFor(meta.Start)
	// En una app local, las URLs quedan relativas a la app: el flujo sigue andando aunque cambie el puerto.
	if origin := appOrigin(fl.App); origin != "" {
		fl.Start = strings.TrimPrefix(fl.Start, origin)
		for i := range fl.Steps {
			if fl.Steps[i].Action == "goto" {
				fl.Steps[i].Value = strings.TrimPrefix(fl.Steps[i].Value, origin)
				fl.Steps[i].Instruction = stepInstruction(Step{Action: "goto", Value: fl.Steps[i].Value})
			}
		}
	}
	flowsMu.Lock()
	defer flowsMu.Unlock()
	if old, how, err := sameFlow(fl, opts); err != nil {
		return Flow{}, "", err
	} else if old != nil {
		fl = mergeInto(*old, fl)
		return fl, how, writeFlow(fl)
	}
	base := slugify(fl.Name)
	fl.ID = base
	for i := 2; ; i++ {
		p, _ := flowPath(fl.App, fl.ID)
		if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) {
			break
		}
		fl.ID = fmt.Sprintf("%s-%d", base, i)
	}
	return fl, "new", writeFlow(fl)
}

// ── un flujo, no dos iguales ──
//
// Grabar dos veces lo mismo dejaba «crear-producto» y «crear-producto-2» con los mismos pasos: nadie sabía cuál era el
// bueno y borrar o editar uno no tocaba al otro. Ahora el flujo tiene una identidad —su app y su id— y una grabación
// nueva va al que ya es ése: el que tiene el mismo RECORRIDO (los mismos pasos sobre los mismos elementos, sin mirar los
// datos escritos) o, si no, el que se llama igual.

// fingerprint es el recorrido de un flujo: acción y elemento de cada paso (y el texto esperado), sin los datos que se
// escribieron —tampoco dentro del nombre de un elemento: «Publicar Bicicleta urbana» y «Publicar Casco» son el mismo
// botón de la fila del producto creado— ni la ida a la página de entrada (una grabación la tiene si abrió la página y
// otra no, si reusó una sesión que ya estaba ahí).
func fingerprint(steps []FlowStep) string {
	var data []string
	for _, s := range steps {
		if s.Param != "" && len([]rune(s.Value)) >= 3 {
			data = append(data, strings.ToLower(s.Value))
		}
	}
	var b strings.Builder
	for i, s := range steps {
		if s.Action == "goto" && (i == 0 || i == 1 && steps[0].Action == "goto") {
			continue
		}
		what := s.Target
		if s.Action == "goto" || s.Action == "expect" {
			what = s.Value
		}
		what = strings.ToLower(strings.TrimSpace(what))
		if s.Action != "goto" && s.Param == "" {
			for _, d := range data {
				what = strings.ReplaceAll(what, d, "\x00")
			}
		}
		b.WriteString(s.Action + "\x1f" + what + "\x1e")
	}
	return b.String()
}

// sameFlow busca el flujo que esta grabación tiene que actualizar (nil: va uno nuevo).
func sameFlow(fl Flow, opts SaveOpts) (*Flow, string, error) {
	if opts.Into != "" {
		app, id, _ := strings.Cut(opts.Into, "/")
		old, err := getFlow(app, id)
		if err != nil {
			return nil, "", fmt.Errorf("no existe el flujo %s: %w", opts.Into, err)
		}
		old.App, old.ID = app, id
		return &old, "into", nil
	}
	if opts.New {
		return nil, "", nil
	}
	paths, _ := filepath.Glob(filepath.Join(flowsDir(), fl.App, "*.json"))
	fp := fingerprint(fl.Steps)
	var byName *Flow
	for _, p := range paths {
		old, err := readFlow(p)
		if err != nil {
			continue
		}
		old.App, old.ID = fl.App, strings.TrimSuffix(filepath.Base(p), ".json")
		if fingerprint(old.Steps) == fp {
			return &old, "same-steps", nil
		}
		if byName == nil && (old.ID == slugify(fl.Name) || strings.EqualFold(strings.TrimSpace(old.Name), fl.Name)) {
			o := old
			byName = &o
		}
	}
	if byName != nil {
		return byName, "same-name", nil
	}
	return nil, "", nil
}

// mergeInto pone la grabación nueva en el flujo viejo: sus pasos, su corrida y sus datos de ahora; del viejo quedan el
// id, el nombre (la persona lo puede haber cambiado), cuándo se creó y, si el recorrido es el mismo, lo que la persona
// decidió en cada paso (dónde para, su texto) y que estaba verificado. Los arreglos propuestos se descartan: la
// grabación nueva ya es el arreglo.
func mergeInto(old, fl Flow) Flow {
	same := fingerprint(old.Steps) == fingerprint(fl.Steps)
	fl.ID, fl.App, fl.Name, fl.Created, fl.Updated, fl.Repairs = old.ID, old.App, old.Name, old.Created, time.Now(), nil
	if same {
		fl.Verified = old.Verified
		off := len(old.Steps) - len(fl.Steps) // una tiene la ida a la entrada y la otra no: se alinean por el final
		for i := range fl.Steps {
			if i+off < 0 || i+off >= len(old.Steps) {
				continue
			}
			o := old.Steps[i+off]
			fl.Steps[i].Pause = o.Pause || fl.Steps[i].Secret
			// El texto de un paso queda si lo escribió la persona (no es el que arma Jarvis solo).
			if o.Param == "" && o.Instruction != "" && o.Instruction != stepInstruction(Step{Action: o.Action, Target: o.Target, Value: o.Value}) {
				fl.Steps[i].Instruction = o.Instruction
			}
		}
	}
	return fl
}

// appOrigin es el origen (http://127.0.0.1:<puerto>) de una app local del registro, o vacío.
func appOrigin(app string) string {
	for _, a := range listApps() {
		if a.ID == app {
			return fmt.Sprintf("http://127.0.0.1:%d", a.Port)
		}
	}
	return ""
}

// absURL completa una URL relativa de un flujo con el origen actual de su app.
func absURL(app, u string) string {
	if strings.HasPrefix(u, "/") {
		if origin := appOrigin(app); origin != "" {
			return origin + u
		}
	}
	return u
}

// flowSteps convierte los pasos de un flujo en pasos para la repetición, con los valores que la persona cambió
// al reproducir (por número de paso).
func flowSteps(fl Flow, values map[int]string) []Step {
	out := make([]Step, 0, len(fl.Steps))
	for i, s := range fl.Steps {
		st := Step{OK: true, Action: s.Action, Target: s.Target, Value: s.Value, Guide: s.Instruction, Why: s.Why, Secret: s.Secret, Ref: s.Ref, Code: s.Code, Pause: s.Pause}
		if s.Action == "goto" {
			st.Value = absURL(fl.App, s.Value)
		}
		if v, ok := values[i]; ok && s.Param != "" {
			st.Value = v
			st.Guide = stepInstruction(Step{Action: s.Action, Target: s.Target, Value: v})
		}
		// Un elemento cuyo nombre lleva un dato del flujo («Publicar Bicicleta urbana», la fila del producto que se
		// acaba de crear) se busca con el dato de ESTA repetición: con otro nombre, el botón es «Publicar Casco».
		for j, d := range fl.Steps[:i] {
			if v, ok := values[j]; ok && d.Param != "" && len([]rune(d.Value)) >= 3 && v != d.Value && strings.Contains(st.Target, d.Value) {
				st.Target = strings.ReplaceAll(st.Target, d.Value, v)
				st.Code = strings.ReplaceAll(st.Code, d.Value, v)
				st.Guide = stepInstruction(Step{Action: st.Action, Target: st.Target, Value: st.Value})
				if st.Ref != nil {
					ref := *st.Ref
					ref.Loc.Value = strings.ReplaceAll(ref.Loc.Value, d.Value, v)
					ref.Loc.ScopeName = strings.ReplaceAll(ref.Loc.ScopeName, d.Value, v)
					ref.Loc.Code = strings.ReplaceAll(ref.Loc.Code, d.Value, v)
					st.Ref = &ref
				}
			}
		}
		out = append(out, st)
	}
	return out
}

// FlowEdit es lo que la persona cambia de un paso: su dato, si para, su texto, o sacarlo.
type FlowEdit struct {
	Value       *string `json:"value"`
	Pause       *bool   `json:"pause"`
	Instruction *string `json:"instruction"`
	Delete      bool    `json:"delete"`
}

// updateFlow guarda lo que la persona cambió en un flujo: el nombre y, por paso, su dato, si para, su texto o
// sacarlo (los pasos se identifican por su posición ANTES de la edición).
func updateFlow(app, id, name string, steps []FlowEdit) (Flow, error) {
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
		if s.Instruction != nil && strings.TrimSpace(*s.Instruction) != "" {
			fl.Steps[i].Instruction = strings.TrimSpace(*s.Instruction)
		}
	}
	kept := fl.Steps[:0]
	for i, st := range fl.Steps {
		if i < len(steps) && steps[i].Delete {
			continue
		}
		kept = append(kept, st)
	}
	if len(kept) == 0 {
		return fl, errors.New("un flujo sin pasos no sirve: eliminá el flujo")
	}
	fl.Steps = kept
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

// DeleteProject borra un proyecto: todos sus flujos (jarvis/flows/<app>) y sus corridas guardadas en .data
// (las que arrancaron en su app o en su host), con sus fotos. Una app de práctica del registro sigue en la lista,
// vacía; un sitio real desaparece. Devuelve cuántos flujos y corridas borró.
func (s *Store) DeleteProject(app string) (int, int, error) {
	if app == "" || strings.ContainsAny(app, "/\\") || strings.HasPrefix(app, ".") {
		return 0, 0, errors.New("proyecto inválido")
	}
	flowsMu.Lock()
	defer flowsMu.Unlock()
	files, _ := filepath.Glob(filepath.Join(flowsDir(), app, "*.json"))
	if err := os.RemoveAll(filepath.Join(flowsDir(), app)); err != nil {
		return 0, 0, err
	}
	runs := 0
	for _, r := range s.Runs() {
		if appFor(r.Start) != app {
			continue
		}
		if err := os.RemoveAll(filepath.Join(s.dir, "runs", r.ID)); err == nil {
			runs++
		}
	}
	hub.Publish("flows", listFlows())
	hub.Publish("runs", s.Runs())
	return len(files), runs, nil
}
