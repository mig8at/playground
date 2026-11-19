package main

import (
	"testing"
	"time"
)

func TestWeekOf(t *testing.T) {
	loc := time.FixedZone("COT", -5*3600)
	cases := map[string][3]string{
		"2026-11-18": {"2026-W47", "2026-11-16", "2026-11-22"}, // miércoles
		"2026-11-16": {"2026-W47", "2026-11-16", "2026-11-22"}, // lunes
		"2026-11-22": {"2026-W47", "2026-11-16", "2026-11-22"}, // domingo
		"2027-01-01": {"2026-W53", "2026-12-28", "2027-01-03"}, // la semana ISO cruza el año
	}
	for day, want := range cases {
		d, _ := time.ParseInLocation("2006-01-02", day, loc)
		key, _, from, to := weekOf(d.Add(10 * time.Hour))
		if key != want[0] || from.Format("2006-01-02") != want[1] || to.Format("2006-01-02") != want[2] {
			t.Errorf("%s → %s %s %s, quería %v", day, key, from.Format("2006-01-02"), to.Format("2006-01-02"), want)
		}
	}
}

// carry: con los mismos modelos, los textos de antes pasan a la versión nueva; los que no estaban no se inventan.
func TestCarry(t *testing.T) {
	prev := &Week{Models: []Model{{ID: "a/x", What: "hace x", Novelty: "nuevo x"}}, Papers: []Paper{{ID: "1", SummarySpanish: "uno"}},
		Lead: "a/x", Why: "porque", Wrote: "abc"}
	w := &Week{Models: []Model{{ID: "a/x"}, {ID: "b/y"}}, Papers: []Paper{{ID: "1"}, {ID: "2"}}}
	carry(prev, w)
	if w.Models[0].What != "hace x" || w.Models[1].What != "" || w.Papers[0].SummarySpanish != "uno" || w.Papers[1].SummarySpanish != "" {
		t.Fatalf("%+v %+v", w.Models, w.Papers)
	}
	if w.Lead != "a/x" || w.Wrote != "abc" {
		t.Fatalf("%+v", w)
	}
}

func TestFingerprintOnlyNewModelsAndPapers(t *testing.T) {
	a := &Week{Models: []Model{{ID: "a", New: true}, {ID: "b", Likes: 1}}, Papers: []Paper{{ID: "1"}}}
	b := &Week{Models: []Model{{ID: "a", New: true, Likes: 99}, {ID: "c"}}, Papers: []Paper{{ID: "1", Upvotes: 5}}}
	if fingerprint(a) != fingerprint(b) {
		t.Fatal("cambió la huella por algo que no se le manda al modelo")
	}
	b.Models = append(b.Models, Model{ID: "d", New: true})
	if fingerprint(a) == fingerprint(b) {
		t.Fatal("un modelo nuevo más tiene que cambiar la huella")
	}
}

// Los favoritos del repo se leen enteros: un error de tipeo en el JSON lo dice la prueba, no la interfaz en blanco.
func TestFavoritesFileIsValid(t *testing.T) {
	favs, err := loadFavorites("../favorites.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(favs) == 0 {
		t.Fatal("favorites.json vacío")
	}
}

// La investigación cita favoritos e ideas por id: un error de tipeo en el archivo tiene que fallar acá, no en la UI.
func TestResearchFileIsValid(t *testing.T) {
	favs, err := loadFavorites("../favorites.json")
	if err != nil {
		t.Fatal(err)
	}
	r, err := loadResearch("../research.json", favs)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Ideas) == 0 || len(r.Lineages) == 0 {
		t.Fatal("research.json sin ideas o sin linajes")
	}
	if _, err := loadResearch("../research.json", favs[:1]); err == nil {
		t.Fatal("una idea que cita un favorito que no existe tenía que fallar")
	}
}
