// Package check es keyring, el llavero del playground: contesta, sin escribir nada, a qué tenemos acceso AHORA desde esta máquina y cuándo
// vence cada cosa: la VPN, AWS, las bases, Loki, PostHog, los servicios de connectors/ y las sesiones de
// asesor del harness.
//
// POR QUÉ EXISTE. «No tengo acceso» y «no estoy en la VPN» se leen igual desde un curl que falla, y lo
// caro es descubrirlo a mitad de una tarea (el 2026-09-28 un curl a dev murió por DNS sin VPN). Cada fila
// hace UNA lectura barata con las mismas credenciales que usa el resto del playground —las de
// connectors/, nunca una copia— y dice qué contestó, sin mostrar jamás un valor secreto: sólo si hay,
// de quién es y cuándo vence.
//
// Lo usan dos: la consola (`make keyring`, en keyring/server) y el hook de arranque, que corre sólo los
// grupos rápidos (Quick) para avisar antes de la primera pregunta.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package check

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// State es el resultado de una fila.
type State string

const (
	OK   State = "ok"   // hay acceso
	Warn State = "warn" // hay acceso, pero vence pronto o contestó a medias
	Fail State = "fail" // falta o no contesta
	Off  State = "off"  // no aplica en este ambiente, o está apagado a propósito
)

// Check es una fila: qué se probó, qué dio y, si se sabe, cuándo vence.
type Check struct {
	Group   string     `json:"group"`
	Name    string     `json:"name"`
	State   State      `json:"state"`
	Detail  string     `json:"detail"`
	Expires *time.Time `json:"expires,omitempty"`
	Millis  int64      `json:"ms"`
}

// Probe es una sonda: devuelve una o más filas. Corre con un contexto que ya trae su tope de tiempo.
type Probe struct {
	Group string
	Run   func(ctx context.Context) []Check
}

// Groups es el orden en que se muestran los grupos: primero lo que condiciona al resto.
var Groups = []string{"network", "aws", "databases", "logs", "events", "services", "sessions"}

// GroupLabel es cómo se muestra cada grupo.
var GroupLabel = map[string]string{
	"network": "red", "aws": "aws", "databases": "bases", "logs": "logs",
	"events": "eventos", "services": "servicios", "sessions": "sesiones de asesor",
}

// Quick son los grupos que contestan en un par de segundos sin tocar la red de nadie más que la propia:
// los que el arranque de sesión se puede permitir esperar.
var Quick = []string{"network", "aws", "sessions"}

// soon es desde cuándo un vencimiento se marca como aviso.
const soon = time.Hour

// Select deja las sondas de esos grupos; sin grupos, todas.
func Select(groups []string) []Probe {
	all := allProbes()
	if len(groups) == 0 {
		return all
	}
	want := map[string]bool{}
	for _, g := range groups {
		want[strings.TrimSpace(g)] = true
	}
	var out []Probe
	for _, p := range all {
		if want[p.Group] {
			out = append(out, p)
		}
	}
	return out
}

func allProbes() []Probe {
	ps := []Probe{
		{"network", probeVPN},
		{"aws", probeAWS},
	}
	for _, t := range targets {
		t := t
		ps = append(ps,
			Probe{"databases", func(ctx context.Context) []Check { return []Check{probeSQL(ctx, t)} }},
			Probe{"logs", func(ctx context.Context) []Check { return []Check{probeLogs(ctx, t)} }},
			Probe{"events", func(ctx context.Context) []Check { return []Check{probeEvents(ctx, t)} }},
		)
	}
	return append(ps,
		Probe{"services", one(probeAtlassian)},
		Probe{"services", probeSlack},
		Probe{"services", one(probeFigma)},
		Probe{"services", one(probeTwilio)},
		Probe{"services", one(probeGemini)},
		Probe{"services", one(probeJev)},
		Probe{"services", probeCanon},
		Probe{"sessions", probeSessions},
	)
}

func one(f func(ctx context.Context) Check) func(ctx context.Context) []Check {
	return func(ctx context.Context) []Check { return []Check{f(ctx)} }
}

// Run corre las sondas a la vez. Una sonda que no respeta el contexto (el driver de MySQL abre sin él)
// igual se corta: pasado el tope, su fila sale como «no contestó» y su goroutine se abandona.
func Run(ps []Probe, timeout time.Duration) []Check {
	var (
		mu  sync.Mutex
		out []Check
		wg  sync.WaitGroup
	)
	for _, p := range ps {
		wg.Add(1)
		go func(p Probe) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			start := time.Now()
			done := make(chan []Check, 1)
			go func() { done <- p.Run(ctx) }()
			var rows []Check
			select {
			case rows = <-done:
			case <-ctx.Done():
				rows = []Check{{Name: "sonda de " + p.Group, State: Fail, Detail: fmt.Sprintf("no contestó en %s", timeout)}}
			}
			ms := time.Since(start).Milliseconds()
			for j := range rows {
				rows[j].Group = p.Group
				if rows[j].Millis == 0 {
					rows[j].Millis = ms
				}
				expiring(&rows[j])
			}
			mu.Lock()
			out = append(out, rows...)
			mu.Unlock()
		}(p)
	}
	wg.Wait()
	rank := map[string]int{}
	for i, g := range Groups {
		rank[g] = i
	}
	sort.SliceStable(out, func(a, b int) bool {
		if rank[out[a].Group] != rank[out[b].Group] {
			return rank[out[a].Group] < rank[out[b].Group]
		}
		return nameRank(out[a].Name) < nameRank(out[b].Name)
	})
	return out
}

// nameRank ordena los ambientes de chico a grande (local → prod) y el resto por nombre.
func nameRank(name string) string {
	for i, t := range targets {
		if name == t {
			return fmt.Sprintf("0%d", i)
		}
	}
	return "1" + name
}

// expiring baja a aviso lo que vence en menos de una hora, y a falla lo ya vencido.
func expiring(c *Check) {
	if c.Expires == nil || c.State != OK {
		return
	}
	left := time.Until(*c.Expires)
	switch {
	case left <= 0:
		c.State = Fail
	case left < soon:
		c.State = Warn
	}
}

// Brief es el resumen del arranque: un renglón con el estado de cada fila y, debajo, sólo lo que falla o
// vence pronto con su motivo. Lo que está bien no ocupa más que su nombre.
func Brief(checks []Check) string {
	var b strings.Builder
	b.WriteString("  KEYRING — a qué hay acceso al arrancar: red, AWS y sesiones de asesor (`make keyring`: también bases, logs y servicios)\n")
	var names []string
	for _, c := range checks {
		// Una sesión apagada es un archivo viejo, no un acceso: en el arranque sólo ensucia.
		if c.State == Off && c.Group != "network" {
			continue
		}
		names = append(names, Mark(c.State)+" "+c.Name)
	}
	b.WriteString("    " + strings.Join(names, " · ") + "\n")
	for _, c := range checks {
		if c.State == Off && c.Group == "network" {
			b.WriteString("    – " + c.Name + ": " + c.Detail + offHint[c.Name] + "\n")
			continue
		}
		if c.State != Fail && c.State != Warn {
			continue
		}
		line := "    " + Mark(c.State) + " " + c.Name + ": " + c.Detail
		if c.Expires != nil {
			line += " · " + UntilText(*c.Expires)
		}
		b.WriteString(line + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// offHint dice qué deja de llegar sin cada VPN: el error que se ve después (un timeout, un DNS) no lo dice.
var offHint = map[string]string{
	"VPN dev":  " → no llegan las bases de dev/qa/staging ni los servicios internos de dev",
	"VPN prod": " → no llegan canon ni los servicios internos de prod",
}

// Mark es el signo de un estado, el mismo en la consola y en el arranque.
func Mark(s State) string {
	switch s {
	case OK:
		return "✔"
	case Warn:
		return "▲"
	case Fail:
		return "✗"
	}
	return "–"
}

// UntilText dice cuánto falta para un vencimiento, o cuánto hace que venció.
func UntilText(t time.Time) string {
	d := time.Until(t)
	if d <= 0 {
		return "venció hace " + human(-d)
	}
	return "vence en " + human(d) + " (" + t.Local().Format("02/01 15:04") + ")"
}

func human(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%d′", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh%02d", int(d.Hours()), int(d.Minutes())%60)
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}
