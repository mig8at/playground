package canon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// El corpus entero sale en tandas de `readBatch`: con más temas que una tanda, ninguno se puede perder
// entre dos pedidos, y la clave es el tema sin su capa, que es como lo nombran las tareas.
func TestCorpusReadsEveryTopicAcrossBatches(t *testing.T) {
	total := readBatch + 3
	var reads int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/index":
			var nodes []map[string]string
			for i := 0; i < total; i++ {
				nodes = append(nodes, map[string]string{"id": fmt.Sprintf("tema%d/context", i)})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"nodes": nodes})
		case "/api/read":
			reads++
			var nodes []map[string]any
			for _, id := range strings.Split(r.URL.Query().Get("ids"), ",") {
				nodes = append(nodes, map[string]any{
					"id":    id,
					"areas": []map[string]any{{"objetivo": "algo", "fuentes": map[string]map[string]string{"legacy-backend": {"a.php": "abc"}}}},
					"sections": []map[string]any{{"title": "Una sección", "blocks": []map[string]string{
						{"text": "Primer párrafo."}, {"text": "Nombra `user_requests`."}}}},
				})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"nodes": nodes})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	topics, err := New(server.URL).Corpus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(topics) != total || reads != 2 {
		t.Fatalf("esperaba %d temas en 2 tandas; dio %d temas en %d pedidos", total, len(topics), reads)
	}
	topic, ok := topics[fmt.Sprintf("tema%d", total-1)]
	if !ok {
		t.Fatalf("el último tema de la segunda tanda no llegó, o su clave conserva la capa: %v", topics)
	}
	if topic.Prose != "Una sección\nPrimer párrafo.\nNombra `user_requests`." {
		t.Fatalf("la prosa tiene que ser títulos y párrafos en orden: %q", topic.Prose)
	}
	if len(topic.Areas) != 1 || topic.Areas[0].Sources["legacy-backend"]["a.php"] != "abc" {
		t.Fatalf("el mapa tiene que llegar con sus fuentes: %+v", topic.Areas)
	}
}

// Un canon que no responde es un error, no un corpus vacío: el vacío lo decide quien llama.
func TestCorpusFailsWhenCanonDoesNotAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("no"))
	}))
	defer server.Close()
	if _, err := New(server.URL).Corpus(context.Background()); err == nil {
		t.Fatal("un 502 sin JSON tiene que ser error")
	}
}
