package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

// Las notas se cortan por su línea «NOTA:», y el integrador marca cada pieza que nombra.
func TestNotesAndIntegration(t *testing.T) {
	got := parseNotes("intro\nNOTA: legacy-backend:a/B.php\ncambió X\n\nNOTA: frontend-monorepo:c.tsx\nnada de fondo\n")
	if len(got) != 2 || !strings.Contains(got["legacy-backend:a/B.php"], "cambió X") || strings.Contains(got["legacy-backend:a/B.php"], "nada de fondo") {
		t.Fatalf("las notas quedaron mal: %q", got)
	}
	m := reIntegration.FindStringSubmatch("INTEGRACIÓN: P3, P12 | cuentan distinto el tope | P12 enlaza a P3")
	if m == nil || len(reID.FindAllString(m[1], -1)) != 2 || !strings.Contains(m[2], "enlaza") {
		t.Fatalf("no se leyó la integración: %v", m)
	}
	if reIntegration.FindStringSubmatch("INTEGRACIÓN: ninguna") != nil {
		t.Fatal("«ninguna» no es un problema")
	}
	shared := sharedChanges(canonWork{
		"a": {{Topic: "a", Repo: "r", Path: "x"}, {Topic: "a", Repo: "r", Path: "solo"}},
		"b": {{Topic: "b", Repo: "r", Path: "x"}},
	}, []string{"a"})
	if len(shared) != 1 || len(shared["r:x"]) != 2 {
		t.Fatalf("compartidos mal: %v", shared)
	}
}

// Un verificador que escribe el veredicto en negrita sigue contando (pasó el 2026-11-05 y dejó dos piezas sin veredicto).
func TestVerdictInBold(t *testing.T) {
	m := reVerdict.FindStringSubmatch("**VEREDICTO: P1 | ✗ | git show x | la sección dice otra cosa**")
	if m == nil || m[1] != "P1" || m[2] != "✗" || strings.HasSuffix(m[3], "*") {
		t.Fatalf("no se leyó el veredicto en negrita: %q", m)
	}
}

// La lista de barridos anteriores guarda el resumen de cada archivo mientras no cambie, lo vuelve a leer si cambia y
// olvida el que se borró.
func TestHistoryCache(t *testing.T) {
	root := t.TempDir()
	write := func(id, body string, mod time.Time) string {
		dir := filepath.Join(root, "sala", ".barridos", id)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, "barrido.json")
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, mod, mod); err != nil {
			t.Fatal(err)
		}
		return path
	}
	t0 := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	a := write("20261101-100000", `{"agents":[{"topic":"cuota"}],"findings":[{"verdict":"✓"},{"verdict":"✗"}],"cost":1.5}`, t0)
	write("20261102-100000", `{"agents":[{"topic":"otp"}],"findings":[],"mock":true}`, t0)
	write("20261103-100000", `{roto`, t0)

	got := history(root)
	if len(got) != 2 || got[0].ID != "20261102-100000" || got[1].Topics != "cuota" || got[1].Findings != 2 || got[1].Verified != 1 || got[1].Cost != 1.5 {
		t.Fatalf("la lista salió mal: %+v", got)
	}
	// Sin cambios en disco, sale lo mismo (de la caché).
	if again := history(root); len(again) != 2 || again[1] != got[1] {
		t.Fatalf("la segunda lectura cambió: %+v", again)
	}
	// Un archivo que cambia (otra fecha) se vuelve a leer.
	write("20261101-100000", `{"agents":[{"topic":"cuota"}],"findings":[{"verdict":"✓"}],"cost":2}`, t0.Add(time.Hour))
	if got = history(root); got[1].Findings != 1 || got[1].Cost != 2 {
		t.Fatalf("no releyó el archivo cambiado: %+v", got[1])
	}
	// Uno que se borra sale de la lista.
	if err := os.Remove(a); err != nil {
		t.Fatal(err)
	}
	if got = history(root); len(got) != 1 || got[0].ID != "20261102-100000" {
		t.Fatalf("el borrado sigue en la lista: %+v", got)
	}
}
