package main

import (
	"testing"
)

func TestRequiresBranchesOnlyForProductWork(t *testing.T) {
	if requiresBranches(task{Stage: "work", Class: "proyecto"}) {
		t.Fatal("un contenedor local no necesita una rama permanente")
	}
	if !requiresBranches(task{Stage: "work"}) {
		t.Fatal("una tarea de producto en work sí necesita declarar ramas")
	}
	if requiresBranches(task{Stage: "evaluation"}) {
		t.Fatal("una evaluación todavía no necesita rama")
	}
}
