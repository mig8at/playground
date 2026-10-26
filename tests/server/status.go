package main

/* Cambiar el estado de una solicitud que vino de una tienda, como si la entidad hubiera contestado. No se hace
 * con un UPDATE: va por el simulador del backend (`POST /simulator/aggregator-result`, en
 * Modules/Onboarding/App/Http/Controllers/EcommerceSimulatorController.php de legacy-backend), que cambia el
 * estado por Eloquent y así corre el observer que le avisa a la tienda (el pedido queda pagado, fallido o
 * cancelado). Un UPDATE cambia la base y la tienda nunca se entera.
 *
 * El simulador sólo acepta estados finales y solicitudes ligadas a un pedido de ecommerce, y se niega en
 * producción. La dirección es la API del harness (`E2E_API_BASE_URL` de harness/.env.<target>) sin `/api`; en
 * qa es interna: hace falta la VPN de dev. */

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// FinalStatuses son los que acepta el simulador, con lo que recibe la tienda.
var FinalStatuses = map[int]string{11: "Autorizada", 6: "Negada", 8: "Cancelado", 7: "No terminó proceso"}

// StatusChange es lo que contestó el simulador.
type StatusChange struct {
	Target   string `json:"target"`
	Request  int    `json:"request"`
	Previous int    `json:"previous"`
	Status   int    `json:"status"`
	URL      string `json:"url"`
	At       string `json:"at"`
}

// SimulateStatus le pide al backend del ambiente que pase la solicitud a un estado final.
func SimulateStatus(target string, request, status int) (*StatusChange, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: tests mira %s", target, strings.Join(Targets, " o "))
	}
	if _, ok := FinalStatuses[status]; !ok {
		return nil, fmt.Errorf("estado %d: el simulador sólo acepta 11, 6, 8 o 7", status)
	}
	base := strings.TrimSuffix(strings.TrimRight(harnessEnv(target)("E2E_API_BASE_URL"), "/"), "/api")
	if base == "" {
		return nil, fmt.Errorf("falta E2E_API_BASE_URL en harness/.env.%s", target)
	}
	url := base + "/simulator/aggregator-result"
	body, _ := json.Marshal(map[string]int{"user_request_id": request, "status": status})
	client := &http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		hint := ""
		if target != "local" {
			hint = " (¿está la VPN de dev?)"
		}
		return nil, fmt.Errorf("no se llegó al backend de %s%s: %w", target, hint, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out struct {
		Previous int    `json:"previous_status"`
		Status   int    `json:"new_status"`
		Error    string `json:"error"`
		Message  string `json:"message"`
	}
	_ = json.Unmarshal(raw, &out)
	if res.StatusCode != http.StatusOK {
		msg := out.Error
		if msg == "" {
			msg = out.Message
		}
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		return nil, fmt.Errorf("el simulador contestó %d: %s", res.StatusCode, msg)
	}
	change := &StatusChange{Target: target, Request: request, Previous: out.Previous, Status: out.Status, URL: url,
		At: time.Now().Format("2006-01-02 15:04:05")}
	journalStatus(change)
	return change, nil
}

// journalStatus deja constancia del cambio junto a los borrados, en tests/.deletions.ndjson.
func journalStatus(c *StatusChange) {
	f, err := os.OpenFile(filepath.Join(repoRoot(), "tests", ".deletions.ndjson"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	line, _ := json.Marshal(map[string]any{"kind": "status", "change": c})
	_, _ = f.Write(append(line, '\n'))
}
