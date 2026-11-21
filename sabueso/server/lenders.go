package main

// LAS ENTIDADES QUE LLEVARÍAN A CREDITOP A OTROS PAÍSES (la sección «Entidades» al fondo del sidebar). Salen de
// `sabueso/lenders.json`, que armó Claude buscando en internet dónde opera cada una (tarea 136), y se cruzan con prod:
// si CreditOp ya la tiene (por sus nombres en `lenders`) y qué países activaría (los que tiene la entidad y CreditOp
// todavía no). Se ordenan de la que más países activa a la que menos. Sólo se muestran: quedan pendientes.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// LenderCountry: un país donde opera una entidad, con su fuente.
type LenderCountry struct {
	Country      string `json:"country"`
	How          string `json:"how,omitempty"`
	PosFinancing string `json:"posFinancing,omitempty"`
	Source       string `json:"source"`
	Unconfirmed  bool   `json:"unconfirmed,omitempty"`
}

// Lender: una entidad y lo que activaría.
type Lender struct {
	Name      string          `json:"name"`
	Aliases   []string        `json:"aliases"`
	What      string          `json:"what"`
	Countries []LenderCountry `json:"countries"`
	Have      bool            `json:"have"`      // CreditOp ya la tiene (en algún país)
	Activates []string        `json:"activates"` // los países donde opera y CreditOp todavía no
}

// spanishCountry: el nombre en español de un país de la tabla `countries` (que está en inglés).
func spanishCountry(name string) string {
	m := map[string]string{"Peru": "Perú", "Dominican Republic": "República Dominicana", "Mexico": "México", "Brazil": "Brasil",
		"Panama": "Panamá", "Puerto Rico": "Puerto Rico"}
	if s, ok := m[name]; ok {
		return s
	}
	return name
}

func loadLenders() ([]Lender, error) {
	b, err := os.ReadFile(filepath.Join(root, "sabueso", "lenders.json"))
	if err != nil {
		return nil, err
	}
	var doc struct {
		Lenders []Lender `json:"lenders"`
	}
	return doc.Lenders, json.Unmarshal(b, &doc)
}

// rankLenders marca las que CreditOp ya tiene, calcula qué países activaría cada una y las ordena.
func rankLenders(list []Lender, m *Measured) []Lender {
	operating := map[string]bool{}
	for _, c := range m.Countries {
		operating[c] = true
	}
	if len(operating) == 0 {
		operating["Colombia"] = true // sin medición, al menos Colombia
	}
	for i := range list {
		l := &list[i]
		l.Have = false
		for _, have := range m.Lenders {
			for _, a := range l.Aliases {
				if strings.Contains(strings.ToLower(have), strings.ToLower(a)) {
					l.Have = true
				}
			}
		}
		l.Activates = []string{}
		for _, c := range l.Countries {
			if !operating[c.Country] {
				l.Activates = append(l.Activates, c.Country)
			}
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		if len(list[i].Activates) != len(list[j].Activates) {
			return len(list[i].Activates) > len(list[j].Activates)
		}
		return list[i].Name < list[j].Name
	})
	return list
}
