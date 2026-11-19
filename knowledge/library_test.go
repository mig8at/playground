package knowledge

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTopic(t *testing.T, dir string) {
	t.Helper()
	base := filepath.Join(dir, "lender-listing")
	if err := os.MkdirAll(base, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "rules.md"), []byte("# Listado\n\n## Monto del crédito\n\nEl monto depende del pedido.\n"), 0644); err != nil {
		t.Fatal(err)
	}
	meta := Metadata{Version: 1, Title: "Listado", Summary: "El monto del pedido", ReviewedAt: "2026-10-03T12:00:00Z", Sources: []Source{{Repo: "backend", Path: "src/List.php", Commit: strings.Repeat("a", 40), Blob: strings.Repeat("b", 40), Sections: []string{"monto-del-credito"}}}}
	raw, _ := json.Marshal(meta)
	if err := os.WriteFile(filepath.Join(base, "sources.json"), raw, 0644); err != nil {
		t.Fatal(err)
	}
}

func TestLocalContextKeepsCompleteRulesAndNamesMissingReferences(t *testing.T) {
	dir := t.TempDir()
	writeTopic(t, dir)
	l, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if hits := l.Search("crédito"); len(hits) != 1 || hits[0].ID != "lender-listing#monto-del-credito" {
		t.Fatalf("búsqueda: %+v", hits)
	}
	c := l.Select([]string{"lender-listing", "unknown"}, 1)
	if len(c.Topics) != 0 || len(c.Pending) != 1 || len(c.Missing) != 1 {
		t.Fatalf("el presupuesto recortó o silenció contexto: %+v", c)
	}
	topic, err := l.Read("lender-listing#monto-del-credito")
	if err != nil || len(topic.Sections) != 1 {
		t.Fatalf("lectura: %+v %v", topic, err)
	}
	for _, ref := range []string{"../lender-listing", "lender-listing#nope", "/etc/passwd"} {
		if _, err := l.Read(ref); err == nil {
			t.Errorf("aceptó %q", ref)
		}
	}
}

func TestIncompleteKnowledgeOrRulesWithoutSourcesNeverLookValid(t *testing.T) {
	for _, kind := range []string{"missing-sources", "unknown-section", "uncovered-section", "duplicate-anchor", "invalid-source-path", "invalid-review-date"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			writeTopic(t, dir)
			base := filepath.Join(dir, "lender-listing")
			raw, _ := os.ReadFile(filepath.Join(base, "sources.json"))
			var m Metadata
			json.Unmarshal(raw, &m)
			switch kind {
			case "missing-sources":
				os.Remove(filepath.Join(base, "sources.json"))
			case "unknown-section":
				m.Sources[0].Sections = []string{"wrong"}
			case "uncovered-section":
				f, _ := os.OpenFile(filepath.Join(base, "rules.md"), os.O_APPEND|os.O_WRONLY, 0644)
				f.WriteString("\n## Otra regla\nSin fuente.\n")
				f.Close()
			case "duplicate-anchor":
				f, _ := os.OpenFile(filepath.Join(base, "rules.md"), os.O_APPEND|os.O_WRONLY, 0644)
				f.WriteString("\n## Monto del crédito\nOtro texto.\n")
				f.Close()
			case "invalid-source-path":
				m.Sources[0].Path = "../private.php"
			case "invalid-review-date":
				m.ReviewedAt = ""
			}
			if kind == "unknown-section" || kind == "invalid-source-path" || kind == "invalid-review-date" {
				raw, _ = json.Marshal(m)
				os.WriteFile(filepath.Join(base, "sources.json"), raw, 0644)
			}
			if _, err := Open(dir); err == nil {
				t.Fatal("dio por válido conocimiento incompleto")
			}
		})
	}
}

func TestKnowledgeRejectsLinkedTopicsAndFiles(t *testing.T) {
	for _, target := range []string{"topic", "rules.md", "sources.json"} {
		t.Run(target, func(t *testing.T) {
			dir := t.TempDir()
			writeTopic(t, dir)
			path := filepath.Join(dir, "lender-listing")
			if target != "topic" {
				path = filepath.Join(path, target)
			}
			backup := filepath.Join(t.TempDir(), "original")
			if err := os.Rename(path, backup); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(backup, path); err != nil {
				t.Fatal(err)
			}
			if _, err := Open(dir); err == nil {
				t.Fatal("aceptó un enlace")
			}
		})
	}
}

// La búsqueda por significado: el índice recalcula sólo lo que cambió, y la mezcla con la búsqueda por palabras sube
// lo que está arriba en cualquiera de las dos.
func TestSemanticIndexAndBlend(t *testing.T) {
	l := Library{Topics: []Topic{{ID: "a", Metadata: Metadata{Title: "A"}, Sections: []Section{{ID: "a#uno", Title: "Uno", Text: "cuota inicial"}, {ID: "a#dos", Title: "Dos", Text: "pagaré"}}}}}
	calls := 0
	// un «modelo» de juguete: el vector dice si el texto habla de cuota o de pagaré
	embed := func(texts []string) ([][]float32, error) {
		calls += len(texts)
		out := make([][]float32, len(texts))
		for i, s := range texts {
			out[i] = []float32{float32(strings.Count(s, "cuota")), float32(strings.Count(s, "pagar") + strings.Count(s, "pagaré")), 0.01}
		}
		return out, nil
	}
	path := filepath.Join(t.TempDir(), "index.json")
	hits, stats, err := l.SemanticSearch("¿cuánto es la cuota?", path, "m", embed)
	if err != nil || stats.Embedded != 2 || hits[0].ID != "a#uno" {
		t.Fatalf("%v %+v %v", hits, stats, err)
	}
	calls = 0
	_, stats, _ = l.SemanticSearch("firmar el pagaré", path, "m", embed)
	if stats.Embedded != 0 || calls != 1 {
		t.Fatalf("con el índice guardado sólo se calcula la pregunta: embebió %d, llamó %d", stats.Embedded, calls)
	}
	l.Topics[0].Sections[1].Text = "pagaré firmado"
	_, stats, _ = l.SemanticSearch("x", path, "m", embed)
	if stats.Embedded != 1 {
		t.Fatalf("una sección que cambió se recalcula sola: %+v", stats)
	}
	words := []Hit{{Section: Section{ID: "a#dos"}, Topic: "a", Score: 5}}
	meaning := []SemanticHit{{Hit: Hit{Section: Section{ID: "a#uno"}, Topic: "a"}, Similarity: 0.9}, {Hit: Hit{Section: Section{ID: "a#dos"}, Topic: "a"}, Similarity: 0.5}}
	got := Blend(words, meaning, 10, 1)
	if got[0].ID != "a#dos" || len(got) != 2 {
		t.Fatalf("la que está en las dos listas va primero: %+v", got)
	}
}
