package main

/* El perfil de prueba: la persona que va a escribir el cliente al comprar, para dictarle a las centrales que
 * contesten ESA persona antes de lanzar la solicitud. Sin esto el mock de qa contesta su persona por defecto
 * (JUAN CARLOS PEREZ GOMEZ) y la identidad sale de una cascada que no se probó (ver el tema
 * identity-name-validation).
 *
 * Vive en tests/.profile.json, fuera de git: lleva datos de una persona. El dictado no se reescribe acá: lo hace
 * el harness (`harness/bin/bureaus-profile.ts`, sobre `pkg/risk-lambda.ts`), el mismo código que usa el panel,
 * así hay una sola forma de dictar. */

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Profile es lo que se le dicta a las centrales para una cédula.
type Profile struct {
	Document   string `json:"document"`
	Name       string `json:"name"`
	Income     int    `json:"income"`
	Occupation string `json:"occupation"`
	Months     int    `json:"months"`
	Score      int    `json:"score"`
}

// ProfileLoad es lo que contestó el harness al dictar.
type ProfileLoad struct {
	OK      bool     `json:"ok"`
	Target  string   `json:"target"`
	Profile Profile  `json:"profile"`
	Lines   []string `json:"lines"`
	At      string   `json:"at"`
}

var reDoc = regexp.MustCompile(`^\d{5,15}$`)

func profilePath() string { return filepath.Join(repoRoot(), "tests", ".profile.json") }

// ReadProfile lee el perfil por defecto y completa lo que falte con los mismos valores por defecto del harness.
func ReadProfile() (Profile, error) {
	data, err := os.ReadFile(profilePath())
	if err != nil {
		return Profile{}, fmt.Errorf("no hay perfil: creá tests/.profile.json con {\"document\": \"…\", \"name\": \"…\"}")
	}
	var p Profile
	if err := json.Unmarshal(data, &p); err != nil {
		return Profile{}, fmt.Errorf("tests/.profile.json no es JSON válido: %w", err)
	}
	return p.normalized()
}

// normalized valida un perfil (el del archivo o el que se editó en la interfaz) y completa lo que falte.
func (p Profile) normalized() (Profile, error) {
	p.Document = onlyDigits(p.Document)
	p.Name = strings.ToUpper(strings.Join(strings.Fields(p.Name), " "))
	if !reDoc.MatchString(p.Document) || p.Name == "" {
		return Profile{}, fmt.Errorf("falta la cédula (sólo dígitos) o el nombre completo")
	}
	if p.Income <= 0 {
		p.Income = 2_500_000
	}
	if p.Occupation != "Independiente" {
		p.Occupation = "Empleado" // lo único que distingue el harness: Independiente o no
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

// LoadProfile le dicta un perfil a las centrales del ambiente, por el harness: el que llega (editado en la
// interfaz) o, si no llega ninguno, el del archivo. Escribe en el mock de centrales (el de la empresa en qa),
// nunca en la base.
func LoadProfile(target string, given *Profile) (*ProfileLoad, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: tests mira %s", target, strings.Join(Targets, " o "))
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
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "bin/bureaus-profile.ts", target, p.Document,
		"--name", p.Name, "--income", strconv.Itoa(p.Income), "--occupation", p.Occupation,
		"--months", strconv.Itoa(p.Months), "--score", strconv.Itoa(p.Score), "--json")
	cmd.Dir = filepath.Join(repoRoot(), "harness")
	// ⚠ El harness resuelve el mock al importar, con E2E_TARGET (F-187): va en el entorno del hijo, no después.
	cmd.Env = append(os.Environ(), "E2E_TARGET="+target)
	raw, runErr := cmd.Output()
	out := &ProfileLoad{Target: target, Profile: p, At: time.Now().Format("2006-01-02 15:04:05")}
	if err := json.Unmarshal(raw, out); err != nil {
		if runErr != nil {
			var ee *exec.ExitError
			if ok := asExitError(runErr, &ee); ok && len(ee.Stderr) > 0 {
				return nil, fmt.Errorf("el harness falló: %s", strings.TrimSpace(string(ee.Stderr)))
			}
			return nil, fmt.Errorf("el harness falló: %w", runErr)
		}
		return nil, fmt.Errorf("el harness contestó algo que no es JSON: %s", strings.TrimSpace(string(raw)))
	}
	out.Target, out.Profile = target, p
	return out, nil
}

func asExitError(err error, target **exec.ExitError) bool {
	ee, ok := err.(*exec.ExitError)
	if ok {
		*target = ee
	}
	return ok
}
