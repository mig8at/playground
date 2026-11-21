package main

// LO QUE SABUESO GUARDA: las empresas que Miguel sigue (comercios y entidades), cada una con su etapa, su encaje, su
// próximo paso y su bitácora. Vive en `sabueso/.data/state.json`, fuera de git: son datos de trabajo, no código.

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// Los dos tipos de empresa.
const (
	KindMerchant = "merchant"
	KindLender   = "lender"
)

// Stage: una etapa del embudo. El orden de la lista es el del embudo.
type Stage struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Las etapas de cada tipo. «lost» (descartado) vale para los dos y va al final.
var stages = map[string][]Stage{
	KindMerchant: {
		{"prospect", "Prospecto"}, {"contacted", "Contactado"}, {"demo", "Demo"}, {"preregistered", "Prerregistro"},
		{"kyb", "KYB y contrato"}, {"linking", "Vinculación con entidades"}, {"selling", "Vendiendo"}, {"lost", "Descartado"},
	},
	KindLender: {
		{"prospect", "Prospecto"}, {"interest", "Interés"}, {"risk", "Riesgo y legal"}, {"agreement", "Convenio"},
		{"integration", "Integración técnica"}, {"pilot", "Piloto"}, {"live", "En producción"}, {"lost", "Descartado"},
	},
}

func validStage(kind, id string) bool {
	for _, s := range stages[kind] {
		if s.ID == id {
			return true
		}
	}
	return false
}

func stageName(kind, id string) string {
	for _, s := range stages[kind] {
		if s.ID == id {
			return s.Name
		}
	}
	return id
}

// Activity: una línea de la bitácora de una empresa.
type Activity struct {
	ID   string `json:"id"`
	At   string `json:"at"`   // RFC3339
	Kind string `json:"kind"` // note · call · email · meeting · stage · handoff · created · client
	Text string `json:"text"`
}

var activityKinds = map[string]bool{"note": true, "call": true, "email": true, "meeting": true}

// Step: el próximo paso, con su fecha.
type Step struct {
	Text string `json:"text"`
	Due  string `json:"due"` // AAAA-MM-DD
}

// Company: una empresa que se sigue.
type Company struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	NIT      string `json:"nit,omitempty"`
	Sector   string `json:"sector,omitempty"` // id de `sectors`
	CIIU     string `json:"ciiu,omitempty"`
	Region   string `json:"region,omitempty"` // la cámara de comercio o la ciudad
	Points   int    `json:"points"`           // puntos de venta (establecimientos activos)
	Online   bool   `json:"online"`           // vende en línea, en cualquier plataforma
	Website  string `json:"website,omitempty"`
	Email    string `json:"email,omitempty"` // el correo PÚBLICO de la empresa (ventas@, contacto@)
	Phone    string `json:"phone,omitempty"` // la línea pública de la empresa
	Source   string `json:"source"`          // manual · registry
	Stage    string `json:"stage"`
	HandedTo string `json:"handedTo,omitempty"` // a quién se le pasó: desde ahí lo sigue esa persona
	Next     *Step  `json:"next,omitempty"`
	Renewed  string `json:"renewed,omitempty"` // el último año renovado en el registro mercantil
	Created  string `json:"created"`
	Updated  string `json:"updated"`
	// Derivados al leer (no se guardan como verdad: se recalculan).
	Fit    int      `json:"fit"`
	FitWhy []string `json:"fitWhy"`
	// La bitácora, de la más vieja a la más nueva.
	Activities []Activity `json:"activities"`
}

// State: el archivo entero.
type State struct {
	Companies []*Company `json:"companies"`
}

func newID(prefix string) string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func now() string { return time.Now().Format(time.RFC3339) }

func (c *Company) log(kind, text string) {
	c.Activities = append(c.Activities, Activity{ID: newID("act"), At: now(), Kind: kind, Text: text})
	c.Updated = now()
}

// normalizeNIT deja sólo los dígitos, sin el dígito de verificación si viene separado («900.123.456-7»).
func normalizeNIT(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, "-"); i > 0 {
		s = s[:i]
	}
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// normalizeName: el nombre para comparar, sin tildes, sin la forma jurídica y sin signos.
func normalizeName(s string) string {
	s = strings.ToLower(s)
	r := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n", ".", " ", ",", " ", "-", " ", "&", " ")
	s = r.Replace(s)
	drop := map[string]bool{"sas": true, "s": true, "a": true, "ltda": true, "sa": true, "y": true, "cia": true, "de": true, "la": true, "el": true, "los": true, "las": true, "bic": true, "zomac": true, "sigla": true}
	var words []string
	for _, w := range strings.Fields(s) {
		if !drop[w] {
			words = append(words, w)
		}
	}
	return strings.Join(words, " ")
}

func validateCompany(c *Company) error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return fmt.Errorf("falta el nombre")
	}
	if c.Kind != KindMerchant && c.Kind != KindLender {
		return fmt.Errorf("el tipo es merchant o lender")
	}
	if c.Stage == "" {
		c.Stage = "prospect"
	}
	if !validStage(c.Kind, c.Stage) {
		return fmt.Errorf("la etapa %q no existe para %s", c.Stage, c.Kind)
	}
	if c.Sector != "" && sectorByID(c.Sector) == nil {
		return fmt.Errorf("el sector %q no existe", c.Sector)
	}
	if c.Points < 0 {
		c.Points = 0
	}
	c.NIT = normalizeNIT(c.NIT)
	return nil
}
