package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"creditop/tablero/server/internal/canon"
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

func TestFichasCanonRespetaElTopeYNoCallaErrores(t *testing.T) {
	declarados := []string{"a", "b", "c", "d", "e", "f"}
	leer := func(n string) (fichaCanon, error) {
		if n == "c" {
			return fichaCanon{}, errors.New("el tema no está en el corpus")
		}
		return fichaCanon{Titulo: "tema " + n}, nil
	}
	fichas, aviso := fichasCanon(declarados, "1", leer)
	if len(fichas) != topeFichas || !strings.Contains(aviso, "2 más") || !strings.Contains(aviso, "e, f") {
		t.Fatalf("con BRIEF=1 van los primeros %d y el aviso nombra el resto: %d fichas, aviso %q", topeFichas, len(fichas), aviso)
	}
	if fichas[2].Error == "" || fichas[2].Titulo != "" || fichas[1].Titulo != "tema b" {
		t.Fatalf("una ficha que falla queda como error EN su ficha, y las demás siguen: %+v", fichas)
	}
	if fichas[2].Tema != "c" {
		t.Fatalf("la ficha que falló igual dice de qué tema era: %+v", fichas[2])
	}
	fichas, aviso = fichasCanon(declarados, "f, zz", leer)
	if aviso != "" || len(fichas) != 2 || !fichas[0].Declarado || fichas[1].Declarado {
		t.Fatalf("BRIEF=a,b elige esos temas y marca el que la tarea no declara: %+v aviso %q", fichas, aviso)
	}
	if fichas, _ := fichasCanon(nil, "1", leer); fichas != nil {
		t.Fatal("sin `canon:` y con BRIEF=1 no hay fichas: la sección lo dice, no inventa temas")
	}
}

func TestFichaDesdeCanonProyectaLaRespuestaDeLaAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/read" || r.URL.Query().Get("ids") != "kyc/context" {
			t.Fatalf("pedido inesperado: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"nodes":[{"id":"kyc/context","title":"El estudio del cliente","summary":"Burós y score.","repos":{"application":""},"areas":[
			{"id":"disparo","objetivo":"Decidir si se consulta el buró.","secciones":["a","b"],"tablas":["datacredito_frequencies"],"fuentes":{"legacy-backend":{"x.php":"ab12"}}},
			{"id":"score","objetivo":"De dónde sale el score.","secciones":[],"tablas":["datacredito_frequencies","scores"],"fuentes":{}}]}]}`))
	}))
	defer server.Close()

	f, err := fichaDesdeCanon(canon.New(server.URL))("kyc")
	if err != nil {
		t.Fatalf("la referencia existe: %v", err)
	}
	if f.Titulo != "El estudio del cliente" || len(f.Areas) != 2 || f.Areas[0].Secciones != 2 {
		t.Fatalf("la ficha no conserva la respuesta de Canon: %+v", f)
	}
	if len(f.Tablas) != 2 || f.Tablas[0] != "datacredito_frequencies" {
		t.Fatalf("las tablas llegan desde Canon: %v", f.Tablas)
	}
	if len(f.Repos) != 2 || f.Repos[0] != "application" {
		t.Fatalf("los repos llegan desde Canon: %v", f.Repos)
	}
}
