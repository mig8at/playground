package main

import (
	"os"
	"testing"
)

func TestNameScore(t *testing.T) {
	cases := []struct {
		old, cand string
		min, max  float64
	}{
		{"Guardar", "guardar", 1, 1},
		{"Guardar", "Guardar producto", 0.85, 0.85},
		{"Crear tarea", "Crear la tarea", 0.5, 0.6},
		{"Guardar", "Eliminar", 0, 0},
		{"Descripción", "descripcion", 1, 1},
	}
	for _, c := range cases {
		if got := nameScore(c.old, c.cand); got < c.min || got > c.max {
			t.Errorf("nameScore(%q, %q) = %.2f, quería entre %.2f y %.2f", c.old, c.cand, got, c.min, c.max)
		}
	}
}

func TestFindReplacement(t *testing.T) {
	loc := []Locator{{Kind: "role", Value: "x"}}
	pg := &Page{Controls: []Control{
		{Kind: "button", Name: "Guardar producto", Locators: loc},
		{Kind: "button", Name: "Cancelar", Locators: loc},
		{Kind: "field", Name: "Guardar", Locators: loc}, // un campo no reemplaza a un botón
	}}
	if c, _ := findReplacement(pg, "click", "Guardar"); c == nil || c.Name != "Guardar producto" {
		t.Fatalf("quería «Guardar producto», salió %+v", c)
	}
	// Dos igual de parecidos: ninguno (mejor parar que tocar otro botón).
	pg.Controls = append(pg.Controls, Control{Kind: "button", Name: "Guardar borrador", Locators: loc})
	if c, _ := findReplacement(pg, "click", "Guardar"); c != nil {
		t.Fatalf("con dos candidatos parejos no tenía que elegir, eligió %q", c.Name)
	}
	if c, _ := findReplacement(pg, "click", "Publicar"); c != nil {
		t.Fatalf("sin nada parecido no tenía que elegir, eligió %q", c.Name)
	}
}

func TestSameFlowByStepsAndName(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("JARVIS_FLOWS", dir)
	old := Flow{App: "demo", ID: "crear-producto", Name: "Crear un producto (renombrado)", Steps: []FlowStep{
		{Action: "click", Target: "Nuevo"}, {Action: "fill", Target: "Nombre", Value: "Casco", Param: "Nombre"}, {Action: "click", Target: "Guardar", Pause: true, Instruction: "Guardá vos"}, {Action: "click", Target: "Publicar Casco", Instruction: stepInstruction(Step{Action: "click", Target: "Publicar Casco"})},
	}}
	if err := writeFlow(old); err != nil {
		t.Fatal(err)
	}
	// Mismo recorrido, otro dato y otro nombre: va al mismo, con lo que decidió la persona.
	rec := Flow{App: "demo", Name: "otra meta", Steps: []FlowStep{
		{Action: "click", Target: "Nuevo"}, {Action: "fill", Target: "Nombre", Value: "Guantes", Param: "Nombre"}, {Action: "click", Target: "Guardar", Instruction: "Hacé clic en «Guardar»"}, {Action: "click", Target: "Publicar Guantes", Instruction: "Hacé clic en «Publicar Guantes»"},
	}}
	got, how, err := sameFlow(rec, SaveOpts{})
	if err != nil || got == nil || how != "same-steps" || got.ID != "crear-producto" {
		t.Fatalf("quería same-steps en crear-producto, salió %v %q %v", got, how, err)
	}
	m := mergeInto(*got, rec)
	if m.ID != "crear-producto" || m.Name != old.Name || m.Steps[1].Value != "Guantes" || !m.Steps[2].Pause || m.Steps[2].Instruction != "Guardá vos" || m.Steps[3].Instruction != "Hacé clic en «Publicar Guantes»" {
		t.Fatalf("la mezcla no conservó lo de la persona: %+v", m)
	}
	// Otro recorrido con el mismo nombre: va al mismo por nombre.
	rec2 := Flow{App: "demo", Name: "Crear un producto (renombrado)", Steps: []FlowStep{{Action: "click", Target: "Otro"}}}
	if got, how, _ := sameFlow(rec2, SaveOpts{}); got == nil || how != "same-name" {
		t.Fatalf("quería same-name, salió %v %q", got, how)
	}
	// --new: siempre uno nuevo.
	if got, _, _ := sameFlow(rec, SaveOpts{New: true}); got != nil {
		t.Fatal("con New no tenía que encontrar")
	}
	_ = os.RemoveAll(dir)
}

func TestFingerprintIgnoresDataAndEntry(t *testing.T) {
	a := []FlowStep{{Action: "goto", Value: "http://x/"}, {Action: "fill", Target: "Nombre", Value: "Bicicleta urbana", Param: "Nombre"}, {Action: "click", Target: "Publicar Bicicleta urbana"}}
	b := []FlowStep{{Action: "fill", Target: "Nombre", Value: "Casco", Param: "Nombre"}, {Action: "click", Target: "Publicar Casco"}}
	if fingerprint(a) != fingerprint(b) {
		t.Fatalf("mismo recorrido con otro dato y sin la ida a la entrada: tenían que ser iguales\n%q\n%q", fingerprint(a), fingerprint(b))
	}
	c := []FlowStep{{Action: "fill", Target: "Nombre", Value: "Casco", Param: "Nombre"}, {Action: "click", Target: "Eliminar Casco"}}
	if fingerprint(b) == fingerprint(c) {
		t.Fatal("publicar y eliminar no son el mismo recorrido")
	}
}

func TestFlowStepsCarriesDataIntoTargets(t *testing.T) {
	fl := Flow{App: "demo", Steps: []FlowStep{
		{Action: "fill", Target: "Nombre", Value: "Bicicleta urbana", Param: "Nombre"},
		{Action: "click", Target: "Publicar Bicicleta urbana", Ref: &Ref{Loc: Locator{Kind: "label", Value: "Publicar Bicicleta urbana", Code: "page.getByLabel('Publicar Bicicleta urbana')"}}},
	}}
	st := flowSteps(fl, map[int]string{0: "Casco"})
	if st[1].Target != "Publicar Casco" || st[1].Ref.Loc.Value != "Publicar Casco" || fl.Steps[1].Ref.Loc.Value != "Publicar Bicicleta urbana" {
		t.Fatalf("el botón tenía que seguir al dato nuevo sin tocar el flujo: %+v / %+v", st[1], fl.Steps[1].Ref)
	}
}
