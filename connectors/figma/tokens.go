package figma

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

// Los TOKENS de un diseño: los colores y los estilos de texto que usa, con el NOMBRE que tienen en el
// sistema de diseño de Figma, su valor y cuánto se usan. Es lo que necesita un modelo para pasar una
// pantalla a Vue o React sin copiar `rgba(37,34,86,1)` suelto: con esto escribe `var(--morado-900)`.
//
// De dónde sale cada cosa, medido el 2026-09-24:
//   - el NOMBRE de un estilo viene en la misma respuesta del árbol (`/nodes`, mapa `styles`), así que no
//     cuesta un pedido más. En los archivos de producto los estilos son de una biblioteca compartida
//     (`remote`): «Colors/morado/morado-500», «text-small/medium». 13 en una pantalla de Credifamilia;
//   - el VALOR no viene con el nombre: es el que tienen los nodos que usan el estilo (un nodo que cambia el
//     color a mano pierde la referencia al estilo, así que el valor del nodo ES el del estilo);
//   - los radios y espaciados van por VALOR, sin nombre: sus variables sólo se leen con un permiso que el
//     token no tiene (`/variables/local` contesta 403) y que Figma da en planes Enterprise.
//
// Los colores SIN estilo también se cuentan, aparte: son lo que se sale del sistema de diseño, y conviene
// que el modelo los vea como tales en vez de inventarles un nombre.

// Tokens es la hoja de un diseño.
type Tokens struct {
	Colors  []ColorToken `json:"colors"`
	Texts   []TextToken  `json:"texts"`
	Loose   []LooseColor `json:"loose,omitempty"`   // colores sin estilo
	Radii   []Measure    `json:"radii,omitempty"`   // radios de esquina, por valor
	Spacing []Measure    `json:"spacing,omitempty"` // separación entre hijos y rellenos, por valor
}

type ColorToken struct {
	ID      string `json:"id"`   // el id del estilo en Figma
	Name    string `json:"name"` // «Colors/morado/morado-500»
	Var     string `json:"var"`  // «--morado-500»
	Value   string `json:"value"`
	Uses    int    `json:"uses"`
	Screens int    `json:"screens"`
}

type TextToken struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`  // «text-small/medium»
	Class         string  `json:"class"` // «text-small-medium»
	Family        string  `json:"family"`
	Weight        float64 `json:"weight"`
	Size          float64 `json:"size"`
	LineHeight    float64 `json:"line_height,omitempty"`
	LetterSpacing float64 `json:"letter_spacing,omitempty"`
	Uses          int     `json:"uses"`
	Screens       int     `json:"screens"`
}

type LooseColor struct {
	Value   string `json:"value"`
	Uses    int    `json:"uses"`
	Screens int    `json:"screens"`
	// Matches es la variable de un estilo con el MISMO valor: el color se escribió a mano (o se soltó
	// del estilo) pero es del sistema. En Credifamilia, el blanco suelto es `--neutral-0` 92 veces.
	Matches string `json:"matches,omitempty"`
}

type Measure struct {
	Value float64 `json:"value"`
	Uses  int     `json:"uses"`
}

type styleMeta struct {
	Name      string `json:"name"`
	StyleType string `json:"styleType"`
}

type tokenPaint struct {
	Type    string
	Visible *bool
	Opacity *float64
	Color   *struct{ R, G, B, A float64 }
}

type tokenNode struct {
	ID      string
	Name    string
	Type    string
	Visible *bool
	Styles  map[string]string
	Fills   []tokenPaint
	Strokes []tokenPaint
	Style   *struct {
		FontFamily    string
		FontWeight    float64
		FontSize      float64
		LineHeightPx  float64
		LetterSpacing float64
	}
	CornerRadius  float64
	ItemSpacing   float64
	PaddingLeft   float64
	PaddingRight  float64
	PaddingTop    float64
	PaddingBottom float64
	Children      []tokenNode
}

// ComputeTokens lee los tokens de un árbol ya bajado. `styles` es el mapa de estilos de la misma
// respuesta; `screens`, los ids de las pantallas, para contar en cuántas aparece cada uno.
func ComputeTokens(doc json.RawMessage, styles map[string]styleMeta, screens map[string]bool) (Tokens, error) {
	var root tokenNode
	if err := json.Unmarshal(doc, &root); err != nil {
		return Tokens{}, fmt.Errorf("el árbol no es el JSON esperado: %v", err)
	}
	type agg struct {
		values  map[string]int
		uses    int
		screens map[string]bool
	}
	newAgg := func() *agg { return &agg{values: map[string]int{}, screens: map[string]bool{}} }
	colors, texts, loose := map[string]*agg{}, map[string]*agg{}, map[string]*agg{}
	radii, spacing := map[float64]int{}, map[float64]int{}
	count := func(m map[string]*agg, key, value, screen string) {
		a := m[key]
		if a == nil {
			a = newAgg()
			m[key] = a
		}
		a.values[value]++
		a.uses++
		if screen != "" {
			a.screens[screen] = true
		}
	}
	paints := func(n tokenNode, ps []tokenPaint, styleKeys []string, screen string) {
		value := firstSolidHex(ps)
		if value == "" {
			return
		}
		for _, k := range styleKeys {
			if id := n.Styles[k]; id != "" && styles[id].StyleType == "FILL" {
				count(colors, id, value, screen)
				return
			}
		}
		count(loose, value, value, screen)
	}
	var walk func(n tokenNode, screen string)
	walk = func(n tokenNode, screen string) {
		// La barra de estado del teléfono (la hora, la batería) no es del diseño: sus negros y blancos sin
		// estilo eran la mitad de los «colores sueltos» de Credifamilia.
		if n.Visible != nil && !*n.Visible || reStatusBar.MatchString(n.Name) {
			return
		}
		if screens[n.ID] {
			screen = n.ID
		}
		paints(n, n.Fills, []string{"fill", "fills"}, screen)
		paints(n, n.Strokes, []string{"stroke", "strokes"}, screen)
		if n.Type == "TEXT" && n.Style != nil {
			if id := n.Styles["text"]; id != "" && styles[id].StyleType == "TEXT" {
				s := n.Style
				count(texts, id, fmt.Sprintf("%s|%g|%g|%g|%g", s.FontFamily, round2(s.FontWeight), round2(s.FontSize), round2(s.LineHeightPx), round2(s.LetterSpacing)), screen)
			}
		}
		if n.CornerRadius > 0 {
			radii[round2(n.CornerRadius)]++
		}
		for _, v := range []float64{n.ItemSpacing, n.PaddingLeft, n.PaddingRight, n.PaddingTop, n.PaddingBottom} {
			if v > 0 {
				spacing[round2(v)]++
			}
		}
		for _, ch := range n.Children {
			walk(ch, screen)
		}
	}
	walk(root, "")

	var t Tokens
	for id, a := range colors {
		t.Colors = append(t.Colors, ColorToken{ID: id, Name: styles[id].Name, Value: mostCommon(a.values), Uses: a.uses, Screens: len(a.screens)})
	}
	for id, a := range texts {
		parts := strings.Split(mostCommon(a.values), "|")
		num := func(i int) float64 { var f float64; fmt.Sscan(parts[i], &f); return f }
		t.Texts = append(t.Texts, TextToken{ID: id, Name: styles[id].Name, Class: tokenSlug(styles[id].Name), Family: parts[0],
			Weight: num(1), Size: num(2), LineHeight: num(3), LetterSpacing: num(4), Uses: a.uses, Screens: len(a.screens)})
	}
	for v, a := range loose {
		t.Loose = append(t.Loose, LooseColor{Value: v, Uses: a.uses, Screens: len(a.screens)})
	}
	for v, n := range radii {
		t.Radii = append(t.Radii, Measure{Value: v, Uses: n})
	}
	for v, n := range spacing {
		t.Spacing = append(t.Spacing, Measure{Value: v, Uses: n})
	}
	sort.Slice(t.Colors, func(i, j int) bool { return t.Colors[i].Name < t.Colors[j].Name })
	sort.Slice(t.Texts, func(i, j int) bool {
		if t.Texts[i].Size != t.Texts[j].Size {
			return t.Texts[i].Size > t.Texts[j].Size
		}
		return t.Texts[i].Name < t.Texts[j].Name
	})
	sort.Slice(t.Loose, func(i, j int) bool {
		return t.Loose[i].Uses > t.Loose[j].Uses || t.Loose[i].Uses == t.Loose[j].Uses && t.Loose[i].Value < t.Loose[j].Value
	})
	sort.Slice(t.Radii, func(i, j int) bool { return t.Radii[i].Value < t.Radii[j].Value })
	sort.Slice(t.Spacing, func(i, j int) bool { return t.Spacing[i].Value < t.Spacing[j].Value })
	nameColorVars(t.Colors)
	byValue := map[string]string{}
	for _, c := range t.Colors {
		if _, ok := byValue[c.Value]; !ok {
			byValue[c.Value] = c.Var
		}
	}
	for i := range t.Loose {
		t.Loose[i].Matches = byValue[t.Loose[i].Value]
	}
	return t, nil
}

// nameColorVars nombra la variable de cada color desde su nombre de Figma. Las bibliotecas de producto
// usan DOS formas —la vieja «Colors/violet/violet-500» y la nueva «colors/violet/500»— para el mismo
// color, así que la regla las junta: se saca el «colors» de adelante y no se repite la familia, y las dos
// dan `--violet-500`. «colors/neutral/0» da `--neutral-0` (sin la familia era `--0`).
//
// Si dos estilos dan el mismo nombre con el MISMO valor, son el mismo token y comparten la variable. Con
// valores distintos —medido en flujo-ecommerce: dos «Colors/neutral/neutral-50», #fcfcfc y #e6e6e6— el
// más usado se queda con el nombre y el otro lleva su valor pegado (`--neutral-50-e6e6e6`): la hoja no
// esconde que el sistema tiene dos definiciones.
func nameColorVars(cs []ColorToken) {
	base := func(name string) string {
		var segs []string
		for _, p := range strings.Split(name, "/") {
			if s := tokenSlug(p); s != "" {
				segs = append(segs, s)
			}
		}
		if len(segs) > 1 && (segs[0] == "colors" || segs[0] == "color" || segs[0] == "colores") {
			segs = segs[1:]
		}
		if n := len(segs); n >= 2 && (segs[n-1] == segs[n-2] || strings.HasPrefix(segs[n-1], segs[n-2]+"-")) {
			segs = append(segs[:n-2], segs[n-1])
		}
		return strings.Join(segs, "-")
	}
	byBase := map[string][]int{}
	for i := range cs {
		byBase[base(cs[i].Name)] = append(byBase[base(cs[i].Name)], i)
	}
	for b, idx := range byBase {
		// El valor con más usos se queda con el nombre.
		uses := map[string]int{}
		for _, i := range idx {
			uses[cs[i].Value] += cs[i].Uses
		}
		main, best := "", -1
		for v, n := range uses {
			if n > best || n == best && v < main {
				main, best = v, n
			}
		}
		for _, i := range idx {
			v := b
			if cs[i].Value != main {
				v += "-" + tokenSlug(strings.TrimPrefix(cs[i].Value, "#"))
			}
			cs[i].Var = "--" + v
		}
	}
}

func mostCommon(m map[string]int) string {
	best, n := "", -1
	for v, c := range m {
		if c > n || c == n && v < best {
			best, n = v, c
		}
	}
	return best
}

func firstSolidHex(ps []tokenPaint) string {
	for _, p := range ps {
		if (p.Visible == nil || *p.Visible) && p.Type == "SOLID" && p.Color != nil {
			a := p.Color.A
			if p.Opacity != nil {
				a *= *p.Opacity
			}
			return ColorValue(p.Color.R, p.Color.G, p.Color.B, a)
		}
	}
	return ""
}

// ColorValue escribe un color como lo escribe la hoja: hexadecimal si es opaco, rgba si no.
func ColorValue(r, g, b, a float64) string {
	to := func(c float64) int { return int(math.Round(c * 255)) }
	if a >= 0.999 {
		return fmt.Sprintf("#%02x%02x%02x", to(r), to(g), to(b))
	}
	return fmt.Sprintf("rgba(%d,%d,%d,%s)", to(r), to(g), to(b), trimFloat(a))
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func trimFloat(v float64) string {
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%.2f", v), "0"), ".")
}

// tokenSlug: minúsculas, sin tildes, con guiones. «text-small/semi Bold» → «text-small-semi-bold».
func tokenSlug(name string) string {
	fold := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n")
	var b strings.Builder
	dash := false
	for _, r := range fold.Replace(strings.ToLower(name)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}

// CSS escribe la hoja como variables y clases: lo que se pega al lado de un componente de Vue o React.
func (t Tokens) CSS(title string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "/* Tokens de «%s», sacados de Figma: los nombres son los estilos del sistema de diseño. */\n:root {\n", title)
	for _, c := range t.uniqueColors() {
		fmt.Fprintf(&b, "  %s: %s; /* %s · %d usos en %d pantallas */\n", c.Var, c.Value, c.Name, c.Uses, c.Screens)
	}
	if len(t.Radii) > 0 {
		b.WriteString("\n  /* Radios: por valor (Figma no da los nombres de sus variables a este token). */\n")
		for _, r := range t.Radii {
			fmt.Fprintf(&b, "  --radius-%s: %spx; /* %d usos */\n", strings.ReplaceAll(trimFloat(r.Value), ".", "_"), trimFloat(r.Value), r.Uses)
		}
	}
	b.WriteString("}\n")
	for _, x := range t.Texts {
		fmt.Fprintf(&b, "\n/* %s · %d usos en %d pantallas */\n.%s {\n  font-family: %s;\n  font-weight: %s;\n  font-size: %spx;\n",
			x.Name, x.Uses, x.Screens, x.Class, cssFamily(x.Family), trimFloat(x.Weight), trimFloat(x.Size))
		if x.LineHeight > 0 {
			fmt.Fprintf(&b, "  line-height: %spx;\n", trimFloat(x.LineHeight))
		}
		if x.LetterSpacing != 0 {
			fmt.Fprintf(&b, "  letter-spacing: %spx;\n", trimFloat(x.LetterSpacing))
		}
		b.WriteString("}\n")
	}
	if len(t.Loose) > 0 {
		b.WriteString("\n/* Colores SIN estilo en Figma: se salen del sistema de diseño. No son tokens; si hacen falta,\n   que el diseñador les dé un estilo.\n")
		for _, l := range t.Loose {
			same := ""
			if l.Matches != "" {
				same = " · es el valor de " + l.Matches + ": usar el token"
			}
			fmt.Fprintf(&b, "   %s · %d usos en %d pantallas%s\n", l.Value, l.Uses, l.Screens, same)
		}
		b.WriteString("*/\n")
	}
	return b.String()
}

// Tailwind escribe la misma hoja como tema de Tailwind v4 (`@theme`): `bg-morado-500`,
// `text-small-medium`, `rounded-8`.
func (t Tokens) Tailwind(title string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "/* Tema de Tailwind v4 de «%s», sacado de Figma. */\n@theme {\n", title)
	for _, c := range t.uniqueColors() {
		fmt.Fprintf(&b, "  --color-%s: %s; /* %s */\n", strings.TrimPrefix(c.Var, "--"), c.Value, c.Name)
	}
	families := map[string]bool{}
	for _, x := range t.Texts {
		// `text-small/medium` es `--text-small-medium`: sin repetir el «text-» del nombre.
		name := strings.TrimPrefix(x.Class, "text-")
		fmt.Fprintf(&b, "  --text-%s: %spx; /* %s */\n", name, trimFloat(x.Size), x.Name)
		if x.LineHeight > 0 {
			fmt.Fprintf(&b, "  --text-%s--line-height: %spx;\n", name, trimFloat(x.LineHeight))
		}
		fmt.Fprintf(&b, "  --text-%s--font-weight: %s;\n", name, trimFloat(x.Weight))
		if x.LetterSpacing != 0 {
			fmt.Fprintf(&b, "  --text-%s--letter-spacing: %spx;\n", name, trimFloat(x.LetterSpacing))
		}
		families[x.Family] = true
	}
	var fams []string
	for f := range families {
		fams = append(fams, f)
	}
	sort.Strings(fams)
	for _, f := range fams {
		fmt.Fprintf(&b, "  --font-%s: %s;\n", tokenSlug(strings.TrimSuffix(f, " Variable")), cssFamily(f))
	}
	for _, r := range t.Radii {
		fmt.Fprintf(&b, "  --radius-%s: %spx;\n", strings.ReplaceAll(trimFloat(r.Value), ".", "_"), trimFloat(r.Value))
	}
	b.WriteString("}\n")
	return b.String()
}

// uniqueColors: una entrada por variable —dos estilos con el mismo nombre y valor son el mismo token—, con
// sus usos sumados y los nombres de Figma juntos.
func (t Tokens) uniqueColors() []ColorToken {
	var out []ColorToken
	at := map[string]int{}
	for _, c := range t.Colors {
		if i, ok := at[c.Var]; ok {
			out[i].Uses += c.Uses
			if !strings.Contains(out[i].Name, c.Name) {
				out[i].Name += " = " + c.Name
			}
			if c.Screens > out[i].Screens {
				out[i].Screens = c.Screens
			}
			continue
		}
		at[c.Var] = len(out)
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Var < out[j].Var })
	return out
}

// cssFamily: «Satoshi Variable» es el nombre con que Figma guarda la variable; la web la publica como «Satoshi».
func cssFamily(f string) string {
	base := strings.TrimSuffix(f, " Variable")
	return "'" + base + "', sans-serif"
}
