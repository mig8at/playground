package main

/* El modo guía: en vez de actuar, Claude MARCA en la página en vivo el elemento que la persona tiene que tocar, con
 * una instrucción corta, y espera a que lo haga (con su clic o su teclado en el editor, o con «Hecho» / «No lo
 * encuentro»). Cada paso queda con su foto de antes y el cuadro marcado, como cualquier otro: la corrida termina
 * siendo una guía con fotos («cómo se configura X en este panel») que se puede volver a ver.
 *
 * Y lo que cambió en cada campo (antes → después) en una acción de Claude: es lo que se muestra antes de guardar
 * una configuración, con las llaves y contraseñas tapadas. */

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

// GuideReq es el paso que la interfaz muestra marcado sobre la página, esperando a la persona.
type GuideReq struct {
	ID          int    `json:"id"`
	Instruction string `json:"instruction"`
	Target      string `json:"target"`
	Box         *Box   `json:"box,omitempty"`
	View        *Box   `json:"view,omitempty"`
	Replay      bool   `json:"replay,omitempty"` // es un paso de una repetición (replay.go), no de Claude
}

// GuideResult es cómo terminó: lo hizo (y qué), dijo que no lo encuentra, o no hizo nada a tiempo.
type GuideResult struct {
	Done bool   `json:"done"`
	How  string `json:"how"`
	Code string `json:"code,omitempty"`
}

// Change es lo que cambió en un campo con una acción: el antes y el después (tapados si es un secreto).
type Change struct {
	Field  string `json:"campo"`
	Before string `json:"antes"`
	After  string `json:"despues"`
}

// guideAnswer es lo que contesta la persona desde la interfaz: «Hecho» o «No lo encuentro» (con una nota).
type guideAnswer struct {
	done bool
	note string
}

const guideWait = 100 * time.Second // menos que el tope de un comando de Claude Code (2 min)

// LiveGuide marca un elemento con una instrucción y espera a que la persona lo haga.
func (r *Runner) LiveGuide(in LiveAct, instruction string) (GuideResult, error) {
	l := r.liveSession()
	if l == nil {
		return GuideResult{}, errors.New("no hay sesión en vivo")
	}
	instruction = strings.TrimSpace(instruction)
	if instruction == "" {
		return GuideResult{}, errors.New("falta la instrucción: qué tiene que hacer la persona, en una línea")
	}
	l.mu.Lock()
	cur := l.current
	l.mu.Unlock()
	if cur == nil {
		var err error
		if cur, err = r.liveAnalyze(l); err != nil {
			return GuideResult{}, err
		}
	}
	target, base, c, err := r.liveTarget(l, cur, in.Control, in.Text)
	if err != nil {
		return GuideResult{}, err
	}
	name, kind := in.Text, ""
	if c != nil {
		name, kind = c.Name, c.Kind
	}
	var shown Step
	r.shotBefore(l, target, &shown)

	l.mu.Lock()
	l.guideSeq++
	req := &GuideReq{ID: l.guideSeq, Instruction: instruction, Target: name, Box: shown.Box, View: shown.View}
	l.guide = req
	l.guideAnswers = make(chan guideAnswer, 1)
	answers := l.guideAnswers
	startInputs := l.inputs
	started := time.Now()
	l.pendingWhy = "" // en la guía, el porqué ya va en la instrucción
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		if l.guide == req {
			l.guide = nil
		}
		l.mu.Unlock()
	}()

	// Se da por hecho cuando la persona tocó la página y después se quedó quieta un momento: un clic se
	// resuelve rápido; en un campo se espera más, porque escribe de a poco.
	quiet := 1200 * time.Millisecond
	if kind == "field" || kind == "select" {
		quiet = 3 * time.Second
	}
	res := GuideResult{}
	deadline := time.Now().Add(guideWait)
wait:
	for time.Now().Before(deadline) {
		select {
		case a := <-answers:
			res.Done = a.done
			res.How = map[bool]string{true: "dijo que ya lo hizo", false: "dijo que no lo encuentra"}[a.done]
			if a.note != "" {
				res.How += ": «" + a.note + "»"
			}
			break wait
		case <-time.After(200 * time.Millisecond):
		}
		l.mu.Lock()
		touched, last := l.inputs > startInputs, l.lastInput
		l.mu.Unlock()
		if touched && time.Since(last) >= quiet {
			res.Done, res.How = true, "lo hizo en la página"
			break
		}
	}
	if res.How == "" {
		return GuideResult{How: fmt.Sprintf("no hizo nada en %.0f s", guideWait.Seconds())}, nil
	}
	if !res.Done {
		return res, nil
	}

	step := r.recordManual(l, target, base, name, kind, instruction, shown, targetRef(c, in.Text, base), started)
	res.Code = step.Code
	return res, nil
}

// recordManual registra un paso que hizo la persona: la línea del script es lo que se le pidió, con el valor que
// quedó (sin secretos), y el punto es su clic de verdad si lo hubo.
func (r *Runner) recordManual(l *live, target playwright.Locator, base, name, kind, instruction string, shown Step, ref *Ref, since time.Time) Step {
	step := Step{Target: name, OK: true, Manual: true, Guide: instruction, Before: shown.Before, Box: shown.Box, View: shown.View, Ref: ref, Point: center(shown.Box)}
	l.mu.Lock()
	if l.lastClick != nil && l.lastClickAt.After(since) {
		step.Point = l.lastClick
	}
	l.mu.Unlock()
	switch kind {
	case "field":
		step.Action = "fill"
		v, _ := target.InputValue(playwright.LocatorInputValueOptions{Timeout: playwright.Float(2000)})
		if isSecret(target, name) {
			step.Code = fmt.Sprintf("// la persona escribió %s (un secreto: no va en el script)", name)
			step.Raw, step.Secret = true, true
		} else {
			step.Code = fmt.Sprintf("%s.fill('%s')", base, jsQuote(v))
			step.Value = v
		}
	case "select":
		v, _ := target.InputValue(playwright.LocatorInputValueOptions{Timeout: playwright.Float(2000)})
		step.Code = fmt.Sprintf("%s.selectOption('%s')", base, jsQuote(v))
		step.Action, step.Value = "select", v
	case "check":
		if on, err := target.IsChecked(playwright.LocatorIsCheckedOptions{Timeout: playwright.Float(2000)}); err == nil && !on {
			step.Code, step.Action = base+".uncheck()", "uncheck"
		} else {
			step.Code, step.Action = base+".check()", "check"
		}
	default:
		step.Code, step.Action = base+".click()", "click"
	}
	r.recordStep(l, step)
	l.markDirty()
	return step
}

// LiveNarrate guarda lo que Claude pensó antes de actuar: es el «por qué» del subtítulo del próximo paso.
func (r *Runner) LiveNarrate(text string) {
	l := r.liveSession()
	if l == nil {
		return
	}
	text = strings.Join(strings.Fields(text), " ")
	if len([]rune(text)) > 220 {
		text = string([]rune(text)[:219]) + "…"
	}
	l.mu.Lock()
	l.pendingWhy = text
	l.mu.Unlock()
}

// LiveGuideAnswer es el «Hecho» o «No lo encuentro» de la interfaz.
func (r *Runner) LiveGuideAnswer(done bool, note string) error {
	l := r.liveSession()
	if l == nil {
		return errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	ch := l.guideAnswers
	waiting := l.guide != nil
	l.mu.Unlock()
	if !waiting || ch == nil {
		return errors.New("no hay ningún paso de la guía esperando")
	}
	select {
	case ch <- guideAnswer{done: done, note: strings.TrimSpace(note)}:
	default:
	}
	return nil
}

var secretName = regexp.MustCompile(`(?i)llave|key|secret|token|contrase|password|clave|pin\b|cvv`)

// isSecret: un campo de contraseña o uno que por su nombre guarda una credencial. Su valor nunca se muestra.
func isSecret(loc playwright.Locator, name string) bool {
	if secretName.MatchString(name) {
		return true
	}
	t, _ := loc.GetAttribute("type", playwright.LocatorGetAttributeOptions{Timeout: playwright.Float(1000)})
	return t == "password"
}

// fieldState es el valor de un campo antes o después de una acción, como se muestra en un cambio.
func fieldState(loc playwright.Locator, action string) string {
	opt := playwright.Float(1500)
	switch action {
	case "check", "uncheck":
		on, err := loc.IsChecked(playwright.LocatorIsCheckedOptions{Timeout: opt})
		if err != nil {
			return "?"
		}
		return map[bool]string{true: "marcada", false: "sin marcar"}[on]
	case "select":
		// La opción elegida por su texto, que es lo que se ve.
		v, err := loc.Evaluate("e => e.selectedOptions?.[0]?.textContent?.trim() ?? e.value", nil, playwright.LocatorEvaluateOptions{Timeout: opt})
		if err != nil {
			return "?"
		}
		return fmt.Sprint(v)
	default:
		v, err := loc.InputValue(playwright.LocatorInputValueOptions{Timeout: opt})
		if err != nil {
			return "?"
		}
		return v
	}
}

// LiveChanges son los cambios hechos a campos desde el último clic que guarda (o desde el principio): lo que
// se va a guardar.
func (r *Runner) LiveChanges() ([]Change, error) {
	l := r.liveSession()
	if l == nil {
		return nil, errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	steps := append([]Step{}, l.steps...)
	l.mu.Unlock()
	var out []Change
	for _, s := range steps {
		if s.OK && savesLike.MatchString(s.Target) && strings.HasSuffix(s.Code, ".click()") {
			out = nil // lo de antes ya se guardó
			continue
		}
		if s.Change == nil || !s.OK {
			continue
		}
		// El mismo campo dos veces: vale el antes del primero y el después del último.
		merged := false
		for i := range out {
			if out[i].Field == s.Change.Field {
				out[i].After, merged = s.Change.After, true
			}
		}
		if !merged {
			out = append(out, *s.Change)
		}
	}
	// Un campo que volvió a quedar como estaba no es un cambio.
	kept := out[:0]
	for _, c := range out {
		if c.Before != c.After {
			kept = append(kept, c)
		}
	}
	return kept, nil
}

// destructiveLike reconoce lo IRREVERSIBLE: lo único que, en modo automático, frena y pide el sí de la persona.
// Guardar, activar o conectar van solos. (El CLI usa el mismo criterio para frenar a Claude.)
var destructiveLike = regexp.MustCompile(`(?i)^\s*(eliminar|borrar|delete|remove|quitar|desactivar|deactivate|disable|desconectar|disconnect|pagar|pay|comprar|buy|enviar|send|publicar|publish|vaciar|empty|revocar|revoke|dar de baja|cancelar (la |mi )?(cuenta|suscripci))`)

// savesLike reconoce un botón que guarda, activa o confirma algo (el mismo criterio que el CLI usa para frenar).
var savesLike = regexp.MustCompile(`(?i)^\s*(guardar|save|publicar|publish|activar|activate|desactivar|deactivate|confirmar|confirm|aplicar|apply|enviar|send|conectar|connect|desconectar|eliminar|borrar|delete|remove|pagar|pay|comprar|buy)`)

// LiveCheck evalúa una expresión en la página y dice si dio true (la usa la suite de evals).
func (r *Runner) LiveCheck(js string) (bool, error) {
	l := r.liveSession()
	if l == nil {
		return false, errors.New("no hay sesión en vivo")
	}
	v, err := l.page.Evaluate("() => { try { return !!(" + js + ") } catch { return false } }")
	if err != nil {
		return false, err
	}
	ok, _ := v.(bool)
	return ok, nil
}
