// Package background es EL MODELO DE SEGUNDO PLANO: el que usa lo que corre solo (agendado, a ciertas horas, sin nadie
// mirando). Cuál es lo decide la configuración de Cockpit («Modelo», lib/cockpit/settings.go): Claude por el puente
// de canon (connectors/claude), por defecto, o Gemini por su API con la llave de connectors/.env (connectors/gemini).
// Lo usan `bin/pg model` y lo agendado (la daily del tablero).
package background

import (
	"context"
	"fmt"
	"strings"

	"creditop/my-tools/connectors/claude"
	"creditop/my-tools/connectors/gemini"
	"creditop/my-tools/lib/cockpit"
)

// Request: una pregunta. MaxTokens 0 es el tope del modelo.
type Request struct {
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
func Info(ctx context.Context, root string) Status {
	st := Status{Model: Chosen(), Choice: cockpit.BackgroundModels}
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
	}
	return st
}

// Ask: la pregunta al elegido.
func Ask(ctx context.Context, root string, in Request) (Answer, error) {
	out := Answer{Model: Chosen()}
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
	}
	return out, nil
}
