package journeys

import (
	"path/filepath"
	"strings"
	"testing"
)

// El catálogo real del harness: si alguien renombra una clave allá, estas pruebas lo dicen acá.
func catalog(t *testing.T) Catalog {
	t.Helper()
	c, err := Load(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatalf("no pude leer el catálogo: %v", err)
	}
	return c
}

func TestParse(t *testing.T) {
	c := catalog(t)
	cases := []struct {
		name   string
		tokens []string
		fit    Fit
		errs   int
	}{
		{"credifamilia encaja", []string{"advisor|self-service", "riel-4", "credit", "+dynamic-form", "formalizacion:radicacion"}, Fits, 0},
		{"finandina con una entrega nueva", []string{"advisor", "riel-4", "credit", "formalizacion:nueva-entrega-finandina"}, FitsWithVariation, 0},
		{"una variación nueva", []string{"store", "riel-2", "+nueva-garantia"}, FitsWithVariation, 0},
		{"un canal nuevo", []string{"nuevo-whatsapp", "riel-2"}, NewJourney, 0},
		{"un riel nuevo", []string{"advisor", "riel-nuevo-leasing"}, NewJourney, 0},
		{"un tipeo no es una novedad", []string{"advisor", "riel-4", "+abacco"}, Fits, 1},
		{"sin canal ni riel", []string{"credit"}, Fits, 2},
		{"formalización fuera del riel 4", []string{"advisor", "riel-2", "formalizacion:radicacion"}, Fits, 1},
	}
	for _, tc := range cases {
		r, errs := Parse(c, tc.tokens)
		if len(errs) != tc.errs {
			t.Errorf("%s: %d errores, quería %d: %s", tc.name, len(errs), tc.errs, strings.Join(errs, " | "))
			continue
		}
		if tc.errs == 0 && r.Fit != tc.fit {
			t.Errorf("%s: fit %s, quería %s", tc.name, r.Fit, tc.fit)
		}
	}
}

func TestLineUsesCatalogNames(t *testing.T) {
	r, errs := Parse(catalog(t), []string{"advisor", "riel-2", "renting", "+abaco", "+cosigner"})
	if len(errs) > 0 {
		t.Fatal(errs)
	}
	want := "asesor · riel 2 creditopx consumo · renting operativo · +ábaco · +codeudor"
	if r.Line != want {
		t.Errorf("línea\n got %q\nwant %q", r.Line, want)
	}
}
