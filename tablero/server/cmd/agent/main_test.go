package main

import (
	"strings"
	"testing"
)

// El cruce con las trampas propone por palabras compartidas: una fila con dos palabras de la tarea entra,
// una con una sola no, y las palabras de todos los días no cuentan. Las citadas salen con su línea.
func TestMatchTrapsBySymptomAndCited(t *testing.T) {
	doc := strings.Split(`## Índice · ¿con qué síntoma llegás?

| Si tu síntoma es… | Mirá |
|---|---|
| **«Deceval rechaza por identidad» / el pagaré dice otra persona** | **F-133** · F-121 |
| **«el comercio no ve la entidad»** | F-10 |
| **«el pagaré tarda»** | F-11 |

## Índice · los F-xx de una línea

| F | qué | estado |
|---|---|---|
| F-77 | Mergear a qa no aplica migraciones | TRAMPA |
`, "\n")
	var task taskView
	task.Title = "El pagaré de Deceval rechaza la identidad del comercio"
	task.Context = append(task.Context, struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}{Title: "corrida", Body: "ver F-77"})

	got := matchTraps(doc, task)
	if len(got.BySymptom) != 1 || got.BySymptom[0].Traps[0] != "F-133" {
		t.Fatalf("por síntoma: quería sólo la fila de Deceval, vino %+v", got.BySymptom)
	}
	if strings.Contains(got.BySymptom[0].Symptom, "**") {
		t.Fatalf("el síntoma quedó con marcas: %q", got.BySymptom[0].Symptom)
	}
	if len(got.Cited) != 1 || got.Cited[0].ID != "F-77" || got.Cited[0].What == "" {
		t.Fatalf("citadas: quería F-77 con su línea, vino %+v", got.Cited)
	}
}
