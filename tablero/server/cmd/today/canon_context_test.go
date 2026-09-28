package main

import (
	"errors"
	"reflect"
	"testing"

	"creditop/playground/connectors/canon"
)

// Un tema declarado que canon no tiene NO se manda —canon lo ignora en silencio— y se reporta; las citas
// con ancla se reducen a su tema, sin repetirlo.
func TestCanonContextValidatesDeclaredTopics(t *testing.T) {
	var sent canon.ContextRequest
	fetch := func(r canon.ContextRequest) (canon.ContextPackage, error) {
		sent = r
		return canon.ContextPackage{}, nil
	}
	known := map[string]bool{"kyc": true, "preaprobado": true}
	c := buildCanonContext([]string{"motai", "kyc", "kyc/context#ancla", "preaprobado"}, "q", false, known, 5000, fetch)
	if !reflect.DeepEqual(c.Unknown, []string{"motai"}) || !reflect.DeepEqual(sent.Topics, []string{"kyc/context", "preaprobado/context"}) || sent.MaxBytes != 5000 {
		t.Fatalf("desconocidos %v, mandados %v", c.Unknown, sent.Topics)
	}
	// ninguno existe y no hay consulta propia: NO se busca (el título no es una pregunta)
	sent = canon.ContextRequest{Q: "sin pedir"}
	c = buildCanonContext([]string{"altas"}, "q", false, known, 5000, fetch)
	if !c.Skipped || sent.Q != "sin pedir" {
		t.Fatalf("sin temas válidos buscó igual: %+v %+v", c, sent)
	}
	// con consulta propia sí, en todo el corpus
	c = buildCanonContext([]string{"altas"}, "cuota", true, known, 5000, fetch)
	if c.Skipped || len(sent.Topics) != 0 || sent.Q != "cuota" {
		t.Fatalf("con consulta propia: %+v %+v", c, sent)
	}
	// sin copia local no se puede validar: se manda todo y se avisa
	c = buildCanonContext([]string{"altas"}, "q", false, nil, 5000, fetch)
	if !c.Offline || len(sent.Topics) != 1 {
		t.Fatalf("sin copia: %+v", c)
	}
	// un error de canon se devuelve, no se calla
	c = buildCanonContext([]string{"kyc"}, "q", false, known, 5000, func(canon.ContextRequest) (canon.ContextPackage, error) {
		return canon.ContextPackage{}, errors.New("sin VPN")
	})
	if c.Error != "sin VPN" || c.Package != nil {
		t.Fatalf("error: %+v", c)
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

func TestSectionBodyDropsCommentAndHeading(t *testing.T) {
	if got := sectionBody("<!-- canon -->\n## Título\n\ncuerpo"); got != "cuerpo" {
		t.Fatalf("%q", got)
	}
}
