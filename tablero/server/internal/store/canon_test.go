package store

import "testing"

func TestCanonUsesOnlyRecognizesExplicitEvidence(t *testing.T) {
	body := `
La tarea declara canon, pero eso no prueba que alguien lo haya leído.

> **CANON · 2026-09-22 · leído · validado** — ` + "`" + `listado/context#por-donde-pasa-todo` + "`" + ` — Se usó para dejar el filtro en el loader.
> **CANON · 2026-09-21 · leído** — ` + "`" + `onboarding/context#nacimiento` + "`" + ` — Confirmó dónde nace la solicitud.
`
	uses := CanonUses(body)
	if len(uses) != 2 {
		t.Fatalf("usos = %+v", uses)
	}
	if !uses[0].Read || !uses[0].Validated || uses[0].Reference != "listado/context#por-donde-pasa-todo" {
		t.Fatalf("primer uso = %+v", uses[0])
	}
	if !uses[1].Read || uses[1].Validated || uses[1].Usage != "Confirmó dónde nace la solicitud." {
		t.Fatalf("segundo uso = %+v", uses[1])
	}
}
