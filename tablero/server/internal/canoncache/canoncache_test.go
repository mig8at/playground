package canoncache

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"creditop/playground/connectors/canon"
)

const topicsBody = `{"temas":[{"topic":"cartera","title":"Cartera"},{"topic":"actores","title":"Actores"},{"topic":"canales","title":"Canales"}]}`
const mapBody = `{"mapa":{"groups":[{"titulo":"ENTRADA","x":0},{"titulo":"PAGOS","x":100}],
	"stations":[{"tema":"canales","x":10},{"tema":"cartera","x":120}]}}`

// El ciclo entero, que es lo que el hook de inicio hace cada vez: la primera baja todo; con el corpus igual
// canon contesta 304 y la copia sigue; sin canon, se usa la copia que había y se dice que falló.
func TestRefreshKeepsWorkingWithoutCanon(t *testing.T) {
	var topicsCalls, mapCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/topics":
			topicsCalls++
			if r.Header.Get("If-None-Match") == `"c1"` {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", `"c1"`)
			w.Write([]byte(topicsBody))
		case "/api/globalmap":
			mapCalls++
			w.Write([]byte(mapBody))
		}
	}))
	dir := t.TempDir()
	day1 := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)

	c, err := Refresh(context.Background(), canon.New(srv.URL), srv.URL, dir, day1)
	if err != nil || len(c.Topics) != 3 || c.ETag != `"c1"` {
		t.Fatalf("primera: %+v %v", c, err)
	}
	c, err = Refresh(context.Background(), canon.New(srv.URL), srv.URL, dir, day1.Add(time.Hour))
	if err != nil || len(c.Topics) != 3 || mapCalls != 1 || !c.FetchedAt.Equal(day1) || !c.CheckedAt.Equal(day1.Add(time.Hour)) {
		t.Fatalf("con el corpus igual no se baja el mapa de nuevo: mapa=%d %+v %v", mapCalls, c, err)
	}
	srv.Close()
	c, err = Refresh(context.Background(), canon.New(srv.URL), srv.URL, dir, day1.Add(2*time.Hour))
	if err == nil || len(c.Topics) != 3 {
		t.Fatalf("sin canon: la copia sigue y el error se dice: %d temas, err=%v", len(c.Topics), err)
	}
	if topicsCalls != 2 {
		t.Errorf("pedidos a topics: %d", topicsCalls)
	}
}

// La lista del inicio: cada tema en su etapa, y los que no tienen estación como transversales. Ninguno se
// pierde: un tema que no aparece es un tema que el agente no sabe que existe.
func TestCompactListsEveryTopic(t *testing.T) {
	c := Cache{
		Topics: []canon.TopicSummary{{Topic: "actores"}, {Topic: "canales"}, {Topic: "cartera"}},
		Stages: []canon.Stage{{Title: "ENTRADA", Topics: []string{"canales"}}, {Title: "PAGOS", Topics: []string{"cartera"}}},
	}
	got := c.Compact()
	for _, want := range []string{"entrada", "canales", "pagos", "cartera", "transversales", "actores"} {
		if !strings.Contains(got, want) {
			t.Errorf("falta %q en:\n%s", want, got)
		}
	}
}
