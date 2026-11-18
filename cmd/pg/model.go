package main

// pg model: EL MODELO DE SEGUNDO PLANO, el que usa lo que corre solo (agendado, a ciertas horas, sin nadie mirando).
// Cuál es lo decide la configuración de Cockpit («Modelo», lib/cockpit/settings.go); por defecto, Claude por el
// puente de canon (connectors/claude). Gemini va por su API con la llave de connectors/.env (connectors/gemini).

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"creditop/my-tools/connectors/claude"
	"creditop/my-tools/connectors/gemini"
	"creditop/my-tools/lib/cliflags"
	"creditop/my-tools/lib/cockpit"
)

// modelStatus: el modelo elegido y si contesta, sin preguntarle nada.
type modelStatus struct {
	Model  string   `json:"model"`         // claude · gemini (la elección)
	Name   string   `json:"name"`          // lo que atiende de verdad
	Ready  bool     `json:"ready"`         // se le puede preguntar
	Detail string   `json:"detail"`        // por dónde va, o por qué no
	Fix    string   `json:"fix,omitempty"` // qué hacer si no está listo
	Choice []string `json:"choices"`       // lo que se puede elegir
}

func modelInfo(ctx context.Context, model string) modelStatus {
	st := modelStatus{Model: model, Choice: cockpit.BackgroundModels}
	switch model {
	case "claude":
		root, err := myToolsRoot()
		if err != nil {
			st.Detail = err.Error()
			return st
		}
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

func runModelInfo(args []string) int {
	fs := flag.NewFlagSet("model info", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "en JSON (lo lee Cockpit)")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	st := modelInfo(ctx, cockpit.LoadSettings().BackgroundModel)
	if *asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(st)
	} else {
		mark := "listo"
		if !st.Ready {
			mark = "NO está listo"
		}
		fmt.Printf("modelo de segundo plano: %s — %s\n  %s\n", st.Model, mark, st.Detail)
		if st.Fix != "" {
			fmt.Printf("  arreglo: %s\n", st.Fix)
		}
		fmt.Printf("  se elige en Cockpit (engranaje → Modelo) o con `pg model set %s`\n", strings.Join(st.Choice, "|"))
	}
	if !st.Ready {
		return 1
	}
	return 0
}

func runModelSet(args []string) int {
	if len(args) != 1 {
		return fail(2, "pg model set %s", strings.Join(cockpit.BackgroundModels, "|"))
	}
	if err := cockpit.SetBackgroundModel(args[0]); err != nil {
		return fail(2, "%v", err)
	}
	fmt.Printf("modelo de segundo plano: %s\n", args[0])
	return 0
}

func runModelAsk(args []string) int {
	fs := flag.NewFlagSet("model ask", flag.ContinueOnError)
	prompt := fs.String("prompt", "", "la pregunta (o --file, o por la entrada estándar con `-`)")
	file := fs.String("file", "", "la pregunta desde un archivo (- es la entrada estándar)")
	system := fs.String("system", "", "instrucciones de sistema (opcional)")
	maxTokens := fs.Int("max-tokens", 0, "tope de la respuesta (Claude: hasta 16384, el de siempre). Muy chico no alcanza: con 60, Sonnet 5.5 lo gastó entero pensando y no escribió nada")
	asJSON := fs.Bool("json", false, "en JSON: modelo, texto, por qué terminó y cuánto tardó")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	text := *prompt
	if *file != "" {
		var raw []byte
		var err error
		if *file == "-" {
			raw, err = io.ReadAll(os.Stdin)
		} else {
			raw, err = os.ReadFile(*file)
		}
		if err != nil {
			return fail(2, "--file: %v", err)
		}
		if text != "" {
			text += "\n\n"
		}
		text += string(raw)
	}
	if strings.TrimSpace(text) == "" {
		return fail(2, "falta --prompt o --file")
	}
	model := cockpit.LoadSettings().BackgroundModel
	start := time.Now()
	var out struct {
		Model      string  `json:"model"`
		Text       string  `json:"text"`
		StopReason string  `json:"stopReason,omitempty"`
		Seconds    float64 `json:"seconds"`
	}
	out.Model = model
	switch model {
	case "claude":
		root, err := myToolsRoot()
		if err != nil {
			return fail(2, "%v", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		ans, err := claude.New(root).Ask(ctx, claude.Request{Prompt: text, System: *system, MaxTokens: *maxTokens})
		if err != nil {
			return fail(1, "Claude: %v", err)
		}
		out.Text, out.StopReason = ans.Text, ans.StopReason
	case "gemini":
		cfg, err := gemini.LoadConfig()
		if err != nil {
			return fail(2, "%v", err)
		}
		ans, err := gemini.New(cfg).Ask(text, *system, nil, nil)
		if err != nil {
			return fail(1, "Gemini: %v", err)
		}
		out.Text = fmt.Sprint(ans) // sin herramientas, Gemini contesta texto
	}
	out.Seconds = time.Since(start).Round(100 * time.Millisecond).Seconds()
	if *asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(out)
		return 0
	}
	fmt.Println(out.Text)
	if out.StopReason == "max_tokens" {
		fmt.Fprintln(os.Stderr, "(la respuesta llegó al tope de largo y se cortó)")
	}
	fmt.Fprintf(os.Stderr, "— %s · %.1f s\n", model, out.Seconds)
	return 0
}
