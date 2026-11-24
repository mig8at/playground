// Package background es EL MODELO DE SEGUNDO PLANO: el que usa lo que corre solo (agendado, a ciertas horas, sin nadie
// mirando). Cuál es lo decide la configuración de Cockpit («Modelo», lib/cockpit/settings.go): Claude por el puente
// de canon (connectors/claude), por defecto, o Gemini por su API con la llave de connectors/.env (connectors/gemini).
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
	case "aistudio":
		if _, err := os.Stat(filepath.Join(root, "bin", "aistudio")); err != nil {
			st.Detail = "no está bin/aistudio en " + root
			return st
		}
		st.Ready, st.Name = true, aistudioModel()
		st.Detail = st.Name + " por la web de AI Studio, en tu Chrome con Jarvis (de a una pregunta)"
		st.Fix = "Chrome abierto con la extensión Jarvis"
	}
	return st
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
