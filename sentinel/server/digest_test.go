package main

import (
	"strings"
	"testing"
)

// Lo que no sale de la Mac aunque se cuele en un texto: el paquete va a una cuenta de consumidor de AI Studio.
func TestScrub(t *testing.T) {
	in := "Mirá la solicitud 637606 y ureq=642392; cédula 1020744247, celular 3044208718, correo ana.perez+x@gmail.com. Versión v0.6.67, 20 errores a las 21:02."
	out := scrub(in)
	for _, leak := range []string{"637606", "642392", "1020744247", "3044208718", "ana.perez", "gmail.com"} {
		if strings.Contains(out, leak) {
			t.Errorf("se coló %q: %s", leak, out)
		}
	}
	// Lo que sí sirve queda: versiones, conteos y horas.
	for _, keep := range []string{"v0.6.67", "20 errores", "21:02"} {
		if !strings.Contains(out, keep) {
			t.Errorf("se perdió %q: %s", keep, out)
		}
	}
}

func TestScrubSecrets(t *testing.T) {
	in := "+API_KEY=sk_live_abc123456789\n+    'password' => 'Sup3rS3creto!',\n+CLIENT_SECRET: \"xyzxyzxyz123\"\n+$timeout = 30;"
	out := scrubSecrets(in)
	for _, leak := range []string{"sk_live_abc123456789", "Sup3rS3creto!", "xyzxyzxyz123"} {
		if strings.Contains(out, leak) {
			t.Errorf("se coló %q: %s", leak, out)
		}
	}
	if !strings.Contains(out, "$timeout = 30;") {
		t.Errorf("lo que no es secreto queda: %s", out)
	}
}
