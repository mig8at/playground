package main

/* LOS FLUJOS SE REPARAN SOLOS (2026-11-20). Cuando una pantalla cambia (un botón «Guardar» que pasa a «Guardar
 * producto», un campo que pierde su aria-label), la repetición se frenaba en «no encuentro el elemento» y había que
 * grabar el flujo de nuevo. Ahora, antes de rendirse, busca en la página un control del mismo tipo (un campo para
 * escribir, un botón o un enlace para un clic) cuyo nombre se parezca al de la grabación, y si hay UNO que gana claro,
 * sigue con ése.
 *
 * El arreglo no se escribe solo en el flujo: queda PROPUESTO (Flow.Repairs, con el nombre viejo y el nuevo) y lo aprueba
 * la persona con `bin/jarvis flows repairs <app>/<id> --apply` (o lo descarta con --discard). Un flujo que se repitió
 * con arreglos no queda verificado: lo que se verificó fue otra cosa. Lo destructivo sigue frenando igual: el
 * criterio mira el nombre NUEVO. */

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// FlowRepair es un arreglo propuesto: en el paso Step, el elemento Old ya no estaba y se usó New.
type FlowRepair struct {
	Step  int       `json:"step"`
	Old   string    `json:"old"`
	New   string    `json:"new"`
	Ref   *Ref      `json:"ref"`
	Code  string    `json:"code,omitempty"`
	Score float64   `json:"score"` // qué tan parecido era el nombre (1: igual)
	Run   string    `json:"run,omitempty"`
	At    time.Time `json:"at"`
}

// kindsFor: qué tipo de control puede hacer la acción de un paso.
func kindsFor(action string) map[string]bool {
	switch action {
	case "fill", "press":
		return map[string]bool{"field": true}
	case "select":
		return map[string]bool{"select": true}
	case "check", "uncheck":
		return map[string]bool{"check": true}
	}
	return map[string]bool{"button": true, "link": true}
}

// plainWords pasa un nombre a palabras en minúscula y sin tildes.
func plainWords(s string) []string {
	t := norm.NFD.String(strings.ToLower(s))
	var b strings.Builder
	for _, r := range t {
		switch {
		case unicode.Is(unicode.Mn, r):
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		default:
			b.WriteRune(' ')
		}
	}
	return strings.Fields(b.String())
}

// nameScore: cuánto se parece el nombre de un control al de la grabación. 1 igual (salvo mayúsculas, tildes y
// signos); 0,85 si uno contiene al otro entero; si no, la proporción de palabras en común (por 0,8).
func nameScore(old, cand string) float64 {
	a, b := plainWords(old), plainWords(cand)
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	as, bs := strings.Join(a, " "), strings.Join(b, " ")
	if as == bs {
		return 1
	}
	if strings.Contains(" "+bs+" ", " "+as+" ") || strings.Contains(" "+as+" ", " "+bs+" ") {
		return 0.85
	}
	set := map[string]bool{}
	for _, w := range a {
		set[w] = true
	}
	common := 0
	seen := map[string]bool{}
	for _, w := range b {
		if set[w] && !seen[w] {
			common++
			seen[w] = true
		}
	}
	union := len(set) + len(b) - common
	return 0.8 * float64(common) / float64(union)
}

// findReplacement elige el control que reemplaza al de un paso que ya no está: del mismo tipo, usable, con el nombre
// más parecido (al menos 0,5) y con una ventaja clara sobre el segundo (0,15). Si no hay uno así, nil: mejor parar que
// tocar otro botón.
func findReplacement(pg *Page, action, target string) (*Control, float64) {
	if pg == nil {
		return nil, 0
	}
	kinds := kindsFor(action)
	var best *Control
	bestScore, second := 0.0, 0.0
	for i := range pg.Controls {
		c := &pg.Controls[i]
		if !kinds[c.Kind] || c.Best < 0 || c.Disabled || c.Blocked {
			continue
		}
		sc := nameScore(target, c.Name)
		if sc > bestScore {
			best, bestScore, second = c, sc, bestScore
		} else if sc > second {
			second = sc
		}
	}
	if best == nil || bestScore < 0.5 || bestScore-second < 0.15 {
		return nil, 0
	}
	return best, bestScore
}

// FlowRepairs aplica (apply) o descarta (discard) los arreglos propuestos de un flujo. Aplicar cambia el elemento de
// cada paso por el nuevo; el nombre del dato (param) queda igual, así los lotes con sus columnas siguen andando.
func FlowRepairs(app, id, action string) (Flow, int, error) {
	flowsMu.Lock()
	defer flowsMu.Unlock()
	fl, err := getFlow(app, id)
	if err != nil {
		return fl, 0, err
	}
	fl.App, fl.ID = app, id
	n := len(fl.Repairs)
	if n == 0 {
		return fl, 0, errors.New("el flujo no tiene arreglos propuestos")
	}
	switch action {
	case "discard":
	case "apply":
		for _, rp := range fl.Repairs {
			if rp.Step < 0 || rp.Step >= len(fl.Steps) {
				continue
			}
			s := &fl.Steps[rp.Step]
			s.Target, s.Ref, s.Code = rp.New, rp.Ref, rp.Code
			s.Instruction = stepInstruction(Step{Action: s.Action, Target: s.Target, Value: s.Value})
		}
	default:
		return fl, 0, fmt.Errorf("arreglos: apply o discard, no %q", action)
	}
	fl.Repairs = nil
	return fl, n, writeFlow(fl)
}
