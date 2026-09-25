package figma

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// El INVENTARIO de componentes de un diseño: qué piezas del sistema de diseño usa el flujo, con qué
// variantes y en qué pantallas. Es lo que dice qué componentes de Vue o React hay que tener antes de
// armar pantallas —y cuáles ya existen en el front—.
//
// Cuenta las instancias de PRIMER nivel: un «Botones» cuenta, el ícono que lleva adentro no, porque es
// parte del botón y no una pieza que se arma aparte. La barra de estado del teléfono no cuenta. Sale de la
// misma respuesta que el árbol del mapa (el nombre del set viene en `components` y `componentSets`).

// ComponentUse es un componente del sistema de diseño y cómo lo usa el flujo.
type ComponentUse struct {
	Name    string       `json:"name"`    // el del set de variantes, o el del componente
	Uses    int          `json:"uses"`    // instancias de primer nivel
	Screens []string     `json:"screens"` // las pantallas donde aparece, en el orden del mapa
	Sample  string       `json:"sample"`  // una instancia, para dibujarlo
	Props   []PropValues `json:"props,omitempty"`
}

// PropValues es una propiedad del componente y los valores con que se usa. Las de texto no llevan
// valores: son el contenido («Continuar»), no una variante.
type PropValues struct {
	Name   string       `json:"name"`
	Type   string       `json:"type"` // VARIANT · BOOLEAN · TEXT · INSTANCE_SWAP
	Values []ValueCount `json:"values,omitempty"`
}

type ValueCount struct {
	Value string `json:"value"`
	Uses  int    `json:"uses"`
}

type inventoryNode struct {
	ID          string
	Name        string
	Type        string
	Visible     *bool
	ComponentID string
	Props       map[string]struct {
		Type  string
		Value json.RawMessage
	} `json:"componentProperties"`
	Children []inventoryNode
}

// ComputeInventory lee el inventario de un árbol ya bajado. `names` traduce el id de componente al
// nombre de su set; `order` son las pantallas en el orden del mapa.
func ComputeInventory(doc json.RawMessage, names map[string]string, order []string) ([]ComponentUse, error) {
	var root inventoryNode
	if err := json.Unmarshal(doc, &root); err != nil {
		return nil, fmt.Errorf("el árbol no es el JSON esperado: %v", err)
	}
	isScreen := map[string]bool{}
	for _, id := range order {
		isScreen[id] = true
	}
	type agg struct {
		use     ComponentUse
		screens map[string]bool
		props   map[string]map[string]int
		types   map[string]string
	}
	byName := map[string]*agg{}
	var walk func(n inventoryNode, screen string)
	walk = func(n inventoryNode, screen string) {
		if n.Visible != nil && !*n.Visible || reStatusBar.MatchString(n.Name) {
			return
		}
		if isScreen[n.ID] {
			screen = n.ID
		}
		if n.Type == "INSTANCE" {
			name := names[n.ComponentID]
			if name == "" {
				name = n.Name
			}
			a := byName[name]
			if a == nil {
				a = &agg{use: ComponentUse{Name: name, Sample: n.ID}, screens: map[string]bool{}, props: map[string]map[string]int{}, types: map[string]string{}}
				byName[name] = a
			}
			a.use.Uses++
			if screen != "" {
				a.screens[screen] = true
			}
			for key, p := range n.Props {
				prop := strings.SplitN(key, "#", 2)[0] // «icon#12:3» → «icon»: el sufijo es un id interno
				a.types[prop] = p.Type
				if a.props[prop] == nil {
					a.props[prop] = map[string]int{}
				}
				if p.Type == "TEXT" {
					continue
				}
				var v any
				_ = json.Unmarshal(p.Value, &v)
				a.props[prop][fmt.Sprint(v)]++
			}
			return // lo de adentro es parte de este componente
		}
		for _, ch := range n.Children {
			walk(ch, screen)
		}
	}
	walk(root, "")
	var out []ComponentUse
	for _, a := range byName {
		for _, id := range order {
			if a.screens[id] {
				a.use.Screens = append(a.use.Screens, id)
			}
		}
		for name, values := range a.props {
			pv := PropValues{Name: name, Type: a.types[name]}
			for v, n := range values {
				pv.Values = append(pv.Values, ValueCount{Value: v, Uses: n})
			}
			sort.Slice(pv.Values, func(i, j int) bool {
				return pv.Values[i].Uses > pv.Values[j].Uses || pv.Values[i].Uses == pv.Values[j].Uses && pv.Values[i].Value < pv.Values[j].Value
			})
			a.use.Props = append(a.use.Props, pv)
		}
		// Las variantes primero: son las que definen el componente; el contenido, al final.
		rank := map[string]int{"VARIANT": 0, "BOOLEAN": 1, "INSTANCE_SWAP": 2, "TEXT": 3}
		sort.Slice(a.use.Props, func(i, j int) bool {
			pi, pj := a.use.Props[i], a.use.Props[j]
			return rank[pi.Type] < rank[pj.Type] || rank[pi.Type] == rank[pj.Type] && pi.Name < pj.Name
		})
		out = append(out, a.use)
	}
	sort.Slice(out, func(i, j int) bool {
		if len(out[i].Screens) != len(out[j].Screens) {
			return len(out[i].Screens) > len(out[j].Screens)
		}
		if out[i].Uses != out[j].Uses {
			return out[i].Uses > out[j].Uses
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}
