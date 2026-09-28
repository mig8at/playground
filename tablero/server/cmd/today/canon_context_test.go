package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// mirror arma una copia local mínima: `kyc` y `preaprobado`, con su manifiesto.
func mirror(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write := func(rel, body string) {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("VERSION.json", `{"etag":"\"v1\"","sha256":"x"}`)
	write("content/kyc/context.md", "# KYC\n\n## El ingreso declarado casi nunca decide\n\nEl ingreso que declara la persona no decide.\n\n## Otra cosa\n\nNada que ver.\n")
	write("content/preaprobado/context.md", "# Preaprobado\n\n## La compuerta\n\nCon el ingreso validado se consulta.\n")
	return dir
}

// Un tema declarado que la copia no tiene NO se busca —canon lo ignoraba en silencio— y se avisa; las
// citas con ancla se reducen a su tema, sin repetirlo.
func TestCanonContextValidatesDeclaredTopics(t *testing.T) {
	dir := mirror(t)
	c := buildCanonContext([]string{"motai", "kyc", "kyc/context#ancla", "preaprobado"}, "ingreso", false, dir, 5000)
	if !reflect.DeepEqual(c.Unknown, []string{"motai"}) || !reflect.DeepEqual(c.Topics, []string{"kyc", "preaprobado"}) {
		t.Fatalf("desconocidos %v, buscados %v", c.Unknown, c.Topics)
	}
	if len(c.Sections) != 2 || c.Sections[0].ID != "kyc/context#el-ingreso-declarado-casi-nunca-decide" {
		t.Fatalf("secciones: %+v", c.Sections)
	}
	// ninguno existe y no hay consulta propia: NO se busca (el título no es una pregunta)
	c = buildCanonContext([]string{"altas"}, "ingreso", false, dir, 5000)
	if !c.Skipped || len(c.Sections) != 0 {
		t.Fatalf("sin temas válidos buscó igual: %+v", c)
	}
	// con consulta propia sí, en todo el corpus
	c = buildCanonContext([]string{"altas"}, "compuerta", true, dir, 5000)
	if c.Skipped || len(c.Sections) != 1 || c.Sections[0].ID != "preaprobado/context#la-compuerta" {
		t.Fatalf("con consulta propia: %+v", c)
	}
	// sin copia local no hay nada que leer, y se dice
	if c := buildCanonContext([]string{"kyc"}, "ingreso", false, t.TempDir(), 5000); !c.Offline {
		t.Fatalf("sin copia: %+v", c)
	}
	// lo que no entra en el presupuesto queda pendiente, por su cita
	c = buildCanonContext([]string{"kyc", "preaprobado"}, "ingreso", false, dir, 60)
	if len(c.Sections) != 1 || len(c.Pending) != 1 {
		t.Fatalf("presupuesto: %+v", c)
	}
}

func TestTaskQueryAddsTheSummary(t *testing.T) {
	body := "intro\n\n## Objetivo\n\nobj\n\n## Tarea (publicable)\n\n## En una línea\n\n<!-- guía -->\nQue la entidad pida\ningresos.\n\nmás\n## Por qué\nx"
	if got := taskQuery(task{Title: "T", Body: body}); got != "T Que la entidad pida ingresos." {
		t.Fatalf("query %q", got)
	}
	if got := taskQuery(task{Title: "T", Body: "## Objetivo\nobj uno\n"}); got != "T obj uno" {
		t.Fatalf("query %q", got)
	}
	if got := taskQuery(task{Title: "T", Body: "nada"}); got != "T" {
		t.Fatalf("query %q", got)
	}
}
