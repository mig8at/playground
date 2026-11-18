package main

// LOS TEXTOS, con el modelo de fondo (lib/background: Claude en el Bedrock de CreditOp por defecto, el elegido en
// Cockpit). Dos preguntas por semana: una sobre los modelos nuevos (cuál es el más innovador y por qué, y qué hace y qué
// trae de nuevo cada uno, leyendo su README) y otra que pasa al español los resúmenes de los papers. Sólo viaja lo
// público de Hugging Face. Se vuelve a preguntar sólo si cambió la lista: la huella de lo que se mandó (`Wrote`).

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"creditop/my-tools/lib/background"
)

const modelsSystem = `Sos el editor de News, un resumen semanal de lo nuevo en Hugging Face para un equipo técnico de una fintech.
Escribís en español neutro, claro y sin marketing. No inventes: si la ficha no lo dice, no lo afirmes.
Contestás SÓLO un objeto JSON, sin texto alrededor ni bloques de código.`

const papersSystem = `Pasás al español resúmenes de papers de IA, en dos oraciones claras y sin jerga innecesaria, para un equipo
técnico. No agregues nada que el resumen no diga. Contestás SÓLO un objeto JSON, sin texto alrededor ni bloques de código.`

type modelsAnswer struct {
	Lead   string `json:"lead"`
	Why    string `json:"why"`
	Models map[string]struct {
		What string `json:"what"`
		New  string `json:"new"`
	} `json:"models"`
}

// writeModels elige el más innovador y escribe la ficha de cada modelo nuevo.
func writeModels(ctx context.Context, root string, w *Week) error {
	var fresh []*Model
	for i := range w.Models {
		if w.Models[i].New {
			fresh = append(fresh, &w.Models[i])
		}
	}
	if len(fresh) == 0 {
		return nil
	}
	var b strings.Builder
	b.WriteString("Estos son los modelos creados esta semana que entraron en tendencia en Hugging Face, con lo que declaran y el comienzo de su README.\n\n")
	for _, m := range fresh {
		fmt.Fprintf(&b, "### %s\ntarea: %s · creado: %s · tendencia #%d · ♥ %d · descargas %d · licencia: %s · parámetros: %d · base: %s\n",
			m.ID, m.Task, m.Created, m.Rank, m.Likes, m.Downloads, orNone(m.License), m.Params, orNone(m.Base))
		if text := readme(ctx, m.ID); text != "" {
			fmt.Fprintf(&b, "README:\n%s\n", text)
		}
		b.WriteString("\n")
	}
	b.WriteString(`Devolvé:
{"lead": "<id del modelo más innovador de la lista: el que trae algo realmente nuevo, no el más popular>",
 "why": "<por qué importa, en 2 o 3 oraciones>",
 "models": {"<id>": {"what": "<qué hace, en 1 o 2 oraciones>", "new": "<qué trae de nuevo respecto de los anteriores de su tarea, y si la licencia permite uso comercial; 1 o 2 oraciones>"}}}
Incluí en "models" todos los ids de la lista.`)
	var out modelsAnswer
	model, err := askJSON(ctx, root, modelsSystem, b.String(), &out)
	if err != nil {
		return err
	}
	w.Lead, w.Why, w.WrittenBy = out.Lead, strings.TrimSpace(out.Why), model
	for _, m := range fresh {
		if t, ok := out.Models[m.ID]; ok {
			m.What, m.Novelty = strings.TrimSpace(t.What), strings.TrimSpace(t.New)
		}
	}
	return nil
}

// writePapers pasa al español el resumen de los papers más votados.
func writePapers(ctx context.Context, root string, w *Week) error {
	if len(w.Papers) == 0 {
		return nil
	}
	var b strings.Builder
	b.WriteString("Resumí en español cada paper (2 oraciones), a partir de su resumen en inglés.\n\n")
	for _, p := range w.Papers {
		fmt.Fprintf(&b, "### %s\n%s\n%s\n\n", p.ID, p.Title, p.Summary)
	}
	b.WriteString(`Devolvé {"papers": {"<id>": "<resumen en español>"}} con todos los ids.`)
	var out struct {
		Papers map[string]string `json:"papers"`
	}
	if _, err := askJSON(ctx, root, papersSystem, b.String(), &out); err != nil {
		return err
	}
	for i := range w.Papers {
		if s, ok := out.Papers[w.Papers[i].ID]; ok {
			w.Papers[i].SummarySpanish = strings.TrimSpace(s)
		}
	}
	return nil
}

func askJSON(ctx context.Context, root, system, prompt string, v any) (string, error) {
	ans, err := background.Ask(ctx, root, background.Request{System: system, Prompt: prompt, MaxTokens: 8000})
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(ans.Text)
	i, j := strings.IndexByte(text, '{'), strings.LastIndexByte(text, '}')
	if i < 0 || j <= i {
		return ans.Model, errors.New("el modelo no devolvió JSON")
	}
	if err := json.Unmarshal([]byte(text[i:j+1]), v); err != nil {
		return ans.Model, fmt.Errorf("el JSON del modelo no se lee: %w", err)
	}
	return ans.Model, nil
}

// fingerprint: qué se le mandaría al modelo. Si no cambió desde la última vez, no se vuelve a preguntar.
func fingerprint(w *Week) string {
	h := sha256.New()
	for _, m := range w.Models {
		if m.New {
			h.Write([]byte(m.ID + "\n"))
		}
	}
	h.Write([]byte("--\n"))
	for _, p := range w.Papers {
		h.Write([]byte(p.ID + "\n"))
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

func orNone(s string) string {
	if s == "" {
		return "no la declara"
	}
	return s
}
