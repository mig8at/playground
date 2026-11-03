package main

import (
	"strings"
	"testing"
)

// El verificador de la llamada real escribió «COMPRUEBO: C2 · descripción | — | …»: con o sin descripción tiene que
// leerse, y una línea que no es una comprobación no.
func TestCheckLineTolerant(t *testing.T) {
	cases := map[string][2]string{
		"COMPRUEBO: C2 | ✓ | git grep x":                          {"C2", "✓"},
		"COMPRUEBO: C2 · el ambiente local no está listo | — | x": {"C2", "—"},
		"COMPRUEBO: C1 (los archivos de S1 y S3) | ✗ | git ls":    {"C1", "✗"},
	}
	for line, want := range cases {
		m := reCheck.FindStringSubmatch(line)
		if m == nil || m[1] != want[0] || m[2] != want[1] {
			t.Errorf("%q: quería %v, vino %v", line, want, m)
		}
	}
	if reCheck.MatchString("COMPRUEBO: después veo") {
		t.Error("una línea sin id ni marca no es una comprobación")
	}
}

// Un hallazgo partido en viñetas sigue siendo uno; lo que viene después de la lista no se le pega.
func TestParseFindings(t *testing.T) {
	text := "Intro.\n\nHALLAZGO: hueco | uno | tema | COMANDO: a\n" +
		"HALLAZGO: contradicción | dos, en partes:\n- `A.php:3`\n- `B.php:9`\n\nDestino: tema | COMANDO: b\n" +
		"Lo que miré y está bien:\n- nada raro\n\nPREGUNTA: ¿y esto?"
	got := parseFindings(text)
	if len(got) != 2 {
		t.Fatalf("quería 2 hallazgos, salieron %d: %q", len(got), got)
	}
	if !strings.Contains(got[1], "B.php:9") || !strings.Contains(got[1], "COMANDO: b") || strings.Contains(got[1], "nada raro") {
		t.Fatalf("el segundo quedó mal armado: %q", got[1])
	}
}
