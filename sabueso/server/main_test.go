package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newReq(method, path string, body io.Reader) *http.Request {
	req := httptest.NewRequest(method, path, body)
	req.Host = "127.0.0.1:5245"
	req.Header.Set("X-Sabueso", "1")
	return req
}

func do(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestFit(t *testing.T) {
	chain, _ := computeFit(&Company{Kind: KindMerchant, Points: 40, Sector: "dental"})
	small, _ := computeFit(&Company{Kind: KindMerchant, Points: 1, Sector: "dental"})
	cars, _ := computeFit(&Company{Kind: KindMerchant, Points: 40, Sector: "cars"})
	online, why := computeFit(&Company{Kind: KindMerchant, Points: 1, Sector: "dental", Online: true})
	if !(chain > cars && cars > small) {
		t.Errorf("una cadena de un sector que encaja gana: cadena %d, carros %d, chico %d", chain, cars, small)
	}
	if online <= small+20 {
		t.Errorf("vender en línea con un solo punto es la excepción medida: %d contra %d", online, small)
	}
	if len(why) != 3 {
		t.Errorf("cada razón se explica: %v", why)
	}
	if f, _ := computeFit(&Company{Kind: KindLender, Points: 50}); f != 0 {
		t.Errorf("a una entidad no se le mide encaje de comercio: %d", f)
	}
}

func TestNormalize(t *testing.T) {
	if got := normalizeNIT("900.123.456-7"); got != "900123456" {
		t.Errorf("normalizeNIT = %q", got)
	}
	if got := normalizeName("MOTOS RED NACIONAL S.A.S."); got != "motos red nacional" {
		t.Errorf("normalizeName = %q", got)
	}
	m := &Measured{Clients: []Client{{Name: "Sonría", NIT: "830108482"}, {Name: "Amoblando Pullman"}}}
	m.index()
	if m.IsClient("830.108.482-1", "") == "" {
		t.Error("por NIT")
	}
	if m.IsClient("", "AMOBLANDO PULLMAN S.A.S") == "" {
		t.Error("por nombre, cuando CreditOp no tiene el NIT")
	}
	if m.IsClient("", "Amoblando Pullman Medellín") == "" {
		t.Error("por nombre que empieza igual")
	}
	if m.IsClient("901000000", "Todomotos VS") != "" {
		t.Error("una que no es cliente")
	}
}

func TestAPI(t *testing.T) {
	dataDir = t.TempDir()
	root = t.TempDir()
	h := guard(routes())
	call := func(method, path string, body any) (int, map[string]any) {
		var b []byte
		if body != nil {
			b, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(b))
		req.Host = "127.0.0.1:5245"
		req.Header.Set("X-Sabueso", "1")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	// sin el encabezado no pasa
	req := httptest.NewRequest("GET", "/api/state", nil)
	req.Host = "127.0.0.1"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("sin X-Sabueso: %d", rec.Code)
	}
	code, out := call("POST", "/api/companies", map[string]any{"kind": "merchant", "name": "Todomotos VS S.A.S.", "nit": "830506750", "sector": "motorcycles", "points": 64})
	if code != 200 {
		t.Fatalf("crear: %d %v", code, out)
	}
	id := out["id"].(string)
	if code, _ := call("POST", "/api/companies", map[string]any{"kind": "merchant", "name": "TODOMOTOS VS"}); code != 400 {
		t.Errorf("una repetida por nombre se rechaza: %d", code)
	}
	if code, _ := call("PATCH", "/api/companies/"+id, map[string]any{"stage": "contacted", "handedTo": "Laura", "next": map[string]string{"text": "Llamar", "due": "2026-11-25"}}); code != 200 {
		t.Fatalf("mover: %d", code)
	}
	if code, _ := call("PATCH", "/api/companies/"+id, map[string]any{"stage": "integration"}); code != 400 {
		t.Errorf("una etapa de entidad no vale para un comercio: %d", code)
	}
	if code, _ := call("POST", "/api/companies/"+id+"/activities", map[string]any{"kind": "call", "text": "Interesados"}); code != 200 {
		t.Fatalf("bitácora: %d", code)
	}
	st, _ := loadState()
	c := st.Companies[0]
	if c.Stage != "contacted" || c.HandedTo != "Laura" || c.Next == nil || len(c.Activities) != 4 {
		t.Fatalf("quedó %+v con %d actividades", c, len(c.Activities))
	}
	if c.Activities[2].Text != "Lo retoma Laura: sigue en persona" {
		t.Errorf("el pase queda en la bitácora: %q", c.Activities[2].Text)
	}
	if code, _ := call("DELETE", "/api/companies/"+id, nil); code != 200 {
		t.Errorf("borrar: %d", code)
	}
	if code, _ := call("DELETE", "/api/companies/"+id, nil); code != http.StatusNotFound {
		t.Errorf("borrar dos veces: %d", code)
	}
}
