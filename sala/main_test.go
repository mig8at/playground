package main

import (
	"strings"
	"testing"
)

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

// El verificador escribe una línea por hallazgo; el veredicto y lo que vio tienen que leerse.
func TestVerdictLine(t *testing.T) {
	m := reVerdict.FindStringSubmatch("VEREDICTO: H12 | ✗ | git -C x show origin/main:a.php | el comentario no dice eso")
	if m == nil || m[1] != "H12" || m[2] != "✗" || !strings.Contains(m[3], "no dice eso") {
		t.Fatalf("no se leyó el veredicto: %v", m)
	}
}

// Las piezas salen de los bloques ```pieza; un JSON roto no cuenta, y la etiqueta lleva tema, sección y archivos.
func TestParsePieces(t *testing.T) {
	text := mockCanonPieces("cuota") + "\n```pieza\n{roto\n```\n"
	got := parsePieces(text)
	if len(got) != 2 {
		t.Fatalf("quería 2 piezas, salieron %d", len(got))
	}
	if kind, _ := pieceLabel(got[0]); kind != "verificado" {
		t.Fatalf("la primera es un verificado, salió %q", kind)
	}
	kind, label := pieceLabel(got[1])
	if kind != "correction" || !strings.Contains(label, "«Regla simulada»") || !strings.Contains(label, "legacy-backend:app/Y.php") {
		t.Fatalf("la segunda quedó mal: %q %q", kind, label)
	}
	if m := reVerdict.FindStringSubmatch("VEREDICTO: P2 | ✓ | git show | sigue"); m == nil || m[1] != "P2" {
		t.Fatalf("no se leyó el veredicto de una pieza: %v", m)
	}
}
