package main

/* Repetir una guía SIN Claude: cada paso grabado trae su localizador, su acción y su valor, así que se puede volver
 * a recorrer en la sesión en vivo. En cada paso la persona elige: que lo haga la herramienta, hacerlo ella o
 * saltarlo; lo que guarda o activa pide un sí explícito, y una llave la escribe siempre ella. Si un elemento ya no
 * está (el panel cambió), el paso queda para la persona. La repetición es una corrida nueva: su reporte es la guía
 * verificada con la fecha de hoy. */

import (
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

// Ref es el elemento de un paso como se lo vuelve a encontrar: su localizador y el iframe donde vive.
type Ref struct {
	Loc   Locator `json:"loc"`
	Frame string  `json:"frame,omitempty"`
}

// targetRef arma el Ref del objetivo que resolvió liveTarget: el mejor localizador del control, o el que se usó
// para un texto (se reconoce por la línea TS que devolvió).
func targetRef(c *Control, text, code string) *Ref {
	if c != nil {
		if c.Best < 0 {
			return nil
		}
		return &Ref{Loc: c.Locators[c.Best], Frame: c.Frame}
	}
	loc := Locator{Value: text, Visible: true, Code: code}
	switch {
	case strings.HasPrefix(code, "page.getByText("):
		loc.Kind, loc.Loose = "text", !strings.Contains(code, "exact: true")
	case strings.HasPrefix(code, "page.getByAltText("):
		loc.Kind = "alt"
	case strings.HasPrefix(code, "page.getByLabel("):
		loc.Kind = "label"
	case strings.HasPrefix(code, "page.getByPlaceholder("):
		loc.Kind = "placeholder"
	default:
		return nil
	}
	return &Ref{Loc: loc}
}

// center es el punto del medio de una caja (dónde se hace clic).
func center(b *Box) *Box {
	if b == nil {
		return nil
	}
	return &Box{X: b.X + b.W/2, Y: b.Y + b.H/2}
}

// Replay es la repetición en curso, como la ve la interfaz.
type Replay struct {
	Run     string   `json:"run"`
	Goal    string   `json:"meta"`
	Index   int      `json:"index"` // el paso que se está repitiendo (de 0)
	Total   int      `json:"total"`
	Status  string   `json:"status"` // waiting (elige la persona) · doing · person (la persona lo está haciendo) · done · stopped
	Auto    bool     `json:"auto"`   // seguir solo hasta el próximo paso que guarda, pide una llave o no se encuentra
	Choices []string `json:"choices,omitempty"`
	Saves   bool     `json:"saves,omitempty"`   // el paso guarda o activa algo: «hacelo» es un sí explícito
	Missing bool     `json:"missing,omitempty"` // el elemento ya no está en la página
	Secret  bool     `json:"secret,omitempty"`
	Note    string   `json:"note,omitempty"` // cómo salió el paso anterior
	Did     int      `json:"did"`            // los hizo la herramienta
	ByHand  int      `json:"byHand"`         // los hizo la persona
	Skipped int      `json:"skipped"`
	Report  string   `json:"report,omitempty"` // la corrida nueva, al terminar
	answers chan string
}

var replayableNav = map[string]bool{"goto": true, "back": true, "forward": true, "reload": true, "scroll-page": true, "expect": true, "dialog": true}
var replayableAct = map[string]bool{"click": true, "dblclick": true, "hover": true, "fill": true, "select": true, "check": true, "uncheck": true, "press": true}

// replayable: un paso que salió bien y trae lo necesario para volver a hacerlo.
func replayable(s Step) bool {
	if !s.OK || s.Refused {
		return false
	}
	return replayableNav[s.Action] || (replayableAct[s.Action] && (s.Ref != nil || s.Secret))
}

// stepInstruction es lo que se le muestra a la persona en cada paso: lo que se le pidió en la guía, o la acción en
// palabras.
func stepInstruction(s Step) string {
	if s.Guide != "" {
		return s.Guide
	}
	t := "«" + s.Target + "»"
	switch s.Action {
	case "fill":
		if s.Secret || s.Value == "" {
			return "Escribí " + t + " (lo escribís vos)"
		}
		return fmt.Sprintf("Escribí «%s» en %s", s.Value, t)
	case "select":
		return fmt.Sprintf("Elegí «%s» en %s", s.Value, t)
	case "check":
		return "Marcá " + t
	case "uncheck":
		return "Desmarcá " + t
	case "press":
		return fmt.Sprintf("Apretá %s en %s", s.Value, t)
	case "hover":
		return "Pasá el mouse por " + t
	case "dblclick":
		return "Doble clic en " + t
	}
	return "Hacé clic en " + t
}

// LiveReplayStart repite una corrida: abre (o reusa) la sesión en vivo en su sitio y dispositivo, y recorre sus
// pasos esperando a la persona en cada uno.
func (r *Runner) LiveReplayStart(runID string) error {
	data, err := r.store.Run(runID)
	if err != nil {
		return err
	}
	meta, _ := data["corrida"].(RunMeta)
	all, _ := data["pasos"].([]Step)
	var steps []Step
	for _, s := range all {
		if replayable(s) {
			steps = append(steps, s)
		}
	}
	if len(steps) == 0 {
		return errors.New("esta corrida no tiene pasos para repetir (es de antes de que se guardaran los localizadores, o no hizo nada)")
	}
	if l := r.liveSession(); l != nil && l.replay != nil && l.replay.Status != "done" && l.replay.Status != "stopped" {
		return errors.New("ya hay una repetición en curso")
	}
	// La sesión: la que está, si es del mismo sitio y dispositivo; si no, una nueva en la entrada de la corrida.
	u, err := url.Parse(meta.Start)
	if err != nil || u.Host == "" {
		return fmt.Errorf("la corrida no dice dónde empezó (%q)", meta.Start)
	}
	slug := ""
	for _, s := range r.store.Sites() {
		if s.Host == u.Host {
			slug = s.Slug
		}
	}
	if slug == "" {
		site, err := r.store.AddSite(meta.Start, "")
		if err != nil {
			return err
		}
		slug = site.Slug
	}
	l := r.liveSession()
	if l == nil || l.site.Slug != slug || l.device != normDevice(meta.Device) {
		if l != nil {
			r.Stop()
			for i := 0; i < 100 && r.State(0).Busy; i++ {
				time.Sleep(100 * time.Millisecond)
			}
		}
		if err := r.LiveStart(slug, meta.Start, meta.Device, false); err != nil {
			return err
		}
		if l = r.liveSession(); l == nil {
			return errors.New("la sesión en vivo no arrancó")
		}
	} else if err := r.LiveNav("goto", meta.Start); err != nil {
		return err
	}
	r.LiveClearSteps() // la repetición es una corrida nueva (con la ida a la entrada como primer paso, si no la tiene)
	rp := &Replay{Run: runID, Goal: meta.Goal, Total: len(steps), Status: "doing", answers: make(chan string, 1)}
	l.mu.Lock()
	l.replay = rp
	l.mu.Unlock()
	go r.runReplay(l, rp, steps)
	return nil
}

// LiveReplayAnswer es lo que elige la persona: do (que lo haga la herramienta), self (lo hace ella), done (ya lo
// hizo), skip, stop, auto (seguir solo hasta el próximo paso delicado) o manual (volver a preguntar en cada uno).
func (r *Runner) LiveReplayAnswer(choice string) error {
	l := r.liveSession()
	if l == nil {
		return errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	rp := l.replay
	if rp != nil {
		switch choice {
		case "auto":
			rp.Auto = true
			choice = "do"
		case "manual":
			rp.Auto = false
			l.mu.Unlock()
			l.markDirty()
			return nil
		}
	}
	l.mu.Unlock()
	if rp == nil || rp.Status == "done" || rp.Status == "stopped" {
		return errors.New("no hay ninguna repetición en curso")
	}
	select {
	case rp.answers <- choice:
	default:
	}
	return nil
}

func (r *Runner) runReplay(l *live, rp *Replay, steps []Step) {
	set := func(f func()) { l.mu.Lock(); f(); l.mu.Unlock(); l.markDirty() }
	stopped := false
	for i, st := range steps {
		if r.liveSession() != l {
			stopped = true
			break
		}
		set(func() {
			rp.Index, rp.Status, rp.Choices, rp.Saves, rp.Missing, rp.Secret = i, "doing", nil, false, false, false
		})
		switch st.Action {
		case "goto", "back", "forward", "reload", "scroll-page":
			// Moverse no cambia nada: se hace solo.
			action := map[string]string{"scroll-page": "scroll"}[st.Action]
			if action == "" {
				action = st.Action
			}
			err := r.LiveNav(action, st.Value)
			set(func() {
				rp.Did++
				rp.Note = map[bool]string{true: "✓ " + stepInstructionNav(st), false: "✗ " + stepInstructionNav(st) + ": " + errText(err)}[err == nil]
			})
			continue
		case "dialog":
			_ = r.LiveDialogPolicy(st.Value == "dismiss")
			continue
		case "expect":
			_, err := r.LiveExpect(st.Value, 10)
			set(func() {
				rp.Note = map[bool]string{true: "✓ se ve «" + st.Value + "»", false: "✗ no se vio «" + st.Value + "»"}[err == nil]
			})
			continue
		}
		choice, err := r.replayStep(l, rp, st, set)
		if err != nil {
			set(func() { rp.Note = "✗ " + stepInstruction(st) + ": " + errText(err) })
		}
		if choice == "stop" {
			stopped = true
			break
		}
	}
	l.mu.Lock()
	if l.guide != nil && l.guide.Replay {
		l.guide = nil
	}
	l.mu.Unlock()
	keyword, status := "LISTO", "done"
	if stopped {
		keyword, status = "NO PUDE", "stopped"
	}
	result := fmt.Sprintf("%s: se repitió la guía «%s»: %d pasos los hizo la herramienta, %d la persona y %d se saltaron.", keyword, rp.Goal, rp.Did, rp.ByHand, rp.Skipped)
	dir, _ := r.LiveReport(ReportInfo{Goal: "Repetición · " + rp.Goal, Result: result, Keyword: keyword, Source: "repetición de " + rp.Run})
	set(func() {
		rp.Status, rp.Choices = status, nil
		if dir != "" {
			rp.Report = filepath.Base(dir)
		}
	})
}

func stepInstructionNav(s Step) string {
	switch s.Action {
	case "goto":
		return "ir a " + s.Value
	case "scroll-page":
		return "bajar la página"
	}
	return s.Target
}

// replayStep repite un paso sobre un elemento: lo busca, lo marca y espera la elección (o lo hace solo, en modo
// automático, si no es delicado).
func (r *Runner) replayStep(l *live, rp *Replay, st Step, set func(func())) (string, error) {
	instruction := stepInstruction(st)
	var loc playwright.Locator
	missing := st.Ref == nil
	if !missing {
		loc = locatorFor(l.page, st.Ref.Loc, st.Ref.Frame)
		// La página puede tardar en mostrarlo (un modal que abre, un SPA que carga).
		_ = loc.First().WaitFor(playwright.LocatorWaitForOptions{State: playwright.WaitForSelectorStateVisible, Timeout: playwright.Float(8000)})
		if n, err := loc.Count(); err != nil || n != 1 {
			missing = true
		}
	}
	saves := (st.Action == "click" || st.Action == "dblclick") && savesLike.MatchString(st.Target)
	choices := []string{"do", "self", "skip", "stop"}
	if missing || st.Secret {
		choices = []string{"self", "skip", "stop"}
	}
	var shown Step
	if !missing {
		r.shotBefore(l, loc, &shown)
	}
	note := instruction
	if missing {
		note += " (no encuentro el elemento: el panel puede haber cambiado; hacelo vos o saltalo)"
	}
	l.mu.Lock()
	l.guideSeq++
	l.guide = &GuideReq{ID: l.guideSeq, Instruction: note, Target: st.Target, Box: shown.Box, View: shown.View, Replay: true}
	startInputs, started := l.inputs, time.Now()
	auto := rp.Auto && !missing && !st.Secret && !saves
	rp.Status, rp.Choices, rp.Saves, rp.Missing, rp.Secret = "waiting", choices, saves, missing, st.Secret
	l.mu.Unlock()
	l.markDirty()
	defer func() {
		l.mu.Lock()
		if l.guide != nil && l.guide.Replay {
			l.guide = nil
		}
		l.mu.Unlock()
	}()

	choice := "do"
	if !auto {
		choice = <-rp.answers
	}
	switch choice {
	case "skip":
		set(func() { rp.Skipped++; rp.Note = "salteado: " + instruction })
		return choice, nil
	case "stop":
		return choice, nil
	case "self", "done":
		set(func() { rp.Status = "person" })
		if choice == "self" {
			// Hasta que la toque y se quede quieta, o diga «Hecho».
			if c := waitPerson(l, rp.answers, startInputs, replayKind(st.Action)); c == "stop" || c == "skip" {
				if c == "skip" {
					set(func() { rp.Skipped++ })
				}
				return c, nil
			}
		}
		if missing {
			set(func() { rp.ByHand++; rp.Note = "✓ lo hizo la persona: " + instruction })
			return choice, nil
		}
		base := st.Ref.Loc.Code
		r.recordManual(l, loc, base, st.Target, replayKind(st.Action), instruction, shown, st.Ref, started)
		set(func() { rp.ByHand++; rp.Note = "✓ lo hizo la persona: " + instruction })
		return choice, nil
	}
	// do: la herramienta lo hace, con el mismo camino que una acción de Claude (foto, diálogos, cambios).
	cur := l.current
	if cur == nil {
		cur, _ = r.liveAnalyze(l)
	}
	if cur == nil {
		cur = &Page{}
	}
	l.mu.Lock()
	l.guide = nil
	l.mu.Unlock()
	_, err := r.performAct(l, cur, LiveAct{Text: st.Target, Action: st.Action, Value: st.Value}, loc, st.Ref.Loc.Code, nil, st.Ref)
	if err == nil {
		set(func() { rp.Did++; rp.Note = "✓ " + instruction })
	}
	return choice, err
}

func replayKind(action string) string {
	switch action {
	case "fill":
		return "field"
	case "select":
		return "select"
	case "check", "uncheck":
		return "check"
	}
	return ""
}

// waitPerson espera a que la persona haga el paso: que toque la página y se quede quieta un momento (más en un
// campo, que se escribe de a poco), o que elija algo (done, skip, stop).
func waitPerson(l *live, answers chan string, startInputs int, kind string) string {
	quiet := 1200 * time.Millisecond
	if kind == "field" || kind == "select" {
		quiet = 3 * time.Second
	}
	for {
		select {
		case c := <-answers:
			if c == "done" || c == "skip" || c == "stop" {
				return c
			}
		case <-time.After(200 * time.Millisecond):
		}
		l.mu.Lock()
		touched, last := l.inputs > startInputs, l.lastInput
		l.mu.Unlock()
		if touched && time.Since(last) >= quiet {
			return "done"
		}
	}
}
