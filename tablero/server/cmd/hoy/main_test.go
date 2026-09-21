package main

import (
	"errors"
	"strings"
	"testing"
)

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

func TestFichasContextRespetaElTopeYNoCallaErrores(t *testing.T) {
	declarados := []string{"a", "b", "c", "d", "e", "f"}
	correr := func(n string) (string, error) {
		if n == "c" {
			return "", errors.New("el nodo no está registrado en el árbol")
		}
		return "ficha de " + n + "\n", nil
	}
	fichas, aviso := fichasContext(declarados, "1", correr)
	if len(fichas) != topeFichas || !strings.Contains(aviso, "2 más") || !strings.Contains(aviso, "e, f") {
		t.Fatalf("con BRIEF=1 van los primeros %d y el aviso nombra el resto: %d fichas, aviso %q", topeFichas, len(fichas), aviso)
	}
	if fichas[2].Error == "" || fichas[2].Texto != "" || fichas[1].Texto != "ficha de b\n" {
		t.Fatalf("un brief que falla queda como error EN su ficha, y los demás siguen: %+v", fichas)
	}
	fichas, aviso = fichasContext(declarados, "f, zz", correr)
	if aviso != "" || len(fichas) != 2 || !fichas[0].Declarado || fichas[1].Declarado {
		t.Fatalf("BRIEF=a,b elige esos nodos y marca el que la tarea no declara: %+v aviso %q", fichas, aviso)
	}
	if fichas, _ := fichasContext(nil, "1", correr); fichas != nil {
		t.Fatal("sin context_nodes y con BRIEF=1 no hay fichas: la sección lo dice, no inventa nodos")
	}
}
