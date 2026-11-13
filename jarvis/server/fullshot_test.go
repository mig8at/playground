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

func TestEachScrollStepIsAPageAndTheLastOneKeepsOnlyWhatIsNew(t *testing.T) {
	// El contenido del panel mide 100 px: rojo hasta 50, azul de 50 en adelante. El panel se ve en (20,10) de 60×40,
	// en una ventana de 100 px de ancho (fotos a 1x: k = 1).
	colorAt := func(y int) color.RGBA {
		if y < 50 {
			return color.RGBA{255, 0, 0, 255}
		}
		return color.RGBA{0, 0, 255, 255}
	}
	sc := scroller{Found: true, X: 20, Y: 10, W: 60, H: 40, ScrollHeight: 100, ViewportW: 100}
	// Paso de 40 − 48 de solape → la mitad (20): 0, 20, 40 y la última frenada en 60.
	shots := []piece{
		{png: viewportShot(t, 0, colorAt), top: 0},
		{png: viewportShot(t, 20, colorAt), top: 20},
		{png: viewportShot(t, 40, colorAt), top: 40},
		{png: viewportShot(t, 60, colorAt), top: 60},
	}
	out, err := pages(shots, sc)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 4 {
		t.Fatalf("una página por foto: %d", len(out))
	}
	first, _ := png.Decode(bytes.NewReader(out[0]))
	if b := first.Bounds(); b.Dx() != 60 || b.Dy() != 40 {
		t.Fatalf("la página es el rectángulo del panel (60×40), sin la barra de arriba: %v", b)
	}
	r, _, _, _ := first.At(5, 5).RGBA()
	if uint8(r>>8) != 255 {
		t.Error("la primera página arranca en el contenido de arriba (rojo)")
	}
	for i, p := range out {
		img, _ := png.Decode(bytes.NewReader(p))
		if img.Bounds().Dy() > 40 {
			t.Errorf("la página %d mide más que el panel", i+1)
		}
	}
}

func TestPagesKeepTheScreenResolution(t *testing.T) {
	// Una foto a 2x: la ventana mide 50 px CSS de ancho y la foto 100. El panel (10,5) de 30×20 CSS sale de 60×40.
	sc := scroller{Found: true, X: 10, Y: 5, W: 30, H: 20, ScrollHeight: 20, ViewportW: 50}
	shot := viewportShot(t, 0, func(int) color.RGBA { return color.RGBA{0, 255, 0, 255} })
	out, err := pages([]piece{{png: shot, top: 0}}, sc)
	if err != nil {
		t.Fatal(err)
	}
	img, _ := png.Decode(bytes.NewReader(out[0]))
	if b := img.Bounds(); b.Dx() != 60 || b.Dy() != 40 {
		t.Fatalf("a 2x la página sale al doble: %v", b)
	}
}

func TestPagesWithoutShotsFail(t *testing.T) {
	if _, err := pages(nil, scroller{W: 10, H: 10}); err == nil {
		t.Fatal("sin fotos no hay páginas")
	}
}
