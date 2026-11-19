package main

// Chronos-2 en modo sombra: un modelo de pronóstico de series (amazon/chronos-2, Apache 2.0) que corre en la Mac y
// dice, para cada hora, el rango en que debería caer cada señal según sus últimas cuatro semanas. NO decide nada:
// `-chronos N` compara, hora por hora de los últimos N días, lo que habría marcado Chronos contra lo que marcó
// Sentinel con sus reglas, para ver cómo se comporta antes de que cambie algo (Miguel, 2026-11-18).
//
// Sólo las señales que son CONTEOS (solicitudes, errores, líneas): las de tasa (proveedores, rechazo, embudo,
// pantallas) Sentinel las evalúa como proporción y un pronóstico del volumen no contesta lo mismo.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	chronosContextDays = 28
	chronosMinDaily    = 200 // sin -signals: las señales de conteo con al menos esto por día, en promedio
)

// los cuantiles que se piden: 0,5 % y 99,5 % son «alerta»; 2 % y 98 %, «para mirar»; 10 % y 90 %, para medir la calibración.
var chronosQuantiles = []float64{0.005, 0.02, 0.1, 0.5, 0.9, 0.98, 0.995}

func countSignal(sig Signal) bool {
	switch kindOf(sig) {
	case "all", "lender", "merchant", "service", "logs", "queue", "lerr", "jserr":
		return true
	}
	return false
}

// hourly: la serie por hora de una señal, de from (inclusive) a to (exclusiva); NaN donde no hay día guardado.
func hourly(se *series, have map[string]bool, from, to time.Time) []float64 {
	var out []float64
	for t := from; t.Before(to); t = t.Add(time.Hour) {
		date := t.Format("2006-01-02")
		if !have[date] {
			out = append(out, math.NaN())
			continue
		}
		n := 0
		if arr := se.total[date]; arr != nil {
			b := bucketOf(t)
			for i := b; i < b+12; i++ {
				n += arr[i]
			}
		}
		out = append(out, float64(n))
	}
	return out
}

// restFlags: 1 en cada hora que cae en fin de semana o festivo de Colombia, desde from, n horas. Es lo que Sentinel
// ya sabe (compara días comparables) y Chronos no, si no se le dice: se le pasa como covariable conocida.
func restFlags(from time.Time, n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		if restDay(from.Add(time.Duration(i) * time.Hour)) {
			out[i] = 1
		}
	}
	return out
}

type chronosReply struct {
	Q       [][][]float64 `json:"q"`
	Device  string        `json:"device"`
	Seconds float64       `json:"seconds"`
}

// chronosForecast manda los contextos a forecast/chronos.py (en su venv) y devuelve, por contexto, los cuantiles de
// la hora siguiente.
func chronosForecast(root string, contexts, rests [][]float64) (*chronosReply, error) {
	home, _ := os.UserHomeDir()
	py := filepath.Join(home, ".cache", "my-tools", "chronos", "venv", "bin", "python")
	if _, err := os.Stat(py); err != nil {
		return nil, fmt.Errorf("falta el venv de Chronos en %s", py)
	}
	series := make([][]any, len(contexts))
	for i, c := range contexts {
		row := make([]any, len(c))
		for j, v := range c {
			if !math.IsNaN(v) {
				row[j] = v
			}
		}
		series[i] = row
	}
	req := map[string]any{"series": series, "horizon": 1, "quantiles": chronosQuantiles}
	if len(rests) > 0 {
		req["rest"] = rests
	}
	body, _ := json.Marshal(req)
	cmd := exec.Command(py, "-I", filepath.Join(root, "sentinel", "forecast", "chronos.py"))
	cmd.Stdin = bytes.NewReader(body)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		lines := strings.Split(strings.TrimSpace(errb.String()), "\n")
		return nil, fmt.Errorf("chronos: %v: %s", err, lines[len(lines)-1])
	}
	var r chronosReply
	if err := json.Unmarshal(out.Bytes(), &r); err != nil {
		return nil, err
	}
	if len(r.Q) != len(contexts) {
		return nil, fmt.Errorf("chronos devolvió %d pronósticos para %d series", len(r.Q), len(contexts))
	}
	return &r, nil
}

// chronosLevel: el nivel que le daría Chronos a una hora, con los mismos pisos de magnitud que las reglas de Sentinel
// (si no, una señal casi constante marca 1.432 contra 1.435). Los errores, si SUBEN por encima del rango, con al menos
// 10 por hora y ×1,5 lo esperado; las líneas de un servicio (`logs:`), si caen a la décima parte; el volumen, si cae
// por debajo del rango y a 0,6 de lo esperado.
func chronosLevel(sig Signal, actual float64, q []float64, rules Rules) int {
	mid := q[3]
	if errorKind(sig) {
		th := rules.Errors
		if actual < float64(th.MinNow) || actual < th.Ratio*math.Max(mid, 1) {
			return levelOK
		}
		if actual > q[6] {
			return levelAlert
		}
		if actual > q[5] {
			return levelWarn
		}
		return levelOK
	}
	th := rules.Volume
	if kindOf(sig) == "logs" {
		th = rules.Liveness
	}
	if mid < th.MinMedian || actual > th.Ratio*mid {
		return levelOK // poco volumen, o no cayó lo suficiente
	}
	if actual < q[0] {
		return levelAlert
	}
	if actual < q[1] {
		return levelWarn
	}
	return levelOK
}

type shadowHour struct {
	sig      Signal
	at       time.Time
	actual   float64
	q        []float64
	chronos  int
	sentinel int
	why      string
}

func printChronos(s *sentinel, days int, patterns []string, plain bool) {
	rules, err := loadRules(s.rulesPath)
	if err != nil {
		log.Fatal(err)
	}
	began := time.Now()
	e := s.evaluator(rules).only(patterns)
	now := time.Now().In(bogota)
	last := now.Truncate(time.Hour) // la hora en curso no está completa
	if last.Minute() != 0 {
		last = time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, bogota)
	}
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, bogota).AddDate(0, 0, -days)
	ctxFrom := start.AddDate(0, 0, -chronosContextDays)

	// qué señales: las de conteo; sin -signals, sólo las de volumen suficiente para que una hora diga algo.
	var sigs []Signal
	for sig, se := range e.data {
		if !countSignal(sig) {
			continue
		}
		if len(patterns) == 0 {
			sum, n := 0, 0
			for date, arr := range se.total {
				d, _ := time.ParseInLocation("2006-01-02", date, bogota)
				if d.Before(ctxFrom) || !d.Before(start) {
					continue
				}
				for _, x := range arr {
					sum += x
				}
				n++
			}
			if n == 0 || sum/chronosContextDays < chronosMinDaily {
				continue
			}
		}
		sigs = append(sigs, sig)
	}
	sort.Strings(sigs)
	if len(sigs) == 0 {
		log.Fatal("chronos: ninguna señal de conteo coincide")
	}

	// un contexto por señal y por hora: las 28 × 24 horas anteriores, para pronosticar esa hora.
	var hours []shadowHour
	var contexts, rests [][]float64
	ctxLen := chronosContextDays * 24
	for _, sig := range sigs {
		full := hourly(e.data[sig], e.have, ctxFrom, last)
		for i := ctxLen; i < len(full); i++ {
			if math.IsNaN(full[i]) {
				continue
			}
			hours = append(hours, shadowHour{sig: sig, at: ctxFrom.Add(time.Duration(i) * time.Hour), actual: full[i]})
			contexts = append(contexts, full[i-ctxLen:i])
			if !plain {
				rests = append(rests, restFlags(ctxFrom.Add(time.Duration(i-ctxLen)*time.Hour), ctxLen+1))
			}
		}
	}
	fmt.Fprintf(os.Stderr, "chronos: %d señales × %d horas = %d pronósticos…\n", len(sigs), len(hours)/max(len(sigs), 1), len(hours))
	reply, err := chronosForecast(s.root, contexts, rests)
	if err != nil {
		log.Fatal(err)
	}

	// Sentinel en los mismos días: el nivel sostenido al cerrar cada hora (su ventana es la hora que termina ahí).
	replayed := e.replayRange(start, last.Add(time.Minute))
	at := map[Signal]map[int64]replayStep{}
	for sig, steps := range replayed {
		m := map[int64]replayStep{}
		for _, st := range steps {
			m[st.At.Unix()] = st
		}
		at[sig] = m
	}
	for i := range hours {
		h := &hours[i]
		h.q = reply.Q[i][0]
		h.chronos = chronosLevel(h.sig, h.actual, h.q, rules)
		if st, ok := at[h.sig][h.at.Add(time.Hour).Unix()]; ok {
			h.sentinel = max(st.Level, levelOK)
			h.why = st.Why
		}
	}
	reportChronos(hours, sigs, days, reply, time.Since(began), plain)
}

func reportChronos(hours []shadowHour, sigs []Signal, days int, reply *chronosReply, took time.Duration, plain bool) {
	// calibración: si el rango sirve, el 80 % de las horas cae entre p10 y p90 y el 96 % entre p2 y p98.
	in80, in96, n := 0, 0, 0
	for _, h := range hours {
		n++
		if h.actual >= h.q[2] && h.actual <= h.q[4] {
			in80++
		}
		if h.actual >= h.q[1] && h.actual <= h.q[5] {
			in96++
		}
	}
	pct := func(a, b int) string { return fmt.Sprintf("%.0f %%", 100*float64(a)/float64(max(b, 1))) }
	fmt.Printf("Chronos-2 contra Sentinel, últimos %d días: %d señales de conteo, %d horas (%s en %s, %s en total)\n",
		days, len(sigs), n, reply.Device, time.Duration(reply.Seconds*float64(time.Second)).Round(time.Second), took.Round(time.Second))
	if plain {
		fmt.Println("sin la covariable de fines de semana y festivos (-plain)")
	} else {
		fmt.Println("con la covariable de fines de semana y festivos")
	}
	fmt.Printf("calibración del rango: entre p10 y p90 cayó el %s (debería ~80 %%); entre p2 y p98, el %s (~96 %%)\n\n", pct(in80, n), pct(in96, n))

	// episodios: horas seguidas marcadas de la misma señal cuentan como uno.
	type ep struct {
		sig      Signal
		from, to time.Time
		level    int
		other    int // el nivel que dio el otro en esas horas
		worst    shadowHour
	}
	episodes := func(get func(shadowHour) int, other func(shadowHour) int) []ep {
		var out []ep
		bySig := map[Signal][]shadowHour{}
		for _, h := range hours {
			bySig[h.sig] = append(bySig[h.sig], h)
		}
		for _, sig := range sigs {
			var cur *ep
			for _, h := range bySig[sig] {
				if get(h) >= levelWarn {
					if cur != nil && h.at.Sub(cur.to) <= time.Hour {
						cur.to = h.at
						cur.level = max(cur.level, get(h))
						cur.other = max(cur.other, other(h))
						continue
					}
					if cur != nil {
						out = append(out, *cur)
					}
					cur = &ep{sig: sig, from: h.at, to: h.at, level: get(h), other: other(h), worst: h}
				}
			}
			if cur != nil {
				out = append(out, *cur)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].from.Before(out[j].from) })
		return out
	}
	chr := episodes(func(h shadowHour) int { return h.chronos }, func(h shadowHour) int { return h.sentinel })
	rules := episodes(func(h shadowHour) int { return h.sentinel }, func(h shadowHour) int { return h.chronos })
	count := func(list []ep, lvl int) (all, shared int) {
		for _, x := range list {
			if x.level == lvl {
				all++
				if x.other >= levelWarn {
					shared++
				}
			}
		}
		return
	}
	chrAlerts, chrAlertsShared := count(chr, levelAlert)
	chrWarns, chrWarnsShared := count(chr, levelWarn)
	ruleAlerts, ruleAlertsShared := count(rules, levelAlert)
	ruleWarns, ruleWarnsShared := count(rules, levelWarn)
	fmt.Println("episodios (horas seguidas de una señal = uno)        alerta   para mirar")
	fmt.Printf("  Sentinel (sus reglas)                               %4d       %4d\n", ruleAlerts, ruleWarns)
	fmt.Printf("    de esos, Chronos también marcó algo               %4d       %4d\n", ruleAlertsShared, ruleWarnsShared)
	fmt.Printf("  Chronos (fuera del rango 0,5–99,5 / 2–98)           %4d       %4d\n", chrAlerts, chrWarns)
	fmt.Printf("    de esos, Sentinel también marcó algo              %4d       %4d\n\n", chrAlertsShared, chrWarnsShared)

	// por día: hábil o de descanso, que es lo que Sentinel ya sabe y Chronos no.
	type dayCount struct{ chr, rules, both int }
	byDay := map[string]*dayCount{}
	var dates []string
	for _, h := range hours {
		d := h.at.Format("2006-01-02")
		if byDay[d] == nil {
			byDay[d] = &dayCount{}
			dates = append(dates, d)
		}
		c := byDay[d]
		if h.chronos >= levelWarn {
			c.chr++
		}
		if h.sentinel >= levelWarn {
			c.rules++
		}
		if h.chronos >= levelWarn && h.sentinel >= levelWarn {
			c.both++
		}
	}
	sort.Strings(dates)
	fmt.Println("horas marcadas por día            Sentinel  Chronos  los dos")
	for _, d := range dates {
		t, _ := time.ParseInLocation("2006-01-02", d, bogota)
		kind := "hábil"
		if dayOff(t) {
			kind = "festivo"
		} else if restDay(t) {
			kind = "fin de semana"
		}
		c := byDay[d]
		fmt.Printf("  %s %-3s %-14s %6d   %6d   %6d\n", d, []string{"dom", "lun", "mar", "mié", "jue", "vie", "sáb"}[t.Weekday()], kind, c.rules, c.chr, c.both)
	}

	span := func(x ep) string {
		end := x.to.Add(time.Hour)
		if end.Format("01-02") != x.from.Format("01-02") && !(end.Hour() == 0 && end.Sub(x.from) <= 24*time.Hour) {
			return x.from.Format("01-02 15h") + "–" + end.Format("01-02 15h")
		}
		return x.from.Format("01-02 15h") + "–" + end.Format("15h")
	}
	show := func(title string, list []ep, onlyAlone bool) {
		fmt.Println("\n" + title)
		shown := 0
		for _, x := range list {
			if onlyAlone && x.other >= levelWarn {
				continue
			}
			if x.level < levelAlert {
				continue
			}
			h := x.worst
			fmt.Printf("  %-22s %-30s hubo %s; Chronos esperaba %s (rango %s–%s)\n", span(x),
				x.sig, fmtNum(h.actual), fmtNum(h.q[3]), fmtNum(h.q[0]), fmtNum(h.q[6]))
			if shown++; shown == 20 {
				break
			}
		}
		if shown == 0 {
			fmt.Println("  ninguna")
		}
	}
	show("alertas de Chronos que Sentinel no marcó (las primeras 20):", chr, true)
	fmt.Println("\nalertas de Sentinel que Chronos no marcó:")
	shown := 0
	for _, x := range rules {
		if x.level < levelAlert || x.other >= levelWarn {
			continue
		}
		h := x.worst
		fmt.Printf("  %-22s %-30s hubo %s; Chronos esperaba %s (rango %s–%s)\n", span(x),
			x.sig, fmtNum(h.actual), fmtNum(h.q[3]), fmtNum(h.q[0]), fmtNum(h.q[6]))
		shown++
	}
	if shown == 0 {
		fmt.Println("  ninguna")
	}
}
