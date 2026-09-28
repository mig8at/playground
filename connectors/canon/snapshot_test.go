package canon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

// Un tema va en TODAS las etapas donde tiene estaciones, en el orden del mapa. Tomar sólo la primera
// dejaba «pagos y cartera» vacía.
func TestStagesPlaceATopicWhereverItHasStations(t *testing.T) {
	raw := json.RawMessage(`{"mapa":{
		"groups":[{"titulo":"PAGOS","x":4950},{"titulo":"ENTRADA","x":90},{"titulo":"CIERRE","x":4230}],
		"stations":[{"tema":"cartera","x":4590},{"tema":"canales","x":90},{"tema":"cartera","x":4950},
		            {"tema":"cartera","x":5130},{"tema":"","x":100},{"tema":"canales","x":500}]}}`)
	got, err := Stages(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := []Stage{{"ENTRADA", []string{"canales"}}, {"CIERRE", []string{"cartera"}}, {"PAGOS", []string{"cartera"}}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("etapas: %+v", got)
	}
}

// El pedido es condicional: con el ETag del corpus, canon contesta 304 y no se baja nada.
func TestTopicsIsConditional(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/topics" {
			t.Errorf("pidió %s", r.URL.Path)
		}
		if r.Header.Get("If-None-Match") == `"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		w.Write([]byte(`{"temas":[{"topic":"kyc","title":"KYC"},{"topic":"actores","title":"Actores"}]}`))
	}))
	defer srv.Close()
	c := New(srv.URL)
	topics, etag, notModified, err := c.Topics(context.Background(), "")
	if err != nil || notModified || etag != `"v1"` || len(topics) != 2 || topics[0].Topic != "actores" {
		t.Fatalf("primera: %v %q %v %v", topics, etag, notModified, err)
	}
	if _, _, notModified, err = c.Topics(context.Background(), etag); err != nil || !notModified {
		t.Fatalf("con el ETag tenía que ser 304: %v %v", notModified, err)
	}
	if calls != 2 {
		t.Errorf("pedidos: %d", calls)
	}
}

// El contexto se pide por POST con los temas, la consulta y el presupuesto, y vuelve con lo que entró y
// lo que quedó pendiente.
func TestContextSendsTopicsAndBudget(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		json.NewDecoder(r.Body).Decode(&in)
		if r.Method != http.MethodPost || r.URL.Path != "/api/context" || in["q"] != "cuota" || in["max_bytes"].(float64) != 8000 {
			t.Errorf("pedido: %s %s %v", r.Method, r.URL.Path, in)
		}
		w.Write([]byte(`{"secciones":[{"id":"cuota/context#a","titulo":"A","texto":"x","verificado":"2026-09-03",
			"respaldo":[{"objetivo":"armar la cuota","referencia":"cuota/context#a=area-1"}]}],"pendientes":["cuota/context#s=b"],"omitidas":1}`))
	}))
	defer srv.Close()
	p, err := New(srv.URL).Context(context.Background(), ContextRequest{Q: "cuota", Topics: []string{"cuota/context"}, MaxBytes: 8000})
	if err != nil || len(p.Sections) != 1 || p.Sections[0].Backing[0].Goal != "armar la cuota" || len(p.Pending) != 1 {
		t.Fatalf("paquete: %+v %v", p, err)
	}
}
