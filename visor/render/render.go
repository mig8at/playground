// Package render traduce una pantalla de Figma a HTML y CSS. No es una captura: los textos son texto,
// las cajas son cajas y el auto-layout de Figma es flexbox, así que la pantalla se puede leer, copiar
// y comparar contra el front real.
//
// La regla que ordena todo: se traduce lo que tiene un equivalente EXACTO en CSS y lo demás se dice.
//
//   - auto-layout (`layoutMode`) → flexbox, con `FIXED`/`HUG`/`FILL` como ancho fijo, `auto` o `flex: 1`;
//   - un marco SIN auto-layout → sus hijos en posición absoluta, con las coordenadas de Figma;
//   - un dibujo (vectores, operaciones booleanas, un ícono entero) → el SVG que exporta Figma, porque
//     reconstruir un trazo en CSS sería inventarlo;
//   - lo que no tiene equivalente (máscaras, rotaciones, modos de mezcla, degradados que no son
//     lineales) queda en el Report, con su conteo, en vez de salir parecido y callado.
//
// Medido en `flujo-ecommerce` el 2026-09-24: 762 marcos con auto-layout, pero la raíz de la pantalla lo
// tiene sólo en 11 de 52 — los bloques grandes están puestos a mano, así que las dos formas conviven en
// la misma pantalla.
package render

import (
	"encoding/json"
	"fmt"
	"html"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Node es lo que se lee de un nodo de Figma para dibujarlo. Los nombres son los de la API.
type Node struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Visible *bool  `json:"visible"`
	Box     *Rect  `json:"absoluteBoundingBox"`
	// RenderBox es lo que se VE: el trazo que sobresale, o un arco que no llena su elipse. El SVG que
	// exporta Figma mide esto, no la caja.
	RenderBox *Rect  `json:"absoluteRenderBounds"`
	Children  []Node `json:"children"`

	LayoutMode         string                   `json:"layoutMode"`
	PrimaryAlign       string                   `json:"primaryAxisAlignItems"`
	CounterAlign       string                   `json:"counterAxisAlignItems"`
	ItemSpacing        float64                  `json:"itemSpacing"`
	CounterSpacing     *float64                 `json:"counterAxisSpacing"`
	LayoutWrap         string                   `json:"layoutWrap"`
	PaddingLeft        float64                  `json:"paddingLeft"`
	PaddingRight       float64                  `json:"paddingRight"`
	PaddingTop         float64                  `json:"paddingTop"`
	PaddingBottom      float64                  `json:"paddingBottom"`
	SizingH            string                   `json:"layoutSizingHorizontal"`
	SizingV            string                   `json:"layoutSizingVertical"`
	LayoutAlign        string                   `json:"layoutAlign"`
	LayoutGrow         float64                  `json:"layoutGrow"`
	LayoutPositioning  string                   `json:"layoutPositioning"`
	ClipsContent       bool                     `json:"clipsContent"`
	Fills              []Paint                  `json:"fills"`
	Strokes            []Paint                  `json:"strokes"`
	StrokeWeight       float64                  `json:"strokeWeight"`
	StrokeAlign        string                   `json:"strokeAlign"`
	IndividualStrokes  *Sides                   `json:"individualStrokeWeights"`
	CornerRadius       float64                  `json:"cornerRadius"`
	CornerRadii        []float64                `json:"rectangleCornerRadii"`
	Effects            []Effect                 `json:"effects"`
	Opacity            *float64                 `json:"opacity"`
	BlendMode          string                   `json:"blendMode"`
	IsMask             bool                     `json:"isMask"`
	Rotation           float64                  `json:"rotation"`
	Arc                *ArcData                 `json:"arcData"`
	ComponentProps     map[string]ComponentProp `json:"componentProperties"`
	Characters         string                   `json:"characters"`
	Style              *TextStyle               `json:"style"`
	CharacterOverrides []int                    `json:"characterStyleOverrides"`
	OverrideTable      map[string]TextStyle     `json:"styleOverrideTable"`
}

type Rect struct{ X, Y, Width, Height float64 }

// ArcData es la parte de una elipse que se dibuja: el barrido en radianes y el hueco del medio (0 a 1).
type ArcData struct {
	StartingAngle float64 `json:"startingAngle"`
	EndingAngle   float64 `json:"endingAngle"`
	InnerRadius   float64 `json:"innerRadius"`
}
type Sides struct{ Top, Right, Bottom, Left float64 }
type Color struct{ R, G, B, A float64 }

type Paint struct {
	Type      string   `json:"type"`
	Visible   *bool    `json:"visible"`
	Opacity   *float64 `json:"opacity"`
	Color     *Color   `json:"color"`
	ScaleMode string   `json:"scaleMode"`
	// ImageTransform es el recorte de una imagen en modo STRETCH (el «Crop» de Figma): qué parte de la
	// imagen, en coordenadas normalizadas, se ve en la caja.
	ImageTransform [][]float64 `json:"imageTransform"`
	ImageRef       string      `json:"imageRef"`
	GradientStops  []struct {
		Position float64 `json:"position"`
		Color    Color   `json:"color"`
	} `json:"gradientStops"`
	GradientHandles []struct{ X, Y float64 } `json:"gradientHandlePositions"`
}

type Effect struct {
	Type    string                  `json:"type"`
	Visible *bool                   `json:"visible"`
	Radius  float64                 `json:"radius"`
	Spread  float64                 `json:"spread"`
	Color   *Color                  `json:"color"`
	Offset  *struct{ X, Y float64 } `json:"offset"`
}

type TextStyle struct {
	FontFamily     string  `json:"fontFamily"`
	FontWeight     float64 `json:"fontWeight"`
	FontSize       float64 `json:"fontSize"`
	Italic         bool    `json:"italic"`
	LineHeightPx   float64 `json:"lineHeightPx"`
	LineHeightUnit string  `json:"lineHeightUnit"`
	LetterSpacing  float64 `json:"letterSpacing"`
	AlignH         string  `json:"textAlignHorizontal"`
	AlignV         string  `json:"textAlignVertical"`
	TextCase       string  `json:"textCase"`
	Decoration     string  `json:"textDecoration"`
	AutoResize     string  `json:"textAutoResize"`
	Fills          []Paint `json:"fills"`
}

// Assets dice cómo se llega a lo que no es CSS: un dibujo exportado como SVG y una imagen de relleno.
// El que llama decide las URLs (el server del visor las sirve desde su caché).
type Assets struct {
	SVG   func(nodeID string) string
	Image func(imageRef string) string
	// Variants es, para la casilla, una instancia que dibuja cada variante en TODO el archivo: la otra
	// variante de una casilla puede no estar en su pantalla. Opcional.
	Variants map[string]string
}

// Report cuenta qué se tradujo y qué no. Lo que no tiene equivalente se nombra: una pantalla que sale
// parecida sin decir qué le falta se lee como fiel.
type Report struct {
	Elements int            `json:"elements"` // cajas y textos en HTML
	Texts    int            `json:"texts"`
	Flex     int            `json:"flex"`     // marcos con auto-layout → flexbox
	Absolute int            `json:"absolute"` // hijos en posición absoluta
	Drawings []string       `json:"drawings"` // nodos exportados como SVG
	Images   []string       `json:"images"`   // referencias de imágenes de relleno
	Fonts    []string       `json:"fonts"`    // familia · peso
	Controls map[string]int `json:"controls"` // campos, casillas y botones que responden
	Missing  map[string]int `json:"missing"`  // lo que no se tradujo, por qué
}

func (r *Report) miss(why string) {
	if r.Missing == nil {
		r.Missing = map[string]int{}
	}
	r.Missing[why]++
}

// Parse lee el documento crudo de un nodo (lo que devuelve `NodeJSON`).
func Parse(raw []byte) (Node, error) {
	var n Node
	if err := json.Unmarshal(raw, &n); err != nil {
		return Node{}, fmt.Errorf("el nodo de Figma no es el JSON esperado: %v", err)
	}
	if n.Box == nil {
		return Node{}, fmt.Errorf("el nodo %s no tiene caja: no es una pantalla", n.ID)
	}
	return n, nil
}

// HTML traduce una pantalla a un documento HTML completo, con su tamaño de Figma.
func HTML(screen Node, assets Assets) (string, Report) {
	r := &Report{}
	fonts := map[string]bool{}
	var body strings.Builder
	w := &writer{assets: assets, report: r, fonts: fonts, out: &body, controls: indexControls(screen, assets.Variants)}
	w.node(screen, nil, true)
	for f := range fonts {
		r.Fonts = append(r.Fonts, f)
	}
	sort.Strings(r.Fonts)
	var doc strings.Builder
	doc.WriteString("<!doctype html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n")
	doc.WriteString(fmt.Sprintf("<meta name=\"viewport\" content=\"width=%d\">\n", int(math.Round(screen.Box.Width))))
	doc.WriteString("<title>" + html.EscapeString(screen.Name) + "</title>\n")
	doc.WriteString(fontLinks(r.Fonts))
	doc.WriteString("<style>\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n")
	doc.WriteString("html,body{background:transparent}\nbody{overflow:hidden;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}\n")
	doc.WriteString("img{display:block}\n")
	doc.WriteString(controlCSS)
	doc.WriteString("</style>\n</head>\n<body>\n")
	doc.WriteString(body.String())
	doc.WriteString("\n</body>\n</html>\n")
	return doc.String(), *r
}

type writer struct {
	assets   Assets
	report   *Report
	fonts    map[string]bool
	out      *strings.Builder
	controls *controlIndex
	inLabel  bool // adentro del <label> de una opción: la casilla no abre otro
}

func visible(v *bool) bool { return v == nil || *v }

// node escribe un nodo. `parent` es su padre ya escrito (nil para la raíz): de él depende si el hijo va
// como elemento flex o en posición absoluta.
func (w *writer) node(n Node, parent *Node, root bool) {
	if !visible(n.Visible) || n.Box == nil {
		return
	}
	if n.IsMask {
		// Una máscara recorta a sus hermanos de arriba; CSS no tiene eso sin clip-path con la forma
		// exacta. Se omite la máscara y los hermanos se dibujan enteros.
		w.report.miss("máscara (se dibuja sin recortar)")
		return
	}
	// Un dibujo trae su rotación adentro del SVG que exporta Figma; una caja no la tiene.
	if n.Rotation != 0 && math.Abs(n.Rotation) > 0.001 && !drawing(n) {
		w.report.miss("rotación (se dibuja derecho)")
	}
	switch n.BlendMode {
	case "", "PASS_THROUGH", "NORMAL":
	default:
		w.report.miss("modo de mezcla " + strings.ToLower(n.BlendMode))
	}

	css := &style{}
	w.place(n, parent, root, css)
	if isCheckbox(n) && !root {
		w.checkbox(n, css)
		return
	}
	if drawing(n) && !root {
		w.report.Drawings = append(w.report.Drawings, n.ID)
		src := ""
		if w.assets.SVG != nil {
			src = w.assets.SVG(n.ID)
		}
		css.set("width", px(n.Box.Width))
		css.set("height", px(n.Box.Height))
		w.opacity(n, css)
		// El SVG de un ARCO sale recortado a lo que se ve, no a la caja de su elipse: en el progreso de
		// Credifamilia la caja mide 46×46 y el SVG 35×36. La caja se queda con su lugar en el diseño y el
		// dibujo va adentro, en su posición real; estirarlo a la caja lo deformaba.
		// ⚠ Sólo para arcos. `absoluteRenderBounds` descuenta también el recorte del marco padre, y el SVG
		// no: el velo de «Pago mínimo» sobresale 1 px, su SVG mide 430×933 y lo visible 932. Ubicarlo por
		// lo visible lo achicaba (99,7 % → 99,5 %).
		if rb := n.RenderBox; rb != nil && arc(n) && !sameRect(*rb, *n.Box) {
			css.setDefault("position", "relative")
			fmt.Fprintf(w.out, `<div data-figma="%s" style="%s"><img alt="" src="%s" style="position:absolute;left:%s;top:%s;width:%s;height:%s;max-width:none"></div>`,
				html.EscapeString(n.ID), css, html.EscapeString(src), px(rb.X-n.Box.X), px(rb.Y-n.Box.Y), px(rb.Width), px(rb.Height))
			return
		}
		fmt.Fprintf(w.out, `<img data-figma="%s" alt="" src="%s" style="%s">`, html.EscapeString(n.ID), html.EscapeString(src), css)
		return
	}
	w.report.Elements++
	if n.Type == "TEXT" {
		if isInputText(n, parent) {
			w.input(n, parent, css)
			return
		}
		w.text(n, parent, css)
		return
	}
	w.box(n, css)
	if n.LayoutMode == "HORIZONTAL" || n.LayoutMode == "VERTICAL" {
		w.report.Flex++
		w.flex(n, css)
	}
	// Los hijos absolutos se ubican contra este marco. ⚠ Sin pisar la posición del propio marco: uno
	// que ya va en absoluta contra SU padre también sirve de referencia a sus hijos.
	if len(n.Children) > 0 {
		css.setDefault("position", "relative")
	}
	if n.ClipsContent || root {
		css.set("overflow", "hidden")
	}
	tag, attrs := "div", ""
	label := false
	switch {
	case root:
	case isButton(n):
		tag, attrs = "button", ` type="button" class="fg-button"`
		w.report.control("botón")
	case optionOf(n) && !w.inLabel:
		tag, attrs, label = "label", ` class="fg-option"`, true
	}
	fmt.Fprintf(w.out, `<%s data-figma="%s" title="%s"%s style="%s">`, tag, html.EscapeString(n.ID), html.EscapeString(n.Name), attrs, css)
	if label {
		w.inLabel = true
	}
	for i := range n.Children {
		w.node(n.Children[i], &n, false)
	}
	if label {
		w.inLabel = false
	}
	fmt.Fprintf(w.out, "</%s>", tag)
}

// place decide DÓNDE va el nodo: dentro de un flex (con su tamaño según FIXED/HUG/FILL) o en posición
// absoluta contra su padre.
func (w *writer) place(n Node, parent *Node, root bool, css *style) {
	if root {
		css.set("position", "relative")
		css.set("width", px(n.Box.Width))
		css.set("height", px(n.Box.Height))
		return
	}
	inFlex := parent != nil && (parent.LayoutMode == "HORIZONTAL" || parent.LayoutMode == "VERTICAL") && n.LayoutPositioning != "ABSOLUTE"
	if !inFlex {
		w.report.Absolute++
		css.set("position", "absolute")
		css.set("left", px(n.Box.X-parent.Box.X))
		css.set("top", px(n.Box.Y-parent.Box.Y))
		css.set("width", px(n.Box.Width))
		css.set("height", px(n.Box.Height))
		return
	}
	row := parent.LayoutMode == "HORIZONTAL"
	primary, counter := n.SizingH, n.SizingV
	primaryProp, counterProp := "width", "height"
	primarySize, counterSize := n.Box.Width, n.Box.Height
	if !row {
		primary, counter = n.SizingV, n.SizingH
		primaryProp, counterProp = "height", "width"
		primarySize, counterSize = n.Box.Height, n.Box.Width
	}
	// Los nodos viejos no traen `layoutSizing*`: se deduce de layoutGrow y layoutAlign.
	if primary == "" {
		primary = "FIXED"
		if n.LayoutGrow == 1 {
			primary = "FILL"
		}
	}
	if counter == "" {
		counter = "FIXED"
		if n.LayoutAlign == "STRETCH" {
			counter = "FILL"
		}
	}
	// «Ajustarse al contenido» sólo funciona en CSS si hay contenido EN EL FLUJO que lo sostenga. Un
	// marco vacío, o uno sin auto-layout (sus hijos van en absoluta), mide 0 y arrastra lo de abajo:
	// medido en «Número de celular», el logo —una instancia vacía con la imagen de fondo— quedaba en
	// 16×16 y la pantalla entera subía 92 px. Ahí va la medida de Figma.
	if !holdsContent(n) {
		if primary == "HUG" {
			primary = "FIXED"
		}
		if counter == "HUG" {
			counter = "FIXED"
		}
	}
	switch primary {
	case "FILL":
		css.set("flex", "1 1 0")
		css.set("min-"+primaryProp, "0")
	case "HUG":
		css.set("flex", "none")
	default:
		css.set("flex", "none")
		css.set(primaryProp, px(primarySize))
	}
	switch counter {
	case "FILL":
		css.set("align-self", "stretch")
	case "HUG":
	default:
		css.set(counterProp, px(counterSize))
	}
	// Un texto que se ajusta sólo en alto tiene el ancho fijo de Figma aunque sea HUG en el eje.
	if n.Type == "TEXT" && n.Style != nil && n.Style.AutoResize == "HEIGHT" && primary == "HUG" && row {
		css.set("width", px(n.Box.Width))
	}
}

func (w *writer) flex(n Node, css *style) {
	css.set("display", "flex")
	if n.LayoutMode == "HORIZONTAL" {
		css.set("flex-direction", "row")
	} else {
		css.set("flex-direction", "column")
	}
	if n.LayoutWrap == "WRAP" {
		css.set("flex-wrap", "wrap")
		if n.CounterSpacing != nil {
			css.set("row-gap", px(*n.CounterSpacing))
		}
	}
	switch n.PrimaryAlign {
	case "CENTER":
		css.set("justify-content", "center")
	case "MAX":
		css.set("justify-content", "flex-end")
	case "SPACE_BETWEEN":
		css.set("justify-content", "space-between")
	default:
		css.set("justify-content", "flex-start")
	}
	switch n.CounterAlign {
	case "CENTER":
		css.set("align-items", "center")
	case "MAX":
		css.set("align-items", "flex-end")
	case "BASELINE":
		css.set("align-items", "baseline")
	default:
		css.set("align-items", "flex-start")
	}
	if n.ItemSpacing != 0 && n.PrimaryAlign != "SPACE_BETWEEN" {
		gap := "gap"
		if n.LayoutWrap == "WRAP" {
			gap = "column-gap"
			if n.LayoutMode == "VERTICAL" {
				gap = "row-gap"
			}
		}
		css.set(gap, px(n.ItemSpacing))
	}
	if n.PaddingTop != 0 || n.PaddingRight != 0 || n.PaddingBottom != 0 || n.PaddingLeft != 0 {
		css.set("padding", px(n.PaddingTop)+" "+px(n.PaddingRight)+" "+px(n.PaddingBottom)+" "+px(n.PaddingLeft))
	}
}

// box pinta la caja: relleno, borde, esquinas, sombras y opacidad.
func (w *writer) box(n Node, css *style) {
	var layers []string
	// Figma apila los rellenos de abajo hacia arriba; CSS los lista de arriba hacia abajo.
	for i := len(n.Fills) - 1; i >= 0; i-- {
		if l := w.paint(n.Fills[i], *n.Box); l != "" {
			layers = append(layers, l)
		}
	}
	if len(layers) > 0 {
		css.set("background", strings.Join(layers, ", "))
	}
	if n.Type == "ELLIPSE" {
		css.set("border-radius", "50%")
	} else if len(n.CornerRadii) == 4 {
		css.set("border-radius", px(n.CornerRadii[0])+" "+px(n.CornerRadii[1])+" "+px(n.CornerRadii[2])+" "+px(n.CornerRadii[3]))
	} else if n.CornerRadius != 0 {
		css.set("border-radius", px(n.CornerRadius))
	}
	var shadows []string
	if stroke := firstSolid(n.Strokes); stroke != "" && (n.StrokeWeight > 0 || n.IndividualStrokes != nil) {
		if s := n.IndividualStrokes; s != nil {
			// Bordes por lado: CSS los dibuja por dentro con border-box, que es lo que hace Figma.
			css.set("border-style", "solid")
			css.set("border-color", stroke)
			css.set("border-width", px(s.Top)+" "+px(s.Right)+" "+px(s.Bottom)+" "+px(s.Left))
		} else {
			// Un borde de Figma no ocupa lugar en el layout: es una sombra dura, adentro o afuera.
			switch n.StrokeAlign {
			case "OUTSIDE":
				shadows = append(shadows, "0 0 0 "+px(n.StrokeWeight)+" "+stroke)
			case "CENTER":
				shadows = append(shadows, "inset 0 0 0 "+px(n.StrokeWeight/2)+" "+stroke, "0 0 0 "+px(n.StrokeWeight/2)+" "+stroke)
			default:
				shadows = append(shadows, "inset 0 0 0 "+px(n.StrokeWeight)+" "+stroke)
			}
		}
	}
	for _, e := range n.Effects {
		if !visible(e.Visible) {
			continue
		}
		switch e.Type {
		case "DROP_SHADOW", "INNER_SHADOW":
			c := "rgba(0,0,0,.25)"
			if e.Color != nil {
				c = rgba(*e.Color, 1)
			}
			ox, oy := 0.0, 0.0
			if e.Offset != nil {
				ox, oy = e.Offset.X, e.Offset.Y
			}
			s := px(ox) + " " + px(oy) + " " + px(e.Radius) + " " + px(e.Spread) + " " + c
			if e.Type == "INNER_SHADOW" {
				s = "inset " + s
			}
			shadows = append(shadows, s)
		case "LAYER_BLUR":
			css.set("filter", "blur("+px(e.Radius/2)+")")
		case "BACKGROUND_BLUR":
			css.set("backdrop-filter", "blur("+px(e.Radius/2)+")")
		}
	}
	if len(shadows) > 0 {
		css.set("box-shadow", strings.Join(shadows, ", "))
	}
	w.opacity(n, css)
}

func (w *writer) opacity(n Node, css *style) {
	if n.Opacity != nil && *n.Opacity < 1 {
		css.set("opacity", num(*n.Opacity))
	}
}

func (w *writer) paint(p Paint, b Rect) string {
	if !visible(p.Visible) {
		return ""
	}
	op := 1.0
	if p.Opacity != nil {
		op = *p.Opacity
	}
	switch p.Type {
	case "SOLID":
		if p.Color == nil {
			return ""
		}
		c := rgba(*p.Color, op)
		return "linear-gradient(" + c + "," + c + ")"
	case "GRADIENT_LINEAR":
		if len(p.GradientStops) == 0 {
			return ""
		}
		angle := 180.0
		if len(p.GradientHandles) >= 2 {
			a, b := p.GradientHandles[0], p.GradientHandles[1]
			// En CSS 0deg apunta hacia arriba y crece en sentido horario.
			angle = math.Atan2(b.X-a.X, -(b.Y-a.Y)) * 180 / math.Pi
		}
		var stops []string
		for _, s := range p.GradientStops {
			stops = append(stops, rgba(s.Color, op)+" "+num(s.Position*100)+"%")
		}
		return "linear-gradient(" + num(angle) + "deg, " + strings.Join(stops, ", ") + ")"
	case "IMAGE":
		w.report.Images = append(w.report.Images, p.ImageRef)
		src := ""
		if w.assets.Image != nil {
			src = w.assets.Image(p.ImageRef)
		}
		pos, size := "center", "cover"
		switch p.ScaleMode {
		case "FIT":
			size = "contain"
		case "TILE":
			w.report.miss("imagen en mosaico (se estira)")
		case "STRETCH":
			// El recorte: la parte visible de la imagen va de tx a tx+a (y de ty a ty+d), así que la
			// imagen entera mide W/a × H/d y arranca corrida -tx/a·W. Medido en `flujo-ecommerce`: 18 de
			// sus 43 imágenes van recortadas, y como `cover` la foto del documento salía entera y chica.
			size = "100% 100%"
			if t := p.ImageTransform; len(t) == 2 && len(t[0]) == 3 && len(t[1]) == 3 && t[0][0] > 0 && t[1][1] > 0 {
				a, tx, d, ty := t[0][0], t[0][2], t[1][1], t[1][2]
				if math.Abs(t[0][1]) > 1e-6 || math.Abs(t[1][0]) > 1e-6 {
					w.report.miss("imagen recortada con giro (se recorta derecha)")
				}
				size = px(b.Width/a) + " " + px(b.Height/d)
				pos = px(-tx/a*b.Width) + " " + px(-ty/d*b.Height)
			}
		}
		return `url("` + src + `") ` + pos + ` / ` + size + " no-repeat"
	default:
		w.report.miss("relleno " + strings.ToLower(strings.ReplaceAll(p.Type, "_", " ")))
		return ""
	}
}

func firstSolid(ps []Paint) string {
	for _, p := range ps {
		if visible(p.Visible) && p.Type == "SOLID" && p.Color != nil {
			op := 1.0
			if p.Opacity != nil {
				op = *p.Opacity
			}
			return rgba(*p.Color, op)
		}
	}
	return ""
}

// text escribe un texto con su estilo, y los tramos con otro estilo (una palabra en negrita, un monto
// de otro color) como <span>.
func (w *writer) text(n Node, parent *Node, css *style) {
	w.report.Texts++
	st := n.Style
	if st == nil {
		st = &TextStyle{}
	}
	w.font(*st, n.Fills, css)
	css.set("white-space", "pre-wrap")
	css.set("overflow-wrap", "break-word")
	if st.AutoResize == "WIDTH_AND_HEIGHT" {
		css.set("white-space", "pre")
	}
	switch st.AlignV {
	case "CENTER", "BOTTOM":
		css.set("display", "flex")
		css.set("flex-direction", "column")
		if st.AlignV == "CENTER" {
			css.set("justify-content", "center")
		} else {
			css.set("justify-content", "flex-end")
		}
	}
	w.opacity(n, css)
	fmt.Fprintf(w.out, `<div data-figma="%s" style="%s">`, html.EscapeString(n.ID), css)
	if st.AlignV == "CENTER" || st.AlignV == "BOTTOM" {
		w.out.WriteString("<span>")
	}
	runes := []rune(n.Characters)
	if len(n.CharacterOverrides) == 0 || len(n.OverrideTable) == 0 {
		w.out.WriteString(html.EscapeString(n.Characters))
	} else {
		// Los tramos: `characterStyleOverrides` da un id de estilo por carácter (0 = el del texto) y
		// puede ser más corto que el texto; lo que falta usa el estilo base.
		start := 0
		idAt := func(i int) int {
			if i < len(n.CharacterOverrides) {
				return n.CharacterOverrides[i]
			}
			return 0
		}
		for i := 1; i <= len(runes); i++ {
			if i < len(runes) && idAt(i) == idAt(start) {
				continue
			}
			chunk := html.EscapeString(string(runes[start:i]))
			if id := idAt(start); id != 0 {
				if ov, ok := n.OverrideTable[strconv.Itoa(id)]; ok {
					span := &style{}
					w.overrideFont(ov, span)
					fmt.Fprintf(w.out, `<span style="%s">%s</span>`, span, chunk)
				} else {
					w.out.WriteString(chunk)
				}
			} else {
				w.out.WriteString(chunk)
			}
			start = i
		}
	}
	if st.AlignV == "CENTER" || st.AlignV == "BOTTOM" {
		w.out.WriteString("</span>")
	}
	w.out.WriteString("</div>")
}

func (w *writer) font(st TextStyle, fills []Paint, css *style) {
	if st.FontFamily != "" {
		css.set("font-family", family(st.FontFamily))
		w.fonts[st.FontFamily+" · "+num(st.FontWeight)] = true
	}
	if st.FontWeight != 0 {
		css.set("font-weight", num(st.FontWeight))
	}
	if st.FontSize != 0 {
		css.set("font-size", px(st.FontSize))
	}
	if st.Italic {
		css.set("font-style", "italic")
	}
	if st.LineHeightPx != 0 {
		css.set("line-height", px(st.LineHeightPx))
	}
	if st.LetterSpacing != 0 {
		css.set("letter-spacing", px(st.LetterSpacing))
	}
	switch st.AlignH {
	case "CENTER":
		css.set("text-align", "center")
	case "RIGHT":
		css.set("text-align", "right")
	case "JUSTIFIED":
		css.set("text-align", "justify")
	}
	switch st.TextCase {
	case "UPPER":
		css.set("text-transform", "uppercase")
	case "LOWER":
		css.set("text-transform", "lowercase")
	case "TITLE":
		css.set("text-transform", "capitalize")
	}
	switch st.Decoration {
	case "UNDERLINE":
		css.set("text-decoration", "underline")
	case "STRIKETHROUGH":
		css.set("text-decoration", "line-through")
	}
	if c := firstSolid(fills); c != "" {
		css.set("color", c)
	}
}

// overrideFont escribe sólo lo que el tramo cambia respecto del texto.
func (w *writer) overrideFont(st TextStyle, css *style) {
	if st.FontFamily != "" {
		css.set("font-family", family(st.FontFamily))
		w.fonts[st.FontFamily+" · "+num(st.FontWeight)] = true
	}
	if st.FontWeight != 0 {
		css.set("font-weight", num(st.FontWeight))
	}
	if st.FontSize != 0 {
		css.set("font-size", px(st.FontSize))
	}
	if st.Italic {
		css.set("font-style", "italic")
	}
	if st.Decoration == "UNDERLINE" {
		css.set("text-decoration", "underline")
	}
	if c := firstSolid(st.Fills); c != "" {
		css.set("color", c)
	}
}

// holdsContent: si el nodo tiene algo en el flujo que le dé tamaño a un `auto` de CSS — texto, o hijos
// visibles que no vayan en posición absoluta dentro de un auto-layout.
func holdsContent(n Node) bool {
	if n.Type == "TEXT" {
		return true
	}
	if n.LayoutMode != "HORIZONTAL" && n.LayoutMode != "VERTICAL" {
		return false
	}
	for _, ch := range n.Children {
		if visible(ch.Visible) && ch.LayoutPositioning != "ABSOLUTE" && !ch.IsMask {
			return true
		}
	}
	return false
}

// drawing: lo que se exporta como SVG. Un vector o una operación booleana siempre; un marco o grupo
// cuando todo lo que tiene adentro es dibujo (un ícono entero es un SVG, no veinte). Un rectángulo o una
// elipse sueltos NO: son una caja con fondo, y como caja se escriben — salvo la elipse que es un ARCO.
func drawing(n Node) bool {
	switch n.Type {
	case "VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "REGULAR_POLYGON":
		return true
	case "ELLIPSE":
		return arc(n)
	case "RECTANGLE", "TEXT":
		return false
	}
	if len(n.Children) == 0 {
		return false
	}
	hasVector := false
	for _, ch := range n.Children {
		if !visible(ch.Visible) {
			continue
		}
		switch ch.Type {
		case "TEXT":
			return false
		case "VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "REGULAR_POLYGON":
			hasVector = true
		case "ELLIPSE":
			hasVector = hasVector || arc(ch)
		case "RECTANGLE":
		default:
			if !drawing(ch) {
				return false
			}
			hasVector = true
		}
	}
	return hasVector
}

// arc: una elipse con hueco (un anillo) o con un barrido que no da la vuelta entera (un progreso). En
// CSS una elipse es una caja con `border-radius: 50%`, o sea un disco lleno: el anillo de progreso de
// Credifamilia salía como una bola violeta. Esas van como el SVG de Figma.
func arc(n Node) bool {
	a := n.Arc
	if a == nil {
		return false
	}
	return a.InnerRadius > 0.001 || math.Abs(math.Abs(a.EndingAngle-a.StartingAngle)-2*math.Pi) > 0.001
}

func sameRect(a, b Rect) bool {
	const eps = 0.5
	return math.Abs(a.X-b.X) < eps && math.Abs(a.Y-b.Y) < eps && math.Abs(a.Width-b.Width) < eps && math.Abs(a.Height-b.Height) < eps
}

// family nombra la fuente con un respaldo del sistema. «Satoshi Variable» es el nombre con que Figma
// guarda la variable; la web la publica como «Satoshi».
func family(f string) string {
	base := strings.TrimSuffix(f, " Variable")
	out := "'" + strings.ReplaceAll(base, "'", "") + "'"
	if base != f {
		out = "'" + strings.ReplaceAll(f, "'", "") + "', " + out
	}
	return out + ", system-ui, sans-serif"
}

// fontLinks carga las fuentes que se sepa de dónde sacar: Satoshi de Fontshare, el resto de Google
// Fonts. Una familia que no esté en ninguno cae al respaldo del sistema, y el Report ya la nombra.
func fontLinks(fonts []string) string {
	weights := map[string]map[string]bool{}
	for _, f := range fonts {
		parts := strings.SplitN(f, " · ", 2)
		name := strings.TrimSuffix(parts[0], " Variable")
		if weights[name] == nil {
			weights[name] = map[string]bool{}
		}
		if len(parts) == 2 && parts[1] != "0" {
			weights[name][parts[1]] = true
		}
	}
	var google []string
	var out strings.Builder
	names := make([]string, 0, len(weights))
	for n := range weights {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		ws := make([]string, 0, len(weights[name]))
		for wt := range weights[name] {
			ws = append(ws, wt)
		}
		sort.Strings(ws)
		if len(ws) == 0 {
			ws = []string{"400"}
		}
		if strings.EqualFold(name, "Satoshi") {
			out.WriteString(`<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@` + strings.Join(ws, ",") + `&display=swap">` + "\n")
			continue
		}
		google = append(google, "family="+strings.ReplaceAll(name, " ", "+")+":wght@"+strings.Join(ws, ";"))
	}
	if len(google) > 0 {
		out.WriteString(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?` + strings.Join(google, "&") + `&display=swap">` + "\n")
	}
	return out.String()
}

// style junta declaraciones en orden, y una propiedad repetida se pisa en su lugar.
type style struct {
	keys []string
	vals map[string]string
}

func (s *style) set(k, v string) {
	if s.vals == nil {
		s.vals = map[string]string{}
	}
	if _, ok := s.vals[k]; !ok {
		s.keys = append(s.keys, k)
	}
	s.vals[k] = v
}

// setDefault pone la propiedad sólo si nadie la puso antes.
func (s *style) setDefault(k, v string) {
	if _, ok := s.vals[k]; !ok {
		s.set(k, v)
	}
}

func (s *style) String() string {
	var b strings.Builder
	for _, k := range s.keys {
		b.WriteString(k + ":" + s.vals[k] + ";")
	}
	return html.EscapeString(b.String())
}

func px(v float64) string {
	if v == 0 {
		return "0"
	}
	return num(v) + "px"
}

// num escribe un número con dos decimales como mucho y sin ceros de más.
func num(v float64) string {
	s := strconv.FormatFloat(math.Round(v*100)/100, 'f', -1, 64)
	if s == "-0" {
		return "0"
	}
	return s
}

func rgba(c Color, op float64) string {
	a := c.A * op
	return fmt.Sprintf("rgba(%d,%d,%d,%s)", int(math.Round(c.R*255)), int(math.Round(c.G*255)), int(math.Round(c.B*255)), num(a))
}
