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
