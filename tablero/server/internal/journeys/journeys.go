// Package journeys lee el catálogo de recorridos del harness (`harness/journeys.json`) y valida el
// `recorrido:` que declara una tarea en su frontmatter.
//
// POR QUÉ EXISTE. El vocabulario (canal, riel, producto, variación, desenlace) se escribió el 2026-11-04 para
// que una tarea pueda decir en qué camino de la plataforma cae y si lo cambia. Sin validar, `riel-4` y `rail-4`
// serían dos recorridos distintos y nadie se enteraría. El catálogo es UNO solo, el del harness: el tablero no
// guarda su propia copia de los nombres.
//
// LA FORMA. Una lista de piezas con los ids del catálogo:
//
//		recorrido: [advisor|self-service, riel-4, credit, +dynamic-form, formalizacion:radicacion]
//
//	  - canal: una clave de `channels`; varios, con `|`
//	  - `riel-N`: una clave de `rails`
//	  - producto: una clave de `products` (opcional)
//	  - `+variación`: una clave de `variations` (cero o más)
//	  - `formalizacion:x`: una de las formalizaciones del riel 4 (opcional)
//
// Un valor que el catálogo no tiene tiene que decirlo: empieza con `nuevo-` o `nueva-`
// (`formalizacion:nueva-entrega-finandina`). Sin ese prefijo es un error de tipeo, no una novedad.
package journeys

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Named es cualquier entrada del catálogo con nombre.
type Named struct {
	Name string `json:"name"`
}

// Catalog es lo que el tablero usa del catálogo del harness.
type Catalog struct {
	Channels map[string]Named `json:"channels"`
	Rails    map[string]struct {
		Name        string `json:"name"`
		PolicyOwner string `json:"policyOwner"`
		Origination string `json:"origination"`
	} `json:"rails"`
	Products   map[string]Named `json:"products"`
	Variations map[string]Named `json:"variations"`
	Outcomes   map[string]struct {
		Name           string            `json:"name"`
		Formalizations map[string]string `json:"formalizations"`
	} `json:"outcomes"`
}

// File es dónde vive el catálogo, a partir de la raíz del playground.
func File(root string) string { return filepath.Join(root, "harness", "journeys.json") }

// Load lee el catálogo.
func Load(root string) (Catalog, error) {
	var c Catalog
	b, err := os.ReadFile(File(root))
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("%s: %w", File(root), err)
	}
	return c, nil
}

// Fit es cómo se ubica la tarea frente al catálogo.
type Fit string

const (
	Fits             Fit = "encaja"
	FitsWithVariation Fit = "encaja-con-variacion"
	NewJourney     Fit = "recorrido-nuevo"
)

// Route es un recorrido ya leído: cada pieza con su nombre, y lo que el catálogo no tiene.
type Route struct {
	Channels      []string `json:"channels"`
	Rail          string   `json:"rail"`
	Product       string   `json:"product,omitempty"`
	Variations    []string `json:"variations"`
	Formalization string   `json:"formalization,omitempty"`
	New           []string `json:"new"`
	Fit           Fit      `json:"fit"`
	Line          string   `json:"line"`
}

func isNew(v string) bool { return strings.HasPrefix(v, "nuevo-") || strings.HasPrefix(v, "nueva-") }

func formalizations(c Catalog) map[string]string {
	out := map[string]string{}
	for _, o := range c.Outcomes {
		for k, v := range o.Formalizations {
			out[k] = v
		}
	}
	return out
}

// Parse lee las piezas de un `recorrido:` y las valida contra el catálogo. Devuelve los errores (piezas que no
// se entienden, o valores que el catálogo no tiene sin el prefijo `nuevo-`); con errores, Route no sirve.
func Parse(c Catalog, tokens []string) (Route, []string) {
	r := Route{Variations: []string{}, New: []string{}}
	var errs []string
	names := []string{}
	forms := formalizations(c)
	for _, raw := range tokens {
		t := strings.TrimSpace(raw)
		switch {
		case t == "":
			continue
		case strings.HasPrefix(t, "riel-"):
			if r.Rail != "" {
				errs = append(errs, fmt.Sprintf("dos rieles (%s y %s): un recorrido tiene uno", r.Rail, t))
				continue
			}
			id := strings.TrimPrefix(t, "riel-")
			r.Rail = id
			if rail, ok := c.Rails[id]; ok {
				names = append(names, fmt.Sprintf("riel %s %s", id, strings.ToLower(rail.Name)))
			} else if isNew(id) {
				r.New = append(r.New, t)
				names = append(names, "riel nuevo")
			} else {
				errs = append(errs, fmt.Sprintf("riel «%s» no está en el catálogo (%s): si es nuevo, `riel-nuevo-…`", id, keys(c.Rails)))
			}
		case strings.HasPrefix(t, "+"):
			id := strings.TrimPrefix(t, "+")
			r.Variations = append(r.Variations, id)
			if v, ok := c.Variations[id]; ok {
				names = append(names, "+"+strings.ToLower(v.Name))
			} else if isNew(id) {
				r.New = append(r.New, t)
				names = append(names, "+"+id)
			} else {
				errs = append(errs, fmt.Sprintf("variación «%s» no está en el catálogo (%s): si es nueva, `+nueva-…`", id, keys(c.Variations)))
			}
		case strings.HasPrefix(t, "formalizacion:"):
			id := strings.TrimPrefix(t, "formalizacion:")
			r.Formalization = id
			if _, ok := forms[id]; ok {
				names = append(names, "formalización "+id)
			} else if isNew(id) {
				r.New = append(r.New, t)
				names = append(names, "formalización "+id)
			} else {
				errs = append(errs, fmt.Sprintf("formalización «%s» no está en el catálogo (%s): si es nueva, `formalizacion:nueva-…`", id, keys(forms)))
			}
		default:
			if _, ok := c.Products[t]; ok && r.Product == "" {
				r.Product = t
				names = append(names, strings.ToLower(c.Products[t].Name))
				continue
			}
			var chNames []string
			bad := false
			for _, ch := range strings.Split(t, "|") {
				ch = strings.TrimSpace(ch)
				if n, ok := c.Channels[ch]; ok {
					r.Channels = append(r.Channels, ch)
					chNames = append(chNames, strings.ToLower(n.Name))
				} else if isNew(ch) {
					r.Channels = append(r.Channels, ch)
					r.New = append(r.New, ch)
					chNames = append(chNames, ch)
				} else {
					bad = true
					errs = append(errs, fmt.Sprintf("«%s» no es un canal (%s) ni un producto (%s) del catálogo", ch, keys(c.Channels), keys(c.Products)))
				}
			}
			if !bad {
				names = append([]string{strings.Join(chNames, "/")}, names...)
			}
		}
	}
	if len(r.Channels) == 0 {
		errs = append(errs, "falta el canal (el primero: "+keys(c.Channels)+")")
	}
	if r.Rail == "" {
		errs = append(errs, "falta el riel (`riel-N`)")
	}
	if r.Formalization != "" && r.Rail != "4" && !isNew(r.Rail) {
		errs = append(errs, "`formalizacion:` es del riel 4")
	}
	r.Fit = Fits
	for _, n := range r.New {
		if strings.HasPrefix(n, "riel-") || !strings.ContainsAny(n, "+:") {
			r.Fit = NewJourney
			break
		}
		r.Fit = FitsWithVariation
	}
	r.Line = strings.Join(names, " · ")
	return r, errs
}

func keys[V any](m map[string]V) string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return strings.Join(out, ", ")
}
