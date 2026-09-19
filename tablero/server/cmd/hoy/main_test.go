package main

import "testing"

func TestRequiereRamasSoloParaTrabajoDeProducto(t *testing.T) {
	if requiereRamas(tarea{Stage: "work", Clase: "proyecto"}) {
		t.Fatal("un contenedor local no necesita una rama permanente")
	}
	if !requiereRamas(tarea{Stage: "work"}) {
		t.Fatal("una tarea de producto en work sí necesita declarar ramas")
	}
	if requiereRamas(tarea{Stage: "evaluation"}) {
		t.Fatal("una evaluación todavía no necesita rama")
	}
}
