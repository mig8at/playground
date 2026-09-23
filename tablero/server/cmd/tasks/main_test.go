package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestLocalProblemAcceptsOnlyCanonicalContainers(t *testing.T) {
	tests := []struct {
		name string
		task Task
		ok   bool
	}{
		{"contenedor", Task{Slug: "context", Class: "proyecto"}, true},
		{"general", Task{Slug: "playground", Class: "proyecto"}, true},
		{"jira", Task{Slug: "arreglo-producto", Jira: []string{"CORE-1"}}, true},
		{"local-suelta", Task{Slug: "otra-mejora"}, false},
		{"canonica-como-tarea", Task{Slug: "harness", Class: "tarea"}, false},
		{"canonica-con-jira", Task{Slug: "tablero", Class: "proyecto", Jira: []string{"CORE-2"}}, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := localProblem(test.task)
			if (got == "") != test.ok {
				t.Fatalf("problemaLocal() = %q, ok esperado %v", got, test.ok)
			}
		})
	}
}

func TestWarningsExplainWhereToConsolidateLooseLocal(t *testing.T) {
	got := strings.Join(warnings([]Task{{ID: 93, Slug: "mejora-suelta", Stage: "work"}}), "\n")
	if !strings.Contains(got, "agregá el frente al contenedor correspondiente") {
		t.Fatalf("aviso = %q", got)
	}
}

func TestDocumentJSONDerivesStateAndWorkWithoutDuplicatingMarkdown(t *testing.T) {
	body := `
## Si retomás esto sin contexto, empezá acá

El estado vigente.

**El próximo paso es:** validar el caso con QA.

## Pendientes

- [ ] Ejecutar la validación.
- [x] Preparar el caso.

## Decisiones

> **DECISIÓN · 2026-09-19** — conservar Markdown como fuente.

## Tarea (publicable)

Descripción para el equipo.

## Cómo validar

- [ ] Confirmar el resultado esperado.
`
	doc := documentJSON(Task{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work", Class: "proyecto"}, body, true)
	if doc.SchemaVersion != "tablero.task.v2" || doc.State.NextStep != "validar el caso con QA." {
		t.Fatalf("estado JSON inesperado: %+v", doc.State)
	}
	if doc.Work.Counts.OpenPending != 1 || doc.Work.Counts.ClosedPending != 1 {
		t.Fatalf("conteos de pendientes inesperados: %+v", doc.Work.Counts)
	}
	if doc.Work.Counts.Decisions != 1 || len(doc.Work.Annotations) != 1 {
		t.Fatalf("anotaciones inesperadas: %+v", doc.Work)
	}
	if len(doc.Sections) != 3 {
		t.Fatalf("las secciones privadas no deben incluir la publicable: %v", doc.Sections)
	}
	if !doc.Publication.Available || !doc.Publication.HasQA || !doc.Publication.ReadyForJira {
		t.Fatalf("publicación inesperada: %+v", doc.Publication)
	}
	if doc.Publication.Violations == nil {
		t.Fatal("una lista vacía debe serializarse como [], no como null")
	}
	if strings.Contains(doc.Publication.Draft, "El estado vigente") {
		t.Fatal("el borrador público mezcló el cuerpo privado")
	}
	compact := documentJSON(Task{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work"}, body, false)
	if compact.Publication.Draft != "" || compact.Publication.Bytes == 0 {
		t.Fatalf("el modo compacto no debe transportar el borrador: %+v", compact.Publication)
	}
}

// Las claves se comparan en TODOS los niveles, no sólo en el primero: la fase 4b (2026-09-23) cambió
// casi todas las claves anidadas —pendientes, anotaciones, conteos— y un test que sólo miraba el primer
// nivel las habría dejado derivar sin avisar.
func TestSchemaJSONDeclaresVersionAndEmittedKeys(t *testing.T) {
	b, err := os.ReadFile("../../../schemas/task.v2.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var schema map[string]any
	if err := json.Unmarshal(b, &schema); err != nil {
		t.Fatalf("schema JSON inválido: %v", err)
	}
	body := "## Pendientes\n\n- [ ] Ejecutar.\n\n> **DECISIÓN · 2026-09-19** — conservar Markdown.\n\n## Tarea (publicable)\n\nTexto.\n"
	doc, err := json.Marshal(documentJSON(Task{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work", Class: "proyecto"}, body, true))
	if err != nil {
		t.Fatal(err)
	}
	var emitted any
	if err := json.Unmarshal(doc, &emitted); err != nil {
		t.Fatal(err)
	}
	checkDeclared(t, "", emitted, schema)
	props, _ := schema["properties"].(map[string]any)
	if v, _ := props["schemaVersion"].(map[string]any); v["const"] != "tablero.task.v2" {
		t.Errorf("el schema declara la versión %v", v["const"])
	}
	for _, key := range []string{"schemaVersion", "task", "state", "work", "sections", "publication"} {
		if _, ok := props[key]; !ok {
			t.Errorf("el schema no declara %q", key)
		}
	}
}

// checkDeclared recorre lo emitido junto con su schema: un objeto sólo puede traer claves de `properties`,
// y un arreglo se revisa ítem por ítem contra `items`.
func checkDeclared(t *testing.T, path string, value any, schema map[string]any) {
	t.Helper()
	switch v := value.(type) {
	case map[string]any:
		props, ok := schema["properties"].(map[string]any)
		if !ok {
			return // objeto libre (`additionalProperties` con tipo): no declara nombres
		}
		for key, child := range v {
			sub, ok := props[key].(map[string]any)
			if !ok {
				t.Errorf("la salida emite %q pero el schema no la declara", path+"/"+key)
				continue
			}
			checkDeclared(t, path+"/"+key, child, sub)
		}
	case []any:
		items, _ := schema["items"].(map[string]any)
		for i, child := range v {
			checkDeclared(t, fmt.Sprintf("%s[%d]", path, i), child, items)
		}
	}
}
