package main

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
)

var markColor = color.RGBA{230, 30, 90, 255}

// mark guarda una copia PNG de la imagen con el recuadro (si lo hay) y el punto: un círculo con una cruz.
func mark(data []byte, path string, a answer) error {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return err
	}
	img := image.NewRGBA(src.Bounds())
	draw.Draw(img, img.Bounds(), src, src.Bounds().Min, draw.Src)
	if len(a.Box) == 4 {
		rect(img, a.Box[0], a.Box[1], a.Box[2], a.Box[3], 3)
	}
	// un punto lleno con borde blanco: se ve sobre cualquier color, también sobre un botón del mismo tono
	disc(img, a.X, a.Y, 10, color.RGBA{255, 255, 255, 255})
	disc(img, a.X, a.Y, 7, markColor)
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

func dot(img *image.RGBA, x, y int) { set(img, x, y, markColor) }

func set(img *image.RGBA, x, y int, c color.Color) {
	if (image.Point{x, y}).In(img.Bounds()) {
		img.Set(x, y, c)
	}
}

func disc(img *image.RGBA, cx, cy, r int, c color.Color) {
	for y := cy - r; y <= cy+r; y++ {
		for x := cx - r; x <= cx+r; x++ {
			if (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r {
				set(img, x, y, c)
			}
		}
	}
}

func rect(img *image.RGBA, x1, y1, x2, y2, width int) {
	for w := 0; w < width; w++ {
		for x := x1; x <= x2; x++ {
			dot(img, x, y1+w)
			dot(img, x, y2-w)
		}
		for y := y1; y <= y2; y++ {
			dot(img, x1+w, y)
			dot(img, x2-w, y)
		}
	}
}
