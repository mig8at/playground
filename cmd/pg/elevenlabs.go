package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"creditop/playground/connectors/elevenlabs"
)

// ElevenLabs por su conector: el saldo, las voces y un texto a voz suelto (para probar una voz antes de dársela a
// un personaje de la videollamada).

func elevenClient() (*elevenlabs.Client, int) {
	cfg, err := elevenlabs.LoadConfig()
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	return elevenlabs.New(cfg), 0
}

func runElevenUsage(args []string) int {
	fs := flag.NewFlagSet("elevenlabs usage", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	cl, code := elevenClient()
	if cl == nil {
		return code
	}
	u, err := cl.Usage()
	if err != nil {
		return fail(1, "ElevenLabs: %v (la llave necesita el permiso «User» para leer el saldo)", err)
	}
	if *asJSON {
		return writeJSON(u)
	}
	reset := ""
	if u.ResetUnix > 0 {
		reset = " · se renueva el " + time.Unix(u.ResetUnix, 0).Format("2006-01-02")
	}
	fmt.Printf("plan %s · %d de %d créditos usados (quedan %d)%s\n", u.Tier, u.Used, u.Limit, u.Limit-u.Used, reset)
	return 0
}

func runElevenVoices(args []string) int {
	fs := flag.NewFlagSet("elevenlabs voices", flag.ContinueOnError)
	gender := fs.String("gender", "", "female | male")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	cl, code := elevenClient()
	if cl == nil {
		return code
	}
	voices, err := cl.Voices()
	if err != nil {
		return fail(1, "ElevenLabs: %v", err)
	}
	var out []elevenlabs.Voice
	for _, v := range voices {
		if *gender == "" || strings.EqualFold(v.Labels["gender"], *gender) {
			out = append(out, v)
		}
	}
	if *asJSON {
		return writeJSON(out)
	}
	for _, v := range out {
		l := v.Labels
		fmt.Printf("%-28s %-22s %-7s %-10s %s %s\n", v.Name, v.ID, l["gender"], l["age"], l["accent"], firstOf(l["description"], l["descriptive"], l["use_case"]))
	}
	return 0
}

func firstOf(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func runElevenSay(args []string) int {
	fs := flag.NewFlagSet("elevenlabs say", flag.ContinueOnError)
	voice := fs.String("voice", "", "la voz: nombre («Laura») o id")
	text := fs.String("text", "", "lo que dice")
	out := fs.String("out", "", "el MP3 de salida")
	if fs.Parse(args) != nil {
		return 2
	}
	if *voice == "" || strings.TrimSpace(*text) == "" || *out == "" {
		return fail(2, "faltan --voice, --text u --out")
	}
	cl, code := elevenClient()
	if cl == nil {
		return code
	}
	id, err := cl.VoiceID(*voice)
	if err != nil {
		return fail(1, "ElevenLabs: %v", err)
	}
	start := time.Now()
	audio, err := cl.Speech(id, *text)
	if err != nil {
		return fail(1, "ElevenLabs: %v", err)
	}
	if err := os.WriteFile(*out, audio, 0o644); err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("✔ %s (%d KB) en %d ms · %d caracteres con %s\n", *out, len(audio)/1024, time.Since(start).Milliseconds(), len([]rune(*text)), cl.Config.Model)
	return 0
}
