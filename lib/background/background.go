// Package background es EL MODELO DE SEGUNDO PLANO: el que usa lo que corre solo (agendado, a ciertas horas, sin nadie
// mirando). Cuál es lo decide la configuración de Cockpit («Modelo», lib/cockpit/settings.go): Gemini por la web de AI
// Studio en el Chrome de Miguel (bin/aistudio), por defecto desde el 2026-11-24; Claude por el puente de canon
// (connectors/claude) o Gemini por su API (connectors/gemini), a mano. Una pregunta puede fijar el suyo (Request.Model).
// Lo usan `bin/pg model` y lo agendado (la daily del tablero).
package background

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/my-tools/connectors/claude"
	"creditop/my-tools/connectors/gemini"
	"creditop/my-tools/lib/cockpit"
)

// Request: una pregunta. MaxTokens 0 es el tope del modelo.
type Request struct {
	Model     string // vacío: el elegido en Cockpit
	Prompt    string
	System    string
	MaxTokens int
}

// Answer: lo que contestó y quién.
type Answer struct {
	Model      string // claude · gemini (la elección)
	Text       string
	StopReason string // sólo Claude: end_turn, max_tokens…
}

// Status: el modelo elegido y si contesta, sin preguntarle nada.
type Status struct {
	Model  string   `json:"model"`
	Name   string   `json:"name"`
	Ready  bool     `json:"ready"`
	Detail string   `json:"detail"`
	Fix    string   `json:"fix,omitempty"`
	Choice []string `json:"choices"`
}

// Chosen: el elegido en Cockpit.
func Chosen() string { return cockpit.LoadSettings().BackgroundModel }

// Info: si el elegido contesta. root es la raíz de my-tools.
func Info(ctx context.Context, root string) Status { return InfoFor(ctx, root, Chosen()) }

// InfoFor: si un modelo dado contesta, sin preguntarle nada.
func InfoFor(ctx context.Context, root, model string) Status {
	st := Status{Model: model, Choice: cockpit.BackgroundModels}
	switch st.Model {
	case "claude":
		info, err := claude.New(root).Info(ctx)
		if err != nil {
			st.Detail = err.Error()
			if strings.Contains(err.Error(), "playground login") {
				st.Fix = "playground login"
			}
			return st
		}
		st.Ready, st.Name = true, info.Model
		st.Detail = fmt.Sprintf("%s en Bedrock (%s), por el puente de canon", info.Model, info.Region)
	case "gemini":
		cfg, err := gemini.LoadConfig()
		if err != nil {
			st.Detail = err.Error()
			return st
		}
		st.Ready, st.Name = true, cfg.Model
		st.Detail = fmt.Sprintf("%s por su API, con la llave de connectors/.env (gasta su cuota)", cfg.Model)
	case "aistudio":
		if _, err := os.Stat(filepath.Join(root, "bin", "aistudio")); err != nil {
			st.Detail = "no está bin/aistudio en " + root
			return st
		}
		st.Name = aistudioModel()
		if until, reason := aistudioPause(st.Name); !until.IsZero() {
			// En pausa (cupo diario o corte de Google): no está listo. Lo agendado espera en vez de gastar un intento.
			st.Detail = fmt.Sprintf("%s en pausa hasta %s: %s", st.Name, until.Format("02/01 15:04"), reason)
			st.Fix = "vuelve sola a esa hora"
			return st
		}
		st.Ready = true
		st.Detail = st.Name + " por la web de AI Studio, en tu Chrome con Jarvis (de a una pregunta)"
		st.Fix = "Chrome abierto con la extensión Jarvis"
	}
	return st
}

// aistudioPause: si bin/aistudio está en pausa para ese modelo (o para toda la cuenta, «*»), hasta cuándo y por qué.
// La escribe la receta de Jarvis al ver un corte o el cupo diario agotado (~/.cache/my-tools/aistudio-pausa.json).
func aistudioPause(model string) (time.Time, string) {
	home, _ := os.UserHomeDir()
	raw, err := os.ReadFile(filepath.Join(home, ".cache", "my-tools", "aistudio-pausa.json"))
	if err != nil {
		return time.Time{}, ""
	}
	var pauses map[string]struct {
		Until  int64  `json:"until"`
		Reason string `json:"reason"`
	}
	if json.Unmarshal(raw, &pauses) != nil {
		return time.Time{}, ""
	}
	for _, k := range []string{model, "*"} {
		if p, ok := pauses[k]; ok && p.Until > time.Now().UnixMilli() {
			reason := p.Reason
			if i := strings.Index(reason, ":"); i > 0 && i < 80 {
				reason = reason[:i]
			}
			return time.UnixMilli(p.Until), reason
		}
	}
	return time.Time{}, ""
}

// aistudioModel: el modelo de AI Studio; AISTUDIO_MODEL lo cambia.
func aistudioModel() string {
	if m := strings.TrimSpace(os.Getenv("AISTUDIO_MODEL")); m != "" {
		return m
	}
	return "gemini-4-hydrogen"
}

// askAIStudio: la pregunta por la web de AI Studio (bin/aistudio, una receta de Jarvis en el Chrome de Miguel). La web no
// tiene un campo de sistema: las instrucciones y la pregunta van juntas en un archivo, y el pedido corto dice que las siga.
func askAIStudio(ctx context.Context, root string, in Request) (string, error) {
	f, err := os.CreateTemp("", "background-aistudio-*.md")
	if err != nil {
		return "", err
	}
	defer os.Remove(f.Name())
	doc := in.Prompt
	if in.System != "" {
		doc = "# INSTRUCCIONES\n\n" + in.System + "\n\n# LO QUE HAY QUE CONTESTAR\n\n" + in.Prompt
	}
	if _, err := f.WriteString(doc); err != nil {
		f.Close()
		return "", err
	}
	f.Close()
	cmd := exec.CommandContext(ctx, filepath.Join(root, "bin", "aistudio"), "--file", f.Name(),
		"--prompt", "Seguí las INSTRUCCIONES del documento adjunto y contestá exactamente en el formato que piden.",
		"--model", aistudioModel(), "--json")
	cmd.Dir = root
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("aistudio: %v: %s", err, strings.TrimSpace(stderr.String()))
	}
	var ans struct {
		Answer string `json:"answer"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(out, &ans); err != nil {
		return "", fmt.Errorf("aistudio no devolvió su JSON: %.200s", out)
	}
	if ans.Error != "" {
		return "", fmt.Errorf("aistudio: %s", ans.Error)
	}
	return ans.Answer, nil
}

// Ask: la pregunta al elegido.
func Ask(ctx context.Context, root string, in Request) (Answer, error) {
	out := Answer{Model: Chosen()}
	if in.Model != "" {
		out.Model = in.Model
	}
	switch out.Model {
	case "claude":
		ans, err := claude.New(root).Ask(ctx, claude.Request{Prompt: in.Prompt, System: in.System, MaxTokens: in.MaxTokens})
		if err != nil {
			return out, fmt.Errorf("Claude: %w", err)
		}
		out.Text, out.StopReason = ans.Text, ans.StopReason
	case "gemini":
		cfg, err := gemini.LoadConfig()
		if err != nil {
			return out, err
		}
		ans, err := gemini.New(cfg).Ask(in.Prompt, in.System, nil, nil)
		if err != nil {
			return out, fmt.Errorf("Gemini: %w", err)
		}
		out.Text = fmt.Sprint(ans) // sin herramientas, Gemini contesta texto
	case "aistudio":
		text, err := askAIStudio(ctx, root, in)
		if err != nil {
			return out, err
		}
		out.Text = text
	}
	return out, nil
}
