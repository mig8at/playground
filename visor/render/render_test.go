package render

import (
	"strings"
	"testing"
)

func box(x, y, w, h float64) *Rect { return &Rect{x, y, w, h} }

func solid(r, g, b float64) []Paint {
	return []Paint{{Type: "SOLID", Color: &Color{r, g, b, 1}}}
}

// render devuelve el HTML de una pantalla con un solo hijo.
func render(t *testing.T, screen Node) (string, Report) {
	t.Helper()
	doc, rep := HTML(screen, Assets{SVG: func(id string) string { return "svg:" + id }, Image: func(ref string) string { return "img:" + ref }})
	return doc, rep
}

// styleOf devuelve el style de un elemento por su id de Figma.
func styleOf(t *testing.T, doc, id string) string {
	t.Helper()
	i := strings.Index(doc, `data-figma="`+id+`"`)
	if i < 0 {
		t.Fatalf("no está el nodo %s en:\n%s", id, doc)
	}
	rest := doc[i:]
	j := strings.Index(rest, `style="`)
	k := strings.Index(rest[j+7:], `"`)
	return rest[j+7 : j+7+k]
}

// El auto-layout es flexbox, y cada tamaño de Figma tiene su equivalente: FIXED es la medida, HUG es
// `auto` (si hay contenido que lo sostenga) y FILL es `flex: 1` en el eje y `stretch` en el otro.
func TestAutoLayoutBecomesFlexbox(t *testing.T) {
	label := Node{ID: "3", Type: "TEXT", Box: box(24, 24, 60, 20), Characters: "Continuar", SizingH: "HUG", SizingV: "HUG",
		Style: &TextStyle{FontFamily: "Satoshi Variable", FontWeight: 700, FontSize: 16, LineHeightPx: 20}, Fills: solid(1, 1, 1)}
	button := Node{ID: "2", Type: "FRAME", Box: box(16, 800, 398, 48), LayoutMode: "HORIZONTAL", PrimaryAlign: "CENTER",
		CounterAlign: "CENTER", ItemSpacing: 8, PaddingTop: 12, PaddingBottom: 12, PaddingLeft: 24, PaddingRight: 24,
		SizingH: "FILL", SizingV: "HUG", CornerRadius: 12, Fills: solid(0.3, 0.2, 1), Children: []Node{label}}
	screen := Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), LayoutMode: "VERTICAL", PaddingLeft: 16, PaddingRight: 16,
		Children: []Node{button}}
	doc, rep := render(t, screen)
	s := styleOf(t, doc, "2")
	// El padre es una COLUMNA: el ancho FILL es el eje cruzado (stretch) y el alto HUG, el principal.
	for _, want := range []string{"align-self:stretch", "flex:none", "display:flex", "flex-direction:row", "justify-content:center",
		"align-items:center", "gap:8px", "padding:12px 24px 12px 24px", "border-radius:12px"} {
		if !strings.Contains(s, want) {
			t.Errorf("el botón no tiene %q: %s", want, s)
		}
	}
	if strings.Contains(s, "position:absolute") {
		t.Error("un hijo de auto-layout va en el flujo, no en absoluta")
	}
	ts := styleOf(t, doc, "3")
	if !strings.Contains(ts, "font-family:&#39;Satoshi Variable&#39;, &#39;Satoshi&#39;") || !strings.Contains(ts, "font-weight:700") {
		t.Errorf("el texto lleva su fuente (y el nombre web de la variable): %s", ts)
	}
	if !strings.Contains(doc, "api.fontshare.com") {
		t.Error("Satoshi se carga de Fontshare")
	}
	if rep.Flex != 2 || rep.Texts != 1 {
		t.Errorf("reporte: %+v", rep)
	}
}

// Un marco sin auto-layout pone a sus hijos en absoluta con las coordenadas de Figma, contra ÉL: el
// marco mismo puede ir en absoluta contra su padre y a la vez servir de referencia.
func TestFramesWithoutAutoLayoutPlaceChildrenAbsolutely(t *testing.T) {
	inner := Node{ID: "3", Type: "RECTANGLE", Box: box(130, 330, 20, 20), Fills: solid(1, 0, 0)}
	card := Node{ID: "2", Type: "FRAME", Box: box(100, 300, 200, 100), Children: []Node{inner}}
	screen := Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{card}}
	doc, _ := render(t, screen)
	cs := styleOf(t, doc, "2")
	if !strings.Contains(cs, "position:absolute") || strings.Contains(cs, "position:relative") ||
		!strings.Contains(cs, "left:100px") || !strings.Contains(cs, "top:300px") {
		t.Errorf("la tarjeta va en absoluta contra la pantalla, sin pisarse con relative: %s", cs)
	}
	is := styleOf(t, doc, "3")
	if !strings.Contains(is, "left:30px") || !strings.Contains(is, "top:30px") {
		t.Errorf("el hijo se ubica contra la tarjeta (130-100, 330-300): %s", is)
	}
}

// El caso medido en «Número de celular»: una instancia HUG vacía (sólo la imagen de fondo) mide 0 en
// CSS y sube todo lo de abajo. Sin contenido en el flujo, va con la medida de Figma.
func TestHugWithoutContentKeepsFigmaSize(t *testing.T) {
	logo := Node{ID: "2", Type: "INSTANCE", Box: box(161, 79, 108, 108), LayoutMode: "HORIZONTAL", SizingH: "HUG", SizingV: "HUG",
		PaddingTop: 8, PaddingLeft: 8, PaddingRight: 8, PaddingBottom: 8, Fills: []Paint{{Type: "IMAGE", ImageRef: "abc"}}}
	col := Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), LayoutMode: "VERTICAL", Children: []Node{logo}}
	doc, _ := render(t, col)
	s := styleOf(t, doc, "2")
	if !strings.Contains(s, "height:108px") || !strings.Contains(s, "width:108px") {
		t.Errorf("la instancia vacía conserva 108×108: %s", s)
	}
}

// El recorte de una imagen (STRETCH con imageTransform): la parte visible de la imagen va de tx a
// tx+a, así que la imagen entera mide W/a y arranca en -tx/a·W. Medido: 18 de 43 imágenes van así.
func TestCroppedImageFill(t *testing.T) {
	photo := Node{ID: "2", Type: "RECTANGLE", Box: box(42, 276, 362, 263), Fills: []Paint{{Type: "IMAGE", ImageRef: "f00",
		ScaleMode: "STRETCH", ImageTransform: [][]float64{{0.5, 0, 0.25}, {0, 0.5, 0.1}}}}}
	doc, rep := render(t, Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{photo}})
	s := styleOf(t, doc, "2")
	if !strings.Contains(s, "url(&#34;img:f00&#34;) -181px -52.6px / 724px 526px") {
		t.Errorf("recorte: %s", s)
	}
	if len(rep.Images) != 1 {
		t.Errorf("la imagen va en el reporte: %+v", rep)
	}
}

// Un dibujo (un vector, o un grupo que sólo tiene vectores) se exporta como SVG entero; un rectángulo o
// un grupo con texto, no.
func TestDrawingsGoAsSVGAndOnlyThem(t *testing.T) {
	icon := Node{ID: "2", Type: "GROUP", Box: box(10, 10, 24, 24), Children: []Node{
		{ID: "2a", Type: "VECTOR", Box: box(10, 10, 24, 24)}, {ID: "2b", Type: "RECTANGLE", Box: box(10, 10, 24, 24)}}}
	withText := Node{ID: "3", Type: "GROUP", Box: box(50, 10, 100, 24), Children: []Node{
		{ID: "3a", Type: "VECTOR", Box: box(50, 10, 24, 24)}, {ID: "3b", Type: "TEXT", Characters: "Hola", Box: box(80, 10, 60, 24)}}}
	rect := Node{ID: "4", Type: "RECTANGLE", Box: box(0, 100, 430, 1), Fills: solid(0, 0, 0)}
	doc, rep := render(t, Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{icon, withText, rect}})
	if !strings.Contains(doc, `<img data-figma="2" alt="" src="svg:2"`) {
		t.Error("el ícono entero es un solo SVG")
	}
	if strings.Contains(doc, `src="svg:3"`) || !strings.Contains(doc, `src="svg:3a"`) {
		t.Error("un grupo con texto no es un dibujo: se abre, y su vector sí va como SVG")
	}
	if strings.Contains(doc, `src="svg:4"`) {
		t.Error("un rectángulo es una caja, no un SVG")
	}
	if len(rep.Drawings) != 2 {
		t.Errorf("dibujos: %v", rep.Drawings)
	}
}

// El anillo de progreso de Credifamilia: una elipse con hueco y otra con medio barrido, girada. Como
// caja las dos eran un disco lleno (`border-radius: 50%`); van como SVG, y el girado se ubica por lo que
// se VE —Figma exporta el SVG a ese tamaño—, no estirado a su caja.
func TestArcsGoAsSVGAtWhatIsVisible(t *testing.T) {
	ring := Node{ID: "2", Type: "ELLIPSE", Box: box(5, 5, 36, 36), RenderBox: box(5, 5, 36, 36), Fills: solid(0.85, 0.85, 0.85),
		Arc: &ArcData{EndingAngle: 2 * 3.1415926, InnerRadius: 0.8}}
	progress := Node{ID: "3", Type: "ELLIPSE", Box: box(0, 0, 46.35, 46.35), RenderBox: box(6.87, 5.18, 34.3, 36), Rotation: 2.78,
		Fills: solid(0.3, 0.22, 1), Arc: &ArcData{EndingAngle: -4.55, InnerRadius: 0.8}}
	disk := Node{ID: "4", Type: "ELLIPSE", Box: box(100, 0, 20, 20), Fills: solid(1, 0, 0),
		Arc: &ArcData{EndingAngle: 2 * 3.1415926}}
	// El velo que sobresale 1 px del marco: lo visible está recortado por el padre, pero su SVG no.
	overlay := Node{ID: "5", Type: "VECTOR", Box: box(0, -1, 430, 933), RenderBox: box(0, 0, 430, 932)}
	frame := Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{ring, progress, disk, overlay}}
	doc, rep := render(t, frame)
	if !strings.Contains(doc, `<img data-figma="2" alt="" src="svg:2"`) {
		t.Error("un anillo es un SVG, no un disco")
	}
	st := styleOf(t, doc, "3")
	if !strings.Contains(st, "width:46.35px") || !strings.Contains(doc, `src="svg:3" style="position:absolute;left:6.87px;top:5.18px;width:34.3px;height:36px`) {
		t.Errorf("el arco girado guarda su caja y dibuja lo visible adentro:\n%s", doc)
	}
	if strings.Contains(doc, `src="svg:4"`) || !strings.Contains(styleOf(t, doc, "4"), "border-radius:50%") {
		t.Error("una elipse llena sigue siendo una caja redonda")
	}
	if !strings.Contains(doc, `<img data-figma="5" alt="" src="svg:5"`) || !strings.Contains(styleOf(t, doc, "5"), "height:933px") {
		t.Error("un vector recortado por su marco va a su caja: su SVG no viene recortado")
	}
	if rep.Missing["rotación (se dibuja derecho)"] != 0 {
		t.Error("la rotación de un dibujo viene adentro del SVG: no es algo sin traducir")
	}
}

// Lo que no tiene equivalente se nombra en el reporte, no sale parecido y callado.
func TestWhatIsNotTranslatedIsReported(t *testing.T) {
	mask := Node{ID: "2", Type: "RECTANGLE", IsMask: true, Box: box(0, 0, 10, 10)}
	blend := Node{ID: "3", Type: "RECTANGLE", BlendMode: "MULTIPLY", Box: box(0, 0, 10, 10), Fills: []Paint{{Type: "GRADIENT_RADIAL"}}}
	_, rep := render(t, Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{mask, blend}})
	for _, why := range []string{"máscara (se dibuja sin recortar)", "modo de mezcla multiply", "relleno gradient radial"} {
		if rep.Missing[why] != 1 {
			t.Errorf("falta en el reporte %q: %v", why, rep.Missing)
		}
	}
}

// Los tramos de un texto con otro estilo (un monto en negrita) salen como <span>.
func TestTextRunsKeepTheirStyle(t *testing.T) {
	txt := Node{ID: "2", Type: "TEXT", Box: box(0, 0, 300, 20), Characters: "Pagá $250.000 hoy",
		Style:              &TextStyle{FontFamily: "Roboto", FontWeight: 400, FontSize: 14},
		CharacterOverrides: []int{0, 0, 0, 0, 0, 7, 7, 7, 7, 7, 7, 7, 7}, OverrideTable: map[string]TextStyle{"7": {FontWeight: 700}}}
	doc, _ := render(t, Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{txt}})
	if !strings.Contains(doc, `Pagá <span style="font-weight:700;">$250.000</span> hoy`) {
		t.Errorf("tramos: %s", doc[strings.Index(doc, `data-figma="2"`):])
	}
}

// En una FILA, FILL en el ancho es el eje principal: reparte el espacio con `flex: 1`.
func TestFillOnTheMainAxisGrows(t *testing.T) {
	left := Node{ID: "2", Type: "FRAME", Box: box(0, 0, 100, 40), SizingH: "FILL", SizingV: "FIXED"}
	right := Node{ID: "3", Type: "FRAME", Box: box(100, 0, 60, 40), SizingH: "FIXED", SizingV: "FIXED"}
	row := Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), LayoutMode: "HORIZONTAL", Children: []Node{left, right}}
	doc, _ := render(t, row)
	if s := styleOf(t, doc, "2"); !strings.Contains(s, "flex:1 1 0") || !strings.Contains(s, "min-width:0") || !strings.Contains(s, "height:40px") {
		t.Errorf("FILL en fila: %s", s)
	}
	if s := styleOf(t, doc, "3"); !strings.Contains(s, "flex:none") || !strings.Contains(s, "width:60px") {
		t.Errorf("FIXED en fila: %s", s)
	}
}

func variant(value string) map[string]ComponentProp {
	return map[string]ComponentProp{"tipe": {Type: "VARIANT", Value: []byte(`"` + value + `"`)}}
}

// Un campo del sistema de diseño —«Input Text» adentro de «Input Container»— es un <input> en el mismo
// lugar: el gris de Figma es el placeholder, y lo que se escribe va del color de la etiqueta. Con la
// flecha es un select, que todavía no se traduce.
func TestInputTextBecomesAnInput(t *testing.T) {
	txt := func(id, chars string, gray float64) Node {
		return Node{ID: id, Name: "Input Text", Type: "TEXT", Box: box(16, 40, 200, 20), Characters: chars, SizingH: "HUG",
			Style: &TextStyle{FontFamily: "Satoshi Variable", FontSize: 14, LineHeightPx: 20}, Fills: solid(gray, gray, gray)}
	}
	field := Node{ID: "2", Name: "Text- fields", Type: "FRAME", Box: box(0, 0, 398, 80), LayoutMode: "VERTICAL", Children: []Node{
		{ID: "2a", Name: "Document Number Label", Type: "TEXT", Box: box(0, 0, 100, 20), Characters: "TIN", Fills: solid(0.1, 0.1, 0.3)},
		{ID: "2b", Name: "Input Container", Type: "FRAME", Box: box(0, 30, 398, 44), LayoutMode: "HORIZONTAL", Children: []Node{txt("2c", "123456789", 0.7)}},
	}}
	filled := Node{ID: "3", Name: "Input Container", Type: "FRAME", Box: box(0, 100, 398, 44), LayoutMode: "HORIZONTAL", Children: []Node{txt("3c", "Bogotá", 0.1)}}
	sel := Node{ID: "4", Name: "Input Container", Type: "FRAME", Box: box(0, 200, 398, 44), LayoutMode: "HORIZONTAL", Children: []Node{
		txt("4c", "Seleccione país", 0.7), {ID: "4d", Name: "icon/arrow-down", Type: "INSTANCE", Box: box(360, 210, 24, 24)}}}
	doc, rep := render(t, Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{field, filled, sel}})
	if !strings.Contains(doc, `<input class="fg-input" data-figma="2c" type="text" inputmode="numeric" placeholder="123456789" aria-label="TIN"`) {
		t.Errorf("el campo es un input con su placeholder y el nombre de su etiqueta:\n%s", doc)
	}
	st := styleOf(t, doc, "2c")
	if !strings.Contains(st, "--fg-placeholder:rgba(179,179,179,1)") || !strings.Contains(st, "color:rgba(26,26,77,1)") || !strings.Contains(st, "flex:1 1 0") {
		t.Errorf("el placeholder es el gris de Figma, lo escrito el color de la etiqueta, y el campo ocupa el ancho: %s", st)
	}
	if !strings.Contains(doc, `data-figma="3c" type="text" value="Bogotá"`) {
		t.Error("un texto oscuro en el campo ya es un valor escrito, no un placeholder")
	}
	if strings.Contains(doc, `data-figma="4c" type="text"`) {
		t.Error("con la flecha es una lista: no se traduce a un input de texto")
	}
	if rep.Controls["campo"] != 2 {
		t.Errorf("controles: %v", rep.Controls)
	}
}

// La casilla alterna entre sus DOS dibujos de Figma sin script: el suyo y el de otra instancia de la
// variante contraria (el componente no: Figma no lo exporta). Una pregunta de «Sí» y «No» es un radio; una lista de opciones, casillas. La opción
// entera es un <label>: tocar el texto también marca.
func TestCheckboxesToggleBetweenTheirVariants(t *testing.T) {
	check := func(id, value string, x float64) Node {
		return Node{ID: id, Name: "Check Box", Type: "INSTANCE", Box: box(x, 0, 24, 24), ComponentProps: variant(value),
			Children: []Node{{ID: id + "v", Type: "VECTOR", Box: box(x, 0, 24, 24)}}}
	}
	option := func(id, text string, c Node) Node {
		return Node{ID: id, Name: "Option", Type: "FRAME", Box: box(c.Box.X, 0, 80, 24), LayoutMode: "HORIZONTAL", Children: []Node{c,
			{ID: id + "t", Type: "TEXT", Box: box(c.Box.X+30, 0, 40, 20), Characters: text}}}
	}
	yesNo := Node{ID: "2", Type: "FRAME", Box: box(0, 0, 200, 24), LayoutMode: "HORIZONTAL", Children: []Node{
		option("2a", "Sí", check("c1", "check", 0)), option("2b", "No", check("c2", "deafult", 100))}}
	list := Node{ID: "3", Type: "FRAME", Box: box(0, 100, 400, 60), LayoutMode: "VERTICAL", Children: []Node{
		option("3a", "Ejerce un cargo público", check("c3", "deafult", 0))}}
	doc, rep := render(t, Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{yesNo, list}})
	if !strings.Contains(doc, `<label data-figma="2a" title="Option" class="fg-option"`) {
		t.Errorf("la opción es un label:\n%s", doc)
	}
	if !strings.Contains(doc, `<span class="fg-check" data-figma="c1"`) || !strings.Contains(doc, `<input type="radio" name="g-2" checked><img class="fg-on" alt="" src="svg:c1"><img class="fg-off" alt="" src="svg:c2">`) {
		t.Errorf("«Sí» marcado: radio del grupo, y la otra variante es la casilla vacía de al lado:\n%s", doc)
	}
	if !strings.Contains(doc, `<input type="radio" name="g-2"><img class="fg-on" alt="" src="svg:c1"><img class="fg-off" alt="" src="svg:c2">`) {
		t.Errorf("«No» vacío: al marcarlo se ve la casilla marcada de al lado:\n%s", doc)
	}
	if !strings.Contains(doc, `data-figma="c3"`) || !strings.Contains(doc, `<input type="checkbox"><img class="fg-on" alt="" src="svg:c1">`) {
		t.Errorf("una lista de opciones son casillas, y la variante marcada sale de otra casilla de la pantalla:\n%s", doc)
	}
	if rep.Controls["opción sí/no"] != 2 || rep.Controls["casilla"] != 1 {
		t.Errorf("controles: %v", rep.Controls)
	}

	alone := Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{check("c9", "deafult", 0)}}
	doc, rep = render(t, alone)
	if !strings.Contains(doc, `<label class="fg-check" data-figma="c9"`) || rep.Missing["casilla sin la otra variante en el archivo (se marca, pero no cambia de dibujo)"] != 1 {
		t.Errorf("sin la otra variante se marca igual y el reporte lo dice:\n%s\n%v", doc, rep.Missing)
	}
}

// Un botón del sistema de diseño es un <button>, con la misma caja.
func TestButtonsAreButtons(t *testing.T) {
	label := Node{ID: "2t", Name: "Button Text", Type: "TEXT", Box: box(150, 812, 80, 20), Characters: "Continuar"}
	instance := Node{ID: "2", Name: "Botones", Type: "INSTANCE", Box: box(16, 800, 398, 48), Fills: solid(0.3, 0.22, 1), Children: []Node{label}}
	frame := Node{ID: "3", Name: "Botón continuar", Type: "FRAME", Box: box(16, 860, 398, 48), Children: []Node{
		{ID: "3t", Name: "Button Text", Type: "TEXT", Box: box(150, 872, 80, 20), Characters: "Firmar"}}}
	doc, rep := render(t, Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{instance, frame}})
	for _, id := range []string{"2", "3"} {
		if !strings.Contains(doc, `<button data-figma="`+id+`"`) || !strings.Contains(doc, `type="button" class="fg-button"`) {
			t.Errorf("%s es un botón:\n%s", id, doc)
		}
	}
	if !strings.Contains(styleOf(t, doc, "2"), "background:rgba(77,56,255,1)") {
		t.Errorf("el botón conserva su caja de Figma: %s", styleOf(t, doc, "2"))
	}
	if rep.Controls["botón"] != 2 {
		t.Errorf("controles: %v", rep.Controls)
	}
}

// Con la flecha VISIBLE el campo es una lista: un <select> con la única opción que dibuja el diseño,
// estirado por debajo de la flecha para que toda la caja la abra. Con la flecha oculta —viene así en casi
// todos los campos— sigue siendo un input.
func TestSelectKeepsTheOnlyOptionTheDesignShows(t *testing.T) {
	txt := func(id, chars string) Node {
		return Node{ID: id, Name: "Input Text", Type: "TEXT", Box: box(16, 12, 300, 20), Characters: chars,
			Style: &TextStyle{FontSize: 14, LineHeightPx: 20}, Fills: solid(0.1, 0.1, 0.3)}
	}
	hidden := false
	field := Node{ID: "2", Name: "Text- fields", Type: "FRAME", Box: box(0, 0, 398, 80), LayoutMode: "VERTICAL", Children: []Node{
		{ID: "2a", Type: "TEXT", Box: box(0, 0, 100, 20), Characters: "Departamento de residencia", Fills: solid(0.1, 0.1, 0.3)},
		{ID: "2b", Name: "Input Container", Type: "FRAME", Box: box(0, 30, 398, 44), LayoutMode: "HORIZONTAL", ItemSpacing: 8, Children: []Node{
			txt("2c", "Cundinamarca"), {ID: "2d", Name: "icon/arrow-down", Type: "INSTANCE", Box: box(324, 40, 24, 24)}}},
	}}
	phone := Node{ID: "3", Name: "Input Container", Type: "FRAME", Box: box(0, 100, 398, 44), LayoutMode: "HORIZONTAL", Children: []Node{
		txt("3c", "3178622287"), {ID: "3d", Name: "icon/arrow-down", Type: "INSTANCE", Visible: &hidden, Box: box(324, 110, 24, 24)}}}
	doc, rep := render(t, Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{field, phone}})
	if !strings.Contains(doc, `<select class="fg-select" data-figma="2c" aria-label="Departamento de residencia"`) ||
		!strings.Contains(doc, `<option selected>Cundinamarca</option></select>`) {
		t.Errorf("la lista es un select con la opción que se ve:\n%s", doc)
	}
	if st := styleOf(t, doc, "2c"); !strings.Contains(st, "margin-right:-32px") || !strings.Contains(st, "padding-right:32px") {
		t.Errorf("el select llega hasta el final de la flecha (24 + 8 de separación): %s", st)
	}
	if !strings.Contains(doc, `<input class="fg-input" data-figma="3c"`) {
		t.Error("con la flecha oculta es un campo de texto")
	}
	if rep.Controls["lista"] != 1 || rep.Missing["lista sin opciones en el diseño (sólo la que se ve)"] != 1 {
		t.Errorf("controles %v · sin traducir %v", rep.Controls, rep.Missing)
	}
}

// Con los tokens del archivo, lo que usa un estilo de Figma se escribe con su variable —y el valor por si
// falta— y el texto lleva la clase de su estilo; lo que no tiene estilo queda con el valor, y se cuenta.
func TestStylesBecomeTokens(t *testing.T) {
	label := Node{ID: "3", Type: "TEXT", Box: box(20, 20, 100, 20), Characters: "Continuar", Styles: map[string]string{"text": "T1", "fill": "C2"},
		Style: &TextStyle{FontFamily: "Satoshi Variable", FontSize: 14}, Fills: solid(1, 1, 1)}
	button := Node{ID: "2", Name: "Caja", Type: "FRAME", Box: box(0, 0, 200, 60), Styles: map[string]string{"fill": "C1"}, Fills: solid(0.298, 0.224, 1),
		Children: []Node{label}}
	loose := Node{ID: "4", Type: "RECTANGLE", Box: box(0, 100, 10, 10), Fills: solid(1, 0, 0)}
	screen := Node{ID: "1", Type: "FRAME", Box: box(0, 0, 430, 932), Children: []Node{button, loose}}
	doc, rep := HTML(screen, Assets{Styles: map[string]StyleToken{
		"C1": {Name: "Colors/morado/morado-500", Var: "--morado-500", Value: "#4c39ff"},
		"C2": {Name: "Colors/neutral/neutral-0", Var: "--neutral-0", Value: "#ffffff"},
		"T1": {Name: "text-small/medium", Class: "text-small-medium"},
	}})
	if !strings.Contains(styleOf(t, doc, "2"), "background:var(--morado-500, rgba(76,57,255,1))") {
		t.Errorf("el relleno con estilo es su variable: %s", styleOf(t, doc, "2"))
	}
	if !strings.Contains(doc, `data-figma="3" class="text-small-medium"`) || !strings.Contains(styleOf(t, doc, "3"), "color:var(--neutral-0, rgba(255,255,255,1))") {
		t.Errorf("el texto lleva la clase de su estilo y su color como variable:\n%s", doc)
	}
	if !strings.Contains(styleOf(t, doc, "4"), "background:rgba(255,0,0,1)") || rep.Loose != 1 {
		t.Errorf("sin estilo queda el valor, y se cuenta: %s · %d", styleOf(t, doc, "4"), rep.Loose)
	}
	if !strings.Contains(doc, ":root{--morado-500:#4c39ff;--neutral-0:#ffffff;}") {
		t.Errorf("el documento declara las variables que usa:\n%s", doc)
	}
	if rep.Tokens["Colors/morado/morado-500"] != 1 || rep.Tokens["text-small/medium"] != 1 {
		t.Errorf("tokens del reporte: %v", rep.Tokens)
	}
}
