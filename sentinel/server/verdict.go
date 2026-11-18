package main

// EL DICTAMEN DE LA MAÑANA Y EL PORQUÉ DE UNA ALERTA (Miguel, 2026-11-18): lo que hacía Noctowl en Wally cuando se lo
// pedían, ahora solo, con el modelo de segundo plano (lib/background: Claude por defecto, el elegido en Cockpit).
//
//   - EL DICTAMEN: de lunes a viernes, en la primera pasada desde las 7:30, 🟢/🟡/🔴 con lo que hay que mirar ya, lo
//     que es ruido conocido y los despliegues. Lee lo mismo que `bin/sentinel now` y `bin/sentinel day` (de ayer y de
//     hoy). Queda en `.data/verdicts/<día>.md`, arriba de todo en la interfaz, y con un aviso.
//   - EL PORQUÉ DE UNA ALERTA: cuando una señal pasa a alerta y se avisa, una pregunta aparte con esa señal hora por
//     hora, lo demás que está fuera de lo normal, los despliegues y los cambios de política del día y, si es de una
//     entidad, qué regla dura rechaza. Contesta en dos o tres líneas, como HIPÓTESIS, y llega como un segundo aviso; queda
//     en el episodio y en el detalle de la señal. Uno por episodio, y como mucho `explainPerDay` por día.
//
// CÓMO LEER SENTINEL lo dicen las notas de Noctowl (`wally/agents/noctowl.md`): lo que ya costó leerlo mal, lo conocido y
// el formato. Se leen en cada pregunta, así un error de lectura se corrige en UN lugar para los dos.
//
// El modelo no corre nada ni pide comandos: recibe las salidas y contesta. Lo que no puede confirmar lo dice como
// pendiente, con el comando que lo confirmaría.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/lib/background"
)

// La hora del dictamen: antes de la daily, con la noche ya mirada.
const verdictHour, verdictMinute = 7, 30

// explainPerDay: lo más que se explica por día. Las alertas son ~4 por semana (backtest del 18/11/2026); el tope es
// para un día malo, en que una explicación por señal sería ruido y gasto.
const explainPerDay = 8

// Verdict: un dictamen guardado.
type Verdict struct {
	Day   string `json:"day"`
	At    string `json:"at"`
	Model string `json:"model"`
	Level string `json:"level"` // green · yellow · red · «» si no se leyó
	Text  string `json:"text"`
}

// verdictState: lo que no se guarda: si hay uno en curso y cuándo se intentó (para no reintentar en cada pasada).
type verdictState struct {
	mu        sync.Mutex
	busy      bool
	triedAt   time.Time
	explained map[string]int // por día: cuántas alertas se explicaron
}

func (s *sentinel) verdictPath(day string) string {
	return filepath.Join(s.store.dir, "verdicts", day+".md")
}

// loadVerdict: el guardado de un día, o nil.
func (s *sentinel) loadVerdict(day string) *Verdict {
	raw, err := os.ReadFile(s.verdictPath(day))
	if err != nil {
		return nil
	}
	text, meta := string(raw), ""
	if i := strings.LastIndex(text, "<!-- verdict ·"); i >= 0 {
		meta, text = text[i:], text[:i]
	}
	v := &Verdict{Day: day, Text: strings.TrimSpace(text), Level: verdictLevel(text)}
	// <!-- verdict · <modelo> · <hora> -->
	parts := strings.Split(strings.TrimSuffix(strings.TrimSpace(meta), "-->"), "·")
	if len(parts) >= 3 {
		v.Model, v.At = strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2])
	}
	return v
}

func (s *sentinel) saveVerdict(v Verdict) error {
	path := s.verdictPath(v.Day)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body := fmt.Sprintf("%s\n\n<!-- verdict · %s · %s -->\n", v.Text, v.Model, v.At)
	if err := os.WriteFile(path+".tmp", []byte(body), 0o644); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}

// latestVerdict: el de hoy o, si todavía no hay (antes de las 7:30, un fin de semana), el último de los 4 días
// anteriores: con su fecha, la interfaz dice de cuándo es.
func (s *sentinel) latestVerdict() *Verdict {
	now := time.Now().In(bogota)
	for d := 0; d <= 4; d++ {
		if v := s.loadVerdict(now.AddDate(0, 0, -d).Format("2006-01-02")); v != nil {
			return v
		}
	}
	return nil
}

// verdictLevel: el primer semáforo que aparece.
func verdictLevel(text string) string {
	best, at := "", len(text)+1
	for emoji, level := range map[string]string{"🔴": "red", "🟡": "yellow", "🟢": "green"} {
		if i := strings.Index(text, emoji); i >= 0 && i < at {
			best, at = level, i
		}
	}
	return best
}

// noctowlNotes: cómo se lee Sentinel, de las notas de Noctowl, sin «Cómo trabajás» (pedir comandos: acá no se pide).
func noctowlNotes(root string) string {
	raw, err := os.ReadFile(filepath.Join(root, "wally", "agents", "noctowl.md"))
	if err != nil {
		return ""
	}
	text := string(raw)
	if i := strings.Index(text, "## Cómo trabajás"); i >= 0 {
		if j := strings.Index(text[i+3:], "\n## "); j >= 0 {
			text = text[:i] + text[i+3+j+1:]
		}
	}
	return strings.TrimSpace(text)
}

const verdictRole = `Esta vez NO podés pedir comandos: abajo ya están las salidas que pedirías. Usá sólo esos números; lo que no se puede
confirmar con ellos, decilo como pendiente con el comando que lo confirmaría (Miguel lo corre en su consola). En español
de Colombia.

MUY CORTO: Miguel lo lee en un minuto, antes de la daily. Máximo 12 renglones en total. Cada viñeta, UNA línea: qué, el
número contra lo normal y desde cuándo, y el comando para confirmar; sin explicar cómo decide Sentinel. «Ruido o ya
conocido» en una sola línea que los nombre. Si no hubo despliegues, «Despliegues: ninguno desde ayer» y nada más.`

// makeVerdict: el dictamen de `day` (hoy), con lo de ayer y lo de hoy hasta ahora.
func (s *sentinel) makeVerdict(ctx context.Context, rules Rules, now time.Time) (Verdict, error) {
	day := now.In(bogota).Format("2006-01-02")
	v := Verdict{Day: day}
	reach := s.store.reach()
	if reach.IsZero() {
		return v, fmt.Errorf("no hay nada guardado todavía")
	}
	c := &cli{s: s, e: s.evaluator(rules), rules: rules, reach: reach.In(bogota)}
	var b strings.Builder
	if r, err := c.now(); err == nil {
		b.WriteString("## sentinel now\n\n" + r.Text() + "\n\n")
	} else {
		return v, err
	}
	yesterday := now.In(bogota).AddDate(0, 0, -1).Format("2006-01-02")
	for _, d := range []string{yesterday, day} {
		if r, err := c.day(d); err == nil {
			fmt.Fprintf(&b, "## sentinel day %s\n\n%s\n\n", d, r.Text())
		}
	}
	system := noctowlNotes(s.root) + "\n\n" + verdictRole
	ans, err := background.Ask(ctx, s.root, background.Request{Prompt: strings.TrimSpace(b.String()), System: system})
	if err != nil {
		return v, err
	}
	v.Text, v.Model, v.At = strings.TrimSpace(ans.Text), ans.Model, time.Now().In(bogota).Format(time.RFC3339)
	v.Level = verdictLevel(v.Text)
	return v, nil
}

// maybeVerdict: en cada pasada, el de hoy si toca (de lunes a viernes, desde las 7:30) y no está. Un intento fallido se
// reintenta a los 30 minutos. Corre aparte: la pasada no lo espera.
func (s *sentinel) maybeVerdict(rules Rules) {
	now := time.Now().In(bogota)
	if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
		return
	}
	if now.Hour()*60+now.Minute() < verdictHour*60+verdictMinute {
		return
	}
	day := now.Format("2006-01-02")
	if s.loadVerdict(day) != nil {
		return
	}
	st := &s.verdicts
	st.mu.Lock()
	if st.busy || time.Since(st.triedAt) < 30*time.Minute {
		st.mu.Unlock()
		return
	}
	st.busy, st.triedAt = true, time.Now()
	st.mu.Unlock()
	go func() {
		defer func() { st.mu.Lock(); st.busy = false; st.mu.Unlock() }()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		v, err := s.makeVerdict(ctx, rules, now)
		if err != nil {
			log.Printf("sentinel: el dictamen no salió: %v", err)
			return
		}
		if err := s.saveVerdict(v); err != nil {
			log.Printf("sentinel: no pude guardar el dictamen: %v", err)
			return
		}
		if s.notifier != nil {
			first := strings.SplitN(v.Text, "\n", 2)[0]
			s.notifier.tell(Notice{Signal: "verdict", Name: "Dictamen", Level: "verdict", Text: strings.Trim(first, "*# ")}, "Sentinel · dictamen de hoy", v.Level == "red")
		}
	}()
}

const explainRole = `Esta vez NO es el dictamen del día: una señal ACABA de pasar a alerta. Explicala en dos o tres líneas, para leer en un
aviso: qué pasa (con el número contra lo normal y desde cuándo), la causa más probable COMO HIPÓTESIS (un despliegue o un
cambio de política cerca, otra señal que se movió a la vez, una regla que rechaza más), y qué mirar primero (un comando de
consola). Sin semáforo, sin títulos ni viñetas. MÁXIMO TRES ORACIONES (unas 60 palabras): se lee en un aviso. NO podés
pedir comandos: usá sólo lo que está abajo y no inventes números.`

// explainAlert: el porqué de una alerta, aparte de la pasada. Lo guarda en el episodio y lo manda como segundo aviso.
func (s *sentinel) explainAlert(subj Subject, rules Rules) {
	day := time.Now().In(bogota).Format("2006-01-02")
	st := &s.verdicts
	st.mu.Lock()
	if st.explained == nil {
		st.explained = map[string]int{}
	}
	if st.explained[day] >= explainPerDay {
		st.mu.Unlock()
		return
	}
	st.explained[day]++
	st.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	text, err := s.explainText(ctx, subj, rules)
	if err != nil {
		log.Printf("sentinel: no pude explicar %s: %v", subj.Signal, err)
		return
	}
	if s.notifier != nil {
		s.notifier.explained(subj.Signal, text)
		s.notifier.tell(Notice{Signal: subj.Signal, Name: subj.Name, Level: "why", Text: text}, "Sentinel · por qué: "+subj.Name, false)
	}
}

func (s *sentinel) explainText(ctx context.Context, subj Subject, rules Rules) (string, error) {
	reach := s.store.reach()
	if reach.IsZero() {
		return "", fmt.Errorf("no hay nada guardado")
	}
	c := &cli{s: s, e: s.evaluator(rules), rules: rules, reach: reach.In(bogota)}
	var b strings.Builder
	fmt.Fprintf(&b, "## La alerta\n\n%s (%s): %s\n\n", subj.Name, subj.Signal, subj.Why)
	if r, err := c.signal(subj.Signal); err == nil {
		b.WriteString("## sentinel signal " + subj.Signal + "\n\n" + r.Text() + "\n\n")
	}
	if r, err := c.now(); err == nil {
		b.WriteString("## sentinel now (lo demás que está fuera de lo normal)\n\n" + r.Text() + "\n\n")
	}
	if r, err := c.day(c.reach.Format("2006-01-02")); err == nil {
		b.WriteString("## sentinel day (hoy: despliegues, cambios de política, tramos)\n\n" + r.Text() + "\n\n")
	}
	// De una entidad, qué regla dura rechaza (lee producción: una consulta, sólo lectura).
	lender := 0
	switch subj.Kind {
	case "reject", "lender", "lerr":
		lender = subj.ID
	}
	if lender > 0 {
		if r, err := blockingRules(lender, 24, time.Now()); err == nil {
			b.WriteString("## sentinel rules " + fmt.Sprint(lender) + " (últimas 24 h contra los 7 días anteriores)\n\n" + r.Text() + "\n")
		}
	}
	system := noctowlNotes(s.root) + "\n\n" + explainRole
	ans, err := background.Ask(ctx, s.root, background.Request{Prompt: strings.TrimSpace(b.String()), System: system})
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(ans.Text), nil
}

// verdictCLI: `bin/sentinel verdict [--make]` (el último dictamen, o armar el de hoy ya) y `bin/sentinel why <señal>`
// (el porqué de una señal ahora, aunque no esté en alerta: no se guarda ni avisa).
func verdictCLI(c *cli, cmd string, positional []string, makeIt, asJSON bool) int {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if cmd == "why" {
		if len(positional) == 0 {
			fmt.Fprintln(os.Stderr, "sentinel why <señal|nombre>")
			return 2
		}
		r, err := c.signal(positional[0])
		if err != nil {
			fmt.Fprintln(os.Stderr, "sentinel:", err)
			return 1
		}
		text, err := c.s.explainText(ctx, r.Subject, c.rules)
		if err != nil {
			fmt.Fprintln(os.Stderr, "sentinel:", err)
			return 1
		}
		return printWith(map[string]string{"signal": r.Subject.Signal, "why": text}, asJSON, func() { fmt.Println(text) })
	}
	var v *Verdict
	if makeIt {
		made, err := c.s.makeVerdict(ctx, c.rules, time.Now())
		if err != nil {
			fmt.Fprintln(os.Stderr, "sentinel:", err)
			return 1
		}
		if err := c.s.saveVerdict(made); err != nil {
			fmt.Fprintln(os.Stderr, "sentinel:", err)
			return 1
		}
		v = &made
	} else if v = c.s.latestVerdict(); v == nil {
		fmt.Fprintln(os.Stderr, "sentinel: no hay dictamen guardado en los últimos días (`bin/sentinel verdict --make` arma el de hoy)")
		return 1
	}
	return printWith(v, asJSON, func() { fmt.Printf("Dictamen del %s (%s, %s)\n\n%s\n", v.Day, v.Model, clockOf(v.At), v.Text) })
}

func printWith(out any, asJSON bool, text func()) int {
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(out)
		return 0
	}
	text()
	return 0
}
