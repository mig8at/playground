package main

/* Repetir una corrida o un flujo SIN Claude: cada paso trae su localizador, su acción y su valor, así que se puede
 * volver a recorrer en la sesión en vivo. Dos modos:
 *
 *	fill    «autorrellenar» (como el harness con un formulario): la herramienta escribe, elige y marca sola, y en
 *	        cada botón o enlace para y lo toca la persona
 *	auto    la herramienta hace todo y frena sólo en lo destructivo (borrar, desactivar, pagar, enviar: un sí
 *	        explícito), en una llave (la escribe la persona) o si un elemento ya no está (el panel cambió)
 *	teach   «enseñame»: cada paso lo hace la persona, con la instrucción y el elemento marcados
 *
 * La repetición es una corrida nueva; la de un flujo completo lo da por verificado con la fecha de hoy. */

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
	Mode    string   `json:"mode"`   // fill (llena los campos sola; los botones los toca la persona) · auto (todo salvo lo destructivo) · teach (todo la persona)
	Auto    bool     `json:"auto"`   // seguir solo hasta el próximo paso destructivo, que pide una llave o no se encuentra
	Choices []string `json:"choices,omitempty"`
	Danger  bool     `json:"danger,omitempty"`  // el paso es destructivo (borra, desactiva, paga, envía): «hacelo» es un sí explícito
	Missing bool     `json:"missing,omitempty"` // el elemento ya no está en la página
	Secret  bool     `json:"secret,omitempty"`
	Note    string   `json:"note,omitempty"` // cómo salió el paso anterior
	Did     int      `json:"did"`            // los hizo la herramienta
	ByHand  int      `json:"byHand"`         // los hizo la persona
	Skipped int      `json:"skipped"`
	Report  string   `json:"report,omitempty"` // la corrida nueva, al terminar
	Flow    string   `json:"flow,omitempty"`   // app/id, si se repite un flujo
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
	case "goto":
		return "Abrí " + s.Value
	case "back":
		return "Volvé atrás"
	case "reload":
		return "Recargá la página"
	case "scroll-page":
		return "Bajá la página"
	case "expect":
		return "Comprobá que se vea «" + s.Value + "»"
	case "dialog":
		return map[bool]string{true: "Rechazá", false: "Aceptá"}[s.Value == "dismiss"] + " el aviso que aparece: " + s.Target
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

// LiveReplayStart repite una corrida guardada.
func (r *Runner) LiveReplayStart(runID, mode string) error {
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
	return r.startReplay(replaySource{goal: meta.Goal, start: meta.Start, device: meta.Device, run: runID}, steps, mode)
}

// LiveReplayFlow repite un flujo guardado (navegador/flujos).
func (r *Runner) LiveReplayFlow(app, id, mode string, values map[int]string) error {
	fl, err := getFlow(app, id)
	if err != nil {
		return err
	}
	return r.startReplay(replaySource{goal: fl.Name, start: absURL(app, fl.Start), device: fl.Device, flowApp: app, flowID: id}, flowSteps(fl, values), mode)
}

type replaySource struct {
	goal, start, device string
	run                 string // la corrida de origen
	flowApp, flowID     string // o el flujo
}

// startReplay abre (o reusa) la sesión en vivo en el sitio y el dispositivo de la guía, y la recorre.
func (r *Runner) startReplay(src replaySource, steps []Step, mode string) error {
	meta := struct{ Goal, Start, Device string }{src.goal, src.start, src.device}
	if l := r.liveSession(); l != nil && l.replay != nil && l.replay.Status != "done" && l.replay.Status != "stopped" {
		return errors.New("ya hay una repetición en curso")
	}
	// La sesión: la que está, si es del mismo sitio y dispositivo; si no, una nueva en la entrada de la corrida.
	u, err := url.Parse(meta.Start)
	if err != nil || u.Host == "" {
		return fmt.Errorf("la corrida no dice dónde empezó (%q)", meta.Start)
	}
	site, err := r.store.SiteFor(meta.Start)
	if err != nil {
		return err
	}
	slug := site.Slug
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
	if mode != "teach" && mode != "fill" {
		mode = "auto"
	}
	rp := &Replay{Run: src.run, Goal: meta.Goal, Total: len(steps), Status: "doing", Mode: mode, Auto: mode != "teach", answers: make(chan string, 1)}
	if src.flowID != "" {
		rp.Flow = src.flowApp + "/" + src.flowID
	}
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
			rp.Index, rp.Status, rp.Choices, rp.Danger, rp.Missing, rp.Secret = i, "doing", nil, false, false, false
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
	result := fmt.Sprintf("%s: se repitió «%s»: %d pasos los hizo la herramienta, %d la persona y %d se saltaron.", keyword, rp.Goal, rp.Did, rp.ByHand, rp.Skipped)
	origin := "repetición de " + rp.Run
	if rp.Flow != "" {
		origin = "flujo " + rp.Flow
	}
	dir, _ := r.LiveReport(ReportInfo{Goal: "Repetición · " + rp.Goal, Result: result, Keyword: keyword, Source: origin})
	// Un flujo que se repitió entero (sin saltear nada) queda verificado con la fecha de hoy.
	if rp.Flow != "" && !stopped && rp.Skipped == 0 {
		app, id, _ := strings.Cut(rp.Flow, "/")
		flowsMu.Lock()
		if fl, err := getFlow(app, id); err == nil {
			fl.Verified = time.Now()
			if dir != "" {
				fl.LastRun = filepath.Base(dir)
			}
			_ = writeFlow(fl)
		}
		flowsMu.Unlock()
	}
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
	danger := (st.Action == "click" || st.Action == "dblclick") && destructiveLike.MatchString(st.Target)
	// En autorrelleno, un botón o un enlace lo toca la persona: decide ella cada acción.
	byPerson := rp.Mode == "teach" || st.Pause || (rp.Mode == "fill" && (st.Action == "click" || st.Action == "dblclick" || st.Action == "press"))
	choices := []string{"do", "self", "skip", "stop"}
	if missing || st.Secret || byPerson {
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
	auto := rp.Auto && !byPerson && !missing && !st.Secret && !danger
	rp.Status, rp.Choices, rp.Danger, rp.Missing, rp.Secret = "waiting", choices, danger, missing, st.Secret
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
	if byPerson {
		choice = "self" // enseñame, autorrelleno en un botón, o un paso donde el flujo para: lo hace la persona
	} else if !auto {
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
