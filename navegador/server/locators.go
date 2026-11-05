package main

/* Los localizadores de cada control. analyze.js propone candidatos (por rol y nombre, etiqueta, placeholder, test
 * id, texto, CSS) y marca cada control con data-navegador-id; acá se prueba cada candidato con el MISMO motor que
 * lo va a usar una prueba de Playwright: cuántos elementos encuentra y si es ese control (o algo adentro de él).
 * Un candidato sirve sólo si encuentra uno y es el correcto; el recomendado es el primero que sirve, en el orden
 * propuesto.
 *
 * ⚠ Que sirva HOY no lo hace estable: un CSS por posición (nth-of-type) se rompe con cualquier cambio del HTML.
 * Por eso queda al final del orden, y la interfaz lo marca como frágil.
 */

import (
	"strconv"

	"github.com/playwright-community/playwright-go"
)

type Box struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// Locator es un candidato para llegar a un control, con lo que dio al probarlo.
type Locator struct {
	Kind  string `json:"kind"` // role · label · placeholder · testid · text · css
	Role  string `json:"role,omitempty"`
	Value string `json:"value"`
	Exact bool   `json:"exact,omitempty"` // sólo para role: el nombre entero o una parte
	// scoped: el rol con nombre adentro de una zona de la página (navigation, main, dialog, form…)
	ScopeRole string `json:"scopeRole,omitempty"`
	ScopeName string `json:"scopeName,omitempty"`
	Code      string `json:"code"`  // la línea de Playwright (TS), lista para pegar
	Count     int    `json:"count"` // cuántos elementos encuentra en la página
	Works     bool   `json:"works"` // encuentra uno solo y es este control
}

// Control es un elemento con el que se interactúa: un campo, un botón, un enlace, una casilla.
type Control struct {
	ID       int      `json:"id"`
	Kind     string   `json:"kind"` // field · select · check · button · link
	Tag      string   `json:"tag"`
	Type     string   `json:"type"`
	Role     string   `json:"role"`
	Name     string   `json:"name"`
	Action   string   `json:"action"` // .fill('…') · .check() · .selectOption('…') · .click()
	Form     int      `json:"form"`   // índice del formulario al que pertenece, o -1
	Box      Box      `json:"box"`    // en coordenadas de la página entera: las de la captura
	Options  []Option `json:"options,omitempty"`
	Checked  *bool    `json:"checked,omitempty"`
	Disabled bool     `json:"disabled,omitempty"`
	Blocked  bool     `json:"blocked,omitempty"` // detrás de un modal abierto: un clic ahí no llega
	Zone     string   `json:"zone,omitempty"`    // la zona de la página: navigation, banner, main, contentinfo…
	// Frame: el selector del iframe donde vive, si no está en la página principal; FrameID es su número allá adentro.
	Frame    string    `json:"frame,omitempty"`
	FrameID  int       `json:"frameId,omitempty"`
	AtEnd    *bool     `json:"atEnd,omitempty"` // zona con scroll: ya se bajó hasta el final
	Locators []Locator `json:"locators"`
	Best     int       `json:"best"` // índice del recomendado, o -1 si ninguno sirve
}

type Option struct {
	Value    string `json:"value"`
	Label    string `json:"label"`
	Disabled bool   `json:"disabled,omitempty"`
}

// rootFor es desde dónde se busca: la página entera o el documento de un iframe. Las dos son un Locator, así el
// resto no distingue.
func rootFor(p playwright.Page, frame string) playwright.Locator {
	if frame != "" {
		return p.FrameLocator(frame).Locator(":root")
	}
	return p.Locator(":root")
}

// locatorFor arma en playwright-go el mismo localizador que dice el código TS del candidato.
func locatorFor(p playwright.Page, l Locator, frame string) playwright.Locator {
	exact := playwright.Bool(true)
	root := rootFor(p, frame)
	switch l.Kind {
	case "role":
		return root.GetByRole(playwright.AriaRole(l.Role), playwright.LocatorGetByRoleOptions{Name: l.Value, Exact: playwright.Bool(l.Exact)})
	case "scoped":
		var zone playwright.Locator
		if l.ScopeName != "" {
			zone = root.GetByRole(playwright.AriaRole(l.ScopeRole), playwright.LocatorGetByRoleOptions{Name: l.ScopeName})
		} else {
			zone = root.GetByRole(playwright.AriaRole(l.ScopeRole))
		}
		return zone.GetByRole(playwright.AriaRole(l.Role), playwright.LocatorGetByRoleOptions{Name: l.Value, Exact: exact})
	case "label":
		return root.GetByLabel(l.Value, playwright.LocatorGetByLabelOptions{Exact: exact})
	case "placeholder":
		return root.GetByPlaceholder(l.Value, playwright.LocatorGetByPlaceholderOptions{Exact: exact})
	case "text":
		return root.GetByText(l.Value, playwright.LocatorGetByTextOptions{Exact: exact})
	case "testid":
		return root.GetByTestId(l.Value)
	default:
		return root.Locator(l.Value)
	}
}

// verifyControls prueba cada candidato contra la página tal como está.
func verifyControls(p playwright.Page, controls []Control) {
	quick := playwright.Float(1500)
	for i := range controls {
		c := &controls[i]
		c.Best = -1
		want := strconv.Itoa(c.ID)
		if c.Frame != "" {
			want = strconv.Itoa(c.FrameID)
		}
		for j := range c.Locators {
			l := &c.Locators[j]
			loc := locatorFor(p, *l, c.Frame)
			n, err := loc.Count()
			if err != nil {
				continue
			}
			l.Count = n
			// Sirve si encuentra uno solo y es este control o algo adentro de él (el texto de un botón, su ícono):
			// un clic ahí es un clic en el control.
			if n == 1 {
				got, err := loc.Evaluate(`e => e.closest('[data-navegador-id]')?.getAttribute('data-navegador-id') ?? ''`, nil, playwright.LocatorEvaluateOptions{Timeout: quick})
				l.Works = err == nil && got == want
			}
			if l.Works && c.Best < 0 {
				c.Best = j
			}
		}
	}
}
