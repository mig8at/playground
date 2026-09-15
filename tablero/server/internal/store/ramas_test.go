package store

import "testing"

// El PR de una rama sale de `gh pr list`, que puede traer varios por rama y —con `--search head:x`—
// también ramas que sólo EMPIEZAN igual. Las dos cosas se resuelven en el índice: gana el número más
// alto, y se busca por nombre exacto.
func TestIndexarPRsGanaElMasNuevoYBuscaExacto(t *testing.T) {
	crudos := []prCrudo{
		{Number: 1043, State: "OPEN", HeadRefName: "feature/pais-como-dato", BaseRefName: "main"},
		{Number: 1126, State: "MERGED", HeadRefName: "feature/pais-como-dato-onto-develop", BaseRefName: "develop"},
		{Number: 1061, State: "MERGED", HeadRefName: "feature/pais-como-dato", BaseRefName: "qa"},
		{Number: 900, State: "CLOSED", HeadRefName: "feature/pais-como-dato", BaseRefName: "qa"},
	}
	idx := indexarPRs(crudos)
	pr := idx["feature/pais-como-dato"]
	if pr == nil || pr.Numero != 1061 {
		t.Fatalf("tenía que ganar el #1061 (el más alto de ESA rama), quedó %+v", pr)
	}
	if idx["feature/pais-como-dato-onto-develop"].Numero != 1126 {
		t.Error("la rama con sufijo es OTRA rama, no puede mezclarse con la corta")
	}
	if idx["feature/pais"] != nil {
		t.Error("buscar por prefijo no puede devolver nada: el índice es por nombre exacto")
	}
}
