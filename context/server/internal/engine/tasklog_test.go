package engine

import (
	"testing"
	"time"
)

// Cubre la pieza PURA del bucle de aprendizaje: el matching de precedentes.
// (RecordTask es I/O + validación contra Flows; lo que decide si un precedente
// aparece o no es esto.)

func recs() []TaskRecord {
	return []TaskRecord{
		{Task: "quitar el dd() colgado en el catch de Wompi getMerchant", Nodes: []string{"payments"}, Note: "P0: dump crudo si falla el lookup de merchant", At: time.Date(2026, 7, 18, 10, 0, 0, 0, time.UTC)},
		{Task: "des-motaización + TyC por comercio", Nodes: []string{"motai", "creditopx", "merchants", "dynamic-forms", "kyc"}, At: time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)},
		{Task: "la conciliación de Corbeta no marcó la orden como facturada", Nodes: []string{"corbeta"}, At: time.Date(2026, 7, 15, 10, 0, 0, 0, time.UTC)},
	}
}

func TestPrecedentsMatchesSimilarTask(t *testing.T) {
	got := precedentsFor(recs(), "hay un dump crudo cuando falla el pago de Wompi", 3)
	if len(got) == 0 {
		t.Fatal("esperaba al menos un precedente para la tarea de Wompi")
	}
	if got[0].Nodes[0] != "payments" {
		t.Errorf("el precedente top debía apuntar a payments, vino %v", got[0].Nodes)
	}
	if len(got[0].Matched) < 2 {
		t.Errorf("esperaba ≥2 términos matcheados, vino %v", got[0].Matched)
	}
}

func TestPrecedentsRejectsSingleNoisyTerm(t *testing.T) {
	// "comercio" pega con la de motai, pero UN término compartido no es señal
	got := precedentsFor(recs(), "configurar el comercio nuevo del listado", 3)
	for _, p := range got {
		for _, m := range p.Matched {
			if len(p.Matched) < 2 {
				t.Errorf("precedente con 1 solo término (%q) debía filtrarse: %+v", m, p)
			}
		}
	}
}

func TestPrecedentsSingleTermTaskAllowed(t *testing.T) {
	// si la tarea entrante tiene UN solo término con carga, un hit alcanza
	got := precedentsFor(recs(), "corbeta", 3)
	if len(got) != 1 || got[0].Nodes[0] != "corbeta" {
		t.Errorf("esperaba el precedente de corbeta, vino %+v", got)
	}
}

func TestPrecedentsOrdersByScoreThenRecency(t *testing.T) {
	rs := []TaskRecord{
		{Task: "wompi pago cuota inicial", Nodes: []string{"payments"}, At: time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)},
		{Task: "wompi pago recaudo aplicado", Nodes: []string{"servicing"}, At: time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)},
	}
	got := precedentsFor(rs, "wompi pago", 3)
	if len(got) != 2 {
		t.Fatalf("esperaba 2 precedentes, vino %d", len(got))
	}
	// mismo score (2 términos) → gana el más reciente
	if got[0].Nodes[0] != "servicing" {
		t.Errorf("a igual score debía ganar el más reciente (servicing), vino %v", got[0].Nodes)
	}
}

func TestPrecedentsEmptyInputs(t *testing.T) {
	if p := precedentsFor(nil, "cualquier cosa", 3); p != nil {
		t.Errorf("sin registros debía dar nil, vino %+v", p)
	}
	if p := precedentsFor(recs(), "", 3); p != nil {
		t.Errorf("sin tarea debía dar nil, vino %+v", p)
	}
}
