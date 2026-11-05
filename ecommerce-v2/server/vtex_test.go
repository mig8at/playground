package main

/* Los diagnósticos de VTEX contra transacciones REALES de la cuenta creditop (qa, 2026-11-03 y 2026-11-04), guardadas
 * en testdata/ con los mensajes ya recortados (sin cuerpos ni referencias). Cada caso es una incidencia que pasó. */

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type txFixture struct {
	Status       string `json:"status"`
	Interactions []struct {
		Date    string `json:"Date"`
		Message string `json:"Message"`
	} `json:"interactions"`
}

func loadTx(t *testing.T, tid string) ([]VtexEvent, string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "tx-"+tid+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var f txFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	events := make([]VtexEvent, 0, len(f.Interactions))
	for _, i := range f.Interactions {
		events = append(events, VtexEvent{Date: i.Date, Message: shortMessage(i.Message)})
	}
	return events, f.Status
}

func codes(d Diagnosis) map[string]string {
	out := map[string]string{}
	for _, f := range d.Findings {
		out[f.Code] = f.Level
	}
	return out
}

func TestDiagnoseColdStartTimeout(t *testing.T) {
	// Pedido 1673880500241 (ecommerce_request 8083): el primer authorize tardó 15,6 s y VTEX cortó.
	events, status := loadTx(t, "48E3EB30D2114267987C61A7F5E8C039")
	d := Diagnose(events, status, CreditopSide{})
	c := codes(d)
	if c["timeout"] != "fail" || c["no_request"] != "warn" {
		t.Fatalf("esperaba timeout y no_request por timeout, dio %v", d.Findings)
	}
	if c["slow"] != "" {
		t.Fatalf("con timeout no se avisa además lentitud: %v", d.Findings)
	}
	if d.AuthLatency == nil || *d.AuthLatency < 15 || *d.AuthLatency > 16 {
		t.Fatalf("latencia: %v", d.AuthLatency)
	}
	if d.AuthResponse != "504 GatewayTimeout" {
		t.Fatalf("respuesta: %q", d.AuthResponse)
	}
	if !strings.Contains(d.Findings[len(d.Findings)-1].Text, "no contestó a tiempo") {
		t.Fatalf("la falta de solicitud tiene que nombrar la causa: %v", d.Findings)
	}
}

func TestDiagnoseWarmTimeout(t *testing.T) {
	// Pedido 1673900500257 (8096): 2,1 s, sin arranque en frío. También es timeout.
	events, status := loadTx(t, "56D3CA9497A040FE804B4B1D342C55DF")
	d := Diagnose(events, status, CreditopSide{})
	if codes(d)["timeout"] != "fail" || d.AuthLatency == nil || *d.AuthLatency < 2 || *d.AuthLatency > 2.5 {
		t.Fatalf("esperaba timeout de ~2,1 s: %v %v", d.Findings, d.AuthLatency)
	}
}

func TestDiagnoseCancellationStuck(t *testing.T) {
	// Pedido 1673610500233 (8073, solicitud 504349 en 9): a las 6 h VTEX pidió cancelar y el conector lo negó.
	events, status := loadTx(t, "8A12CD3532E947A4A50312C2B736723D")
	if status != "Cancelling" {
		t.Fatalf("la transacción del caso estaba en Cancelling, dio %q", status)
	}
	d := Diagnose(events, status, CreditopSide{HasRequest: true, StatusID: 9})
	c := codes(d)
	if c["cancel_stuck"] != "fail" {
		t.Fatalf("esperaba cancel_stuck: %v", d.Findings)
	}
	if !strings.Contains(d.Findings[0].Text, "sigue viva") {
		t.Fatalf("con la solicitud viva tiene que decirlo: %v", d.Findings)
	}
	if c["timeout"] != "" || c["slow"] != "" || c["no_request"] != "" {
		t.Fatalf("el authorize de este caso fue normal: %v", d.Findings)
	}
}

func TestDiagnoseSecondResultIgnored(t *testing.T) {
	// Solicitud 504527 (pedido 1673880500247): cancelada y después negada por el simulador; VTEX ignoró el segundo.
	events, status := loadTx(t, "C2705E4E61594704BE9A6915E91D86DF")
	d := Diagnose(events, status, CreditopSide{HasRequest: true, StatusID: 6})
	c := codes(d)
	if c["second_result"] != "warn" {
		t.Fatalf("esperaba second_result: %v", d.Findings)
	}
	// Creditop en 6 y VTEX cancelado: los dos negativos, no es un descuadre.
	if c["mismatch"] != "" {
		t.Fatalf("6 contra Cancelled no es descuadre: %v", d.Findings)
	}
}

func TestDiagnoseHealthyApproved(t *testing.T) {
	// Pedido 1673880500243 (8085, solicitud 504525 en 11): sano.
	events, status := loadTx(t, "110A6B4D46384E81A3EDE28202F3AF7E")
	d := Diagnose(events, status, CreditopSide{HasRequest: true, StatusID: 11})
	if len(d.Findings) != 0 {
		t.Fatalf("un pedido sano no tiene incidencias: %v", d.Findings)
	}
	if d.AuthLatency == nil || *d.AuthLatency > SlowAuthorize {
		t.Fatalf("latencia: %v", d.AuthLatency)
	}
}

func TestDiagnoseRetryTimeout(t *testing.T) {
	// Pedido 1673810500239 (8077, solicitud 504459 en 11): el checkout contestó en 1,2 s, pero el authorize que VTEX
	// hizo tras el aviso de aprobación cortó a los 2 s y la aprobación llegó a la tienda una hora después.
	events, status := loadTx(t, "0FA7D671B48F4F54BAB4F117B1108923")
	d := Diagnose(events, status, CreditopSide{HasRequest: true, StatusID: 11})
	c := codes(d)
	if c["timeout"] != "" || c["retry_timeout"] != "warn" {
		t.Fatalf("un timeout en un reintento no es el del checkout: %v", d.Findings)
	}
	if c["mismatch"] != "" {
		t.Fatalf("terminó aprobado de los dos lados: %v", d.Findings)
	}
}

func TestDiagnoseSlowButAnswered(t *testing.T) {
	// Pedido de 8094: el authorize del checkout tardó 17 s y VTEX igual aceptó el 200. Lento, no timeout.
	events, status := loadTx(t, "C9EB4CCBE833427692978EDE28379ADC")
	d := Diagnose(events, status, CreditopSide{HasRequest: true, StatusID: 6})
	c := codes(d)
	if c["slow"] != "warn" || c["timeout"] != "" {
		t.Fatalf("esperaba lento sin timeout: %v", d.Findings)
	}
	if d.AuthLatency == nil || *d.AuthLatency < 17 || *d.AuthLatency > 17.5 {
		t.Fatalf("latencia: %v", d.AuthLatency)
	}
}

func TestDiagnoseMismatches(t *testing.T) {
	cases := []struct {
		name   string
		status string
		side   CreditopSide
		want   bool
	}{
		{"autorizada y VTEX cancelado", "Cancelled", CreditopSide{true, 11}, true},
		{"autorizada y VTEX aprobado", "Approved", CreditopSide{true, 11}, false},
		{"autorizada y VTEX cobrado", "Finished", CreditopSide{true, 11}, false},
		{"negada y VTEX aprobado", "Approved", CreditopSide{true, 6}, true},
		{"cancelada y VTEX cobrado", "Finished", CreditopSide{true, 8}, true},
		{"viva y VTEX cancelado", "Cancelled", CreditopSide{true, 9}, true},
		{"negada y VTEX cancelado", "Cancelled", CreditopSide{true, 6}, false},
	}
	for _, tc := range cases {
		got := codes(Diagnose(nil, tc.status, tc.side))["mismatch"] == "fail"
		if got != tc.want {
			t.Errorf("%s: descuadre=%v, esperaba %v", tc.name, got, tc.want)
		}
	}
}

func TestVtexOrderID(t *testing.T) {
	for in, want := range map[string]string{
		"1673880500241":        "1673880500241-01",
		"1673880500241-01":     "1673880500241-01",
		"io1792518843-01":      "",
		"v1792516569247cdp-01": "",
		"":                     "",
	} {
		if got := VtexOrderID(in); got != want {
			t.Errorf("VtexOrderID(%q) = %q, esperaba %q", in, got, want)
		}
	}
}

func TestShortMessageDropsBodies(t *testing.T) {
	m := shortMessage(`Sending authorization request to https://x/payments?an=creditop: {"miniCart":{"buyer":{"email":"a@b.co"}}}`)
	if strings.Contains(m, "email") || !strings.HasSuffix(m, "{…}") {
		t.Fatalf("el cuerpo no se recortó: %q", m)
	}
	if got := shortMessage("pending through https://w/checkout?ref=abc-123 now"); strings.Contains(got, "abc") {
		t.Fatalf("la referencia no se recortó: %q", got)
	}
}
