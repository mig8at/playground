package render

import (
	"encoding/json"
	"fmt"
	"html"
	"math"
	"sort"
	"strings"
)

// Los CONTROLES de un formulario: un campo que se puede escribir, una casilla que se marca y un botón.
// Figma no tiene controles —dibuja cajas y textos—, así que se reconocen por el sistema de componentes
// que usan los diseños de producto. Medido el 2026-09-24 sobre las 100 pantallas en caché de los siete
// archivos: los cuatro que tienen formularios (Credifamilia, flujo-ecommerce, Motai, BCP) usan los MISMOS
// nombres de capa:
//
//   - campo: un texto «Input Text» adentro de un «Input Container» (121 textos). Si el contenedor trae
//     además «icon/arrow-down» es un SELECT, que todavía no se traduce: sus opciones no están en el
//     diseño;
//   - casilla: una instancia «Check Box» con una variante que dice su estado (`tipe`: «deafult» —así, con
//     la errata— vacía; «check» y «tabler-icon-square-check-filled» marcadas). 62 instancias;
//   - botón: la instancia «Botones» (25) o el marco que tiene adentro un texto «Button Text» (74).
//
// La regla de siempre sigue: la CAJA es la de Figma, idéntica, y sólo cambia lo que va adentro. Así la
// fidelidad no se toca y la pantalla además responde.
//
// El documento no corre scripts (su CSP lo prohíbe), así que la casilla alterna con CSS: un input real,
// invisible encima, y los dos dibujos de Figma —el de la instancia y el de OTRA instancia de la variante
// contraria— que `:checked` muestra o esconde. ⚠ No el del componente: Figma no exporta los componentes
// de las variantes de este sistema («invisible o vacío», medido con 1:2647 y 1:2648 de Credifamilia),
// y una instancia sí.

// ComponentProp es una propiedad de una instancia. El valor es un texto, un booleano o un id, según el tipo.
type ComponentProp struct {
	Type  string          `json:"type"`
	Value json.RawMessage `json:"value"`
}

func (p ComponentProp) text() string {
	var s string
	if json.Unmarshal(p.Value, &s) == nil {
		return s
	}
	return strings.Trim(string(p.Value), `"`)
}

// Las variantes que dicen «vacía». El resto de los valores de la variante de una casilla es «marcada».
var uncheckedValues = map[string]bool{"deafult": true, "default": true, "off": true, "false": true,
	"unchecked": true, "empty": true, "inactive": true}

const checkboxName = "Check Box"

func isCheckbox(n Node) bool { return n.Type == "INSTANCE" && n.Name == checkboxName }

// checkboxState es la variante de la casilla y si está marcada.
func checkboxState(n Node) (value string, checked bool) {
	keys := make([]string, 0, len(n.ComponentProps))
	for k := range n.ComponentProps {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if p := n.ComponentProps[k]; p.Type == "VARIANT" {
			value = p.text()
			return value, !uncheckedValues[strings.ToLower(value)]
		}
	}
	return "", false
}

func isInputText(n Node, parent *Node) bool {
	return n.Type == "TEXT" && strings.EqualFold(n.Name, "Input Text") && parent != nil &&
		parent.Name == "Input Container" && !hasChildNamed(*parent, "icon/arrow-down")
}

func isButton(n Node) bool {
	if n.Type == "INSTANCE" && n.Name == "Botones" {
		return true
	}
	if n.Type != "FRAME" && n.Type != "INSTANCE" && n.Type != "COMPONENT" {
		return false
	}
	for _, ch := range n.Children {
		if ch.Type == "TEXT" && (ch.Name == "Button Text" || ch.Name == "Button Label") {
			return true
		}
	}
	return false
}

func hasChildNamed(n Node, name string) bool {
	for _, ch := range n.Children {
		if ch.Name == name && visible(ch.Visible) {
			return true
		}
	}
	return false
}

// optionOf: el marco de una opción —la casilla y su texto, como «Option Yes»— se escribe como <label>,
// así que tocar el texto también marca la casilla.
func optionOf(n Node) bool {
	if isCheckbox(n) || n.Type == "TEXT" {
		return false
	}
	box, text := 0, 0
	for _, ch := range n.Children {
		if !visible(ch.Visible) {
			continue
		}
		switch {
		case isCheckbox(ch):
			box++
		case ch.Type == "TEXT":
			text++
		}
	}
	return box == 1 && text >= 1
}

// controlIndex es lo que se sabe de los controles antes de escribir la pantalla: qué casillas son una
// opción entre varias (un radio), qué componente dibuja la otra variante de cada casilla, y de qué color
// es lo que se escribe en cada campo.
type controlIndex struct {
	radio     map[string]string            // id de la casilla → nombre del grupo
	variants  map[string]string            // valor de la variante → una instancia que la dibuja
	groupPeer map[string]map[string]string // grupo → valor → instancia, de las casillas del mismo grupo
	fields    map[string]field             // id del texto del campo → su etiqueta
}

// field es la etiqueta de un campo: su texto nombra el input, y su color es el de lo que se escribe.
type field struct{ label, color string }

func indexControls(screen Node, fileVariants map[string]string) *controlIndex {
	ix := &controlIndex{radio: map[string]string{}, variants: map[string]string{},
		groupPeer: map[string]map[string]string{}, fields: map[string]field{}}
	for v, id := range fileVariants {
		ix.variants[v] = id
	}
	// Las de la pantalla ganan: son las que el diseñador usó acá.
	var walk func(n Node, label field)
	walk = func(n Node, label field) {
		if isCheckbox(n) {
			if v, _ := checkboxState(n); v != "" {
				ix.variants[v] = n.ID
			}
		}
		// Un «Text- fields» es etiqueta + campo + error: el primer texto es la etiqueta, y su color es el
		// de lo que se escribe (el del placeholder es el gris de «todavía nada»).
		if n.Name == "Text- fields" {
			for _, ch := range n.Children {
				if ch.Type == "TEXT" {
					label = field{label: strings.TrimSpace(ch.Characters), color: firstSolid(ch.Fills)}
					break
				}
			}
		}
		if n.Type == "TEXT" && strings.EqualFold(n.Name, "Input Text") && label.label != "" {
			ix.fields[n.ID] = label
		}
		ix.radioGroup(n)
		for _, ch := range n.Children {
			walk(ch, label)
		}
	}
	walk(screen, field{})
	return ix
}

// radioGroup: dos o más opciones hermanas cuyos textos son «Sí» y «No» son UNA pregunta, y se contestan
// con una sola. Una lista de otras opciones («Ejerce un cargo público», «Es representante legal…») se
// deja como casillas: no hay forma de saber desde el dibujo si se puede marcar más de una.
func (ix *controlIndex) radioGroup(n Node) {
	var boxes []Node
	yesNo := true
	for _, ch := range n.Children {
		if !visible(ch.Visible) || !optionOf(ch) {
			continue
		}
		for _, x := range ch.Children {
			switch {
			case isCheckbox(x):
				boxes = append(boxes, x)
			case x.Type == "TEXT":
				t := strings.ToLower(strings.TrimSpace(x.Characters))
				if t != "sí" && t != "si" && t != "no" {
					yesNo = false
				}
			}
		}
	}
	if len(boxes) < 2 || !yesNo {
		return
	}
	group := "g-" + n.ID
	peers := map[string]string{}
	for _, b := range boxes {
		ix.radio[b.ID] = group
		if v, _ := checkboxState(b); v != "" {
			peers[v] = b.ID
		}
	}
	ix.groupPeer[group] = peers
}

// other devuelve una instancia que dibuja la variante contraria de la casilla, o "" si no se conoce.
func (ix *controlIndex) other(n Node) string {
	mine, checked := checkboxState(n)
	pick := func(from map[string]string) string {
		values := make([]string, 0, len(from))
		for v := range from {
			values = append(values, v)
		}
		// «check» antes que los demás marcados: es la variante con nombre de estado, no de ícono.
		rank := func(v string) string {
			if v == "check" {
				return ""
			}
			return v
		}
		sort.Slice(values, func(i, j int) bool { return rank(values[i]) < rank(values[j]) })
		for _, v := range values {
			if uncheckedValues[strings.ToLower(v)] == checked && v != mine {
				return from[v]
			}
		}
		return ""
	}
	if g := ix.radio[n.ID]; g != "" {
		if id := pick(ix.groupPeer[g]); id != "" {
			return id
		}
	}
	return pick(ix.variants)
}

// checkbox escribe la casilla: el input real, invisible y del tamaño de la caja, y los dos dibujos.
func (w *writer) checkbox(n Node, css *style) {
	_, checked := checkboxState(n)
	kind, name := "checkbox", ""
	if g := w.controls.radio[n.ID]; g != "" {
		kind, name = "radio", g
	}
	w.report.control(map[string]string{"checkbox": "casilla", "radio": "opción sí/no"}[kind])
	css.set("width", px(n.Box.Width))
	css.set("height", px(n.Box.Height))
	css.setDefault("position", "relative")
	w.opacity(n, css)
	tag := "label"
	if w.inLabel {
		tag = "span" // ya va adentro del <label> de su opción: dos labels anidados no son HTML válido
	}
	attrs := ` type="` + kind + `"`
	if name != "" {
		attrs += ` name="` + html.EscapeString(name) + `"`
	}
	if checked {
		attrs += " checked"
	}
	src := func(id string) string {
		w.report.Drawings = append(w.report.Drawings, id)
		if w.assets.SVG == nil {
			return ""
		}
		return w.assets.SVG(id)
	}
	fmt.Fprintf(w.out, `<%s class="fg-check" data-figma="%s" style="%s"><input%s>`, tag, html.EscapeString(n.ID), css, attrs)
	mine := src(n.ID)
	other := w.controls.other(n)
	if other == "" {
		// Sin el dibujo de la otra variante la casilla se marca igual, pero se ve siempre como está.
		w.report.miss("casilla sin la otra variante en el archivo (se marca, pero no cambia de dibujo)")
		fmt.Fprintf(w.out, `<img alt="" src="%s">`, html.EscapeString(mine))
	} else {
		on, off := mine, src(other)
		if !checked {
			on, off = off, mine
		}
		fmt.Fprintf(w.out, `<img class="fg-on" alt="" src="%s"><img class="fg-off" alt="" src="%s">`, html.EscapeString(on), html.EscapeString(off))
	}
	fmt.Fprintf(w.out, "</%s>", tag)
}

// input escribe el texto de un campo como un <input>: la misma fuente, en el mismo lugar. El texto de
// Figma es el placeholder si es claro (el gris de «todavía nada»); si es oscuro, ya es un valor escrito.
func (w *writer) input(n Node, parent *Node, css *style) {
	w.report.Texts++
	w.report.control("campo")
	st := n.Style
	if st == nil {
		st = &TextStyle{}
	}
	w.font(*st, n.Fills, css)
	shown := firstSolid(n.Fills)
	f := w.controls.fields[n.ID]
	typed := f.color
	isValue := luminance(n.Fills) < 0.35
	if typed == "" || isValue {
		typed = shown
	}
	if shown != "" {
		css.set("--fg-placeholder", shown)
	}
	if typed != "" {
		css.set("color", typed)
	}
	// El campo ocupa lo que le queda a lo ancho: un texto HUG mide su texto, y un input de ese ancho
	// cortaba lo que se escribe a los pocos caracteres.
	if parent.LayoutMode == "HORIZONTAL" {
		css.set("flex", "1 1 0")
		css.set("min-width", "0")
	} else {
		css.set("align-self", "stretch")
	}
	if st.LineHeightPx != 0 {
		css.setDefault("height", px(st.LineHeightPx))
	}
	w.opacity(n, css)
	attrs := ` type="text"`
	if digitsOnly(n.Characters) {
		attrs += ` inputmode="numeric"`
	}
	if isValue {
		attrs += ` value="` + html.EscapeString(n.Characters) + `"`
	} else {
		attrs += ` placeholder="` + html.EscapeString(n.Characters) + `"`
	}
	if f.label != "" {
		attrs += ` aria-label="` + html.EscapeString(f.label) + `"`
	}
	fmt.Fprintf(w.out, `<input class="fg-input" data-figma="%s"%s style="%s">`, html.EscapeString(n.ID), attrs, css)
}

// luminance es la luminancia relativa del primer relleno sólido (0 negro, 1 blanco); 1 si no hay.
func luminance(ps []Paint) float64 {
	for _, p := range ps {
		if visible(p.Visible) && p.Type == "SOLID" && p.Color != nil {
			lin := func(c float64) float64 {
				if c <= 0.03928 {
					return c / 12.92
				}
				return math.Pow((c+0.055)/1.055, 2.4)
			}
			return 0.2126*lin(p.Color.R) + 0.7152*lin(p.Color.G) + 0.0722*lin(p.Color.B)
		}
	}
	return 1
}

func digitsOnly(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && r != ' ' && r != '-' && r != '.' {
			return false
		}
	}
	return true
}

func (r *Report) control(kind string) {
	if r.Controls == nil {
		r.Controls = map[string]int{}
	}
	r.Controls[kind]++
}

// controlCSS son las reglas que los controles necesitan y un `style` no puede decir: el placeholder,
// el estado marcado y el reinicio de lo que el navegador les pone por defecto. Van en el <head>.
const controlCSS = `.fg-input{all:unset;box-sizing:border-box;display:block;min-width:0;cursor:text}
.fg-input::placeholder{color:var(--fg-placeholder);opacity:1}
.fg-button{all:unset;box-sizing:border-box;display:block;cursor:pointer}
.fg-button:focus-visible,.fg-check:focus-within{outline:2px solid Highlight;outline-offset:2px}
.fg-option{cursor:pointer}
.fg-check{display:block;cursor:pointer}
.fg-check>input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.fg-check>img{display:block;width:100%;height:100%;pointer-events:none}
.fg-check>input:checked~.fg-off,.fg-check>input:not(:checked)~.fg-on{display:none}
`

// CheckboxVariants anota, de una pantalla, una instancia que dibuja cada variante de la casilla. El
// server lo junta de todas las pantallas del archivo que ya leyó y lo pasa en Assets.Variants.
func CheckboxVariants(n Node, into map[string]string) {
	if isCheckbox(n) {
		if v, _ := checkboxState(n); v != "" {
			if _, ok := into[v]; !ok {
				into[v] = n.ID
			}
		}
	}
	for _, ch := range n.Children {
		CheckboxVariants(ch, into)
	}
}
