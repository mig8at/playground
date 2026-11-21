package main

// ENCONTRAR COMERCIOS EN UN PAÍS SIN REGISTRO ABIERTO (Perú): Claude busca en internet las cadenas del sector que
// venden en ese país, con cuántos locales tienen según su sitio o una fuente confiable. En Colombia se usa el registro
// mercantil (sources.go), que es exacto y gratis; acá cada búsqueda gasta el asiento del plan.

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const webFindSchema = `{"type":"object","properties":{"companies":{"type":"array","items":{"type":"object","properties":{
 "name":{"type":"string","description":"el nombre comercial"},
 "legalName":{"type":"string","description":"la razón social, si la encontraste"},
 "taxId":{"type":"string","description":"el número tributario (RUC en Perú), si lo encontraste"},
 "city":{"type":"string","description":"la ciudad de su sede"},
 "points":{"type":"integer","description":"cuántos locales o puntos de venta tiene, según su sitio o una fuente confiable; 0 si no se sabe"},
 "website":{"type":"string"},
 "what":{"type":"string","description":"en español, una frase: qué vende"},
 "source":{"type":"string","description":"la URL que respalda que existe y cuántos locales tiene"}
},"required":["name","city","points","website","what","source"]}}},"required":["companies"]}`

// WebCandidate: una empresa que encontró Claude.
type WebCandidate struct {
	Name      string `json:"name"`
	LegalName string `json:"legalName"`
	TaxID     string `json:"taxId"`
	City      string `json:"city"`
	Points    int    `json:"points"`
	Website   string `json:"website"`
	What      string `json:"what"`
	Source    string `json:"source"`
	Country   string `json:"country"`
	Sector    string `json:"sector"`
	Client    string `json:"client,omitempty"`
	Tracked   string `json:"tracked,omitempty"`
	NoChannel bool   `json:"noChannel,omitempty"`
	Fit       int    `json:"fit"`
}

// sectorHint: qué buscar en cada sector, en palabras de un comercio.
var sectorHint = map[string]string{
	"dental": "cadenas de clínicas u odontologías", "phones": "cadenas de tiendas de celulares",
	"home": "cadenas de tiendas de muebles, colchones y hogar", "appliances": "cadenas de tiendas de electrodomésticos",
	"motorcycles": "concesionarios y cadenas de venta de motos", "cars": "concesionarios de autos (nuevos y usados)",
	"health": "cadenas de clínicas de salud y estética",
}

var webFind = func(ctx context.Context, country Country, s *Sector, limit int, skip []string) ([]WebCandidate, float64, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Buscá en internet %s que venden en %s y que tengan varios locales o puntos de venta. ", sectorHint[s.ID], country.Name)
	b.WriteString("Son prospectos para una fintech que ofrece a sus clientes financiación a crédito en el punto de venta y en línea, así que sirven más las que tienen más locales y venden productos o servicios que la gente paga a cuotas.\n\n")
	fmt.Fprintf(&b, "Traé hasta %d empresas, de la que tiene más locales a la que tiene menos.\n\n", limit)
	b.WriteString("Reglas:\n- Sólo empresas que existen y operan hoy en " + country.Name + ", cada una con la URL que lo respalda (su sitio, su página de locales o una noticia confiable).\n")
	b.WriteString("- El número de locales, el que publica la empresa o una fuente confiable; 0 si no se sabe. No lo inventes.\n")
	if len(skip) > 0 {
		b.WriteString("- No incluyas a estas, que ya conocemos: " + strings.Join(skip, "; ") + ".\n")
	}
	raw, cost, _, err := runClaude(ctx, b.String(), webFindSchema)
	if err != nil {
		return nil, 0, err
	}
	var out struct {
		Companies []WebCandidate `json:"companies"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, cost, fmt.Errorf("la respuesta no trae el JSON pedido: %.200s", string(raw))
	}
	var keep []WebCandidate
	for _, c := range out.Companies {
		if strings.TrimSpace(c.Name) == "" || !strings.HasPrefix(c.Source, "http") {
			continue
		}
		c.Country, c.Sector, c.TaxID, c.Website = country.ID, s.ID, normalizeNIT(c.TaxID), cleanWebsite(c.Website)
		keep = append(keep, c)
	}
	return keep, cost, nil
}

// markWeb marca a las que ya son clientes, ya se siguen o ya se buscaron sin canal, y les pone el encaje.
func markWeb(list []WebCandidate, st *State, m *Measured) {
	for i := range list {
		c := &list[i]
		for _, name := range []string{c.Name, c.LegalName} {
			if name == "" {
				continue
			}
			if cl := m.IsClient(c.TaxID, name); cl != "" && c.Client == "" {
				c.Client = cl
			}
			for _, t := range st.Companies {
				if normalizeName(t.Name) == normalizeName(name) || (c.TaxID != "" && t.NIT == c.TaxID) {
					c.Tracked = t.ID
				}
			}
			for _, d := range st.NoChannel {
				if normalizeName(d.Name) == normalizeName(name) || (c.TaxID != "" && d.NIT == c.TaxID) {
					c.NoChannel = true
				}
			}
		}
		c.Fit, _ = computeFit(&Company{Kind: KindMerchant, Country: c.Country, Points: c.Points, Sector: c.Sector})
	}
}
