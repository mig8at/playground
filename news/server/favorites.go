package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"creditop/my-tools/lib/machine"
)

// Favorite: un modelo curioso que se guarda para no perderlo de vista (Miguel, 2026-11-19). Los elige y los escribe
// Claude, a mano, en news/favorites.json (en git): no salen de una semana, así que sobreviven al cambio de semana.
type Favorite struct {
	ID      string `json:"id"`
	Group   string `json:"group"` // tried · voice · music · odd · tiny · detect · create · specialist · gpu
	Task    string `json:"task"`
	Params  *int64 `json:"params"`
	License string `json:"license"`
	Mac     string `json:"mac"` // yes · no · unknown: si corre en la Mac
	// PC: lo mismo para el PC con Linux (lib/machine), si alguien lo probó o lo dice la ficha. Vacío = todavía no se sabe
	// y News lo estima por tamaño (fits.go). No reemplaza a `mac`: son dos máquinas y cada una tiene su dato.
	PC    string   `json:"pc,omitempty"`
	Added string   `json:"added"`
	What  string   `json:"what"`
	Why   string   `json:"why"`
	Ideas []string `json:"ideas"`
	Tried string   `json:"tried,omitempty"` // lo que dio cuando lo probamos
	// El historial de lo probado: cuándo, si vale la pena (keep) o se descartó y se borró (dropped), por qué, qué
	// herramienta lo usa y qué claves de los instalados son suyas (para ver su tamaño y borrarlo desde la ficha).
	TriedOn    string   `json:"triedOn,omitempty"`
	Verdict    string   `json:"verdict,omitempty"`
	VerdictWhy string   `json:"verdictWhy,omitempty"`
	UsedBy     string   `json:"usedBy,omitempty"`
	Installed  []string `json:"installed,omitempty"`
	// TriedIn: en qué máquina se probó (mac · pc). Vacío = la Mac, que es donde se probó todo hasta el 2026-11-19.
	TriedIn string `json:"triedIn,omitempty"`
	// Here: si corre en la máquina donde está abierto News. Lo calcula el servidor (fits.go); no se escribe en el archivo.
	Here *Fit `json:"here,omitempty"`
}

var favoriteGroups = map[string]bool{"tried": true, "voice": true, "music": true, "odd": true, "tiny": true, "detect": true, "create": true, "specialist": true, "gpu": true}

func (s *server) favoritesPath() string { return filepath.Join(s.root, "news", "favorites.json") }

// loadFavorites lee el archivo y rechaza uno a medio escribir: sin id, sin grupo conocido, sin qué hace ni por qué.
func loadFavorites(path string) ([]Favorite, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []Favorite{}, nil
	}
	if err != nil {
		return nil, err
	}
	var out []Favorite
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("favorites.json: %w", err)
	}
	seen := map[string]bool{}
	for i, f := range out {
		switch {
		case f.ID == "" || !strings.Contains(f.ID, "/"):
			return nil, fmt.Errorf("favorites.json: el %d.º no tiene un id «autor/modelo»", i+1)
		case seen[f.ID]:
			return nil, fmt.Errorf("favorites.json: %s está dos veces", f.ID)
		case !favoriteGroups[f.Group]:
			return nil, fmt.Errorf("favorites.json: %s tiene un grupo desconocido %q", f.ID, f.Group)
		case f.Mac != "yes" && f.Mac != "no" && f.Mac != "unknown":
			return nil, fmt.Errorf("favorites.json: %s: mac debe ser yes, no o unknown", f.ID)
		case f.PC != "" && f.PC != "yes" && f.PC != "no" && f.PC != "unknown":
			return nil, fmt.Errorf("favorites.json: %s: pc debe ser yes, no o unknown (o no estar)", f.ID)
		case f.TriedIn != "" && f.TriedIn != "mac" && f.TriedIn != "pc":
			return nil, fmt.Errorf("favorites.json: %s: triedIn debe ser mac o pc", f.ID)
		case f.Verdict != "" && f.Verdict != "keep" && f.Verdict != "dropped":
			return nil, fmt.Errorf("favorites.json: %s: verdict debe ser keep o dropped", f.ID)
		case f.Verdict != "" && f.TriedOn == "":
			return nil, fmt.Errorf("favorites.json: %s tiene veredicto pero no triedOn", f.ID)
		case f.What == "" || f.Why == "":
			return nil, fmt.Errorf("favorites.json: a %s le falta qué hace o por qué es interesante", f.ID)
		}
		seen[f.ID] = true
	}
	return out, nil
}

func (s *server) favoritesRoute(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/favorites", func(w http.ResponseWriter, _ *http.Request) {
		favs, err := loadFavorites(s.favoritesPath())
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		// cada favorito sale con `here`: si corre en ESTA máquina (lo declarado para ella o, si no hay, la estimación)
		m := machine.Detect()
		for i := range favs {
			fit := fitFor(m, favs[i])
			favs[i].Here = &fit
			if favs[i].TriedOn != "" {
				favs[i].TriedIn = triedIn(favs[i])
			}
		}
		writeJSON(w, 200, map[string]any{"favorites": favs, "machine": m})
	})
}
