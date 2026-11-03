package main

/* El perfil de prueba: la persona que va a escribir el cliente al comprar, para dictarle a las centrales que
 * contesten ESA persona antes de lanzar la solicitud. Sin esto el mock de qa contesta su persona por defecto
 * (JUAN CARLOS PEREZ GOMEZ) y la identidad sale de una cascada que no se probó (ver el tema
 * identity-name-validation).
 *
 * Vive en .profile.json, fuera de git: lleva datos de una persona. El dictado está en lambda.go. */

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Profile es lo que se le dicta a las centrales para una cédula.
type Profile struct {
	Document string `json:"document"`
	Names    string `json:"names"`    // los nombres, como los va a escribir el cliente
	Surnames string `json:"surnames"` // los apellidos
	// Name es nombres + apellidos: Ágil Data devuelve el nombre en UN texto y así se le dicta. Un perfil viejo
	// que sólo trae `name` sigue sirviendo (sin partirlo: no se adivina dónde termina el nombre).
	Name       string `json:"name"`
	Income     int    `json:"income"`
	Occupation string `json:"occupation"`
	Months     int    `json:"months"`
	Score      int    `json:"score"`
}

// ProfileLoad es lo que quedó al dictar.
type ProfileLoad struct {
	OK      bool     `json:"ok"`
	Target  string   `json:"target"`
	Profile Profile  `json:"profile"`
	Lines   []string `json:"lines"`
	At      string   `json:"at"`
}

var reDoc = regexp.MustCompile(`^\d{5,15}$`)

func profilePath() string { return filepath.Join(appRoot(), ".profile.json") }

// ReadProfile lee el perfil por defecto y completa lo que falte con los valores por defecto.
func ReadProfile() (Profile, error) {
	data, err := os.ReadFile(profilePath())
	if err != nil {
		return Profile{}, fmt.Errorf("no hay perfil: creá .profile.json con {\"document\": \"…\", \"name\": \"…\"}")
	}
	var p Profile
	if err := json.Unmarshal(data, &p); err != nil {
		return Profile{}, fmt.Errorf(".profile.json no es JSON válido: %w", err)
	}
	return p.normalized()
}

// normalized valida un perfil (el del archivo o el que se editó en la interfaz) y completa lo que falte.
func (p Profile) normalized() (Profile, error) {
	clean := func(v string) string { return strings.ToUpper(strings.Join(strings.Fields(v), " ")) }
	p.Document = onlyDigits(p.Document)
	p.Names, p.Surnames = clean(p.Names), clean(p.Surnames)
	if p.Names != "" || p.Surnames != "" {
		if p.Names == "" || p.Surnames == "" {
			return Profile{}, fmt.Errorf("faltan los nombres o los apellidos")
		}
		p.Name = p.Names + " " + p.Surnames
	} else {
		p.Name = clean(p.Name)
	}
	if !reDoc.MatchString(p.Document) || p.Name == "" {
		return Profile{}, fmt.Errorf("falta la cédula (sólo dígitos) o el nombre")
	}
	if p.Income <= 0 {
		p.Income = 2_500_000
	}
	if p.Occupation != "Independiente" {
		p.Occupation = "Empleado" // lo único que distingue el dictado: Independiente o no
	}
	if p.Months > 24 {
		p.Months = 24
	}
	if p.Months <= 0 {
		p.Months = 13
	}
	if p.Score <= 0 {
		p.Score = 700
	}
	return p, nil
}

// LoadProfile le dicta un perfil a las centrales del ambiente: el que llega (editado en la interfaz) o, si no llega
// ninguno, el del archivo. Escribe en el mock de centrales de la empresa (`<T>_RISK_LAMBDA_URL`), nunca en la base.
func LoadProfile(target string, given *Profile) (*ProfileLoad, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: ecommerce mira %s", target, strings.Join(Targets, " o "))
	}
	var p Profile
	var err error
	if given != nil {
		p, err = given.normalized()
	} else {
		p, err = ReadProfile()
	}
	if err != nil {
		return nil, err
	}
	base := strings.TrimRight(appEnv(target)("RISK_LAMBDA_URL"), "/")
	if base == "" {
		return nil, fmt.Errorf("falta %s en .env: sin el mock de centrales no hay a quién dictarle", envKey(target, "RISK_LAMBDA_URL"))
	}
	ok, lines := dictateLambda(base, p)
	return &ProfileLoad{OK: ok, Target: target, Profile: p, Lines: lines, At: time.Now().Format("2006-01-02 15:04:05")}, nil
}
