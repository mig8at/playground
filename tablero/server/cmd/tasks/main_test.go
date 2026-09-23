package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"creditop/tablero/server/internal/taskcontext"
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

func TestDocumentJSONCarriesTheDocumentAndItsStack(t *testing.T) {
	body := `
## Pendientes

- [ ] Ejecutar la validación.
- [x] Preparar el caso.

## Plan

El plan vigente.

## Tarea (publicable)

Descripción para el equipo.

## Cómo validar

- [ ] Confirmar el resultado esperado.
`
	stack := []taskcontext.Event{{Schema: taskcontext.BlockSchema, ID: "blk_1", At: "2026-09-23T12:00:00-05:00",
		Via: "manual", Title: "La regla sí excluye", Body: "Se corrió el caso."}}
	doc := documentJSON(Task{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work", Class: "proyecto"}, body, stack, true)
	if doc.SchemaVersion != "tablero.task.v3" {
		t.Fatalf("versión inesperada: %q", doc.SchemaVersion)
	}
	if doc.Work.Counts.OpenPending != 1 || doc.Work.Counts.ClosedPending != 1 || doc.Work.Counts.Blocks != 1 {
		t.Fatalf("conteos inesperados: %+v", doc.Work.Counts)
	}
	if len(doc.Stack) != 1 || doc.Stack[0].Title != "La regla sí excluye" {
		t.Fatalf("la pila no viajó: %+v", doc.Stack)
	}
	if len(doc.Sections) != 2 {
		t.Fatalf("las secciones privadas no deben incluir la publicable: %v", doc.Sections)
	}
	if !doc.Publication.Available || !doc.Publication.HasQA || !doc.Publication.ReadyForJira {
		t.Fatalf("publicación inesperada: %+v", doc.Publication)
	}
	if doc.Publication.Violations == nil {
		t.Fatal("una lista vacía debe serializarse como [], no como null")
	}
	if strings.Contains(doc.Publication.Draft, "El plan vigente") {
		t.Fatal("el borrador público mezcló el cuerpo privado")
	}
	compact := documentJSON(Task{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work"}, body, nil, false)
	if compact.Publication.Draft != "" || compact.Publication.Bytes == 0 {
		t.Fatalf("el modo compacto no debe transportar el borrador: %+v", compact.Publication)
	}
	if compact.Stack == nil {
		t.Fatal("una pila vacía debe serializarse como [], no como null")
	}
}

// Las claves se comparan en TODOS los niveles, no sólo en el primero: la fase 4b (2026-09-23) cambió
// casi todas las claves anidadas —pendientes, anotaciones, conteos— y un test que sólo miraba el primer
// nivel las habría dejado derivar sin avisar.
func TestSchemaJSONDeclaresVersionAndEmittedKeys(t *testing.T) {
	b, err := os.ReadFile("../../../schemas/task.v3.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var schema map[string]any
	if err := json.Unmarshal(b, &schema); err != nil {
		t.Fatalf("schema JSON inválido: %v", err)
	}
	body := "## Pendientes\n\n- [ ] Ejecutar.\n\n## Tarea (publicable)\n\nTexto.\n"
	stack := []taskcontext.Event{{Schema: taskcontext.BlockSchema, ID: "blk_1", At: "2026-09-23T12:00:00-05:00",
		Via: "harness", Title: "Un título", Body: "Una descripción."}}
	doc, err := json.Marshal(documentJSON(Task{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work", Class: "proyecto"}, body, stack, true))
	if err != nil {
		t.Fatal(err)
	}
	var emitted any
	if err := json.Unmarshal(doc, &emitted); err != nil {
		t.Fatal(err)
	}
	checkDeclared(t, "", emitted, schema)
	props, _ := schema["properties"].(map[string]any)
	if v, _ := props["schemaVersion"].(map[string]any); v["const"] != "tablero.task.v3" {
		t.Errorf("el schema declara la versión %v", v["const"])
	}
	for _, key := range []string{"schemaVersion", "task", "work", "stack", "sections", "publication"} {
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

// El lint frena un registro con fecha NUEVO en el documento y deja pasar, avisando, el que ya estaba en
// el último commit: una tarea sin migrar se tiene que poder editar por otra cosa.
func TestLintStopsNewDatedRecordsAndWarnsOnOldOnes(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "tasks", "arreglo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TABLERO_DATA", filepath.Join(root, "data"))
	file := filepath.Join(dir, "task.md")
	head := "---\nid: 9001\ntitle: Arreglo\nstage: work\ncreated: \"2026-09-23T10:00:00-05:00\"\njira: [CORE-1]\n---\n\n## Plan\n\n"
	old := "> **MEDICIÓN · 2026-09-01** — una medición de antes.\n"
	write := func(text string) {
		if err := os.WriteFile(file, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	git := func(args ...string) {
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	write(head + old)
	git("init", "-q")
	git("add", ".")
	git("commit", "-q", "-m", "tarea")
	if got := showLint(file); got != 0 {
		t.Fatalf("la anotación que ya estaba sólo avisa, y el lint salió %d", got)
	}
	write(head + old + "\n## Registro\n\n### 2026-09-23\n")
	if got := showLint(file); got != 1 {
		t.Fatalf("un Registro nuevo tiene que frenar, y el lint salió %d", got)
	}
	write(head + old + old)
	if got := showLint(file); got != 1 {
		t.Fatalf("una segunda anotación igual a la vieja también es nueva, y el lint salió %d", got)
	}
}
