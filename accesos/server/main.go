// Command accesos contesta, sin escribir nada, a qué tenemos acceso AHORA desde esta máquina y cuándo
// vence cada cosa: la VPN, AWS, las bases, Loki, PostHog, los servicios de connectors/ y las sesiones de
// asesor del harness.
//
// POR QUÉ EXISTE. «No tengo acceso» y «no estoy en la VPN» se leen igual desde un curl que falla, y lo
// caro es descubrirlo a mitad de una tarea (el 2026-09-28 un curl a dev murió por DNS sin VPN). Cada fila
// hace UNA lectura barata con las mismas credenciales que usa el resto del playground —las de
// connectors/, nunca una copia— y dice qué contestó, sin mostrar jamás un valor secreto: sólo si hay,
// de quién es y cuándo vence.
//
// Sale 1 si alguna fila falló: así lo puede usar un hook o un script antes de arrancar.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
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

// probe es una sonda: devuelve una o más filas. Corre con un contexto que ya trae su tope de tiempo.
type probe struct {
	group string
	run   func(ctx context.Context) []Check
}

// groupOrder es el orden en que se imprimen los grupos: primero lo que condiciona al resto.
var groupOrder = []string{"red", "aws", "bases", "logs", "eventos", "servicios", "sesiones"}

// soon es desde cuándo un vencimiento se marca como aviso.
const soon = time.Hour

func main() {
	asJSON := flag.Bool("json", false, "las filas en JSON")
	only := flag.String("solo", "", "sólo estos grupos, separados por coma: "+strings.Join(groupOrder, ","))
	timeout := flag.Duration("timeout", 12*time.Second, "tope por sonda")
	flag.Parse()

	checks := runAll(selectProbes(*only), *timeout)
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(checks)
	} else {
		render(checks)
	}
	for _, c := range checks {
		if c.State == Fail {
			os.Exit(1)
		}
	}
}

func selectProbes(only string) []probe {
	all := allProbes()
	if strings.TrimSpace(only) == "" {
		return all
	}
	want := map[string]bool{}
	for _, g := range strings.Split(only, ",") {
		want[strings.TrimSpace(g)] = true
	}
	var out []probe
	for _, p := range all {
		if want[p.group] {
			out = append(out, p)
		}
	}
	return out
}

func allProbes() []probe {
	ps := []probe{
		{"red", probeVPN},
		{"aws", probeAWS},
	}
	for _, t := range targets {
		t := t
		ps = append(ps,
			probe{"bases", func(ctx context.Context) []Check { return []Check{probeSQL(ctx, t)} }},
			probe{"logs", func(ctx context.Context) []Check { return []Check{probeLogs(ctx, t)} }},
			probe{"eventos", func(ctx context.Context) []Check { return []Check{probeEvents(ctx, t)} }},
		)
	}
	ps = append(ps,
		probe{"servicios", one(probeAtlassian)},
		probe{"servicios", probeSlack},
		probe{"servicios", one(probeFigma)},
		probe{"servicios", one(probeTwilio)},
		probe{"servicios", one(probeGemini)},
		probe{"servicios", one(probeJev)},
		probe{"servicios", probeCanon},
		probe{"sesiones", probeSessions},
	)
	return ps
}

func one(f func(ctx context.Context) Check) func(ctx context.Context) []Check {
	return func(ctx context.Context) []Check { return []Check{f(ctx)} }
}

// runAll corre todas las sondas a la vez. Una sonda que no respeta el contexto (el driver de MySQL abre
// sin él) igual se corta: pasado el tope, su fila sale como «no contestó» y su goroutine se abandona.
func runAll(ps []probe, timeout time.Duration) []Check {
	var (
		mu  sync.Mutex
		out []Check
		wg  sync.WaitGroup
	)
	for i, p := range ps {
		wg.Add(1)
		go func(i int, p probe) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			start := time.Now()
			done := make(chan []Check, 1)
			go func() { done <- p.run(ctx) }()
			var rows []Check
			select {
			case rows = <-done:
			case <-ctx.Done():
				rows = []Check{{Group: p.group, Name: fmt.Sprintf("sonda %d", i), State: Fail,
					Detail: fmt.Sprintf("no contestó en %s", timeout)}}
			}
			ms := time.Since(start).Milliseconds()
			for j := range rows {
				rows[j].Group = p.group
				if rows[j].Millis == 0 {
					rows[j].Millis = ms
				}
				expiring(&rows[j])
			}
			mu.Lock()
			out = append(out, rows...)
			mu.Unlock()
		}(i, p)
	}
	wg.Wait()
	rank := map[string]int{}
	for i, g := range groupOrder {
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

func render(checks []Check) {
	fmt.Printf("\n  ACCESOS · %s\n", time.Now().Format("2006-01-02 15:04"))
	counts := map[State]int{}
	for _, c := range checks {
		counts[c.State]++
	}
	fmt.Printf("  %d ok · %d por vencer · %d fallan · %d no aplican\n", counts[OK], counts[Warn], counts[Fail], counts[Off])
	group := ""
	for _, c := range checks {
		if c.Group != group {
			group = c.Group
			fmt.Printf("\n  %s\n", strings.ToUpper(group))
		}
		line := fmt.Sprintf("    %s %-20s %s", mark(c.State), c.Name, c.Detail)
		if c.Expires != nil {
			line += " · " + untilText(*c.Expires)
		}
		fmt.Println(line)
	}
	fmt.Println()
}

func mark(s State) string {
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

// untilText dice cuánto falta para un vencimiento, o cuánto hace que venció.
func untilText(t time.Time) string {
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
