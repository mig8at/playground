package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// setupScaffoldEngine arma un engine con dirs temporales, plantillas con marcadores
// y un árbol raíz(creditop)→group(creditopx)→flujo(smartpay)→tarea(sp-v2).
func setupScaffoldEngine(t *testing.T) *Engine {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	flowsDir := filepath.Join(dataDir, "flows")
	tmplDir := filepath.Join(dataDir, "doc-templates")
	for _, d := range []string{flowsDir, tmplDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	tmpls := map[string]string{
		"raiz":  "# <Nombre> · raíz\nRAIZMARK\n",
		"group": "# <Nombre> · group\nGROUPMARK\n",
		"flujo": "# <Nombre> · flujo\nFLUJOMARK\n",
		"tarea": "# <Nombre> · tarea\nTAREAMARK\n",
	}
	for name, body := range tmpls {
		if err := os.WriteFile(filepath.Join(tmplDir, name+".md"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	e := &Engine{dir: root, flowsDir: flowsDir}
	now := time.Now()
	cf := combFile{Combinations: []Combination{
		{ID: "creditop", Name: "CreditOp", Created: now, Updated: now},
		{ID: "creditopx", Name: "CreditopX", Parent: "creditop", Created: now, Updated: now},
		{ID: "smartpay", Name: "SmartPay", Parent: "creditopx", Created: now, Updated: now},
		{ID: "sp-v2", Name: "SmartPay v2", Parent: "smartpay", Created: now, Updated: now},
	}}
	if err := writeJSON(e.combsPath(), cf); err != nil {
		t.Fatal(err)
	}
	return e
}

func TestScaffoldFlowDocByRole(t *testing.T) {
	e := setupScaffoldEngine(t)

	cases := []struct {
		id, name, marker string
	}{
		{"creditopx", "CreditopX", "GROUPMARK"}, // hijo de raíz → group
		{"smartpay", "SmartPay", "FLUJOMARK"},   // nieto → flujo
		{"sp-v2", "SmartPay v2", "TAREAMARK"},   // bisnieto → tarea
	}
	for _, c := range cases {
		e.ScaffoldFlowDoc(c.id, c.name)
		doc, err := os.ReadFile(filepath.Join(e.flowsDir, c.id, "doc.md"))
		if err != nil {
			t.Fatalf("%s: doc.md no sembrado: %v", c.id, err)
		}
		if !strings.Contains(string(doc), c.marker) {
			t.Errorf("%s: plantilla equivocada, esperaba %s en:\n%s", c.id, c.marker, doc)
		}
		if !strings.Contains(string(doc), "# "+c.name+" ·") {
			t.Errorf("%s: <Nombre> no sustituido por %q en:\n%s", c.id, c.name, doc)
		}
		if _, err := os.Stat(filepath.Join(e.flowsDir, c.id, "map.json")); err != nil {
			t.Errorf("%s: map.json no creado: %v", c.id, err)
		}
	}
}

func TestScaffoldDoesNotClobber(t *testing.T) {
	e := setupScaffoldEngine(t)
	dir := filepath.Join(e.flowsDir, "creditopx")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	existing := "# CreditopX · group\nCONTENIDO CURADO A MANO\n"
	if err := os.WriteFile(filepath.Join(dir, "map.json"), []byte(`{"name":"CreditopX","files":["legacy-backend/x.php"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "doc.md"), []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}
	e.ScaffoldFlowDoc("creditopx", "CreditopX") // debe ser NO-OP (ya existe map.json)
	doc, _ := os.ReadFile(filepath.Join(dir, "doc.md"))
	if string(doc) != existing {
		t.Errorf("scaffold pisó un doc existente:\n%s", doc)
	}
}
