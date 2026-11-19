package main

import "testing"

// parse lee lo que devuelve Qwen3-VL, también con el número entre comillas, y los negativos son «no está».
func TestParse(t *testing.T) {
	cases := map[string][2]float64{
		`{"x": 500, "y": 710}`:  {500, 710},
		`{"x": "898", "y": 41}`: {898, 41},
		`{"x": -1, "y": -1}`:    {-1, -1},
		"Click at 120, 340":     {120, 340},
	}
	for in, want := range cases {
		x, y, ok := parse(in)
		if !ok || x != want[0] || y != want[1] {
			t.Errorf("%q → %v %v %v", in, x, y, ok)
		}
	}
	if _, _, ok := parse("no sé"); ok {
		t.Error("sin números no hay punto")
	}
}

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
