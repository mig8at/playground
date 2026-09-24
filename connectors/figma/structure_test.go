package figma

import (
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
	if s.Links[1].Via != "sola, después de un tiempo" {
		t.Errorf("la pantalla que avanza sola no nombra un elemento (antes decía «desde «11:28»», la hora de la barra): %+v", s.Links[1])
	}
}
