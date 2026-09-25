package main

import (
	"testing"

	"creditop/playground/visor/render"
)

// La diferencia se le cuenta a la capa MÁS CHICA que contiene la celda: el texto adentro del botón se
// lleva lo suyo, el botón lo que queda afuera del texto, y lo que no cae en ninguna capa es del fondo. Una
// capa oculta no se lleva nada, aunque esté encima.
func TestAttributeGoesToTheSmallestLayer(t *testing.T) {
	hidden := false
	rect := func(x, y, w, h float64) *render.Rect { return &render.Rect{X: 1000 + x, Y: 2000 + y, Width: w, Height: h} }
	screen := render.Node{ID: "1", Type: "FRAME", Box: rect(0, 0, 40, 40), Children: []render.Node{
		{ID: "2", Name: "Botón", Type: "INSTANCE", Box: rect(0, 0, 40, 20), Children: []render.Node{
			{ID: "3", Name: "Etiqueta", Type: "TEXT", Characters: "Iniciar\n  solicitud", Box: rect(10, 10, 20, 10)},
		}},
		{ID: "4", Name: "Oculta", Type: "RECTANGLE", Visible: &hidden, Box: rect(0, 20, 40, 20)},
	}}
	// Celdas de 10 px: una grilla de 4×4.
	grid := make([]byte, 16)
	grid[1*4+1] = 255 // centro (15,15): dentro del texto
	grid[1*4+2] = 255 // (25,15): también del texto
	grid[0*4+0] = 255 // (5,5): en el botón, afuera del texto
	grid[3*4+3] = 255 // (35,35): cae en la oculta → fondo
	zones := attribute(screen, grid, 4, 4, 10)
	if len(zones) != 3 {
		t.Fatalf("tres zonas, dio %+v", zones)
	}
	if zones[0].ID != "3" || zones[0].Share != 0.5 || zones[0].Text != "Iniciar solicitud" || zones[0].X != 10 || zones[0].Y != 10 {
		t.Errorf("el texto se lleva la mitad, con su caja relativa a la pantalla: %+v", zones[0])
	}
	if zones[0].Cover != 1 {
		t.Errorf("las dos celdas cubren todo el texto (200 px de 200): %v", zones[0].Cover)
	}
	byID := map[string]zone{}
	for _, z := range zones {
		byID[z.ID] = z
	}
	if zones[0].Parent != "Botón" {
		t.Errorf("la zona dice en qué capa con nombre propio está: %q", zones[0].Parent)
	}
	if byID["2"].Share != 0.25 || byID["1"].Name != "fondo de la pantalla" || byID["1"].Share != 0.25 {
		t.Errorf("botón y fondo, un cuarto cada uno: %+v", zones)
	}
	if _, ok := byID["4"]; ok {
		t.Errorf("una capa oculta no se lleva diferencia: %+v", zones)
	}
	if attribute(screen, make([]byte, 16), 4, 4, 10) != nil {
		t.Errorf("sin diferencia no hay zonas")
	}
}
