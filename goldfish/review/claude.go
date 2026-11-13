package review

// LOS AGENTES: cada paso es una corrida de `claude -p` con su respuesta en JSON (--json-schema). Dos formas:
//
//   - CON CONTEXTO (elephant): desde la raíz del playground, con su CLAUDE.md, sus subagentes (main-verifier) y los
//     repos reales a la vista. Sólo lee: Read, Grep, Glob, git y los subagentes.
//   - EN FRÍO (goldfish): desde la carpeta de la propuesta, en modo --restricted (sin los archivos de configuración,
//     sin correr código, sin MCP, los archivos sólo de esa carpeta). No hay CLAUDE.md en ningún padre de esa carpeta:
//     no sabe nada del proyecto más que lo que la propuesta dice.
//
// ⚠ Cada corrida gasta del límite del plan de equipo (las de `claude -p` cuentan como las de la terminal); el costo que
// devuelve es su equivalente en la API, en dólares, y se muestra con cada validación.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// AgentResult: lo que devolvió una corrida.
type AgentResult struct {
	Output  json.RawMessage `json:"output"` // la respuesta, según el esquema
	CostUSD float64         `json:"costUsd"`
	Turns   int             `json:"turns"`
	Millis  int             `json:"millis"`
}

type agentSpec struct {
	dir       string   // desde dónde corre
	prompt    string   // el pedido
	system    string   // lo que se le agrega al prompt de sistema
	schema    string   // el JSON Schema de la respuesta
	tools     []string // las herramientas que tiene
	allowed   []string // las que usa sin preguntar (en -p, el resto se niega)
	denied    []string // las que nunca
	cold      bool     // en frío: --restricted y sin MCP
	addDirs   []string // otras carpetas que puede leer
	env       []string // variables de más para el agente
	budgetUSD float64
	timeout   time.Duration
}

// claudeBinary: el de la terminal o, si no está en el PATH (el servidor arrancado por Cockpit), el de la app.
func claudeBinary() (string, error) {
	if p := os.Getenv("GOLDFISH_CLAUDE"); p != "" {
		return p, nil
	}
	if p, err := exec.LookPath("claude"); err == nil {
		return p, nil
	}
	home, _ := os.UserHomeDir()
	for _, p := range []string{filepath.Join(home, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"} {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	found, _ := filepath.Glob(filepath.Join(home, ".config", "Claude", "claude-code", "*", "claude"))
	if len(found) > 0 {
		sort.Strings(found)
		return found[len(found)-1], nil
	}
	return "", errors.New("no encuentro Claude Code (claude): instalalo o indicá el binario con GOLDFISH_CLAUDE")
}

func runAgent(ctx context.Context, s agentSpec) (AgentResult, error) {
	bin, err := claudeBinary()
	if err != nil {
		return AgentResult{}, err
	}
	args := []string{"-p", s.prompt, "--output-format", "json", "--no-session-persistence",
		"--json-schema", s.schema, "--max-budget-usd", fmt.Sprintf("%.2f", s.budgetUSD),
		"--tools", strings.Join(s.tools, ","), "--allowedTools", strings.Join(s.allowed, ",")}
	if len(s.denied) > 0 {
		args = append(args, "--disallowedTools", strings.Join(s.denied, ","))
	}
	if s.system != "" {
		args = append(args, "--append-system-prompt", s.system)
	}
	if s.cold {
		args = append(args, "--restricted", "--strict-mcp-config")
	}
	for _, d := range s.addDirs {
		args = append(args, "--add-dir", d)
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = s.dir
	cmd.Env = append(childEnv(), s.env...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	runErr := cmd.Run()
	var res struct {
		Result     string          `json:"result"`
		Structured json.RawMessage `json:"structured_output"`
		Cost       float64         `json:"total_cost_usd"`
		Turns      int             `json:"num_turns"`
		Millis     int             `json:"duration_ms"`
		IsError    bool            `json:"is_error"`
		Subtype    string          `json:"subtype"`
	}
	if err := json.Unmarshal(out.Bytes(), &res); err != nil {
		switch ctx.Err() {
		case context.DeadlineExceeded:
			return AgentResult{}, fmt.Errorf("se pasó del tiempo (%s)", s.timeout)
		case context.Canceled:
			return AgentResult{}, errors.New("frenada")
		}
		if runErr != nil {
			return AgentResult{}, fmt.Errorf("claude -p: %v: %s", runErr, tail(errb.String(), 400))
		}
		return AgentResult{}, fmt.Errorf("claude -p no devolvió JSON: %s", tail(out.String(), 400))
	}
	r := AgentResult{CostUSD: res.Cost, Turns: res.Turns, Millis: res.Millis}
	switch {
	case len(res.Structured) > 0 && string(res.Structured) != "null":
		r.Output = res.Structured
	default:
		if raw := jsonIn(res.Result); raw != nil {
			r.Output = raw
		}
	}
	if r.Output == nil {
		why := res.Subtype
		if why == "" {
			why = tail(res.Result, 300)
		}
		return r, fmt.Errorf("la corrida no dejó una respuesta válida (%s)", why)
	}
	return r, nil
}

// jsonIn: el primer objeto JSON de un texto (por si vino entre ```).
func jsonIn(s string) json.RawMessage {
	i, j := strings.Index(s, "{"), strings.LastIndex(s, "}")
	if i < 0 || j <= i {
		return nil
	}
	raw := json.RawMessage(s[i : j+1])
	if !json.Valid(raw) {
		return nil
	}
	return raw
}

// childEnv: el entorno del servidor sin lo que haría creer a claude que corre adentro de otra sesión.
func childEnv() []string {
	var out []string
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "CLAUDECODE=") || strings.HasPrefix(kv, "CLAUDE_CODE_ENTRYPOINT=") {
			continue
		}
		out = append(out, kv)
	}
	return out
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return "…" + string(r[len(r)-n:])
	}
	return s
}
