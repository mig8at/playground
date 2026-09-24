package atlassian

import (
	"encoding/json"
	"testing"
)

func TestMdToADF(t *testing.T) {
	md := "## Título\n" +
		"Texto con **negrita**, un link https://x.com y [otro](https://y.com).\n\n" +
		"- uno\n- dos\n\n" +
		"1. paso uno\n2. paso dos\n\n" +
		"- [ ] pendiente\n- [x] hecho"

	doc := mdToADF(md)

	// Debe ser serializable a JSON (lo que se manda a Jira).
	if _, err := json.Marshal(doc); err != nil {
		t.Fatalf("ADF no serializa: %v", err)
	}
	content, ok := doc["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatal("ADF sin content")
	}

	types := map[string]bool{}
	for _, b := range content {
		if m, ok := b.(map[string]any); ok {
			types[m["type"].(string)] = true
		}
	}
	for _, want := range []string{"heading", "paragraph", "bulletList", "orderedList", "taskList"} {
		if !types[want] {
			t.Errorf("falta el bloque %q (tipos presentes: %v)", want, types)
		}
	}

	// El párrafo debe traer marcas (negrita/link) además de texto.
	var marks int
	var walk func(any)
	walk = func(n any) {
		m, ok := n.(map[string]any)
		if !ok {
			return
		}
		if _, has := m["marks"]; has {
			marks++
		}
		if c, ok := m["content"].([]any); ok {
			for _, ch := range c {
				walk(ch)
			}
		}
	}
	walk(doc)
	if marks == 0 {
		t.Error("no se generaron marcas inline (negrita/link)")
	}
}
