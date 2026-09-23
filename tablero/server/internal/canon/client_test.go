package canon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReferencesNormalizaTemaYConservaUnaCitaExacta(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/read" {
			t.Fatalf("ruta = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("ids"); got != "listado/context,kyc/context#disparo" {
			t.Fatalf("ids = %q", got)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"nodes":[
			{"id":"listado/context","title":"El listado","summary":"Cómo se arma.","areas":[],"repos":{}},
			{"id":"kyc/context","title":"KYC","summary":"Identidad.","areas":[],"repos":{}}
		]}`))
	}))
	defer server.Close()

	references, err := New(server.URL).References(context.Background(), []string{"listado", "kyc/context#disparo"})
	if err != nil {
		t.Fatal(err)
	}
	if len(references) != 2 || references[0].ID != "listado/context" || references[0].Title != "El listado" {
		t.Fatalf("referencias = %+v", references)
	}
	if references[1].ID != "kyc/context#disparo" || references[1].Title != "KYC" {
		t.Fatalf("la ancla se conserva como cita: %+v", references[1])
	}
}

func TestReferencesMarcaLaQueCanonNoEncuentra(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"nodes":[],"not_found":["inexistente/context"]}`))
	}))
	defer server.Close()

	references, err := New(server.URL).References(context.Background(), []string{"inexistente"})
	if err != nil {
		t.Fatal(err)
	}
	if len(references) != 1 || references[0].Error == "" || references[0].ID != "inexistente/context" {
		t.Fatalf("la referencia ausente no quedó explicada: %+v", references)
	}
}

func TestFichaSaleDeLaAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"nodes":[{"id":"kyc/context","title":"El estudio del cliente","summary":"Burós y score.","repos":{"application":""},"areas":[{"id":"disparo","objetivo":"Decidir si se consulta el buró.","secciones":["a","b"],"tablas":["scores"],"fuentes":{"legacy-backend":{"x.php":"abc"}}}]}]}`))
	}))
	defer server.Close()

	ficha, err := New(server.URL).Ficha(context.Background(), "kyc")
	if err != nil {
		t.Fatal(err)
	}
	if ficha.ID != "kyc/context" || ficha.Titulo != "El estudio del cliente" || len(ficha.Areas) != 1 {
		t.Fatalf("ficha = %+v", ficha)
	}
	if len(ficha.Tablas) != 1 || ficha.Tablas[0] != "scores" || len(ficha.Repos) != 2 {
		t.Fatalf("la ficha no preservó procedencia: %+v", ficha)
	}
}
