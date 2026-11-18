package check

// LO QUE NECESITA UN AGENTE (grupo `agent`, 2026-11-18): lo que no es un servicio de CreditOp ni un servicio de fondo,
// pero si falta deja a una sesión de Claude a medias sin decir por qué.
//
//   - la sesión del playground (`playground login`): por ella van el chat del equipo y Claude por el puente de canon;
//   - `gh` con sesión: los PRs de Goldfish, de Knowledge y de los despliegues;
//   - el modelo de segundo plano (el elegido en Cockpit): la daily, el dictamen de Sentinel, Knowledge;
//   - Cockpit: si está abierto y qué apps tiene arriba. Una app apagada NO es una falla: las que no corren de fondo se
//     levantan con `bin/cockpit ensure <app>`, y los CLI de Wally y Jarvis lo hacen solos.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/my-tools/connectors/env"
	"creditop/my-tools/lib/background"
	"creditop/my-tools/lib/cockpit"
)

func probeAgent(ctx context.Context) []Check {
	return []Check{probePlayground(), probeGitHub(ctx), probeBackgroundModel(ctx), probeCockpit()}
}

// probePlayground: la sesión del CLI `playground`, con su vencimiento (el `exp` del token, sin verificarlo).
func probePlayground() Check {
	c := Check{Name: "playground"}
	home, _ := os.UserHomeDir()
	raw, err := os.ReadFile(filepath.Join(home, ".config", "creditop-playground", "token.json"))
	var saved struct {
		Token string `json:"token"`
	}
	if err != nil || json.Unmarshal(raw, &saved) != nil || saved.Token == "" {
		c.State, c.Detail = Fail, "sin sesión → `playground login` (sin ella no hay chat del equipo ni Claude por el puente)"
		return c
	}
	var claims struct {
		Exp   int64  `json:"exp"`
		Email string `json:"email"`
	}
	if parts := strings.Split(saved.Token, "."); len(parts) == 3 {
		if body, err := base64.RawURLEncoding.DecodeString(parts[1]); err == nil {
			_ = json.Unmarshal(body, &claims)
		}
	}
	if claims.Exp == 0 {
		c.State, c.Detail = Warn, "hay sesión, pero no se le lee el vencimiento"
		return c
	}
	exp := time.Unix(claims.Exp, 0)
	c.Expires = &exp
	switch {
	case time.Until(exp) <= 0:
		c.State, c.Detail = Fail, "la sesión venció → `playground login`"
	case time.Until(exp) < soon:
		c.State, c.Detail = Warn, "sesión de "+claims.Email+", por vencer → `playground login`"
	default:
		c.State, c.Detail = OK, "sesión de "+claims.Email
	}
	return c
}

// probeGitHub: `gh auth status` (no gasta nada: lee el llavero del sistema).
func probeGitHub(ctx context.Context) Check {
	c := Check{Name: "gh"}
	if _, err := exec.LookPath("gh"); err != nil {
		c.State, c.Detail = Fail, "no está `gh` en el PATH"
		return c
	}
	out, err := exec.CommandContext(ctx, "gh", "auth", "status").CombinedOutput()
	if err != nil {
		c.State, c.Detail = Fail, "sin sesión → `gh auth login` ("+firstLine(strings.TrimSpace(string(out)))+")"
		return c
	}
	c.State, c.Detail = OK, "con sesión"
	for _, l := range strings.Split(string(out), "\n") {
		if i := strings.Index(l, "account "); i >= 0 {
			c.Detail = "sesión de " + strings.Fields(l[i+len("account "):])[0]
			break
		}
	}
	return c
}

// probeBackgroundModel: el modelo que usa lo que corre solo, sin preguntarle nada (lib/background).
func probeBackgroundModel(ctx context.Context) Check {
	c := Check{Name: "modelo de fondo"}
	dir, err := env.Dir()
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	st := background.Info(ctx, filepath.Dir(dir))
	if !st.Ready {
		c.State, c.Detail = Fail, st.Model+": "+firstLine(st.Detail)
		if st.Fix != "" {
			c.Detail += " → `" + st.Fix + "`"
		}
		return c
	}
	c.State, c.Detail = OK, st.Model+" · "+st.Detail
	return c
}

// probeCockpit: abierto o no, y qué apps tiene arriba.
func probeCockpit() Check {
	c := Check{Name: "cockpit"}
	ctl, err := cockpit.Load(os.Getenv("HOME"))
	var st cockpit.Status
	if err == nil {
		err = ctl.Do("GET", "/status", nil, &st, 2*time.Second)
	}
	if err != nil {
		c.State, c.Detail = Off, "cerrado: lo de fondo sigue andando; las demás apps se levantan con su `make`"
		return c
	}
	var up, down []string
	for _, a := range st.Apps {
		if a.Ready {
			up = append(up, a.ID)
		} else {
			down = append(down, a.ID)
		}
	}
	c.State, c.Detail = OK, "abierto · arriba: "+strings.Join(up, ", ")
	if len(down) > 0 {
		c.Detail += " · apagadas: " + strings.Join(down, ", ") + " (`bin/cockpit ensure <app>` las levanta sin traerlas al frente)"
	}
	return c
}
