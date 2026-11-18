package main

// pg model: EL MODELO DE SEGUNDO PLANO, el que usa lo que corre solo (agendado, a ciertas horas, sin nadie mirando).
// Cuál es lo decide la configuración de Cockpit («Modelo»); la mecánica está en lib/background.

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"creditop/my-tools/lib/background"
	"creditop/my-tools/lib/cliflags"
	"creditop/my-tools/lib/cockpit"
)

func runModelInfo(args []string) int {
	fs := flag.NewFlagSet("model info", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "en JSON (lo lee Cockpit)")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	root, err := myToolsRoot()
	if err != nil {
		return fail(2, "%v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	st := background.Info(ctx, root)
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
	prompt := fs.String("prompt", "", "la pregunta (o --file)")
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
	root, err := myToolsRoot()
	if err != nil {
		return fail(2, "%v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	start := time.Now()
	ans, err := background.Ask(ctx, root, background.Request{Prompt: text, System: *system, MaxTokens: *maxTokens})
	if err != nil {
		return fail(1, "%v", err)
	}
	secs := time.Since(start).Round(100 * time.Millisecond).Seconds()
	if *asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"model": ans.Model, "text": ans.Text, "stopReason": ans.StopReason, "seconds": secs})
		return 0
	}
	fmt.Println(ans.Text)
	if ans.StopReason == "max_tokens" {
		fmt.Fprintln(os.Stderr, "(la respuesta llegó al tope de largo y se cortó)")
	}
	fmt.Fprintf(os.Stderr, "— %s · %.1f s\n", ans.Model, secs)
	return 0
}
