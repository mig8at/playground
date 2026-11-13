package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// viewportShot arma una «foto de la ventana» de 100×60: arriba 10 px de barra (gris) que no es parte del panel, y el
// panel de 40 px de alto (y 10..50) pintado con el color de la franja que se ve a esa altura del contenido.
func viewportShot(t *testing.T, top int, colorAt func(y int) color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 100, 60))
	for y := 0; y < 60; y++ {
		for x := 0; x < 100; x++ {
			c := color.RGBA{128, 128, 128, 255}
			if y >= 10 && y < 50 && x >= 20 && x < 80 {
				c = colorAt(top + y - 10)
			}
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestStitchPastesEachPieceOfThePanelAtItsScrollTop(t *testing.T) {
	// El contenido del panel mide 100 px: rojo hasta 50, azul de 50 en adelante. El panel se ve en (20,10) de 60×40.
	colorAt := func(y int) color.RGBA {
		if y < 50 {
			return color.RGBA{255, 0, 0, 255}
		}
		return color.RGBA{0, 0, 255, 255}
	}
	sc := scroller{Found: true, X: 20, Y: 10, W: 60, H: 40, ScrollHeight: 100}
	// Bajando de a 40: 0, 40 y el último queda en 60 (el navegador lo recorta al fondo).
	pieces := []piece{
		{png: viewportShot(t, 0, colorAt), top: 0},
		{png: viewportShot(t, 40, colorAt), top: 40},
		{png: viewportShot(t, 60, colorAt), top: 60},
	}
	out, err := stitch(pieces, sc, 100)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 60 || b.Dy() != 100 {
		t.Fatalf("la imagen mide %v; tiene que medir lo que el panel (60×100), sin la barra de arriba", b)
	}
	for _, c := range []struct {
		y    int
		want color.RGBA
	}{{0, colorAt(0)}, {49, colorAt(49)}, {50, colorAt(50)}, {99, colorAt(99)}} {
		r, g, b, _ := img.At(30, c.y).RGBA()
		if uint8(r>>8) != c.want.R || uint8(g>>8) != c.want.G || uint8(b>>8) != c.want.B {
			t.Errorf("y=%d: el color no es el del contenido a esa altura", c.y)
		}
	}
}

func TestStitchWithoutPiecesFails(t *testing.T) {
	if _, err := stitch(nil, scroller{W: 10, H: 10}, 10); err == nil {
		t.Fatal("sin fotos no hay imagen")
	}
}
