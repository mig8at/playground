package main

// LA CONSOLA DE SENTINEL (`bin/sentinel <comando>`): lo guardado contado en prosa, para el día a día y para un agente.
// Lee `sentinel/.data` directamente —los conteos de 5 minutos SON la trazabilidad— y vuelve a evaluar con las reglas de
// hoy: no depende de que la API esté arriba. Lo único que pide afuera es GitHub (`gh`), para ubicar un despliegue.
//
//	bin/sentinel now                         cómo está producción ahora: lo que pide atención, lo que se sigue, los servicios
//	bin/sentinel day [AAAA-MM-DD]            el día: cuánto entró contra lo normal, qué se salió y cuándo, despliegues y avisos
//	bin/sentinel signal <señal|nombre>       una señal hora por hora, hoy contra lo normal («credifamilia», «merchant:94»)
//	bin/sentinel deploy <repo> [versión]     ¿se dañó algo después de ese despliegue? antes, después y lo normal de esa franja
//
// Todos aceptan --json. Un despliegue sin versión es el último a producción de ese repo.

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

var cliCommands = map[string]bool{"now": true, "day": true, "signal": true, "deploy": true}

// runCLI: un comando de la consola. Devuelve el código de salida.
func runCLI(root string, args []string) int {
	cmd := args[0]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "la salida en JSON (para un agente)")
	hours := fs.Float64("hours", 2, "deploy: cuántas horas mirar antes y después")
	var positional []string
	// Los flags pueden ir antes o después de los argumentos.
	rest := args[1:]
	for len(rest) > 0 {
		if err := fs.Parse(rest); err != nil {
			return 2
		}
		rest = fs.Args()
		if len(rest) > 0 {
			positional = append(positional, rest[0])
			rest = rest[1:]
		}
	}
	c, err := openCLI(root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "sentinel:", err)
		return 1
	}
	var out any
	switch cmd {
	case "now":
		out, err = c.now()
	case "day":
		date := time.Now().In(bogota).Format("2006-01-02")
		if len(positional) > 0 {
			date = positional[0]
		}
		var d *DayReport
		if d, err = c.day(date); err == nil {
			out = d
			_ = c.saveDay(d)
		}
	case "signal":
		if len(positional) == 0 {
			err = fmt.Errorf("falta la señal: «credifamilia», «lender:24», «merchant:94», «service:legacy-backend»")
			break
		}
		out, err = c.signal(strings.Join(positional, " "))
	case "deploy":
		if len(positional) == 0 {
			err = fmt.Errorf("falta el repo: «legacy-backend», «legacy-application», «pre-approvals-service»…")
			break
		}
		version := ""
		if len(positional) > 1 {
			version = positional[1]
		}
		out, err = c.deploy(positional[0], version, *hours)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "sentinel:", err)
		return 1
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(out)
		return 0
	}
	fmt.Print(out.(interface{ Text() string }).Text())
	return 0
}

type cli struct {
	s     *sentinel
	e     evaluator
	rules Rules
	reach time.Time // hasta dónde llega lo guardado
}

func openCLI(root string) (*cli, error) {
	st, err := openStore(filepath.Join(root, "sentinel", ".data"))
	if err != nil {
		return nil, err
	}
	s := &sentinel{root: root, rulesPath: filepath.Join(root, "sentinel", "rules.json"), store: st, follow: openFollowing(st.dir)}
	rules, err := loadRules(s.rulesPath)
	if err != nil {
		return nil, err
	}
	s.loadLast() // los despliegues de la última pasada (para la sensibilidad de después de un despliegue)
	s.loadNames()
	s.loadSavedReleases()
	if s.releases == nil { // nunca se guardaron: se piden ahora (unos segundos)
		s.loadReleases()
	}
	reach := st.reach()
	if reach.IsZero() {
		return nil, fmt.Errorf("no hay nada guardado todavía: `make sentinel` (o `make sentinel ONCE=1`) carga la historia")
	}
	return &cli{s: s, e: s.evaluator(rules), rules: rules, reach: reach.In(bogota)}, nil
}

// La edad de lo guardado, para que nadie lea lo de hace dos horas como lo de ahora.
func (c *cli) freshness() string {
	age := time.Since(c.reach)
	if age < 15*time.Minute {
		return fmt.Sprintf("guardado hasta las %s", c.reach.Format("15:04"))
	}
	return fmt.Sprintf("⚠ lo guardado llega hasta el %s (hace %s): la API no está leyendo producción (`make sentinel-status`)",
		c.reach.Format("02/01 15:04"), fmtDuration(int(age.Minutes())))
}

// ── now ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type NowReport struct {
	At        string    `json:"at"`
	Freshness string    `json:"freshness"`
	All       Subject   `json:"all"`
	Attention []Subject `json:"attention"` // en alerta o para mirar, lo peor primero
	Following []Subject `json:"following"`
	Apps      []App     `json:"apps"`
}

func (c *cli) now() (*NowReport, error) {
	o := c.s.overview(c.rules, c.reach.Truncate(time.Minute))
	r := &NowReport{At: c.reach.Format(time.RFC3339), Freshness: c.freshness(), All: o.All, Apps: o.Apps}
	for _, list := range [][]Subject{o.Services, o.Liveness, o.LenderErrors, o.Lenders, o.Merchants} {
		for _, x := range list {
			if x.State == "alert" || x.State == "warn" {
				r.Attention = append(r.Attention, x)
			}
			if c.s.follow.has(x.Signal) {
				r.Following = append(r.Following, x)
			}
		}
	}
	sortSubjects(r.Attention)
	return r, nil
}

func (r *NowReport) Text() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Producción · %s\n\n", r.Freshness)
	fmt.Fprintf(&b, "Toda la originación: %s · %s\n\n", stateWord(r.All.State), r.All.Why)
	if len(r.Attention) == 0 {
		b.WriteString("Nada fuera de lo normal.\n\n")
	} else {
		fmt.Fprintf(&b, "Pide atención (%d):\n", len(r.Attention))
		for _, x := range r.Attention {
			fmt.Fprintf(&b, "  %s %s — %s\n", mark(x.State), x.Name, x.Why)
		}
		b.WriteString("\n")
	}
	if len(r.Following) > 0 {
		b.WriteString("Lo que seguís:\n")
		for _, x := range r.Following {
			fmt.Fprintf(&b, "  %s %s — %s\n", mark(x.State), x.Name, x.Why)
		}
		b.WriteString("\n")
	}
	b.WriteString("Servicios en producción:\n")
	for _, a := range r.Apps {
		version := "sin versión en GitHub"
		if a.Release != nil {
			version = a.Release.Version + " (" + shortAgo(a.Release.At) + ")"
			if !a.Release.OK {
				version += ", ese despliegue FALLÓ"
			}
		}
		errs, lines := "—", "—"
		if a.Errors != nil {
			errs = fmt.Sprintf("%d errores · normal %s", a.Errors.Now.Total, fmtNum(a.Errors.Median))
		}
		if a.Lines != nil {
			lines = fmt.Sprintf("%d líneas · normal %s", a.Lines.Now.Total, fmtNum(a.Lines.Median))
			if a.Lines.Silence != nil {
				lines = "CALLADO: " + a.Lines.Silence.Why
			}
		}
		fmt.Fprintf(&b, "  %s %-30s %-28s %s · %s\n", mark(a.State), a.Service, version, errs, lines)
	}
	return b.String()
}

// ── day ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Spell: un tramo en que una señal estuvo fuera de lo normal (sostenido), con su peor momento.
type Spell struct {
	Signal Signal `json:"signal"`
	Name   string `json:"name"`
	From   string `json:"from"`
	To     string `json:"to,omitempty"` // vacío: sigue
	Level  string `json:"level"`        // el peor: alert o warn
	Why    string `json:"why"`          // el porqué del peor momento
}

type DayReport struct {
	Date       string    `json:"date"`
	Freshness  string    `json:"freshness"`
	Through    string    `json:"through"` // hasta qué hora mira (hoy, la hora de lo guardado)
	Requests   DayTotals `json:"requests"`
	Spells     []Spell   `json:"spells"`
	Deploys    []Deploy  `json:"deploys"`
	Notices    []Notice  `json:"notices"`
	Comparable int       `json:"comparable"` // cuántos días comparables hay para lo normal
}

// DayTotals: lo que entró en el día (hasta `Through`) y lo normal hasta esa misma hora.
type DayTotals struct {
	Total, Approved, Denied int
	Normal                  float64
	Low, High               int
}

func (c *cli) day(date string) (*DayReport, error) {
	start, err := time.ParseInLocation("2006-01-02", date, bogota)
	if err != nil {
		return nil, fmt.Errorf("la fecha va como AAAA-MM-DD: %v", err)
	}
	end := start.AddDate(0, 0, 1)
	if end.After(c.reach) {
		end = c.reach
	}
	if !end.After(start) {
		return nil, fmt.Errorf("no hay nada guardado del %s", date)
	}
	r := &DayReport{Date: date, Freshness: c.freshness(), Through: end.Format(time.RFC3339)}
	minutes := int(end.Sub(start).Minutes())
	if se := c.e.data["all:production"]; se != nil {
		r.Requests = DayTotals{Total: window(se.total, end, minutes), Approved: window(se.approved, end, minutes), Denied: window(se.denied, end, minutes)}
		var xs []float64
		for _, past := range comparable(end, c.rules.BaselineDays, c.e.have) {
			xs = append(xs, float64(window(se.total, past, minutes)))
		}
		r.Comparable = len(xs)
		r.Requests.Normal, r.Requests.Low, r.Requests.High = median(xs), int(quantile(xs, 0.1)), int(quantile(xs, 0.9)+0.5)
	}
	r.Spells = c.spells(start, end)
	for _, d := range c.s.deployList {
		if strings.HasPrefix(d.At, date) {
			r.Deploys = append(r.Deploys, d)
		}
	}
	for _, x := range openNotifier(c.s.store.dir).recent(1000) {
		if t, err := time.Parse(time.RFC3339, x.At); err == nil && t.In(bogota).Format("2006-01-02") == date {
			r.Notices = append(r.Notices, x)
		}
	}
	return r, nil
}

// spells: los tramos fuera de lo normal de [start, end), con una lectura cada `stepMinutes`, como el backtest.
func (c *cli) spells(start, end time.Time) []Spell {
	step := time.Duration(c.rules.StepMinutes) * time.Minute
	var out []Spell
	for sig := range c.e.data {
		if c.rules.Signals[sig].Ignore {
			continue
		}
		var cur *Spell
		worst := levelOK
		for t := start.Add(step); !t.After(end); t = t.Add(step) {
			ev, level := c.e.sustained(sig, t)
			switch {
			case level >= levelWarn && cur == nil:
				cur = &Spell{Signal: sig, Name: c.s.subjectName(sig), From: t.Format(time.RFC3339), Level: levelName(level), Why: ev.Why}
				worst = level
			case level >= levelWarn:
				if level > worst {
					worst, cur.Level, cur.Why = level, levelName(level), ev.Why
				}
			case level < levelWarn && cur != nil:
				cur.To = t.Format(time.RFC3339)
				out = append(out, *cur)
				cur = nil
			}
		}
		if cur != nil {
			out = append(out, *cur)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].From < out[j].From })
	return out
}

func (r *DayReport) Text() string {
	var b strings.Builder
	day, _ := time.ParseInLocation("2006-01-02", r.Date, bogota)
	through, _ := time.Parse(time.RFC3339, r.Through)
	until := "el día entero"
	if t := through.In(bogota); t.Hour() != 0 || t.Minute() != 0 {
		until = "hasta las " + t.Format("15:04")
	}
	fmt.Fprintf(&b, "Producción · %s (%s) · %s\n\n", spanishDate(day), until, r.Freshness)
	q := r.Requests
	normalWhen := "hasta esta hora"
	if until == "el día entero" {
		normalWhen = "en un día así"
	}
	fmt.Fprintf(&b, "Solicitudes: %d (aprobadas %d · negadas %d). Lo normal %s: %s, casi siempre entre %d y %d (%d días comparables).\n\n",
		q.Total, q.Approved, q.Denied, normalWhen, fmtNum(q.Normal), q.Low, q.High, r.Comparable)
	if len(r.Spells) == 0 {
		b.WriteString("Nada se salió de lo normal.\n\n")
	} else {
		fmt.Fprintf(&b, "Lo que se salió de lo normal (%d):\n", len(r.Spells))
		for _, x := range r.Spells {
			from, _ := time.Parse(time.RFC3339, x.From)
			span := from.In(bogota).Format("15:04") + "–"
			if x.To != "" {
				to, _ := time.Parse(time.RFC3339, x.To)
				span += to.In(bogota).Format("15:04")
			} else {
				span += "sigue"
			}
			fmt.Fprintf(&b, "  %s %-12s %s — %s\n", mark(x.Level), span, x.Name, x.Why)
		}
		b.WriteString("\n")
	}
	if len(r.Deploys) > 0 {
		b.WriteString("Despliegues a producción:\n")
		for _, d := range r.Deploys {
			t, _ := time.Parse(time.RFC3339, d.At)
			ok := ""
			if !d.OK {
				ok = " · FALLÓ"
			}
			fmt.Fprintf(&b, "  %s %s %s%s — %s\n", t.In(bogota).Format("15:04"), d.Repo, d.Version, ok, d.Title)
		}
		b.WriteString("  (¿se dañó algo? bin/sentinel deploy <repo> <versión>)\n\n")
	}
	if len(r.Notices) > 0 {
		b.WriteString("Avisos que salieron:\n")
		for _, x := range r.Notices {
			t, _ := time.Parse(time.RFC3339, x.At)
			fmt.Fprintf(&b, "  %s %s · %s\n", t.In(bogota).Format("15:04"), x.Name, x.Text)
		}
		b.WriteString("\n")
	}
	return b.String()
}

// saveDay: el resumen del día queda escrito en `sentinel/.data/days/<día>.md`, para leerlo sin la consola.
func (c *cli) saveDay(d *DayReport) error {
	dir := filepath.Join(c.s.store.dir, "days")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, d.Date+".md"), []byte("# "+d.Text()), 0o644)
}

// ── signal ───────────────────────────────────────────────────────────────────────────────────────────────────────

type SignalReport struct {
	Freshness string   `json:"freshness"`
	Subject   Subject  `json:"subject"`
	Errors    *Subject `json:"errors,omitempty"` // de una entidad: sus errores en los logs
}

func (c *cli) signal(ref string) (*SignalReport, error) {
	sig, err := c.resolve(ref)
	if err != nil {
		return nil, err
	}
	now := c.reach.Truncate(time.Minute)
	r := &SignalReport{Freshness: c.freshness(), Subject: c.s.subject(c.e, sig, now)}
	if kindOf(sig) == "lender" {
		if errSig := Signal("lerr:" + sig[len("lender:"):]); c.e.data[errSig] != nil {
			x := c.s.subject(c.e, errSig, now)
			r.Errors = &x
		}
	}
	return r, nil
}

// resolve: «lender:24», «merchant:94», «service:x», «logs:x», o un pedazo del nombre (entidades, comercios, servicios).
func (c *cli) resolve(ref string) (Signal, error) {
	if strings.Contains(ref, ":") {
		if c.e.data[ref] == nil {
			return "", fmt.Errorf("no hay nada guardado de %q", ref)
		}
		return ref, nil
	}
	q := foldText(ref)
	var hits []Signal
	for sig := range c.e.data {
		if k := kindOf(sig); k == "lerr" || k == "logs" {
			continue // se llega por la entidad o el servicio
		}
		name := foldText(c.s.subjectName(sig))
		if name == q {
			return sig, nil
		}
		if strings.Contains(name, q) {
			hits = append(hits, sig)
		}
	}
	sort.Slice(hits, func(i, j int) bool { return len(c.s.subjectName(hits[i])) < len(c.s.subjectName(hits[j])) })
	switch len(hits) {
	case 0:
		return "", fmt.Errorf("nada se llama como %q", ref)
	case 1:
		return hits[0], nil
	}
	var names []string
	for _, h := range hits[:min(len(hits), 8)] {
		names = append(names, fmt.Sprintf("%s (%s)", c.s.subjectName(h), h))
	}
	return hits[0], fmt.Errorf("%q es ambiguo: %s", ref, strings.Join(names, ", "))
}

func (r *SignalReport) Text() string {
	var b strings.Builder
	s := r.Subject
	fmt.Fprintf(&b, "%s · %s\n\n%s %s — %s\n", s.Name, r.Freshness, mark(s.State), stateWord(s.State), s.Why)
	if s.Silence != nil {
		fmt.Fprintf(&b, "  callado: %s\n", s.Silence.Why)
	}
	if s.Shift != nil {
		fmt.Fprintf(&b, "  cambio de nivel: ×%s por día (de %s a %s), la última semana contra las anteriores\n", fmtNum(math.Round(s.Shift.Ratio*10)/10), fmtNum(s.Shift.Before), fmtNum(s.Shift.After))
	}
	if s.Kind == "lender" || s.Kind == "merchant" || s.Kind == "all" {
		fmt.Fprintf(&b, "  aprobadas %d · negadas %d en la ventana\n", s.Now.Approved, s.Now.Denied)
	}
	b.WriteString("\n  hora   hoy   lo normal (casi siempre)\n")
	writeHours(&b, s)
	if r.Errors != nil {
		e := r.Errors
		fmt.Fprintf(&b, "\nErrores en los logs que la nombran: %s %s — %s\n\n  hora   hoy   lo normal (casi siempre)\n", mark(e.State), stateWord(e.State), e.Why)
		writeHours(&b, *e)
	}
	return b.String()
}

func writeHours(b *strings.Builder, s Subject) {
	for h := range s.Normal {
		today := "     "
		if h < len(s.Today) {
			today = fmt.Sprintf("%5d", s.Today[h])
		}
		flag := ""
		if h < len(s.Today) && h < len(s.Today)-1 { // la hora en curso todavía se llena
			if v := float64(s.Today[h]); errorKind(s.Signal) && v > s.NormHi[h]*1.5 && v >= 5 {
				flag = "  ↑"
			} else if !errorKind(s.Signal) && v < s.NormLo[h]*0.6 && s.Normal[h] >= 3 {
				flag = "  ↓"
			}
		}
		fmt.Fprintf(b, "  %02dh %s   %6s (%s–%s)%s\n", h, today, fmtNum(s.Normal[h]), fmtNum(math.Round(s.NormLo[h])), fmtNum(math.Round(s.NormHi[h])), flag)
	}
}

// ── deploy ───────────────────────────────────────────────────────────────────────────────────────────────────────

// Change: una señal en la franja de después de un despliegue, contra la de antes y contra lo normal de esa franja.
type Change struct {
	Signal Signal  `json:"signal"`
	Name   string  `json:"name"`
	After  int     `json:"after"`
	Before int     `json:"before"`
	Normal float64 `json:"normal"` // la mediana de la misma franja en los días comparables
	Why    string  `json:"why"`
	score  float64
}

type DeployReport struct {
	Freshness string   `json:"freshness"`
	Repo      string   `json:"repo"`
	Release   Release  `json:"release"`
	From      string   `json:"from"`
	To        string   `json:"to"`
	Complete  bool     `json:"complete"` // ya pasaron las horas pedidas
	Hours     float64  `json:"hours"`
	Worse     []Change `json:"worse"`
	Checked   int      `json:"checked"` // cuántas señales se compararon
	// NewErrors: los mensajes de error del front que aparecen después y no en los 7 días de antes.
	NewErrors     []NewError `json:"newErrors,omitempty"`
	NewErrorsNote string     `json:"newErrorsNote,omitempty"`
	Comparable    int        `json:"comparable"`
}

func (c *cli) deploy(repo, version string, hours float64) (*DeployReport, error) {
	rel, err := findRelease(repo, version)
	if err != nil {
		return nil, err
	}
	at, _ := time.Parse(time.RFC3339, rel.At)
	at = at.In(bogota)
	span := time.Duration(hours * float64(time.Hour))
	to := at.Add(span)
	r := &DeployReport{Freshness: c.freshness(), Repo: repo, Release: *rel, From: at.Format(time.RFC3339), Hours: hours, Complete: !to.After(c.reach)}
	if to.After(c.reach) {
		to = c.reach
	}
	r.To = to.Format(time.RFC3339)
	minutes := int(to.Sub(at).Minutes()) / 5 * 5
	if minutes < 15 {
		return r, fmt.Errorf("el despliegue fue hace %d minutos: todavía no hay con qué comparar", minutes)
	}
	comp := comparable(to, c.rules.BaselineDays, c.e.have)
	r.Comparable = len(comp)
	for sig, se := range c.e.data {
		if c.rules.Signals[sig].Ignore {
			continue
		}
		r.Checked++
		ch := Change{Signal: sig, Name: c.s.subjectName(sig), After: window(se.total, to, minutes), Before: window(se.total, at, minutes)}
		var xs []float64
		for _, past := range comp {
			xs = append(xs, float64(window(se.total, past, minutes)))
		}
		ch.Normal = median(xs)
		ref := math.Max(ch.Normal, float64(ch.Before))
		label := fmt.Sprintf("%s en las %s después; antes %d, lo normal en esa franja %s", "%d", fmtDuration(minutes), ch.Before, fmtNum(ch.Normal))
		switch k := kindOf(sig); {
		case k == "step": // una pantalla del wizard: que caiga la conversión, o que suban los fallos
			rate := func(to time.Time) (float64, int, float64) {
				v, d, f := window(se.approved, to, minutes), window(se.total, to, minutes), window(se.denied, to, minutes)
				r, fr := -1.0, 0.0
				if v > 0 {
					r = math.Min(1, float64(d)/float64(v))
				}
				if d > 0 {
					fr = float64(f) / float64(d)
				}
				return r, v, fr
			}
			ra, va, fa := rate(to)
			rb, _, fb := rate(at)
			var rn, fn []float64
			for _, past := range comp {
				if r, v, f := rate(past); v >= 10 {
					rn = append(rn, r)
					fn = append(fn, f)
				}
			}
			normRate, normFail := median(rn), median(fn)
			fails := window(se.denied, to, minutes)
			switch {
			case va >= stepMinViews && normRate > 0 && ra >= 0 && ra <= 0.6*normRate && (rb < 0 || ra <= 0.75*rb):
				ch.score = normRate / math.Max(ra, 0.01)
				ch.Why = fmt.Sprintf("la enviaron %s de los que la vieron (%d) en las %s después; antes %s, lo normal %s",
					pctText(ra), va, fmtDuration(minutes), pctText(rb), pctText(normRate))
			case fails >= stepMinFails && fa >= 2*math.Max(normFail, 0.01) && fa >= 1.5*math.Max(fb, 0.01):
				ch.score = fa / math.Max(normFail, 0.01)
				ch.Why = fmt.Sprintf("fallaron %s (%d) en las %s después; antes %s, lo normal %s", pctText(fa), fails, fmtDuration(minutes), pctText(fb), pctText(normFail))
			}
		case errorKind(sig): // errores: que suban, con piso
			if ch.After >= max(c.rules.Errors.MinNow, 10)*int(math.Max(1, float64(minutes)/60)) && float64(ch.After) >= 1.5*math.Max(ref, 1) {
				ch.score = float64(ch.After) / math.Max(ref, 1)
				ch.Why = "errores: " + fmt.Sprintf(label, ch.After)
			}
		case k == "logs": // la señal de vida: que casi deje de escribir
			if ch.Normal >= 20 && float64(ch.After) <= 0.1*ch.Normal {
				ch.score = 10
				ch.Why = "casi dejó de escribir: " + fmt.Sprintf(label, ch.After) + " líneas"
			}
		default: // volumen: que caiga contra lo normal Y contra lo de antes
			// Con poco volumen, de 4 a 1 es azar: hace falta que lo normal de la franja sea 10, o que no entre nada donde
			// entraban al menos 5.
			drop := ch.Normal >= 10 && float64(ch.After) <= 0.6*ch.Normal && float64(ch.After) <= 0.6*math.Max(float64(ch.Before), 1)
			if drop || (ch.After == 0 && ch.Normal >= 5 && ch.Before >= 3) {
				ch.score = ch.Normal / math.Max(float64(ch.After), 0.5)
				ch.Why = "entraron " + fmt.Sprintf(label, ch.After)
			}
		}
		if ch.Why != "" {
			r.Worse = append(r.Worse, ch)
		}
	}
	sort.Slice(r.Worse, func(i, j int) bool { return r.Worse[i].score > r.Worse[j].score })
	if cl, err := phClient(); err == nil {
		if r.NewErrors, err = newFrontErrors(cl, at, to, 7); err != nil {
			r.NewErrorsNote = "no se pudieron leer los errores del front: " + err.Error()
		}
	}
	return r, nil
}

func (r *DeployReport) Text() string {
	var b strings.Builder
	from, _ := time.Parse(time.RFC3339, r.From)
	to, _ := time.Parse(time.RFC3339, r.To)
	ok := ""
	if !r.Release.OK {
		ok = " · ese despliegue FALLÓ"
	}
	fmt.Fprintf(&b, "%s %s · desplegado el %s a las %s%s\n%s\n\n", r.Repo, r.Release.Version, spanishDate(from.In(bogota)), from.In(bogota).Format("15:04"), ok, r.Release.URL)
	fmt.Fprintf(&b, "Miro %s–%s contra las mismas horas antes del despliegue y contra esa franja en %d días comparables (%s).\n",
		from.In(bogota).Format("15:04"), to.In(bogota).Format("15:04"), r.Comparable, r.Freshness)
	if !r.Complete {
		fmt.Fprintf(&b, "⚠ Todavía no pasaron las %s horas: es lo que va.\n", fmtNum(r.Hours))
	}
	b.WriteString("\n")
	newErrors := func() {
		if len(r.NewErrors) > 0 {
			fmt.Fprintf(&b, "\nErrores del front NUEVOS (no aparecieron en los 7 días de antes):\n")
			for _, x := range r.NewErrors {
				fmt.Fprintf(&b, "  ✗ %d × %s\n", x.After, x.Message)
			}
		}
		if r.NewErrorsNote != "" {
			fmt.Fprintf(&b, "\n⚠ %s\n", r.NewErrorsNote)
		}
	}
	if len(r.Worse) == 0 {
		fmt.Fprintf(&b, "No se ve nada peor: de %d señales (solicitudes, errores y vida de cada servicio, errores por entidad, pantallas del wizard), ninguna empeoró contra antes y contra lo normal.\n", r.Checked)
		newErrors()
		return b.String()
	}
	fmt.Fprintf(&b, "Empeoró (%d de %d señales):\n", len(r.Worse), r.Checked)
	for _, ch := range r.Worse {
		fmt.Fprintf(&b, "  ✗ %s — %s\n", ch.Name, ch.Why)
	}
	newErrors()
	b.WriteString("\nOjo: que algo empeore después no prueba que lo causó el despliegue. Mirá la señal (bin/sentinel signal …) y sus logs.\n")
	return b.String()
}

// findRelease: un despliegue a producción de un repo en GitHub: el de esa versión, o el último que salió bien.
func findRelease(repo, version string) (*Release, error) {
	// El front: lo que se vio en producción en PostHog (no hay un workflow de GitHub que lo despliegue a la vista).
	if repo == "frontend-monorepo" {
		cl, err := phClient()
		if err != nil {
			return nil, err
		}
		list, err := frontReleases(cl, 60)
		if err != nil {
			return nil, err
		}
		var seen []string
		for i := len(list) - 1; i >= 0; i-- {
			d := list[i]
			seen = append(seen, d.Version)
			if version == "" || d.Version == version || strings.Contains(d.Title, version) {
				return &Release{Version: d.Version, At: d.At, OK: true, URL: d.URL, Title: d.Title}, nil
			}
		}
		if len(seen) == 0 {
			return nil, fmt.Errorf("en PostHog no hay versiones del front vistas en producción (antes de la v1.11.7 los errores no la traían)")
		}
		return nil, fmt.Errorf("no vi %s en producción; las vistas: %s", version, strings.Join(seen, ", "))
	}
	out, err := exec.Command("gh", "run", "list", "--repo", "Creditop-SAS/"+repo, "--limit", "200",
		"--json", "workflowName,headBranch,conclusion,status,createdAt,url,displayTitle").Output()
	if err != nil {
		return nil, fmt.Errorf("GitHub no contestó por %s (¿gh autenticado? ¿así se llama el repo?): %v", repo, err)
	}
	var runs []struct {
		WorkflowName, HeadBranch, Conclusion, Status, CreatedAt, URL, DisplayTitle string
	}
	if err := json.Unmarshal(out, &runs); err != nil {
		return nil, err
	}
	var seen []string
	for _, r := range runs {
		if !prodWorkflow.MatchString(r.WorkflowName) || r.Status != "completed" {
			continue
		}
		seen = append(seen, r.HeadBranch)
		if (version == "" && r.Conclusion == "success") || r.HeadBranch == version {
			t, err := time.Parse(time.RFC3339, r.CreatedAt)
			if err != nil {
				continue
			}
			return &Release{Version: r.HeadBranch, At: t.In(bogota).Format(time.RFC3339), OK: r.Conclusion == "success", URL: r.URL, Title: r.DisplayTitle}, nil
		}
	}
	if len(seen) == 0 {
		return nil, fmt.Errorf("%s no tiene despliegues a producción en sus últimas 200 corridas de GitHub", repo)
	}
	return nil, fmt.Errorf("no encuentro %s %s; los últimos a producción: %s", repo, version, strings.Join(seen[:min(len(seen), 8)], ", "))
}

// ── piezas ───────────────────────────────────────────────────────────────────────────────────────────────────────

// subjectName: el nombre de una señal sin evaluarla (para listas largas).
func (s *sentinel) subjectName(sig Signal) string {
	kind := kindOf(sig)
	key := sig[len(kind)+1:]
	id, _ := strconv.Atoi(key)
	switch kind {
	case "all":
		return "Toda la originación"
	case "lender":
		return nameOr(s.lenderNames, id)
	case "lerr":
		return nameOr(s.lenderNames, id) + " · errores"
	case "merchant":
		return nameOr(s.merchantNames, id)
	case "queue":
		return "Trabajos fallidos de la cola"
	case "logs":
		return key + " · líneas"
	case "jserr":
		return "Errores del front (JavaScript)"
	case "step":
		id, m := stepParts(sig)
		label := id
		if st := stepByID(id); st != nil {
			label = st.Label
		}
		if m == "" {
			return "Pantalla · " + label
		}
		mid, _ := strconv.Atoi(m)
		return nameOr(s.merchantNames, mid) + " · " + label
	}
	return key
}

// Los nombres de entidades y comercios quedan en `names.json` en cada pasada, para la consola sin la API.
type savedNames struct {
	Lenders   map[int]string `json:"lenders"`
	Merchants map[int]string `json:"merchants"`
}

func (s *sentinel) saveNames() {
	raw, err := json.Marshal(savedNames{s.lenderNames, s.merchantNames})
	if err != nil {
		return
	}
	path := filepath.Join(s.store.dir, "names.json")
	if os.WriteFile(path+".tmp", raw, 0o644) == nil {
		_ = os.Rename(path+".tmp", path)
	}
}

func (s *sentinel) loadNames() {
	raw, err := os.ReadFile(filepath.Join(s.store.dir, "names.json"))
	if err != nil {
		// Antes de la primera pasada que los guarda: los de la última vista (last.json).
		s.lenderNames, s.merchantNames = map[int]string{}, map[int]string{}
		if s.last != nil {
			for _, x := range s.last.Lenders {
				s.lenderNames[x.ID] = x.Name
			}
			for _, x := range s.last.Merchants {
				s.merchantNames[x.ID] = x.Name
			}
		}
		return
	}
	var n savedNames
	if json.Unmarshal(raw, &n) == nil {
		s.lenderNames, s.merchantNames = n.Lenders, n.Merchants
	}
}

var (
	spanishWeekdays = []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}
	spanishMonths   = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}
)

func spanishDate(t time.Time) string {
	return fmt.Sprintf("%s %d de %s", spanishWeekdays[t.Weekday()], t.Day(), spanishMonths[t.Month()-1])
}

func foldText(s string) string {
	r := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ñ", "n", "ü", "u")
	return r.Replace(strings.ToLower(strings.TrimSpace(s)))
}

func mark(state string) string {
	switch state {
	case "alert":
		return "✗"
	case "warn":
		return "!"
	case "ok":
		return "·"
	}
	return " "
}

func stateWord(state string) string {
	return map[string]string{"alert": "ALERTA", "warn": "para mirar", "ok": "normal", "quiet": "poco volumen"}[state]
}

func shortAgo(iso string) string {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return ""
	}
	h := time.Since(t).Hours()
	if h < 48 {
		return fmt.Sprintf("hace %d h", int(h))
	}
	return fmt.Sprintf("hace %d días", int(h/24))
}
