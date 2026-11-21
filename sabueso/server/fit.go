package main

// LOS SECTORES Y EL ENCAJE. Un sector junta los códigos CIIU con los que se busca en el registro mercantil y el nombre
// de su industria en CreditOp (`allied_industries.name`), con la que se mide cuánto origina hoy. El encaje es un
// puntaje que se explica solo, con lo medido en prod el 2026-11-21 (tarea 136):
//
//   - los puntos de venta pesan más que todo: con 21 o más, un comercio origina ~40 veces lo de uno de un solo punto;
//   - el ticket del sector: odontología, celulares, hogar y motos encajan; carros, con variación (el monto de hoy no
//     cubre un carro entero: en movilidad casi todo va de 5 a 15 M);
//   - vender en línea suma, en cualquier plataforma.

import "fmt"

// Sector: un sector que Sabueso sabe buscar.
type Sector struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	CIIU     []string `json:"ciiu"`
	Industry string   `json:"industry"` // en CreditOp; vacío si no hay
	Ticket   string   `json:"ticket"`   // high · partial: si el monto de hoy cubre lo que vende
	Note     string   `json:"note,omitempty"`
	// Lo medido en prod (últimos 180 días), si se pudo.
	Disbursed int     `json:"disbursed"`
	AvgAmount float64 `json:"avgAmount"`
	Merchants int     `json:"merchants"`
}

var sectors = []Sector{
	{ID: "dental", Name: "Odontología", CIIU: []string{"8622"}, Industry: "Odontología", Ticket: "high"},
	{ID: "phones", Name: "Celulares", CIIU: []string{"4741"}, Industry: "Celulares", Ticket: "high"},
	{ID: "home", Name: "Hogar y descanso", CIIU: []string{"4754", "4755"}, Industry: "Hogar y Descanso", Ticket: "high"},
	{ID: "appliances", Name: "Electrodomésticos", CIIU: []string{"4754"}, Industry: "Electrohogar", Ticket: "high",
		Note: "Poco volumen hoy en CreditOp: puede ser una oportunidad o que no convierte."},
	{ID: "motorcycles", Name: "Motos", CIIU: []string{"4541"}, Industry: "Movilidad", Ticket: "high"},
	{ID: "cars", Name: "Carros", CIIU: []string{"4511", "4512"}, Industry: "Movilidad", Ticket: "partial",
		Note: "El monto de hoy no cubre un carro entero (máximo 24,8 M en movilidad): usados económicos, accesorios o cuota inicial."},
	{ID: "health", Name: "Salud y estética", CIIU: []string{"8621", "8692", "9602"}, Industry: "Salud Capilar ", Ticket: "high"},
}

func sectorByID(id string) *Sector {
	for i := range sectors {
		if sectors[i].ID == id {
			return &sectors[i]
		}
	}
	return nil
}

// computeFit: el puntaje (0 a 100) y sus razones, en el orden en que pesan.
func computeFit(c *Company) (int, []string) {
	score := 0
	var why []string
	switch {
	case c.Points >= 21:
		score += 55
		why = append(why, fmt.Sprintf("%d puntos de venta: una cadena, lo que más origina", c.Points))
	case c.Points >= 6:
		score += 40
		why = append(why, fmt.Sprintf("%d puntos de venta", c.Points))
	case c.Points >= 2:
		score += 15
		why = append(why, fmt.Sprintf("%d puntos de venta: los de 2 a 5 casi no originan hoy", c.Points))
	case c.Points == 1:
		score += 5
		why = append(why, "un solo punto de venta")
	default:
		why = append(why, "sin dato de puntos de venta")
	}
	if s := sectorByID(c.Sector); s != nil {
		if s.Ticket == "high" {
			score += 30
			why = append(why, fmt.Sprintf("%s: el ticket entra en lo que se presta", s.Name))
		} else {
			score += 10
			why = append(why, fmt.Sprintf("%s: el ticket entra sólo en parte", s.Name))
		}
	}
	if c.Online {
		score += 15
		if c.Points <= 1 {
			score += 15 // la excepción medida: venta en línea de ticket alto con un punto (Tripleten)
		}
		why = append(why, "vende en línea")
	}
	if c.Kind == KindLender {
		return 0, nil // a una entidad no se le mide encaje de comercio
	}
	if score > 100 {
		score = 100
	}
	return score, why
}
