package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestProblemaLocalAceptaSoloContenedoresCanonicos(t *testing.T) {
	tests := []struct {
		name string
		task Tarea
		ok   bool
	}{
		{"contenedor", Tarea{Slug: "context", Clase: "proyecto"}, true},
		{"general", Tarea{Slug: "playground", Clase: "proyecto"}, true},
		{"jira", Tarea{Slug: "arreglo-producto", Jira: []string{"CORE-1"}}, true},
		{"local-suelta", Tarea{Slug: "otra-mejora"}, false},
		{"canonica-como-tarea", Tarea{Slug: "harness", Clase: "tarea"}, false},
		{"canonica-con-jira", Tarea{Slug: "tablero", Clase: "proyecto", Jira: []string{"CORE-2"}}, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := problemaLocal(test.task)
			if (got == "") != test.ok {
				t.Fatalf("problemaLocal() = %q, ok esperado %v", got, test.ok)
			}
		})
	}
}

func TestAvisosExplicaDondeConsolidarUnaLocalSuelta(t *testing.T) {
	got := strings.Join(avisos([]Tarea{{ID: 93, Slug: "mejora-suelta", Stage: "work"}}), "\n")
	if !strings.Contains(got, "agregá el frente al contenedor correspondiente") {
		t.Fatalf("aviso = %q", got)
	}
}

func TestDocumentoJSONDerivaEstadoYTrabajoSinDuplicarElMarkdown(t *testing.T) {
	cuerpo := `
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
	doc := documentoJSON(Tarea{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work", Clase: "proyecto"}, cuerpo, true)
	if doc.SchemaVersion != "tablero.tarea.v1" || doc.Estado.ProximoPaso != "validar el caso con QA." {
		t.Fatalf("estado JSON inesperado: %+v", doc.Estado)
	}
	if doc.Trabajo.Conteos.PendientesAbiertos != 1 || doc.Trabajo.Conteos.PendientesCerrados != 1 {
		t.Fatalf("conteos de pendientes inesperados: %+v", doc.Trabajo.Conteos)
	}
	if doc.Trabajo.Conteos.Decisiones != 1 || len(doc.Trabajo.Anotaciones) != 1 {
		t.Fatalf("anotaciones inesperadas: %+v", doc.Trabajo)
	}
	if len(doc.Secciones) != 3 {
		t.Fatalf("las secciones privadas no deben incluir la publicable: %v", doc.Secciones)
	}
	if !doc.Publicacion.Disponible || !doc.Publicacion.TieneQA || !doc.Publicacion.ListaParaJira {
		t.Fatalf("publicación inesperada: %+v", doc.Publicacion)
	}
	if doc.Publicacion.Violaciones == nil {
		t.Fatal("una lista vacía debe serializarse como [], no como null")
	}
	if strings.Contains(doc.Publicacion.Borrador, "El estado vigente") {
		t.Fatal("el borrador público mezcló el cuerpo privado")
	}
	compacto := documentoJSON(Tarea{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work"}, cuerpo, false)
	if compacto.Publicacion.Borrador != "" || compacto.Publicacion.Bytes == 0 {
		t.Fatalf("el modo compacto no debe transportar el borrador: %+v", compacto.Publicacion)
	}
}

func TestSchemaJSONDeclaraLaVersionYLasClavesEmitidas(t *testing.T) {
	b, err := os.ReadFile("../../../schemas/tarea.v1.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Properties map[string]json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(b, &schema); err != nil {
		t.Fatalf("schema JSON inválido: %v", err)
	}
	doc, err := json.Marshal(documentoJSON(Tarea{ID: 84, Slug: "tablero", Title: "Tablero", Stage: "work"}, "", false))
	if err != nil {
		t.Fatal(err)
	}
	var emitidas map[string]json.RawMessage
	if err := json.Unmarshal(doc, &emitidas); err != nil {
		t.Fatal(err)
	}
	for clave := range emitidas {
		if _, ok := schema.Properties[clave]; !ok {
			t.Errorf("la salida emite %q pero el schema no la declara", clave)
		}
	}
	for _, clave := range []string{"schemaVersion", "tarea", "estado", "trabajo", "secciones", "publicacion"} {
		if _, ok := schema.Properties[clave]; !ok {
			t.Errorf("el schema no declara %q", clave)
		}
	}
}
