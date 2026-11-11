package knowledge

import "testing"

func TestTouchedFindsSectionsByFileAndRanksByFiles(t *testing.T) {
	l := Library{Topics: []Topic{
		{ID: "listing", Sections: []Section{{ID: "listing#doors", Title: "Puertas"}, {ID: "listing#amount", Title: "Monto"}},
			Metadata: Metadata{Sources: []Source{
				{Repo: "legacy-backend", Path: "routes/api.php", Sections: []string{"doors"}},
				{Repo: "legacy-backend", Path: "app/Listing.php", Sections: []string{"doors", "amount"}},
				// la MISMA ruta en el otro monolito es otro archivo: no puede colarse
				{Repo: "application", Path: "routes/api.php", Sections: []string{"amount"}},
			}}},
		{ID: "other", Sections: []Section{{ID: "other#x", Title: "X"}},
			Metadata: Metadata{Sources: []Source{{Repo: "legacy-backend", Path: "app/Other.php", Sections: []string{"x"}}}}},
	}}
	got := l.Touched([]RepoFile{{"legacy-backend", "routes/api.php"}, {"legacy-backend", "app/Listing.php"}})
	if len(got) != 2 {
		t.Fatalf("esperaba 2 secciones, hubo %d: %+v", len(got), got)
	}
	// doors: api.php sólo la cita ella (1) + Listing.php lo citan dos (½) = 1,5; amount: ½
	if got[0].ID != "listing#doors" || len(got[0].Files) != 2 || got[0].Title != "Puertas" || got[0].Score != 1.5 {
		t.Fatalf("primero va la más específica: %+v", got[0])
	}
	if got[1].ID != "listing#amount" || len(got[1].Files) != 1 || got[1].Files[0] != "legacy-backend/app/Listing.php" {
		t.Fatalf("la ruta del otro monolito no cuenta: %+v", got[1])
	}
	if len(l.Touched([]RepoFile{{"application", "app/Listing.php"}})) != 0 {
		t.Fatal("un archivo que nadie cita no toca nada")
	}
}
