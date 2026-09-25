package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"creditop/playground/visor/render"
)

// El pedazo de HTML de una capa es su elemento con todo lo de adentro: los <div> anidados cuentan, un
// <divider> no es un <div>, y una imagen termina en su propia etiqueta.
func TestHTMLFragmentTakesTheWholeElement(t *testing.T) {
	doc := `<body><div data-figma="1:1" style="a"><div data-figma="1:2"><div data-figma="1:3">x</div><divider></divider></div>` +
		`<img data-figma="I1:4;5:6" src="s"></div><div data-figma="1:9">después</div></body>`
	if got := htmlFragment(doc, "1:2"); got != `<div data-figma="1:2"><div data-figma="1:3">x</div><divider></divider></div>` {
		t.Errorf("el div con sus hijos: %s", got)
	}
	if got := htmlFragment(doc, "I1:4;5:6"); got != `<img data-figma="I1:4;5:6" src="s">` {
		t.Errorf("una imagen es su etiqueta: %s", got)
	}
	if got := htmlFragment(doc, "1:1"); !strings.HasSuffix(got, `src="s"></div>`) || strings.Contains(got, "después") {
		t.Errorf("el de afuera termina en su cierre, no en el del hermano: %s", got)
	}
	if htmlFragment(doc, "7:7") != "" {
		t.Error("una capa que el HTML no dibuja no tiene pedazo")
	}
}

// Las cajas son de las capas VISIBLES, relativas a la pantalla, sin la pantalla misma; el detalle dice por
// dónde se llega a la capa, y una capa que ya no existe es un error propio (el enlace la nombra igual).
func TestLayerBoxesAndDetail(t *testing.T) {
	screen := `{"id":"1:1","name":"Pantalla","type":"FRAME","absoluteBoundingBox":{"x":1000,"y":2000,"width":430,"height":932},"children":[
	  {"id":"1:2","name":"Card","type":"FRAME","layoutMode":"VERTICAL","itemSpacing":8,"paddingTop":16,"absoluteBoundingBox":{"x":1016,"y":2100,"width":398,"height":200},
	   "fills":[{"type":"SOLID","color":{"r":1,"g":1,"b":1,"a":1}}],"children":[
	    {"id":"I1:3;9:9","name":"Título","type":"TEXT","characters":"Hola","absoluteBoundingBox":{"x":1032,"y":2116,"width":100,"height":24},
	     "style":{"fontFamily":"Satoshi","fontWeight":700,"fontSize":20,"lineHeightPx":30}}]},
	  {"id":"1:4","name":"Oculta","type":"RECTANGLE","visible":false,"absoluteBoundingBox":{"x":1000,"y":2000,"width":10,"height":10}}]}`
	s := newServer(nil, t.TempDir())
	s.nodeJSON = func(context.Context, string, string) ([]byte, error) { return []byte(screen), nil }
	n, _, err := s.screenNode(context.Background(), "KKKKKKKKKK", "1:1")
	if err != nil {
		t.Fatal(err)
	}
	boxes := layerBoxes(n)
	if len(boxes) != 2 || boxes[0].ID != "1:2" || boxes[0].X != 16 || boxes[0].Y != 100 || boxes[1].Depth != 2 {
		t.Fatalf("dos capas visibles, relativas a la pantalla: %+v", boxes)
	}
	d, err := s.layerDetail(context.Background(), "KKKKKKKKKK", "1:1", "I1:3;9:9")
	if err != nil {
		t.Fatal(err)
	}
	if d.Text != "Hola" || strings.Join(d.Path, " › ") != "Pantalla › Card" || d.X != 32 || d.Y != 116 {
		t.Errorf("qué es y por dónde se llega: %+v", d)
	}
	if !strings.Contains(d.HTML, `data-figma="I1:3;9:9"`) || !strings.Contains(d.HTML, "Hola") {
		t.Errorf("el pedazo de HTML que la dibuja: %s", d.HTML)
	}
	facts := map[string]string{}
	for _, f := range d.Facts {
		facts[f.Label] = f.Value
	}
	if facts["Letra"] != "Satoshi 700 · 20/30" {
		t.Errorf("lo que dice Figma de la letra: %+v", d.Facts)
	}
	// El mismo estilo por las dos vías con que Figma lo nombra sale una sola vez.
	if got := layerFacts(render.Node{Fills: []render.Paint{{Type: "SOLID", Color: &render.Color{R: 1, G: 1, B: 1, A: 1}}},
		Styles: map[string]string{"fill": "S1", "fills": "S1"}}, map[string]render.StyleToken{"S1": {Name: "colors/rojo/50"}}); len(got) != 1 || got[0].Value != "#ffffff (colors/rojo/50)" {
		t.Errorf("el token del relleno, una vez: %+v", got)
	}
	card, _ := s.layerDetail(context.Background(), "KKKKKKKKKK", "1:1", "1:2")
	if !strings.Contains(card.Facts[0].Value, "en columna · separación 8") {
		t.Errorf("el auto-layout de la tarjeta: %+v", card.Facts)
	}
	var gone errNoLayer
	if _, err := s.layerDetail(context.Background(), "KKKKKKKKKK", "1:1", "5:5"); !errors.As(err, &gone) {
		t.Errorf("una capa que ya no está es su propio error: %v", err)
	}
	if !reLayerID.MatchString("I1:3;9:9") || !reLayerID.MatchString("1:2") || reLayerID.MatchString("1:2;x") {
		t.Error("el id de capa acepta los de instancia y nada más")
	}
}
