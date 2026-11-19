package main

import "testing"

// toPixels pasa de 0–1000 al tamaño real, sin salirse de la imagen.
func TestToPixels(t *testing.T) {
	if got := toPixels(500, 1280); got != 640 {
		t.Errorf("500 → %d", got)
	}
	if got := toPixels(1000, 800); got != 799 {
		t.Errorf("1000 → %d", got)
	}
	if got := toPixels(1149, 1280); got != 1149 {
		t.Errorf("en píxeles → %d", got)
	}
}

// parseBox ordena el recuadro y distingue «no está» de una respuesta que no se entiende.
func TestParseBox(t *testing.T) {
	b, ok := parseBox(`{"bbox_2d": [700, 360, 640, 330]}`)
	if !ok || b[0] != 640 || b[1] != 330 || b[2] != 700 || b[3] != 360 {
		t.Fatalf("%v %v", b, ok)
	}
	if b, ok := parseBox(`{"bbox_2d": []}`); !ok || b != nil {
		t.Fatalf("vacío: %v %v", b, ok)
	}
	if _, ok := parseBox("no sé"); ok {
		t.Fatal("sin recuadro no se entiende")
	}
}
