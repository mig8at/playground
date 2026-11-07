package docs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// La documentación sale del repo: con las recetas, el mapa y las grabaciones de VTEX que están en git.
func TestLoadVTEX(t *testing.T) {
	root, _ := filepath.Abs(filepath.Join("..", ".."))
	if _, err := os.Stat(filepath.Join(root, "jarvis", "recipes", "vtex")); err != nil {
		t.Skip("sin las recetas de vtex")
	}
	a, err := Load(root, "vtex")
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]Recipe{}
	for _, r := range a.Recipes {
		byID[r.ID] = r
	}
	col, ok := byID["collection"]
	if !ok {
		t.Fatalf("falta la receta collection: %v", a.Recipes)
	}
	if col.Mode != "api" || col.Writes == "" || len(col.Warnings) == 0 {
		t.Errorf("collection: modo %q, escribe %q, avisos %d", col.Mode, col.Writes, len(col.Warnings))
	}
	want := map[string]bool{"POST catalog/api/catalog/pvt/collection/": false, "DELETE catalog/api/catalog/pvt/collection/{id}": false}
	for _, c := range col.Calls {
		k := c.Method + " " + c.Host + c.Path
		if _, ok := want[k]; ok {
			want[k] = true
		}
	}
	for k, seen := range want {
		if !seen {
			t.Errorf("collection: no aparece la llamada %s en %+v", k, col.Calls)
		}
	}
	if syn := byID["synonym"]; syn.Mode != "session" || syn.Case != "synonym" || len(syn.Operations) != 3 {
		t.Errorf("synonym: modo %q, caso %q, operaciones %v", syn.Mode, syn.Case, syn.Operations)
	}
	if scr := byID["collection-screen"]; scr.Mode != "screen" || scr.Case != "collection" {
		t.Errorf("collection-screen: modo %q, caso %q", scr.Mode, scr.Case)
	}
	var created bool
	for _, c := range a.Cases {
		for _, w := range c.Writes {
			if w.Operation == "createCollection" {
				created = true
			}
			if strings.HasPrefix(w.Operation, "get") {
				t.Errorf("caso %s: una lectura quedó como escritura: %s", c.ID, w.Operation)
			}
		}
	}
	if !created {
		t.Error("las grabaciones no muestran createCollection")
	}
	if len(a.Screens) == 0 || a.Screens[0].ID != "admin" {
		t.Errorf("el mapa: %d pantallas, la primera %v", len(a.Screens), a.Screens)
	}
	if len(a.Sections) != 9 {
		t.Errorf("el barrido: %d secciones, se esperaban 9", len(a.Sections))
	}
}
