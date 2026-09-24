package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"creditop/playground/tablero/server/internal/canon"
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

func TestCanonBriefsRespectLimitAndSurfaceErrors(t *testing.T) {
	declared := []string{"a", "b", "c", "d", "e", "f"}
	readBrief := func(n string) (canonBrief, error) {
		if n == "c" {
			return canonBrief{}, errors.New("el tema no está en el corpus")
		}
		return canonBrief{Title: "tema " + n}, nil
	}
	briefs, notice := canonBriefs(declared, "1", readBrief)
	if len(briefs) != briefLimit || !strings.Contains(notice, "2 más") || !strings.Contains(notice, "e, f") {
		t.Fatalf("con BRIEF=1 van los primeros %d y el aviso nombra el resto: %d fichas, aviso %q", briefLimit, len(briefs), notice)
	}
	if briefs[2].Error == "" || briefs[2].Title != "" || briefs[1].Title != "tema b" {
		t.Fatalf("una ficha que falla queda como error EN su ficha, y las demás siguen: %+v", briefs)
	}
	if briefs[2].Topic != "c" {
		t.Fatalf("la ficha que falló igual dice de qué tema era: %+v", briefs[2])
	}
	briefs, notice = canonBriefs(declared, "f, zz", readBrief)
	if notice != "" || len(briefs) != 2 || !briefs[0].Declared || briefs[1].Declared {
		t.Fatalf("BRIEF=a,b elige esos temas y marca el que la tarea no declara: %+v aviso %q", briefs, notice)
	}
	if briefs, _ := canonBriefs(nil, "1", readBrief); briefs != nil {
		t.Fatal("sin `canon:` y con BRIEF=1 no hay fichas: la sección lo dice, no inventa temas")
	}
}

func TestBriefFromCanonProjectsAPIResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/read" || r.URL.Query().Get("ids") != "kyc/context" {
			t.Fatalf("pedido inesperado: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"nodes":[{"id":"kyc/context","title":"El estudio del cliente","summary":"Burós y score.","repos":{"application":""},"areas":[
			{"id":"disparo","objetivo":"Decidir si se consulta el buró.","secciones":["a","b"],"tablas":["datacredito_frequencies"],"fuentes":{"legacy-backend":{"x.php":"ab12"}}},
			{"id":"score","objetivo":"De dónde sale el score.","secciones":[],"tablas":["datacredito_frequencies","scores"],"fuentes":{}}]}]}`))
	}))
	defer server.Close()

	f, err := briefFromCanon(canon.New(server.URL))("kyc")
	if err != nil {
		t.Fatalf("la referencia existe: %v", err)
	}
	if f.Title != "El estudio del cliente" || len(f.Areas) != 2 || f.Areas[0].Sections != 2 {
		t.Fatalf("la ficha no conserva la respuesta de Canon: %+v", f)
	}
	if len(f.Tables) != 2 || f.Tables[0] != "datacredito_frequencies" {
		t.Fatalf("las tablas llegan desde Canon: %v", f.Tables)
	}
	if len(f.Repos) != 2 || f.Repos[0] != "application" {
		t.Fatalf("los repos llegan desde Canon: %v", f.Repos)
	}
}
