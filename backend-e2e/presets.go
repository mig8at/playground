package main

import (
	"creditop-tests/pkg/client"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

// ── presets.json: alias de merchant por entorno + defaults + scenarios nombrados ──────────────────
//
// NO es cache de la BD. La resolución real de merchant/lender SIGUE pegándole a la BD en runtime; el
// JSON solo quita fricción de tipeo (alias lógicos, defaults, combos nombrados). Si un alias queda
// stale, el comando falla fuerte y claro en merchant.Resolve — nunca silenciosamente mal.

type presetScenario struct {
	Env       string `json:"env"`
	Ecommerce string `json:"ecommerce"`
	Merchant  string `json:"merchant"`
	Lender    string `json:"lender"`
	State     string `json:"state"`
}

type presetsFile struct {
	Defaults struct {
		Webhook string `json:"webhook"`
		Amount  int    `json:"amount"`
	} `json:"defaults"`
	Merchants map[string]map[string]string `json:"merchants"` // alias lógico → {entorno → hash/nombre}
	Scenarios map[string]presetScenario    `json:"scenarios"`
}

// loadPresets lee presets.json del directorio del harness. Best-effort: si no existe o es inválido,
// devuelve vacío y los comandos siguen funcionando con resolución normal (sin alias/defaults).
func loadPresets() presetsFile {
	var p presetsFile
	raw, err := os.ReadFile("presets.json")
	if err != nil {
		return p
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		fmt.Fprintf(os.Stderr, "%s⚠ presets.json inválido (%v) — sigo sin alias/defaults%s\n", client.CGray, err, client.CReset)
	}
	return p
}

// merchantAlias mapea un alias lógico al merchant del entorno (env). Devuelve (resuelto, true) si hubo
// alias; (name, false) si no está en el mapa (la resolución contra BD lo maneja igual).
func (p presetsFile) merchantAlias(name, env string) (string, bool) {
	m, ok := p.Merchants[strings.ToLower(strings.TrimSpace(name))]
	if !ok {
		return name, false
	}
	if v, ok := m[env]; ok && v != "" {
		return v, true
	}
	return name, false
}

// scenarioNames devuelve los nombres de scenarios ordenados (para listar / sugerir).
func (p presetsFile) scenarioNames() []string {
	names := make([]string, 0, len(p.Scenarios))
	for n := range p.Scenarios {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// runScenario corre un scenario nombrado de presets.json: fija el target desde sc.Env, valida el guard
// de dev y delega en runFlow (que aplica alias de merchant + webhook default). El Makefile ya sourceó
// el .env del entorno correcto antes de invocar.
func runScenario(name string) {
	p := loadPresets()
	sc, ok := p.Scenarios[name]
	if !ok {
		fmt.Fprintf(os.Stderr, "%s✗ scenario %q no existe%s\n", client.CRed, name, client.CReset)
		fmt.Fprintf(os.Stderr, "  disponibles: %s\n", strings.Join(p.scenarioNames(), ", "))
		os.Exit(2)
	}
	if sc.Ecommerce == "" || sc.Merchant == "" || sc.Lender == "" {
		client.FatalError(fmt.Sprintf("scenario %q incompleto (faltan ecommerce/merchant/lender)", name), nil, nil)
	}
	if sc.Env != "" {
		target = sc.Env
	}
	state := sc.State
	if state == "" {
		state = "approved"
	}
	if target != "local" && os.Getenv("I_KNOW_THIS_TOUCHES_SHARED_DEV") != "1" {
		client.FatalError(fmt.Sprintf("scenario %q apunta a %s (shared dev) — exige I_KNOW_THIS_TOUCHES_SHARED_DEV=1 (está en .env.dev)", name, target), nil, nil)
	}
	client.PrintRule(fmt.Sprintf("scenario %q → env=%s ecommerce=%s merchant=%s lender=%s state=%s", name, target, sc.Ecommerce, sc.Merchant, sc.Lender, state))
	runFlow(sc.Ecommerce, sc.Merchant, sc.Lender, state)
}

// listScenarios imprime los scenarios disponibles (make scenarios).
func listScenarios() {
	p := loadPresets()
	client.Banner("SCENARIOS (presets.json)")
	if len(p.Scenarios) == 0 {
		fmt.Println("  (sin scenarios — ¿falta presets.json?)")
		return
	}
	for _, n := range p.scenarioNames() {
		sc := p.Scenarios[n]
		state := sc.State
		if state == "" {
			state = "approved"
		}
		fmt.Printf("  %-16s  %-5s  %-12s  %-12s  %-14s  %s\n", n, sc.Env, sc.Ecommerce, sc.Merchant, sc.Lender, state)
	}
	fmt.Println("\n  corré uno con:  make scenario <name>")
}
