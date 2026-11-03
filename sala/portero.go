package main

/* EL PORTERO: en el modo canal decide a quién despertar con cada mensaje, para no despertar a todos. No habla en la
 * llamada. Es Claude Haiku 5.5 (Miguel, 2026-11-02: rápido, económico y sin sacar datos a un servicio nuevo), sin
 * herramientas, con un prompt de sistema propio y desde una carpeta vacía (así no carga el CLAUDE.md del repo).
 *
 * POR QUÉ. En la primera llamada real en canal cada mensaje despertaba a los cinco, cada turno costaba US$0,35-0,45 y
 * el tope de US$3 se fue en 40 segundos. Pasados por el portero, los mensajes de esa llamada despertaban a 2 o 3 de 5,
 * casi siempre los mismos que reaccionaron de verdad.
 *
 * LAS REGLAS QUE NO PASAN POR ÉL: lo que dice Miguel o el moderador despierta a todos; una mención @id despierta a ese;
 * una afirmación despierta siempre al verificador (que se compruebe no depende del portero); la indicación del
 * coordinador con @id va sólo a los nombrados. Y si el portero falla o tarda, se despierta a todos: un portero caído
 * no puede silenciar la llamada. */

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

const gatekeeperModel = "claude-haiku-5-5"

var (
	reMention = regexp.MustCompile(`@([a-z]+)`)
	emptyDir  struct {
		once sync.Once
		path string
	}
)

const gatekeeperSystem = `Sos el PORTERO de una llamada de trabajo entre agentes. No hablás en la llamada: decidís a quién despertar para ` +
	`el mensaje nuevo. Despertá sólo a quien tiene algo pertinente que hacer o decir por ESE mensaje, según su rol; si nadie, lista vacía. ` +
	`Nunca despiertes a quien escribió el mensaje. Contestá SÓLO un JSON {"wake":[ids],"why":"una frase"}, sin texto alrededor.`

// route decide a quién le toca reaccionar a m, lo marca en want y lo despierta. Corre en su propia goroutine.
func (h *hub) route(ctx context.Context, m message, listeners []*participant, isListener, want map[string]bool, wake map[string]chan struct{}, routing *int) {
	// Mientras el portero decide, la llamada no está en silencio: sin esto el coordinador hablaba a los 2 s, antes de
	// que llegara la decisión (Haiku tarda 4-6 s), cerraba y cancelaba las decisiones pendientes.
	h.mu.Lock()
	*routing++
	h.mu.Unlock()
	defer func() { h.mu.Lock(); *routing--; h.mu.Unlock() }()
	everyone := func() []string {
		var ids []string
		for _, p := range listeners {
			if p.ID != m.Who {
				ids = append(ids, p.ID)
			}
		}
		return ids
	}
	var fixed []string
	for _, mm := range reMention.FindAllStringSubmatch(m.Text, -1) {
		if isListener[mm[1]] && mm[1] != m.Who {
			fixed = append(fixed, mm[1])
		}
	}
	if reClaim.MatchString(m.Text) && isListener["verificador"] && m.Who != "verificador" {
		fixed = append(fixed, "verificador")
	}

	// Las reglas fijas despiertan YA, sin esperar al portero.
	mark := func(ids []string) map[string]bool {
		got := map[string]bool{}
		h.mu.Lock()
		for _, id := range ids {
			if isListener[id] && id != m.Who {
				want[id], got[id] = true, true
			}
		}
		h.mu.Unlock()
		for id := range got {
			select {
			case wake[id] <- struct{}{}:
			default:
			}
		}
		return got
	}
	mark(fixed)

	h.mu.Lock()
	mock := h.st.Mock
	h.mu.Unlock()
	var ids []string
	why := ""
	switch {
	case m.Who == "miguel" || m.Who == "moderador":
		ids, why = everyone(), "lo dijo "+m.Name
	case m.Who == "coordinador" && len(fixed) > 0:
		ids, why = fixed, "el coordinador los nombró"
	case reCheck.MatchString(m.Text):
		// Una comprobación no le pide nada a nadie, salvo la refutación: ésa despierta a quien hizo la afirmación.
		h.mu.Lock()
		for _, c := range reCheck.FindAllStringSubmatch(m.Text, -1) {
			if c[2] != "✗" {
				continue
			}
			for _, cl := range h.st.Claims {
				if cl.ID == c[1] {
					for _, p := range listeners {
						if p.Name == cl.Who {
							ids = append(ids, p.ID)
						}
					}
				}
			}
		}
		h.mu.Unlock()
		why = "comprobaciones: sólo despierta quien fue refutado"
	case mock && os.Getenv("SALA_PORTERO") != "1": // SALA_PORTERO=1: agentes simulados con el portero de verdad
		ids, why = everyone(), "simulada: sin portero"
	default:
		gate, reason, use, err := h.gatekeeper(ctx, m, listeners)
		h.update(func(s *state) { s.Spent += use.Cost; s.Gate.add(use) })
		if err != nil {
			ids, why = everyone(), "el portero no contestó ("+err.Error()+"): despierto a todos"
		} else {
			ids, why = gate, reason
		}
		ids = append(ids, fixed...)
	}

	if ctx.Err() != nil { // la llamada ya cerró: no se despierta ni se anuncia nada
		return
	}
	seen := mark(ids)
	var names []string
	for _, p := range listeners {
		if seen[p.ID] {
			names = append(names, p.Name)
		}
	}
	if m.Who != "moderador" && m.Who != "miguel" {
		target := strings.Join(names, ", ")
		if target == "" {
			target = "nadie"
		}
		h.post(message{Who: "portero", Name: "Portero", Text: fmt.Sprintf("→ %s · %s", target, why), Kind: "portero"})
	}
}

// gatekeeper le pregunta a Haiku a quién despertar. Sólo recibe los roles, quién trabaja en qué y el mensaje nuevo.
func (h *hub) gatekeeper(ctx context.Context, m message, listeners []*participant) ([]string, string, usage, error) {
	var b strings.Builder
	b.WriteString("ROLES:\n")
	h.mu.Lock()
	for _, p := range listeners {
		fmt.Fprintf(&b, "- %s: %s\n", p.ID, p.Role)
	}
	var work []string
	for _, p := range listeners {
		if p.Work != "" {
			work = append(work, p.ID+" → "+p.Work)
		}
	}
	h.mu.Unlock()
	if len(work) > 0 {
		b.WriteString("TRABAJANDO: " + strings.Join(work, "; ") + "\n")
	}
	text := m.Text
	if r := []rune(text); len(r) > 1500 {
		text = string(r[:1500])
	}
	fmt.Fprintf(&b, "MENSAJE NUEVO [%s]: %s", m.Who, text)

	emptyDir.once.Do(func() { emptyDir.path, _ = os.MkdirTemp("", "sala-portero-") })
	tctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(tctx, "claude", "-p", b.String(), "--model", gatekeeperModel, "--tools", "",
		"--system-prompt", gatekeeperSystem, "--output-format", "json", "--no-session-persistence", "--strict-mcp-config")
	cmd.Dir = emptyDir.path
	cmd.Env = childEnv()
	out, err := cmd.Output()
	if err != nil {
		return nil, "", usage{}, fmt.Errorf("claude -p: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n") // la CLI puede anteponer un aviso de modelo
	var res struct {
		Result string  `json:"result"`
		Cost   float64 `json:"total_cost_usd"`
		Usage  struct {
			In         int `json:"input_tokens"`
			CacheWrite int `json:"cache_creation_input_tokens"`
			CacheRead  int `json:"cache_read_input_tokens"`
			Out        int `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal([]byte(lines[len(lines)-1]), &res) != nil {
		return nil, "", usage{}, fmt.Errorf("salida sin JSON")
	}
	use := usage{Calls: 1, In: res.Usage.In, CacheRead: res.Usage.CacheRead, CacheWrite: res.Usage.CacheWrite, Out: res.Usage.Out, Cost: res.Cost}
	raw := res.Result
	if i, j := strings.Index(raw, "{"), strings.LastIndex(raw, "}"); i >= 0 && j > i {
		raw = raw[i : j+1]
	}
	var d struct {
		Wake []string `json:"wake"`
		Why  string   `json:"why"`
	}
	if json.Unmarshal([]byte(raw), &d) != nil {
		return nil, "", use, fmt.Errorf("respuesta sin la forma pedida")
	}
	return d.Wake, d.Why, use, nil
}
