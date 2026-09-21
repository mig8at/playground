package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
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

// El corpus real es la vara: una ficha derivada de un map.json que no existe tiene que fallar, y una
// de un tema real tiene que traer áreas con objetivo. Sin esto, el lector podría devolver una ficha
// vacía sin error y la retoma imprimiría un tema en blanco como si no tuviera nada que decir.
func TestFichaDeCanonLeeElCorpusOLoDice(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "kyc"), 0o755); err != nil {
		t.Fatal(err)
	}
	crudo := `{"title":"El estudio del cliente","summary":"Burós y score.","areas":[
	  {"id":"disparo","objetivo":"Decidir si se consulta el buró.","secciones":["a","b"],
	   "tablas":["datacredito_frequencies"],"fuentes":{"legacy-backend":{"x.php":"ab12"}}},
	  {"id":"score","objetivo":"De dónde sale el score.","secciones":[],
	   "tablas":["datacredito_frequencies","scores"],"fuentes":{"application":{"y.php":"cd34"}}}]}`
	if err := os.WriteFile(filepath.Join(dir, "kyc", "map.json"), []byte(crudo), 0o644); err != nil {
		t.Fatal(err)
	}
	leer := fichaDeCanon(dir)

	f, err := leer("kyc")
	if err != nil {
		t.Fatalf("el tema existe: %v", err)
	}
	if f.Titulo != "El estudio del cliente" || len(f.Areas) != 2 || f.Areas[0].Secciones != 2 {
		t.Fatalf("la ficha sale del map.json tal como está: %+v", f)
	}
	if len(f.Tablas) != 2 || f.Tablas[0] != "datacredito_frequencies" {
		t.Fatalf("las tablas se juntan sin repetir y ordenadas: %v", f.Tablas)
	}
	if len(f.Repos) != 2 || f.Repos[0] != "application" {
		t.Fatalf("los repos salen de las fuentes de cada área: %v", f.Repos)
	}
	if _, err := leer("no-existe"); err == nil {
		t.Fatal("un tema que no está tiene que fallar, no devolver una ficha vacía")
	}
	if _, err := fichaDeCanon("")("kyc"); err == nil {
		t.Fatal("sin corpus configurado tiene que decirlo")
	}
}
