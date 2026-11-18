package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// providerSpec: lo que acepta un proveedor por su web y cómo trabaja Wally con él (wally/providers.json, versionado).
type providerSpec struct {
	// MessageChars: lo más que entró en UN mensaje, medido (las webs no lo publican); 0 = sin tope encontrado.
	MessageChars int `json:"messageChars"`
	// ContextTokens: el contexto publicado del modelo.
	ContextTokens int    `json:"contextTokens"`
	Chat          string `json:"chat"`   // «sigue» (un chat por conversación) o «temporal»
	Chunks        bool   `json:"chunks"` // si lo que no entra se parte en trozos en el mismo chat
	// CompactChars: cuando la conversación guardada pasa de esto, Wally resume lo viejo antes de preguntar
	// (compact.go); 0 = no compacta solo.
	CompactChars int    `json:"compactChars"`
	Note         string `json:"note"`
}

// defaultSpecs: por si el archivo falta o está roto (lo medido el 2026-11-17).
var defaultSpecs = map[string]providerSpec{
	"claude":   {ContextTokens: 200_000, Chat: "temporal", CompactChars: 400_000},
	"aistudio": {ContextTokens: 1_048_576, Chat: "temporal", CompactChars: 600_000},
	"deepseek": {MessageChars: 114_000, ContextTokens: 1_000_000, Chat: "sigue", Chunks: true, CompactChars: 250_000},
	"chatgpt":  {MessageChars: 72_000, Chat: "sigue", Chunks: true, CompactChars: 120_000},
	"groq":     {MessageChars: 37_000, ContextTokens: 131_072, Chat: "temporal", CompactChars: 20_000},
}

// providerSpecs lee wally/providers.json en cada uso: cambiar un número vale desde la próxima pregunta.
func (a *app) providerSpecs() map[string]providerSpec {
	raw, err := os.ReadFile(filepath.Join(a.root, "wally", "providers.json"))
	if err != nil {
		return defaultSpecs
	}
	var all map[string]json.RawMessage
	if json.Unmarshal(raw, &all) != nil {
		return defaultSpecs
	}
	out := map[string]providerSpec{}
	for id, def := range defaultSpecs {
		spec := def
		if r, ok := all[id]; ok && json.Unmarshal(r, &spec) != nil {
			spec = def
		}
		out[id] = spec
	}
	return out
}

// chunkSize: de a cuánto se parte lo que va a ese proveedor (0 = no se parte): el 90 % de lo medido, para dejar
// lugar al encabezado de cada trozo.
func (s providerSpec) chunkSize() int {
	if !s.Chunks || s.MessageChars <= 0 {
		return 0
	}
	return s.MessageChars * 9 / 10
}
