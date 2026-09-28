package canoncache

import (
	"os"
	"path/filepath"
	"testing"
)

func fakeMirror(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for rel, body := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// El ancla es la de canon (`corpus.AnchorOf`): sin tildes, y lo que no es letra ni dígito, un guion.
func TestAnchorIsCanons(t *testing.T) {
	for in, want := range map[string]string{
		"Sólo un proveedor trae el score":                 "solo-un-proveedor-trae-el-score",
		"La tabla de centrales NO es «la lista de burós»": "la-tabla-de-centrales-no-es-la-lista-de-buros",
		"En tienda, la cuota: ¿quién la fija?":            "en-tienda-la-cuota-quien-la-fija",
		"Año 2026 — el señor":                             "ano-2026-el-senor",
	} {
		if got := anchorOf(in); got != want {
			t.Errorf("%q → %q, quería %q", in, got, want)
		}
	}
}

func TestSelectContextRanksAndBudgets(t *testing.T) {
	dir := fakeMirror(t, map[string]string{
		"content/kyc/context.md": "# KYC\n\nresumen\n\n## El ingreso no decide\n\nEl ingreso declarado no decide.\n\n" +
			"## Otra cosa\n\nNada.\n\n## Menciona el ingreso\n\nUna vez: ingreso.\n",
	})
	chosen, pending, missing := SelectContext(dir, []string{"kyc", "nope"}, "el ingreso de la persona", 10000)
	if len(missing) != 1 || missing[0] != "nope" {
		t.Fatalf("missing %v", missing)
	}
	if len(chosen) != 2 || chosen[0].ID != "kyc/context#el-ingreso-no-decide" || len(pending) != 0 {
		t.Fatalf("elegidas %+v, pendientes %v", chosen, pending)
	}
	// con poco presupuesto, la mejor entra y la otra queda pendiente por su cita
	chosen, pending, _ = SelectContext(dir, []string{"kyc"}, "ingreso", 60)
	if len(chosen) != 1 || len(pending) != 1 || pending[0] != "kyc/context#menciona-el-ingreso" {
		t.Fatalf("presupuesto: %+v %v", chosen, pending)
	}
}

func TestAreaReadsTheLocalMap(t *testing.T) {
	dir := fakeMirror(t, map[string]string{"content/kyc/map.json": `{"areas":[{"objetivo":"a"},{"objetivo":"b","fuentes":{"lb":{"X.php":"abc"}},"tablas":["t"]}]}`})
	a, total, err := Area(dir, "kyc/context", 1)
	if err != nil || total != 2 || a.Goal != "b" || a.Files["lb"]["X.php"] != "abc" || a.Tables[0] != "t" {
		t.Fatalf("%+v %d %v", a, total, err)
	}
	if _, _, err := Area(dir, "kyc", 5); err == nil {
		t.Error("un área fuera de rango tiene que fallar diciendo cuántas hay")
	}
	if _, _, err := Area(dir, "nope", 0); err == nil {
		t.Error("un tema que no está en la copia tiene que fallar")
	}
}
