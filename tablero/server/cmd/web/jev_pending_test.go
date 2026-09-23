package main

import (
	"strings"
	"testing"

	"creditop/tablero/server/internal/store"
)

func TestJevPendingStateIsBoundedAndOmitsCommands(t *testing.T) {
	effort := store.Effort{
		Title:       "Validar alta mobile",
		ProximoPaso: "Revisar la evidencia.",
		Retoma:      "Esperamos una confirmación.",
		TechNotes:   "CUERPO PRIVADO ENTERO: no debe salir",
		Pendientes: []store.Pendiente{
			{Que: "Confirmar el código con la app", Seccion: "Pendientes"},
			{Que: "Ya cerrado", Hecho: true, Seccion: "Pendientes"},
		},
		Anotaciones: []store.Anotacion{{
			Fecha: "2026-09-21", Tipo: "medicion", Que: "La app confirmó el flujo.",
			Como: "curl --header Authorization: private-command",
		}},
	}
	state, omitted, err := jevPendingStateFromEffort(effort)
	if err != nil {
		t.Fatal(err)
	}
	if omitted != 0 || len(state.Pending) != 1 || len(state.Evidence) != 1 {
		t.Fatalf("state = %+v, omitted = %d", state, omitted)
	}
	body, err := newJevPendingRequest(state)
	if err != nil {
		t.Fatal(err)
	}
	if len(body.Questions) != 1 {
		t.Fatalf("questions = %#v", body.Questions)
	}
	if got := body.State.Evidence[0].Text; got != "La app confirmó el flujo." {
		t.Fatalf("evidence text = %q", got)
	}
	encoded := body.State.Title + body.State.NextStep + body.State.Retoma + body.State.Evidence[0].Text
	if strings.Contains(encoded, "private-command") || strings.Contains(encoded, "CUERPO PRIVADO") {
		t.Fatalf("la proyección expuso contenido excluido: %q", encoded)
	}
}

func TestJevPendingResponseRequiresExactChoiceContract(t *testing.T) {
	state := jevPendingState{Pending: []jevPendingItem{{ID: 0, Text: "Confirmar", Section: "Pendientes"}}}
	request, err := newJevPendingRequest(state)
	if err != nil {
		t.Fatal(err)
	}
	response := jevPendingResponse{
		Model: jevModel,
		Answers: map[string]jevChoiceAnswer{"pending_0": {
			Type: "choice", Choice: "resolved", Confidence: .8,
			Probabilities: map[string]float64{"resolved": .8, "open": .1, "unclear": .1},
		}},
	}
	review, err := validateJevPendingResponse(response, request)
	if err != nil || len(review.Items) != 1 || review.Items[0].Status != "resolved" {
		t.Fatalf("review = %+v, err = %v", review, err)
	}
	response.Answers["pending_0"] = jevChoiceAnswer{Type: "choice", Choice: "resolved", Confidence: .8,
		Probabilities: map[string]float64{"resolved": .8, "open": .2, "unclear": .2}}
	if _, err := validateJevPendingResponse(response, request); err == nil {
		t.Fatal("se aceptó una distribución inválida")
	}
}

func TestJevPendingStateRejectsPossibleSecrets(t *testing.T) {
	_, _, err := jevPendingStateFromEffort(store.Effort{
		Title: "Tarea", ProximoPaso: "token=redacted", Pendientes: []store.Pendiente{{Que: "Confirmar"}},
	})
	if err == nil {
		t.Fatal("se aceptó un posible secreto")
	}
}
