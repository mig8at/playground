package main

// TU AGENTE EN «MI CHAT»: le escribís y contesta él, con el modelo que elegiste en su panel, redactando con Claude
// Code en esta máquina (claudeAsk: sin herramientas y aislado). No toca nada ni le manda nada a nadie: sólo contesta,
// con lo que el chat le pasa —tu nombre, tus tareas de cuadrilla y los últimos mensajes de la conversación—.
//
// ⚠ `claude -p` gasta el límite del asiento del plan de equipo de quien corre el chat, como usar Claude Code.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Los modelos del panel de tu agente (src/stores/myAgent.js): otro no se acepta.
var myAgentModels = map[string]bool{"claude-opus-5-5": true, "claude-sonnet-5-5": true, "claude-haiku-5-5": true}

type myAgentTask struct {
	Title string `json:"titulo"`
	State string `json:"estado"`
}

type myAgentTurn struct {
	From string `json:"from"` // "yo" o "agente"
	Text string `json:"text"`
}

type myAgentAsk struct {
	Model   string        `json:"model"`
	Name    string        `json:"name"`
	Owner   string        `json:"owner"`
	Rules   []string      `json:"rules"`
	Tasks   []myAgentTask `json:"tasks"`
	History []myAgentTurn `json:"history"`
	Text    string        `json:"text"`
}

const myAgentPrompt = `Sos %[1]s, el agente personal de %[2]s en CreditOp (una fintech colombiana de originación de crédito).
Estás en el chat privado de %[2]s: quien te escribe es %[2]s mismo, tu dueño, no otra persona.

Cómo sos:
%[3]s

Lo que sabés de %[2]s, y nada más (no inventes datos, tareas, fechas ni personas):
- Sus tareas en cuadrilla (JSON): %[4]s

La conversación hasta ahora (lo más nuevo al final):
%[5]s

Lo que te escribe ahora %[2]s:
%[6]s

Contestale en español, natural y breve (1 a 5 frases, sin títulos). Si te pide algo que no podés hacer desde acá
(mandar mensajes, tocar código, consultar sistemas), decíselo en una frase y sugerí cómo hacerlo él.`

func myAgentPromptFor(in myAgentAsk) string {
	rules := make([]string, 0, len(in.Rules))
	for _, r := range in.Rules {
		if r = strings.TrimSpace(r); r != "" {
			rules = append(rules, "- "+r)
		}
	}
	tasks, _ := json.Marshal(in.Tasks)
	history := []string{}
	start := 0
	if len(in.History) > 20 {
		start = len(in.History) - 20
	}
	for _, t := range in.History[start:] {
		who := in.Owner
		if t.From == "agente" {
			who = in.Name
		}
		history = append(history, fmt.Sprintf("%s: %s", who, strings.TrimSpace(t.Text)))
	}
	if len(history) == 0 {
		history = append(history, "(es el primer mensaje)")
	}
	return fmt.Sprintf(myAgentPrompt, in.Name, in.Owner, strings.Join(rules, "\n"), tasks, strings.Join(history, "\n"), strings.TrimSpace(in.Text))
}

func myAgentHandlers(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/my-agent/ask", func(w http.ResponseWriter, r *http.Request) {
		var in myAgentAsk
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {model, name, owner, tasks, history, text}"))
			return
		}
		in.Text, in.Name, in.Owner = strings.TrimSpace(in.Text), strings.TrimSpace(in.Name), strings.TrimSpace(in.Owner)
		switch {
		case in.Text == "":
			fail(w, http.StatusBadRequest, errors.New("falta el mensaje"))
			return
		case len([]rune(in.Text)) > maxText:
			fail(w, http.StatusRequestEntityTooLarge, fmt.Errorf("el mensaje pasa de %d caracteres", maxText))
			return
		case !myAgentModels[in.Model]:
			fail(w, http.StatusBadRequest, fmt.Errorf("modelo desconocido: %q", in.Model))
			return
		}
		if in.Name == "" {
			in.Name = "Mi agente"
		}
		if in.Owner == "" {
			in.Owner = "tu dueño"
		}
		ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
		defer cancel()
		text, err := claudeAsk(ctx, in.Model, myAgentPromptFor(in))
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"text": text, "model": in.Model})
	})
}
