package figma

import (
	"strings"
	"testing"
)

func frame(id, name string, x, y, w, h float64, children ...fullNode) fullNode {
	return fullNode{ID: id, Name: name, Type: "FRAME", AbsoluteBoundingBox: &box{x, y, w, h}, Children: children}
}

func text(id, name, chars string, size, y float64) fullNode {
	return fullNode{ID: id, Name: name, Type: "TEXT", Characters: chars, Style: &struct{ FontSize float64 }{size},
		AbsoluteBoundingBox: &box{0, y, 100, 20}}
}

func mobile(id, layer string, x, y float64, children ...fullNode) fullNode {
	status := frame(id+"s", "Status bar", x, y, 430, 36, text(id+"t", "12:30", "-- : --", 19, y))
	return frame(id, layer, x, y, 430, 932, append([]fullNode{status}, children...)...)
}

// El caso que da sentido a todo: dos rótulos en la MISMA fila, uno a la izquierda y otro a mitad de
// camino. En el archivo medido «Premium» y «No paga cuota inicial» comparten fila así: el carril tiene
// que empezar a mitad de fila, y el nombre del rótulo es su TEXTO, no el de la capa.
func TestLanesSplitARowAtEachLabel(t *testing.T) {
	root := fullNode{ID: "0:1", Name: "flujo", Type: "SECTION", AbsoluteBoundingBox: &box{0, 0, 10000, 5000}, Children: []fullNode{
		frame("L1", "-", 0, 800, 1400, 200, text("L1t", "x", "Paga cuota", 90, 800)),
		frame("L2", "Premium", 2000, 700, 1400, 200, text("L2t", "x", "No paga cuota", 90, 700)),
		mobile("A", "Frame 1", 0, 1000, text("At", "Title", "Pedí tu crédito", 24, 1100)),
		mobile("B", "Frame 2", 500, 1010, text("Bt", "x", "Número de celular", 20, 1100)),
		mobile("C", "Frame 3", 2000, 1005, text("Ct", "x", "Pago exitoso", 20, 1100)),
		mobile("D", "Frame 4", 0, 3000, text("Dt", "x", "Otra fila", 20, 3100)),
	}}
	s := Read(root, nil, nil)
	if len(s.Lanes) != 3 {
		t.Fatalf("carriles: %+v", s.Lanes)
	}
	if s.Lanes[0].Label != "Paga cuota" || len(s.Lanes[0].Screens) != 2 || s.Lanes[0].Screens[0].ID != "A" {
		t.Errorf("primer carril: %+v", s.Lanes[0])
	}
	if s.Lanes[1].Label != "No paga cuota" || len(s.Lanes[1].Screens) != 1 || s.Lanes[1].Screens[0].ID != "C" {
		t.Errorf("el rótulo de mitad de fila abre su carril: %+v", s.Lanes[1])
	}
	if s.Lanes[2].Label != "" || s.Lanes[2].Screens[0].ID != "D" {
		t.Errorf("una fila sin rótulo queda sin rótulo, no hereda el de arriba: %+v", s.Lanes[2])
	}
}

// El título, por niveles. Cada caso es uno medido: la capa «Title»; el texto más grande con palabras
// antes que un dato más grande; el nombre de la capa cuando la pantalla sólo tiene datos; y nunca la
// barra de estado, que es el texto más grande de muchas pantallas vacías.
func TestTitleComesFromWhatTheScreenSays(t *testing.T) {
	cases := []struct {
		screen   fullNode
		want     string
		wantFrom string
	}{
		{mobile("1", "Frame 9", 0, 0, text("a", "Title", "Pago exitoso", 18, 100), text("b", "x", "Un texto más grande", 30, 200)), "Pago exitoso", "texto"},
		{mobile("2", "Frame 9", 0, 0, text("a", "x", "07-Feb", 40, 100), text("b", "x", "Elige tu fecha", 20, 200)), "Elige tu fecha", "texto"},
		{mobile("3", "Elige tu fecha de pago", 0, 0, text("a", "x", "07-Feb", 20, 100)), "Elige tu fecha de pago", "capa"},
		{mobile("4", "Frame 427320380", 0, 0, text("a", "x", "4", 16, 100)), "4", "texto"},
		{mobile("5", "Frame 427320380", 0, 0), "", ""},
	}
	for _, c := range cases {
		sc := screenOf(c.screen, textsOf(c.screen, nil), boxOf(c.screen), "mobile")
		if sc.Title != c.want || sc.TitleFrom != c.wantFrom {
			t.Errorf("%s: título %q (%s), quería %q (%s)", c.screen.ID, sc.Title, sc.TitleFrom, c.want, c.wantFrom)
		}
	}
	btn := mobile("6", "Frame", 0, 0, text("a", "x", "Confirma tu plan", 20, 100),
		frame("b", "Botones/Primary", 0, 800, 300, 40, text("bt", "Label", "Confirmar", 16, 800)))
	sc := screenOf(btn, textsOf(btn, nil), boxOf(btn), "mobile")
	if sc.Title != "Confirma tu plan" || len(sc.Actions) != 1 || sc.Actions[0] != "Confirmar" {
		t.Errorf("el texto de un botón es una acción, no el título: %+v", sc)
	}
}

// Una flecha con la punta suelta se ubica por su posición, que Figma guarda RELATIVA a la sección.
func TestLooseArrowEndsArePlacedByPosition(t *testing.T) {
	arrow := fullNode{ID: "c1", Type: "CONNECTOR",
		ConnectorStart: &endpoint{EndpointNodeID: "A"},
		ConnectorEnd:   &endpoint{EndpointNodeID: "0:1", Position: &struct{ X, Y float64 }{2100, 1100}}}
	far := fullNode{ID: "c2", Type: "CONNECTOR",
		ConnectorStart: &endpoint{EndpointNodeID: "0:1", Position: &struct{ X, Y float64 }{9000, 9000}},
		ConnectorEnd:   &endpoint{EndpointNodeID: "A"}}
	root := fullNode{ID: "0:1", Type: "SECTION", AbsoluteBoundingBox: &box{-1000, -1000, 10000, 5000}, Children: []fullNode{
		mobile("A", "Frame", 0, 0, text("At", "x", "Inicio del flujo", 20, 100)),
		mobile("B", "Frame", 1000, 0, text("Bt", "x", "Pantalla destino", 20, 100)),
		arrow, far,
	}}
	s := Read(root, nil, nil)
	if len(s.Arrows) != 2 || s.Arrows[0].To != "B" || s.Arrows[0].ToName != "«Pantalla destino»" {
		t.Errorf("la punta suelta sobre B (sección en -1000 + 2100 = 1100) tiene que ser B: %+v", s.Arrows)
	}
	if s.Arrows[1].From != "" {
		t.Errorf("una punta en el aire, lejos de todo, no se inventa un destino: %+v", s.Arrows[1])
	}
}

// El prototipo: el disparador es el botón con su texto, o la pantalla entera cuando avanza sola; y
// una pantalla repetida en dos carriles son dos recorridos, no un duplicado.
func TestPrototypeLinksSayWhatTriggersThem(t *testing.T) {
	nav := func(trigger, dest string) []struct {
		Trigger *struct{ Type string } `json:"trigger"`
		Actions []*struct {
			Type          string
			DestinationID string `json:"destinationId"`
			Navigation    string
		} `json:"actions"`
	} {
		return []struct {
			Trigger *struct{ Type string } `json:"trigger"`
			Actions []*struct {
				Type          string
				DestinationID string `json:"destinationId"`
				Navigation    string
			} `json:"actions"`
		}{{Trigger: &struct{ Type string }{trigger}, Actions: []*struct {
			Type          string
			DestinationID string `json:"destinationId"`
			Navigation    string
		}{{Type: "NODE", DestinationID: dest, Navigation: "NAVIGATE"}}}}
	}
	button := frame("Ab", "Botones", 0, 800, 300, 40, text("Abt", "Label", "Continuar", 16, 800))
	button.Interactions = nav("ON_CLICK", "B")
	a := mobile("A", "Frame", 0, 0, text("At", "x", "Inicio del flujo", 20, 100), button)
	b := mobile("B", "Frame", 1000, 0, text("Bt", "x", "Estamos validando", 20, 100))
	b.Interactions = nav("AFTER_TIMEOUT", "C")
	c := mobile("C", "Frame", 2000, 0, text("Ct", "x", "Listo el pago", 20, 100))
	s := Read(fullNode{ID: "0:1", Type: "SECTION", Children: []fullNode{a, b, c}}, nil, nil)
	if len(s.Links) != 2 {
		t.Fatalf("links: %+v", s.Links)
	}
	if s.Links[0].From != "A" || s.Links[0].To != "B" || s.Links[0].Via != "clic en «Continuar»" {
		t.Errorf("clic en un botón: %+v", s.Links[0])
	}
	var hs []Hotspot
	for _, l := range s.Lanes {
		for _, sc := range l.Screens {
			if sc.ID == "A" {
				hs = sc.Hotspots
			}
		}
	}
	if len(hs) != 1 || hs[0].To != "B" || hs[0].Y != 800 || hs[0].W != 300 || hs[0].Auto {
		t.Errorf("la zona del botón va en coordenadas de SU pantalla (y 800 dentro de A): %+v", hs)
	}
	if s.Links[1].Via != "sola, después de un tiempo" {
		t.Errorf("la pantalla que avanza sola no nombra un elemento (antes decía «desde «11:28»», la hora de la barra): %+v", s.Links[1])
	}
}

// El caso de Motai: dos FRANJAS anchas sobre la misma fila, cada una cubriendo su parte, y pantallas
// sueltas entre la franja y la fila. La pantalla va con la franja que la cubre, no con la fila más
// cercana al rótulo.
func TestBannersLabelTheScreensTheyCover(t *testing.T) {
	root := fullNode{ID: "0:1", Type: "SECTION", AbsoluteBoundingBox: &box{-5000, -3000, 30000, 20000}, Children: []fullNode{
		frame("L1", "tag", -3400, -500, 2400, 480, text("L1t", "x", "Asesor", 181, -500)),
		frame("L2", "tag", -860, -1170, 6500, 480, text("L2t", "x", "Usuario", 181, -1170)),
		mobile("F", "Frame", -280, -630, text("Ft", "x", "Pantalla flotante", 20, -600)),
		mobile("A", "Frame", -3400, 300, text("At", "x", "Ingresa el código", 20, 400)),
		mobile("B", "Frame", -2900, 300, text("Bt", "x", "Datos de contacto", 20, 400)),
		mobile("C", "Frame", 200, 300, text("Ct", "x", "Verificación de identidad", 20, 400)),
	}}
	s := Read(root, nil, nil)
	laneOf := map[string]string{}
	for _, l := range s.Lanes {
		for _, sc := range l.Screens {
			laneOf[sc.ID] = l.Label
		}
	}
	if laneOf["A"] != "Asesor" || laneOf["B"] != "Asesor" {
		t.Errorf("las pantallas bajo «Asesor» son de «Asesor»: %v", laneOf)
	}
	if laneOf["C"] != "Usuario" {
		t.Errorf("la pantalla bajo la franja «Usuario» es de «Usuario», aunque haya una suelta más cerca del rótulo: %v", laneOf)
	}
}

// Dos renglones del mismo rótulo son UN rótulo; y un rótulo al comienzo de la fila vale para las
// pantallas que siguen aunque no las cubra.
func TestStackedLabelsMergeAndRowsContinue(t *testing.T) {
	root := fullNode{ID: "0:1", Type: "SECTION", AbsoluteBoundingBox: &box{0, 0, 20000, 5000}, Children: []fullNode{
		frame("L1", "-", 0, 700, 1400, 198, text("L1t", "x", "Salvar mejores", 90, 700)),
		frame("L2", "-", 10, 971, 1400, 198, text("L2t", "x", "Segunda oportunidad", 90, 971)),
		mobile("A", "Frame", 0, 1300, text("At", "x", "Pago exitoso", 20, 1400)),
		mobile("B", "Frame", 2000, 1310, text("Bt", "x", "Elige tu fecha", 20, 1400)),
		mobile("C", "Frame", 4000, 1305, text("Ct", "x", "Solicitud aprobada", 20, 1400)),
	}}
	s := Read(root, nil, nil)
	if len(s.Lanes) != 1 || s.Lanes[0].Label != "Salvar mejores · Segunda oportunidad" || len(s.Lanes[0].Screens) != 3 {
		t.Errorf("un carril con el rótulo de dos renglones y las tres pantallas: %+v", s.Lanes)
	}
}

// Lo que separa un rótulo de una casilla de decisión del mismo tamaño es la FLECHA: a la casilla le llega
// una. Casos de Credifamilia: «Pensionado» (50 px, sin flechas) es un carril; «Reenviar nuevamente»
// (35 px, con flecha) y «Si» son decisiones; «Fin» es un marcador; y una nota de 36 px no es un carril.
func TestArrowsSeparateChoicesFromLabels(t *testing.T) {
	root := fullNode{ID: "0:1", Type: "SECTION", AbsoluteBoundingBox: &box{0, 0, 20000, 5000}, Children: []fullNode{
		frame("P", "-", 0, 700, 1485, 183, text("Pt", "x", "Pensionado", 50, 700)),
		frame("R", "No", 3000, 300, 424, 88, text("Rt", "x", "Reenviar nuevamente", 35, 300)),
		frame("S", "si", 3600, 300, 88, 88, text("St", "x", "Si", 35, 300)),
		frame("F", "fin", 4000, 300, 471, 127, text("Ft", "x", "Fin", 50, 300)),
		frame("N", "tag", 6000, 700, 590, 91, text("Nt", "x", "Permiso de permanencia", 36, 700)),
		mobile("A", "Frame", 0, 1000, text("At", "x", "Completa tu solicitud", 20, 1100)),
		mobile("B", "Frame", 6000, 1000, text("Bt", "x", "Datos del empleo", 20, 1100)),
		frame("V", "validación", 9000, 1000, 430, 932, text("Vt", "x", "VALIDACIÓN DE IDENTIDAD", 48, 1100)),
		{ID: "c1", Type: "CONNECTOR", ConnectorStart: &endpoint{EndpointNodeID: "A"}, ConnectorEnd: &endpoint{EndpointNodeID: "R"}},
	}}
	s := Read(root, nil, nil)
	choices := map[string]bool{}
	for _, c := range s.Choices {
		choices[c.ID] = true
	}
	if !choices["R"] || !choices["S"] || !choices["F"] || choices["P"] || choices["N"] {
		t.Errorf("decisiones: %v", choices)
	}
	laneOf := map[string]string{}
	for _, l := range s.Lanes {
		for _, sc := range l.Screens {
			laneOf[sc.ID] = l.Label
		}
	}
	if laneOf["A"] != "Pensionado" {
		t.Errorf("«Pensionado» de 50 px rotula su carril: %v", laneOf)
	}
	if laneOf["B"] == "Permiso de permanencia" {
		t.Error("una nota de 36 px sobre una pantalla no es un carril")
	}
	if _, ok := laneOf["V"]; !ok {
		t.Error("un marco con forma de pantalla y un título grande es una pantalla, no un rótulo")
	}
}

// Credifamilia: las franjas van DEBAJO del recorrido, cada una bajo su tramo; y una rama por perfil con
// su etiqueta encima gana sobre la franja de abajo.
func TestBannersBelowLabelTheirStretch(t *testing.T) {
	root := fullNode{ID: "0:1", Type: "SECTION", AbsoluteBoundingBox: &box{-10000, -5000, 30000, 12000}, Children: []fullNode{
		mobile("A", "Frame", -9000, 0, text("At", "x", "Ingresa el monto", 20, 100)),
		mobile("B", "Frame", -8000, 0, text("Bt", "x", "Ingresa el celular", 20, 100)),
		mobile("C", "Frame", 0, 0, text("Ct", "x", "Validación de identidad", 20, 100)),
		frame("E", "-", 2000, -400, 1500, 150, text("Et", "x", "Empleado", 50, -400)),
		mobile("D", "Frame", 2000, -200, text("Dt", "x", "Datos del empleo", 20, -100)),
		frame("L1", "asesor", -9500, 2300, 4800, 340, text("L1t", "x", "Asesor", 199, 2300)),
		frame("L2", "usuario", -500, 4700, 10000, 340, text("L2t", "x", "Usuario", 199, 4700)),
		frame("N", "info", -9500, -2000, 1300, 580, text("Nt", "x", "Una vez el asesor finaliza el proceso con el cliente, sigue el usuario", 50, -2000)),
	}}
	s := Read(root, nil, nil)
	laneOf := map[string]string{}
	for _, l := range s.Lanes {
		for _, sc := range l.Screens {
			laneOf[sc.ID] = l.Label
		}
	}
	if laneOf["A"] != "Asesor" || laneOf["B"] != "Asesor" || laneOf["C"] != "Usuario" {
		t.Errorf("las franjas de abajo rotulan su tramo: %v", laneOf)
	}
	if laneOf["D"] != "Empleado" {
		t.Errorf("la etiqueta de arriba gana sobre la franja de abajo: %v", laneOf)
	}
	for _, l := range s.Lanes {
		if strings.HasPrefix(l.Label, "Una vez") {
			t.Error("una nota de 70 caracteres no es un rótulo")
		}
	}
}

// En `flujo-ecommerce` la primera fila se rotula con un bloque a su IZQUIERDA y la segunda con uno
// ENCIMA, que así también queda debajo de la primera. Un rótulo que ya rotula desde arriba no rotula
// desde abajo: la primera fila sigue con el de su izquierda.
func TestALabelAboveItsRowDoesNotLabelTheRowAbove(t *testing.T) {
	root := fullNode{ID: "0:1", Type: "SECTION", AbsoluteBoundingBox: &box{-1000, -1000, 12000, 8000}, Children: []fullNode{
		frame("L1", "no paga", -1600, 300, 1464, 150, text("L1t", "x", "No paga cuota inicial", 60, 300)),
		mobile("A", "Frame", 0, 0, text("At", "x", "Ingresa el monto", 20, 100)),
		mobile("B", "Frame", 1000, 0, text("Bt", "x", "Ingresa el celular", 20, 100)),
		frame("L2", "debe pagar", 0, 2200, 1464, 150, text("L2t", "x", "Debe pagar cuota inicial", 60, 2200)),
		mobile("C", "Frame", 0, 2500, text("Ct", "x", "Paga la cuota", 20, 2600)),
	}}
	laneOf := map[string]string{}
	for _, l := range Read(root, nil, nil).Lanes {
		for _, sc := range l.Screens {
			laneOf[sc.ID] = l.Label
		}
	}
	if laneOf["A"] != "No paga cuota inicial" || laneOf["B"] != "No paga cuota inicial" || laneOf["C"] != "Debe pagar cuota inicial" {
		t.Errorf("cada fila con su rótulo: %v", laneOf)
	}
}

// La huella no depende del orden de las claves, y cambia con cualquier cambio de contenido.
func TestFingerprintFollowsContentNotKeyOrder(t *testing.T) {
	a, _ := Fingerprint([]byte(`{"id":"1:2","name":"Pago","children":[{"characters":"Continuar"}]}`))
	b, _ := Fingerprint([]byte(`{"name":"Pago","children":[{"characters":"Continuar"}],"id":"1:2"}`))
	c, _ := Fingerprint([]byte(`{"id":"1:2","name":"Pago","children":[{"characters":"Seguir"}]}`))
	if a == "" || a != b {
		t.Errorf("el orden de las claves no es contenido: %q vs %q", a, b)
	}
	if a == c {
		t.Error("otro texto es otra pantalla")
	}
	if _, err := Fingerprint([]byte(`no es json`)); err == nil {
		t.Error("lo que no es JSON no tiene huella")
	}
}

// Los tokens: el nombre sale del estilo y el valor, de los nodos que lo usan; lo que no tiene estilo va
// aparte (y si su valor es el de un estilo, lo dice); la barra de estado no cuenta; y cada uno sabe en
// cuántas pantallas aparece.
func TestTokensNameStylesAndSeparateWhatIsLoose(t *testing.T) {
	doc := []byte(`{"id":"0:1","type":"SECTION","children":[
	  {"id":"1:1","type":"FRAME","children":[
	    {"id":"1:2","type":"TEXT","styles":{"text":"T1","fill":"C1"},"fills":[{"type":"SOLID","color":{"r":0.298,"g":0.224,"b":1,"a":1}}],
	     "style":{"fontFamily":"Satoshi Variable","fontWeight":500,"fontSize":14,"lineHeightPx":21.000000953}},
	    {"id":"1:3","type":"RECTANGLE","cornerRadius":16,"fills":[{"type":"SOLID","color":{"r":0.298,"g":0.224,"b":1,"a":1}}]},
	    {"id":"1:4","type":"FRAME","name":"Status bar","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0,"a":1}}]}]},
	  {"id":"2:1","type":"FRAME","children":[
	    {"id":"2:2","type":"RECTANGLE","styles":{"fill":"C1"},"fills":[{"type":"SOLID","color":{"r":0.298,"g":0.224,"b":1,"a":1}}]},
	    {"id":"2:3","type":"RECTANGLE","visible":false,"fills":[{"type":"SOLID","color":{"r":1,"g":0,"b":0,"a":1}}]}]}]}`)
	styles := map[string]styleMeta{"C1": {Name: "Colors/morado/morado-500", StyleType: "FILL"}, "T1": {Name: "text-small/medium", StyleType: "TEXT"}}
	tk, err := ComputeTokens(doc, styles, map[string]bool{"1:1": true, "2:1": true})
	if err != nil {
		t.Fatal(err)
	}
	if len(tk.Colors) != 1 || tk.Colors[0].Var != "--morado-500" || tk.Colors[0].Value != "#4c39ff" || tk.Colors[0].Uses != 2 || tk.Colors[0].Screens != 2 {
		t.Errorf("color con estilo: %+v", tk.Colors)
	}
	if len(tk.Texts) != 1 || tk.Texts[0].Class != "text-small-medium" || tk.Texts[0].Size != 14 || tk.Texts[0].LineHeight != 21 || tk.Texts[0].Weight != 500 {
		t.Errorf("estilo de texto: %+v", tk.Texts)
	}
	if len(tk.Loose) != 1 || tk.Loose[0].Value != "#4c39ff" || tk.Loose[0].Matches != "--morado-500" {
		t.Errorf("sueltos: sólo el rectángulo sin estilo —ni la barra de estado ni lo oculto— y con su token: %+v", tk.Loose)
	}
	if len(tk.Radii) != 1 || tk.Radii[0].Value != 16 {
		t.Errorf("radios: %+v", tk.Radii)
	}
	css := tk.CSS("x")
	for _, want := range []string{"--morado-500: #4c39ff;", ".text-small-medium {", "font-family: 'Satoshi', sans-serif;", "line-height: 21px;", "es el valor de --morado-500"} {
		if !strings.Contains(css, want) {
			t.Errorf("falta %q en el CSS:\n%s", want, css)
		}
	}
	tw := tk.Tailwind("x")
	for _, want := range []string{"--color-morado-500: #4c39ff;", "--text-small-medium: 14px;", "--text-small-medium--line-height: 21px;", "--font-satoshi:", "--radius-16: 16px;"} {
		if !strings.Contains(tw, want) {
			t.Errorf("falta %q en el tema:\n%s", want, tw)
		}
	}
}

// El nombre de la variable junta las dos formas de las bibliotecas de producto, no deja un `--0`, y si
// un mismo nombre tiene dos valores, el menos usado lleva el suyo pegado.
func TestColorVarsJoinBothNamingSchemes(t *testing.T) {
	cs := []ColorToken{
		{Name: "Colors/violet/violet-500", Value: "#252256", Uses: 10}, {Name: "colors/violet/500", Value: "#252256", Uses: 3},
		{Name: "colors/neutral/0", Value: "#ffffff", Uses: 5}, {Name: "Colors/Verde creditop/verde creditop-200", Value: "#8cecc8", Uses: 1},
		{Name: "Colors/neutral/neutral-50", Value: "#fcfcfc", Uses: 6}, {Name: "Colors/neutral/neutral-50", Value: "#e6e6e6", Uses: 1},
	}
	nameColorVars(cs)
	want := []string{"--violet-500", "--violet-500", "--neutral-0", "--verde-creditop-200", "--neutral-50", "--neutral-50-e6e6e6"}
	for i, w := range want {
		if cs[i].Var != w {
			t.Errorf("%s → %s, quería %s", cs[i].Name, cs[i].Var, w)
		}
	}
	css := Tokens{Colors: cs}.CSS("x")
	if strings.Count(css, "--violet-500:") != 1 || !strings.Contains(css, "13 usos") {
		t.Errorf("el mismo token se declara una vez, con los usos sumados:\n%s", css)
	}
}

// El inventario cuenta las instancias de PRIMER nivel —el ícono de adentro de un botón es parte del
// botón—, junta las variantes con que se usa cada componente y dice en qué pantallas, en orden.
func TestInventoryCountsTopLevelComponentsWithTheirVariants(t *testing.T) {
	doc := []byte(`{"id":"0:1","type":"SECTION","children":[
	  {"id":"1:1","type":"FRAME","children":[
	    {"id":"1:2","type":"INSTANCE","name":"Botones","componentId":"B1","componentProperties":{"Estado":{"type":"VARIANT","value":"Primary button"},"name#3:4":{"type":"TEXT","value":"Continuar"},"icon#5:6":{"type":"BOOLEAN","value":false}},
	     "children":[{"id":"1:3","type":"INSTANCE","name":"icon","componentId":"I1"}]},
	    {"id":"1:4","type":"INSTANCE","name":"Status bar","componentId":"S1"}]},
	  {"id":"2:1","type":"FRAME","children":[
	    {"id":"2:2","type":"INSTANCE","name":"Botones","componentId":"B2","componentProperties":{"Estado":{"type":"VARIANT","value":"Secondary"},"icon#5:6":{"type":"BOOLEAN","value":true}}},
	    {"id":"2:3","type":"INSTANCE","name":"Check Box","componentId":"C1","componentProperties":{"tipe":{"type":"VARIANT","value":"deafult"}}}]}]}`)
	names := map[string]string{"B1": "Botones", "B2": "Botones", "I1": "icon", "C1": "Check Box"}
	inv, err := ComputeInventory(doc, names, []string{"1:1", "2:1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(inv) != 2 || inv[0].Name != "Botones" || inv[0].Uses != 2 || strings.Join(inv[0].Screens, ",") != "1:1,2:1" || inv[0].Sample != "1:2" {
		t.Fatalf("sin el ícono de adentro ni la barra de estado, el botón primero (está en más pantallas): %+v", inv)
	}
	props := map[string]PropValues{}
	for _, p := range inv[0].Props {
		props[p.Name] = p
	}
	if inv[0].Props[0].Name != "Estado" || len(props["Estado"].Values) != 2 || props["icon"].Type != "BOOLEAN" || len(props["name"].Values) != 0 {
		t.Errorf("la variante primero, con sus dos valores; el booleano sin su sufijo; el texto sin valores: %+v", inv[0].Props)
	}
}
