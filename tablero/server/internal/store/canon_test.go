package store

import "testing"

func TestCanonUsesSoloReconoceEvidenciaExplicita(t *testing.T) {
	cuerpo := `
La tarea declara canon, pero eso no prueba que alguien lo haya leído.

> **CANON · 2026-09-22 · leído · validado** — ` + "`" + `listado/context#por-donde-pasa-todo` + "`" + ` — Se usó para dejar el filtro en el loader.
> **CANON · 2026-09-21 · leído** — ` + "`" + `onboarding/context#nacimiento` + "`" + ` — Confirmó dónde nace la solicitud.
`
	uses := CanonUses(cuerpo)
	if len(uses) != 2 {
		t.Fatalf("usos = %+v", uses)
	}
	if !uses[0].Leido || !uses[0].Validado || uses[0].Referencia != "listado/context#por-donde-pasa-todo" {
		t.Fatalf("primer uso = %+v", uses[0])
	}
	if !uses[1].Leido || uses[1].Validado || uses[1].Uso != "Confirmó dónde nace la solicitud." {
		t.Fatalf("segundo uso = %+v", uses[1])
	}
}
