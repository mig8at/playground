package admin

import (
	"bytes"
	"image/png"
	"testing"
)

func TestAvatarLetter(t *testing.T) {
	cases := map[string]rune{
		"PRUEBA AUTO BUSINESS_FINANDINA": 'B',
		"BUSINESS_FINANDINA":             'B',
		"  Ñandú Motos":                  'N',
		"Éxito":                          'E',
		"123 Tienda":                     '1',
		"___":                            '?',
	}
	for name, want := range cases {
		if got := avatarLetter(name); got != want {
			t.Errorf("avatarLetter(%q) = %q, quiero %q", name, got, want)
		}
	}
}

func TestLetterAvatarIsAStablePNG(t *testing.T) {
	a := LetterAvatar("PRUEBA AUTO Finandina")
	img, err := png.Decode(bytes.NewReader(a))
	if err != nil {
		t.Fatalf("no es un PNG: %v", err)
	}
	if b := img.Bounds(); b.Dx() != avatarSize || b.Dy() != avatarSize {
		t.Fatalf("tamaño %v", b)
	}
	// El centro es la letra (blanco) o el fondo; la esquina queda transparente (fuera del círculo).
	if _, _, _, alpha := img.At(0, 0).RGBA(); alpha != 0 {
		t.Errorf("la esquina debería ser transparente")
	}
	if !bytes.Equal(a, LetterAvatar("Finandina")) {
		t.Errorf("el prefijo de la automatización no debería cambiar el logo")
	}
	if avatarColor("Finandina") != avatarColor("PRUEBA AUTO Finandina") {
		t.Errorf("el color debería ser estable")
	}
}
