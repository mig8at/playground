package main

// QUIÉN DECIDE: el nombre y el cargo de la persona que decidiría sobre una propuesta de financiación (gerente
// comercial, financiero, de canales o de alianzas), con su fuente. Lo busca Claude SÓLO con lo público: el sitio de la
// empresa, noticias y los resultados del buscador. **No abre linkedin.com** (el permiso de WebFetch lo niega, no sólo la
// instrucción): de un perfil público toma el nombre, el cargo y el enlace tal como aparecen en el buscador. Las
// condiciones de LinkedIn prohíben el acceso automatizado, y una cuenta personal no se arriesga (decisión de Miguel,
// 2026-11-21). Sólo se guarda lo que la persona publica profesionalmente; nunca correos o celulares personales. No se le
// escribe a nadie.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// Person: alguien que decide, con su fuente.
type Person struct {
	Name     string `json:"name"`
	Role     string `json:"role"`
	Area     string `json:"area"`              // comercial · financiera · canales y medios de pago · alianzas · gerencia general
	Fit      string `json:"fit"`               // decides (decide sobre la propuesta) · influences (influye) · other
	Profile  string `json:"profile,omitempty"` // el enlace a su perfil público, tal como salió en el buscador
	Source   string `json:"source"`            // la URL donde se vio el nombre y el cargo
	Evidence string `json:"evidence"`          // la frase de la fuente que lo respalda
}

// PeopleResearch: lo que devolvió una búsqueda.
type PeopleResearch struct {
	People  []Person `json:"people"`
	Summary string   `json:"summary"`
	At      string   `json:"at"`
	Seconds int      `json:"seconds"`
	CostUSD float64  `json:"costUsd"`
}

const peopleSchema = `{"type":"object","properties":{
 "people":{"type":"array","items":{"type":"object","properties":{
   "name":{"type":"string"},
   "role":{"type":"string","description":"el cargo, tal como lo publica la fuente"},
   "area":{"type":"string","description":"comercial, financiera, canales y medios de pago, alianzas, gerencia general u otra"},
   "fit":{"type":"string","enum":["decides","influences","other"],"description":"decides: decidiría sobre sumar financiación para sus clientes; influences: influye; other: otro cargo"},
   "profile":{"type":"string","description":"el enlace a su perfil público de LinkedIn si apareció en el buscador; vacío si no"},
   "source":{"type":"string","description":"la URL exacta donde aparece el nombre con el cargo"},
   "evidence":{"type":"string","description":"la frase de la fuente (o del resultado del buscador) que lo respalda"}
 },"required":["name","role","area","fit","source","evidence"]}},
 "summary":{"type":"string","description":"en español, 1 a 3 frases: a quién conviene dirigir la propuesta y por qué"}
},"required":["people","summary"]}`

func peoplePrompt(c *Company, rep *Person) string {
	co := countryOf(c.Country)
	var b strings.Builder
	fmt.Fprintf(&b, "Encontrá, con información pública, quién decidiría en esta empresa %s sobre sumar una nueva forma de financiación a crédito para sus clientes (una fintech que ofrece crédito en el punto de venta y en línea).\n\n", co.Adjective)
	fmt.Fprintf(&b, "Empresa: %s\n", c.Name)
	if c.NIT != "" {
		fmt.Fprintf(&b, "%s: %s\n", co.TaxID, c.NIT)
	}
	if c.Research != nil && len(c.Research.Brands) > 0 {
		fmt.Fprintf(&b, "Marcas: %s\n", strings.Join(c.Research.Brands, ", "))
	}
	if c.Website != "" {
		fmt.Fprintf(&b, "Sitio: %s\n", c.Website)
	}
	if c.Region != "" {
		fmt.Fprintf(&b, "Ciudad: %s\n", c.Region)
	}
	if rep != nil {
		fmt.Fprintf(&b, "Según el registro mercantil, su representante legal es %s: confirmá su cargo si aparece en fuentes públicas.\n", rep.Name)
	}
	b.WriteString(`
Los cargos que buscamos, en este orden: gerente o director comercial, gerente financiero, gerente de canales o medios de pago, gerente de alianzas, y si no, el gerente general o representante legal.

Reglas:
- Sólo información pública y profesional: el sitio de la empresa (equipo, nosotros), noticias, entrevistas, y los resultados del buscador.
- NO abras páginas de linkedin.com: no está permitido. Si un perfil público de LinkedIn aparece en los resultados de búsqueda, tomá el nombre, el cargo y el enlace tal como se ven en el resultado.
- Cada persona con la URL donde aparece su nombre con el cargo y la frase que lo respalda. No inventes nombres ni cargos; si no estás seguro de que trabaje hoy ahí, no la pongas.
- No busques ni pongas correos o celulares personales.
- Confirmá que se trata de la misma empresa.
`)
	return b.String()
}

// findPeople corre la búsqueda. Puede tardar un par de minutos.
var findPeople = func(ctx context.Context, c *Company, rep *Person) (*PeopleResearch, error) {
	raw, cost, secs, err := runClaudeWith(ctx, peoplePrompt(c, rep), peopleSchema,
		"WebFetch(domain:linkedin.com)", "WebFetch(domain:www.linkedin.com)", "WebFetch(domain:co.linkedin.com)", "WebFetch(domain:pe.linkedin.com)")
	if err != nil {
		return nil, err
	}
	var r PeopleResearch
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("la respuesta no trae el JSON pedido: %.200s", string(raw))
	}
	var keep []Person
	for _, p := range r.People {
		p.Name, p.Role = strings.TrimSpace(p.Name), strings.TrimSpace(p.Role)
		if p.Name == "" || p.Role == "" || !strings.HasPrefix(p.Source, "http") || strings.Contains(p.Name, "@") {
			continue
		}
		if !strings.Contains(p.Profile, "linkedin.com/") {
			p.Profile = ""
		}
		keep = append(keep, p)
	}
	if keep == nil {
		keep = []Person{}
	}
	r.People, r.At, r.Seconds, r.CostUSD = keep, now(), secs, cost
	return &r, nil
}

// legalRep: el representante legal según el registro mercantil abierto de Confecámaras (público por ley, gratis). En
// una empresa mediana suele ser el gerente general: quien firma. Sólo Colombia, y con NIT.
var legalRep = func(ctx context.Context, c *Company) (*Person, error) {
	if c.Country != "" && c.Country != "CO" || c.NIT == "" {
		return nil, nil
	}
	p := url.Values{}
	p.Set("$select", "representante_legal, estado_matricula, fecha_actualizacion")
	p.Set("$where", fmt.Sprintf("nit = '%s'", strings.ReplaceAll(c.NIT, "'", "")))
	var rows []struct {
		Rep     string `json:"representante_legal"`
		State   string `json:"estado_matricula"`
		Updated string `json:"fecha_actualizacion"`
	}
	if err := socrata(ctx, companiesURL, p, &rows); err != nil {
		return nil, err
	}
	for _, r := range rows {
		if activeState(r.State) && strings.TrimSpace(r.Rep) != "" {
			upd := r.Updated
			if len(upd) >= 10 {
				upd = strings.ReplaceAll(upd[:10], "/", "-")
			}
			return &Person{Name: titleCase(strings.TrimSpace(r.Rep)), Role: "Representante legal", Area: "gerencia general", Fit: "decides",
				Source:   "https://www.datos.gov.co/d/c82u-588k",
				Evidence: fmt.Sprintf("Registro mercantil (Confecámaras): representante legal de %s, actualizado el %s", c.Name, upd)}, nil
		}
	}
	return nil, nil
}

// mergePeople: el representante legal del registro va primero; lo que trae Claude, sin repetir el nombre.
func mergePeople(rep *Person, found []Person) []Person {
	out := []Person{}
	if rep != nil {
		out = append(out, *rep)
	}
	for _, p := range found {
		if rep != nil && normalizeName(p.Name) == normalizeName(rep.Name) {
			out[0].Role = p.Role + " (representante legal)" // Claude confirmó su cargo
			if p.Profile != "" {
				out[0].Profile = p.Profile
			}
			continue
		}
		out = append(out, p)
	}
	return out
}
