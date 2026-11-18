package main

// CLAUDE, POR EL PUENTE DE CANON (Miguel, 2026-11-18: «dejémoslo por defecto para lo agéntico; Gemini, si lo quiero,
// opcional»). El cliente es el conector `connectors/claude` (el mismo que usa lo que corre en segundo plano, `bin/pg
// model ask`): cómo se llega, la sesión, la llave y el stream están ahí.
//
// Es el único proveedor que NO va por la web ni por el pool: es una API. Y es el único que no saca el contexto de
// CreditOp afuera: queda en la cuenta de AWS de la empresa. Por eso los agentes pueden ir por él sin el permiso de
// `agentsOther`.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"creditop/my-tools/connectors/claude"
)

const claudeProvider = "claude"

func (a *app) claudeClient() *claude.Client { return claude.New(a.root) }

// askClaude: la pregunta entera como un mensaje (Wally ya armó la transcripción). Un corte por tope de tokens con
// texto se avisa al final, para que se pida seguir.
func (a *app) askClaude(ctx context.Context, text string) (string, error) {
	ans, err := a.claudeClient().Ask(ctx, claude.Request{Prompt: text})
	if err != nil {
		return "", err
	}
	if ans.StopReason == "max_tokens" {
		ans.Text += "\n\n(la respuesta llegó al tope de largo y se cortó acá)"
	}
	return ans.Text, nil
}

// checkClaude: si se le puede preguntar, sin preguntar nada (`GET /api/model` dice el modelo y la región).
func (a *app) checkClaude(ctx context.Context) providerStatus {
	now := time.Now()
	info, err := a.claudeClient().Info(ctx)
	if err != nil {
		state := "error"
		if errors.Is(err, claude.ErrSession) || strings.Contains(err.Error(), "llave") {
			state = "sin-sesion"
		}
		return providerStatus{State: state, Detail: err.Error(), Checked: now}
	}
	return providerStatus{State: "listo", Detail: fmt.Sprintf("%s en Bedrock (%s), por el puente de canon", info.Model, info.Region), Checked: now}
}
