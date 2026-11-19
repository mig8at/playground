package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// La investigación (Miguel, 2026-11-19: «entender cómo calibran y mejoran los modelos, cómo ha trabajado la comunidad
// y con qué máquinas»). Las ideas que mejoraron modelos, cada una con su problema, su evidencia (la cifra del paper) y
// la máquina que hizo falta; y los linajes: familias de modelos con la idea que entró en cada salto. Lo escribe Claude,
// a mano, en news/research.json (en git), con cada cifra sacada de su paper.

type PaperRef struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type Idea struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Stage    string   `json:"stage"` // data · architecture · training · alignment · efficiency · use
	Year     int      `json:"year"`
	Who      string   `json:"who"`
	Paper    PaperRef `json:"paper"`
	Problem  string   `json:"problem"`
	Idea     string   `json:"idea"`
	Evidence string   `json:"evidence"`
	Hardware string   `json:"hardware"` // mac · gpu · server · datacenter · unknown: lo que hizo falta para lograrlo
	Machine  string   `json:"machine"`
	Cheap    string   `json:"cheap,omitempty"` // alguien que lo logró con poco
	Mac      string   `json:"mac,omitempty"`   // cómo se hace en esta Mac
	Models   []string `json:"models"`          // favoritos que la usan
	Ours     string   `json:"ours,omitempty"`  // lo que medimos acá
}

type LineageStep struct {
	Model  string   `json:"model"`
	Date   string   `json:"date"`
	Who    string   `json:"who"`
	Change string   `json:"change"`
	Ideas  []string `json:"ideas"`
}

type Lineage struct {
	ID    string        `json:"id"`
	Name  string        `json:"name"`
	Why   string        `json:"why"`
	Steps []LineageStep `json:"steps"`
}

type Research struct {
	Ideas    []Idea    `json:"ideas"`
	Lineages []Lineage `json:"lineages"`
}

var (
	researchStages   = map[string]bool{"data": true, "architecture": true, "training": true, "alignment": true, "efficiency": true, "use": true}
	researchHardware = map[string]bool{"mac": true, "gpu": true, "server": true, "datacenter": true, "unknown": true}
)

func (s *server) researchPath() string { return filepath.Join(s.root, "news", "research.json") }

// loadResearch lee el archivo y rechaza uno a medio escribir: una idea sin problema, idea o evidencia, sin paper, con
// una etapa o máquina desconocida, o que cita un favorito que no existe; un linaje que cita una idea que no existe.
func loadResearch(path string, favs []Favorite) (Research, error) {
	var r Research
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Research{Ideas: []Idea{}, Lineages: []Lineage{}}, nil
	}
	if err != nil {
		return r, err
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return r, fmt.Errorf("research.json: %w", err)
	}
	fav := map[string]bool{}
	for _, f := range favs {
		fav[f.ID] = true
	}
	ideas := map[string]bool{}
	for i, d := range r.Ideas {
		switch {
		case d.ID == "":
			return r, fmt.Errorf("research.json: la idea %d.ª no tiene id", i+1)
		case ideas[d.ID]:
			return r, fmt.Errorf("research.json: la idea %s está dos veces", d.ID)
		case !researchStages[d.Stage]:
			return r, fmt.Errorf("research.json: %s tiene una etapa desconocida %q", d.ID, d.Stage)
		case !researchHardware[d.Hardware]:
			return r, fmt.Errorf("research.json: %s tiene una máquina desconocida %q", d.ID, d.Hardware)
		case d.Name == "" || d.Problem == "" || d.Idea == "" || d.Evidence == "":
			return r, fmt.Errorf("research.json: a %s le falta el nombre, el problema, la idea o la evidencia", d.ID)
		case d.Year < 1990 || !strings.HasPrefix(d.Paper.URL, "https://") || d.Paper.Title == "":
			return r, fmt.Errorf("research.json: %s necesita el año y su paper (título y enlace https)", d.ID)
		}
		for _, m := range d.Models {
			if !fav[m] {
				return r, fmt.Errorf("research.json: %s cita %s, que no está en favorites.json", d.ID, m)
			}
		}
		ideas[d.ID] = true
	}
	lineages := map[string]bool{}
	for _, l := range r.Lineages {
		if l.ID == "" || lineages[l.ID] || l.Name == "" || len(l.Steps) < 2 {
			return r, fmt.Errorf("research.json: el linaje %q necesita un id único, un nombre y al menos dos pasos", l.ID)
		}
		lineages[l.ID] = true
		for _, st := range l.Steps {
			if st.Model == "" || st.Change == "" {
				return r, fmt.Errorf("research.json: un paso de %s no dice el modelo o qué cambió", l.ID)
			}
			for _, id := range st.Ideas {
				if !ideas[id] {
					return r, fmt.Errorf("research.json: %s · %s cita la idea %s, que no existe", l.ID, st.Model, id)
				}
			}
		}
	}
	return r, nil
}

func (s *server) researchRoute(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/research", func(w http.ResponseWriter, _ *http.Request) {
		favs, err := loadFavorites(s.favoritesPath())
		if err == nil {
			var r Research
			if r, err = loadResearch(s.researchPath(), favs); err == nil {
				writeJSON(w, 200, r)
				return
			}
		}
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	})
}
