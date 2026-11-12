// sentinel es la API del vigía de producción. Guarda la historia de producción en bloques de 5 minutos (sentinel/.data,
// fuera de git: la carga inicial de 4 semanas se pide una vez), cada pocos minutos pide sólo lo que falta, y dice por
// entidad, comercio, servicio y cola si la última hora se salió de lo normal de los días comparables (stats.go).
//
//	go run ./sentinel/server -serve 127.0.0.1:5211     la API (`make sentinel` la levanta con la interfaz)
//	go run ./sentinel/server -once                    carga lo que falte, una pasada, y el resumen
//	go run ./sentinel/server -backtest 7              cuántas veces habrían sonado las reglas en los últimos 7 días
//	make sentinel-install                             la deja corriendo de fondo (LaunchAgent): mide aunque nada esté abierto
//
// Sólo escucha en 127.0.0.1 y sólo LEE producción: cada consulta pasa por la guarda de sólo lectura del conector.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── lo que contesta la API ─────────────────────────────────────────────────────────────────────────────────────

type Window struct {
	Total    int `json:"total"`
	Approved int `json:"approved"`
	Denied   int `json:"denied"`
}

type Sample struct {
	Date string `json:"date"`
	N    int    `json:"n"`
}

// Subject es una señal con su última hora, lo normal, el veredicto y la curva del día.
type Subject struct {
	Signal  Signal   `json:"signal"`
	Kind    string   `json:"kind"` // all · lender · merchant · service · queue
	ID      int      `json:"id"`
	Name    string   `json:"name"`
	Now     Window   `json:"now"`
	Median  float64  `json:"median"`
	Low     int      `json:"low"`  // percentil 10 de los días comparables
	High    int      `json:"high"` // percentil 90
	Spread  float64  `json:"spread"`
	Z       float64  `json:"z"`
	Samples []Sample `json:"samples"`
	State   string   `json:"state"` // alert · warn · ok · quiet (sostenido)
	Raw     string   `json:"raw"`   // el nivel de ahora, sin sostener
	Why     string   `json:"why"`
	// Shift: si el nivel diario cambió y se quedó (×2 o la mitad, la última semana contra las anteriores).
	Shift *Shift `json:"shift,omitempty"`
	// La proporción de negadas sobre lo que terminó: se muestra, no alerta. Lo de hoy todavía no terminó de avanzar
	// (una solicitud se aprueba o se niega horas después), así que compararla con días ya asentados engaña.
	DeniedRate float64 `json:"deniedRate"`
	// Por hora del día (0–23): hoy hasta ahora, y la mediana y los percentiles 10 y 90 de los días comparables.
	Today  []int     `json:"today"`
	Normal []float64 `json:"normal"`
	NormLo []float64 `json:"normalLow"`
	NormHi []float64 `json:"normalHigh"`
}

type History struct {
	Days int    `json:"days"`
	From string `json:"from"`
}

type Overview struct {
	CheckedAt  string    `json:"checkedAt"`
	WindowFrom string    `json:"windowFrom"`
	WindowTo   string    `json:"windowTo"`
	Source     string    `json:"source"`
	All        Subject   `json:"all"`
	Lenders    []Subject `json:"lenders"`
	Merchants  []Subject `json:"merchants"`
	Services   []Subject `json:"services"` // los errores de Loki y la cola
	LogsNote   string    `json:"logsNote,omitempty"`
	Deploys    []Deploy  `json:"deploys"`
	History    History   `json:"history"`
	Rules      Rules     `json:"rules"`
	Seconds    float64   `json:"seconds"`
}

// ── la carga: inicial (los días que falten) y en cada pasada (las últimas horas) ───────────────────────────────

type sentinel struct {
	root, rulesPath string
	store           *store
	mu              sync.Mutex
	last            *Overview
	err             string
	running         bool
	loading         string
	fromDisk        bool // la vista de arranque salió de last.json
	lenderNames     map[int]string
	merchantNames   map[int]string
	namesAt         time.Time
	deployList      []Deploy
	deploysAt       time.Time
	logsNote        string
}

var (
	requestKinds = []string{"all", "lender", "merchant", "queue"}
	logKinds     = []string{"service"}
)

// fetchRange pide [from, to) a las dos fuentes y lo guarda, día por día.
func (s *sentinel) fetchRange(r reader, from, to time.Time) error {
	fresh := Fresh{}
	if err := r.requests(from, to, fresh); err != nil {
		return err
	}
	if err := r.failedJobs(from, to, fresh); err != nil {
		return err
	}
	if err := s.putRange(from, to, fresh, requestKinds); err != nil {
		return err
	}
	logs := Fresh{}
	cl, err := lokiClient()
	if err == nil {
		err = logErrors(cl, from, to, logs)
	}
	if err != nil {
		s.logsNote = "sin los errores de Loki: " + err.Error()
		return nil // Loki es una señal más: sin ella, la pasada sigue
	}
	s.logsNote = ""
	return s.putRange(from, to, logs, logKinds)
}

// putRange guarda lo que llegó, día por día, reemplazando los bloques de [from, to) de esas clases.
func (s *sentinel) putRange(from, to time.Time, fresh Fresh, kinds []string) error {
	for day := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, bogota); day.Before(to); day = day.AddDate(0, 0, 1) {
		date := day.Format("2006-01-02")
		next := day.AddDate(0, 0, 1)
		lo, hi := 0, bucketsPerDay
		if from.After(day) {
			lo = bucketOf(from)
		}
		if to.Before(next) {
			hi = bucketOf(to)
			if to.Minute()%5 != 0 || to.Second() != 0 {
				hi++ // el bloque en curso también se reemplaza
			}
		}
		through := minTime(to, next)
		if err := s.store.put(date, lo, hi, fresh[date], through, kinds); err != nil {
			return err
		}
	}
	return nil
}

// backfill pide entero cada día de la historia que no esté completo (la primera vez, las 4 semanas: un par de minutos).
func (s *sentinel) backfill(r reader, rules Rules, now time.Time) error {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, bogota)
	var missing []time.Time
	for d := rules.HistoryDays; d >= 1; d-- {
		day := today.AddDate(0, 0, -d)
		if !s.store.complete(day.Format("2006-01-02")) {
			missing = append(missing, day)
		}
	}
	for i, day := range missing {
		s.setLoading(fmt.Sprintf("cargando la historia: %d de %d días (%s)", i+1, len(missing), day.Format("2006-01-02")))
		if err := s.fetchRange(r, day, day.AddDate(0, 0, 1)); err != nil {
			s.setLoading("")
			return fmt.Errorf("la carga de %s: %w", day.Format("2006-01-02"), err)
		}
	}
	if s.store.day(today.Format("2006-01-02")) == nil {
		s.setLoading("cargando hoy")
		if err := s.fetchRange(r, today, now); err != nil {
			s.setLoading("")
			return err
		}
	}
	s.setLoading("")
	return nil
}

func (s *sentinel) setLoading(text string) {
	s.mu.Lock()
	s.loading = text
	s.mu.Unlock()
	if text != "" {
		log.Printf("sentinel: %s", text)
	}
}

// pass: lo que falte de la historia, las últimas 3 horas de nuevo, y el veredicto.
func (s *sentinel) pass() (*Overview, error) {
	started := time.Now()
	rules, err := loadRules(s.rulesPath)
	if err != nil {
		return nil, err
	}
	now := time.Now().In(bogota).Truncate(time.Minute)
	r, err := openReader()
	if err != nil {
		return nil, err
	}
	defer r.src.Close()
	if err := s.backfill(r, rules, now); err != nil {
		return nil, err
	}
	from := now.Add(-3 * time.Hour)
	if reach := s.store.reach(); !reach.IsZero() && reach.Before(from) {
		from = reach // un hueco (el Mac dormido, la VPN caída): se pide entero
	}
	if err := s.fetchRange(r, from.Truncate(5*time.Minute), now); err != nil {
		return nil, err
	}
	if time.Since(s.namesAt) > time.Hour || s.lenderNames == nil {
		if s.lenderNames, err = r.names("lenders"); err != nil {
			return nil, err
		}
		if s.merchantNames, err = r.names("allieds"); err != nil {
			return nil, err
		}
		s.namesAt = time.Now()
	}
	if time.Since(s.deploysAt) > 30*time.Minute {
		if list, err := deploys(s.root, 8); err == nil {
			s.deployList, s.deploysAt = list, time.Now()
		}
	}
	o := s.overview(rules, now)
	o.Source = "prod · " + r.src.Name()
	o.Seconds = time.Since(started).Seconds()
	return o, nil
}

// ── la vista general ───────────────────────────────────────────────────────────────────────────────────────────

func (s *sentinel) evaluator(rules Rules) evaluator {
	have := map[string]bool{}
	for _, d := range s.store.dates() {
		have[d] = true
	}
	var deployTimes []time.Time
	for _, d := range s.deployList {
		if t, err := time.Parse(time.RFC3339, d.At); err == nil {
			deployTimes = append(deployTimes, t)
		}
	}
	return evaluator{rules: rules, data: s.store.dense(), have: have, deploys: deployTimes, ceils: map[string]float64{}}
}

func (s *sentinel) overview(rules Rules, now time.Time) *Overview {
	e := s.evaluator(rules)
	dates := s.store.dates()
	o := &Overview{
		CheckedAt: now.Format(time.RFC3339), WindowFrom: now.Add(-time.Duration(rules.WindowMinutes) * time.Minute).Format(time.RFC3339),
		WindowTo: now.Format(time.RFC3339), Deploys: s.deployList, Rules: rules, LogsNote: s.logsNote,
	}
	if len(dates) > 0 {
		o.History = History{Days: len(dates), From: dates[0]}
	}
	for sig := range e.data {
		subj := s.subject(e, sig, now)
		switch subj.Kind {
		case "all":
			o.All = subj
		case "lender":
			if subj.ID != 0 {
				o.Lenders = append(o.Lenders, subj)
			}
		case "merchant":
			if subj.ID != 0 {
				o.Merchants = append(o.Merchants, subj)
			}
		case "service", "queue":
			o.Services = append(o.Services, subj)
		}
	}
	for _, list := range []*[]Subject{&o.Lenders, &o.Merchants, &o.Services} {
		sortSubjects(*list)
	}
	return o
}

func sortSubjects(list []Subject) {
	rank := map[string]int{"alert": 0, "warn": 1, "ok": 2, "quiet": 3}
	sort.Slice(list, func(i, j int) bool {
		if rank[list[i].State] != rank[list[j].State] {
			return rank[list[i].State] < rank[list[j].State]
		}
		if list[i].Median != list[j].Median {
			return list[i].Median > list[j].Median
		}
		return list[i].Name < list[j].Name
	})
}

func (s *sentinel) subject(e evaluator, sig Signal, now time.Time) Subject {
	kind := kindOf(sig)
	key := sig[len(kind)+1:]
	id, _ := strconv.Atoi(key)
	subj := Subject{Signal: sig, Kind: kind, ID: id, Name: key}
	switch kind {
	case "all":
		subj.Name = "Toda la originación"
	case "lender":
		subj.Name = nameOr(s.lenderNames, id)
	case "merchant":
		subj.Name = nameOr(s.merchantNames, id)
	case "queue":
		subj.Name = "Trabajos fallidos de la cola"
	}
	ev, level := e.sustained(sig, now)
	se := e.data[sig]
	subj.Now = Window{Total: ev.Now, Approved: window(se.approved, now, e.rules.WindowMinutes), Denied: window(se.denied, now, e.rules.WindowMinutes)}
	if done := subj.Now.Approved + subj.Now.Denied; done > 0 {
		subj.DeniedRate = float64(subj.Now.Denied) / float64(done)
	}
	subj.Median, subj.Spread, subj.Z = ev.Median, ev.Spread, ev.Z
	subj.Low, subj.High = int(quantile(ev.Samples, 0.1)), int(quantile(ev.Samples, 0.9)+0.5)
	for i, n := range ev.Samples {
		subj.Samples = append(subj.Samples, Sample{Date: ev.Dates[i], N: int(n)})
	}
	subj.State, subj.Raw, subj.Why = levelName(level), levelName(ev.Level), ev.Why
	if ev.Level > level && level >= levelOK {
		subj.Why += fmt.Sprintf(" · empezó hace menos de %d min: se confirma si sigue", (e.rules.Sustain-1)*e.rules.StepMinutes)
	}
	subj.Shift = e.shift(sig, now)
	// La curva del día y lo normal por hora, de los días comparables.
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, bogota)
	comp := comparable(now, e.rules.BaselineDays, e.have)
	for h := 0; h < 24; h++ {
		if h <= now.Hour() {
			subj.Today = append(subj.Today, window(se.total, minTime(today.Add(time.Duration(h+1)*time.Hour), now), 60))
		}
		var xs []float64
		for _, past := range comp {
			start := time.Date(past.Year(), past.Month(), past.Day(), 0, 0, 0, 0, bogota)
			xs = append(xs, float64(window(se.total, start.Add(time.Duration(h+1)*time.Hour), 60)))
		}
		subj.Normal = append(subj.Normal, median(xs))
		subj.NormLo = append(subj.NormLo, quantile(xs, 0.1))
		subj.NormHi = append(subj.NormHi, quantile(xs, 0.9))
	}
	return subj
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func nameOr(names map[int]string, id int) string {
	if n := names[id]; n != "" {
		return n
	}
	return fmt.Sprintf("#%d", id)
}

// ── el servidor ────────────────────────────────────────────────────────────────────────────────────────────────

func (s *sentinel) run() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()
	o, err := s.pass()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = false
	if err != nil {
		s.err = err.Error()
		log.Printf("sentinel: %v", err)
		return
	}
	s.last, s.err = o, ""
	s.saveLast(o)
}

// sentinelAt: ¿en esa dirección contesta una API de Sentinel?
func sentinelAt(addr string) bool {
	res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://" + addr + "/api/overview")
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == http.StatusOK
}

// La última vista se guarda en disco: al abrir, la interfaz muestra eso mismo de entrada y no espera la primera pasada.
func (s *sentinel) lastPath() string { return filepath.Join(s.store.dir, "last.json") }

func (s *sentinel) saveLast(o *Overview) {
	raw, err := json.Marshal(o)
	if err != nil {
		return
	}
	tmp := s.lastPath() + ".tmp"
	if os.WriteFile(tmp, raw, 0o644) == nil {
		_ = os.Rename(tmp, s.lastPath())
	}
}

func (s *sentinel) loadLast() {
	raw, err := os.ReadFile(s.lastPath())
	if err != nil {
		return
	}
	var o Overview
	if json.Unmarshal(raw, &o) == nil && o.CheckedAt != "" {
		s.mu.Lock()
		s.last, s.fromDisk = &o, true
		s.deployList = o.Deploys
		s.mu.Unlock()
	}
}

func (s *sentinel) view() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	// stale: lo que se ve es lo guardado de la última vez, y la pasada de ahora todavía no terminó.
	return map[string]any{"overview": s.last, "error": s.err, "running": s.running, "loading": s.loading,
		"stale": s.fromDisk && s.last != nil && s.running}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	serve := flag.String("serve", "127.0.0.1:5211", "dónde escucha la API (sólo 127.0.0.1)")
	every := flag.Duration("every", 5*time.Minute, "cada cuánto pide lo que falta")
	once := flag.Bool("once", false, "carga lo que falte, hace una pasada y muestra el resumen")
	install := flag.Bool("install", false, "la deja corriendo de fondo como LaunchAgent (desde el binario compilado)")
	uninstall := flag.Bool("uninstall", false, "saca el LaunchAgent (lo guardado se queda)")
	status := flag.Bool("status", false, "¿el LaunchAgent está cargado, y hasta dónde llegó lo guardado?")
	backtest := flag.Int("backtest", 0, "cuántas veces habrían sonado las reglas en los últimos N días, y sale")
	flag.Parse()
	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "connectors", "sql")); err != nil {
		log.Fatalf("sentinel: corré desde la raíz del playground (no encuentro connectors/ en %s)", root)
	}
	st, err := openStore(filepath.Join(root, "sentinel", ".data"))
	if err != nil {
		log.Fatal(err)
	}
	s := &sentinel{root: root, rulesPath: filepath.Join(root, "sentinel", "rules.json"), store: st}
	switch {
	case *install:
		exitOn(installAgent(root, *serve))
		return
	case *uninstall:
		exitOn(uninstallAgent())
		return
	case *status:
		agentStatus(st)
		return
	}

	if *once || *backtest > 0 {
		o, err := s.pass()
		if err != nil {
			log.Fatal(err)
		}
		if *backtest > 0 {
			printBacktest(s, *backtest)
		} else {
			printSummary(o)
		}
		return
	}
	if !strings.HasPrefix(*serve, "127.0.0.1:") {
		log.Fatal("sentinel: la API escucha sólo en 127.0.0.1")
	}
	ln, err := net.Listen("tcp", *serve)
	if err != nil && sentinelAt(*serve) {
		// El puerto ya lo tiene otra API de Sentinel (la de fondo, o la que levantó Cockpit con `make sentinel`): se usa
		// ésa, y este proceso espera a que se suelte para tomar el relevo. Así ni `make sentinel` se cae por el puerto ni
		// la de fondo queda muda cuando se cierra la otra.
		log.Printf("sentinel: la API ya corre en %s; espero a que se suelte para tomar el relevo", *serve)
		for err != nil {
			time.Sleep(15 * time.Second)
			ln, err = net.Listen("tcp", *serve)
		}
	}
	if err != nil {
		log.Fatal(err)
	}
	s.loadLast()
	go func() {
		for {
			s.run()
			time.Sleep(*every)
		}
	}()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/overview", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, s.view()) })
	mux.HandleFunc("POST /api/refresh", func(w http.ResponseWriter, r *http.Request) {
		go s.run()
		writeJSON(w, http.StatusOK, s.view())
	})
	// GET /api/backtest?days=7 — cuántas veces habrían sonado las reglas: para ajustarlas antes de prenderlas.
	mux.HandleFunc("GET /api/backtest", func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		if days <= 0 || days > 27 {
			days = 7
		}
		rules, err := loadRules(s.rulesPath)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"days": days, "episodes": s.evaluator(rules).backtest(days, time.Now().In(bogota))})
	})
	log.Printf("sentinel: API en http://%s · pide lo que falta cada %s · historia: %s", *serve, *every, st)
	log.Fatal((&http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}).Serve(ln))
}

func printSummary(o *Overview) {
	fmt.Printf("%s · %d días de historia desde %s · %.1f s\n", o.Source, o.History.Days, o.History.From, o.Seconds)
	show := func(title string, list []Subject) {
		fmt.Println(title)
		for _, s := range list {
			if s.State == "quiet" {
				continue
			}
			fmt.Printf("  %-5s %-34.34s ahora %4d · normal %6s · z %+5.1f · %s\n", s.State, s.Name, s.Now.Total, fmtNum(s.Median), s.Z, s.Why)
			if s.Shift != nil {
				fmt.Printf("        cambio de nivel: ×%.1f por día (de %s a %s)\n", s.Shift.Ratio, fmtNum(s.Shift.Before), fmtNum(s.Shift.After))
			}
		}
	}
	show("Toda la originación", []Subject{o.All})
	show("Errores", o.Services)
	show("Entidades", o.Lenders)
	show("Comercios", o.Merchants)
	if o.LogsNote != "" {
		fmt.Println(o.LogsNote)
	}
}

func printBacktest(s *sentinel, days int) {
	rules, err := loadRules(s.rulesPath)
	if err != nil {
		log.Fatal(err)
	}
	eps := s.evaluator(rules).backtest(days, time.Now().In(bogota))
	alerts, warns := 0, 0
	bySignal := map[Signal][2]int{}
	for _, e := range eps {
		c := bySignal[e.Signal]
		if e.Level == "alert" {
			alerts++
			c[0]++
		} else {
			warns++
			c[1]++
		}
		bySignal[e.Signal] = c
	}
	fmt.Printf("las reglas contra los últimos %d días: %d alertas y %d «para mirar»\n", days, alerts, warns)
	sigs := make([]Signal, 0, len(bySignal))
	for sig := range bySignal {
		sigs = append(sigs, sig)
	}
	sort.Slice(sigs, func(i, j int) bool {
		return bySignal[sigs[i]][0]*100+bySignal[sigs[i]][1] > bySignal[sigs[j]][0]*100+bySignal[sigs[j]][1]
	})
	for _, sig := range sigs {
		fmt.Printf("  %-26s %3d alertas · %3d para mirar\n", sig, bySignal[sig][0], bySignal[sig][1])
	}
	fmt.Println("las alertas:")
	for _, e := range eps {
		if e.Level == "alert" {
			fmt.Printf("  %s  %-26s %s\n", e.Start[:16], e.Signal, e.Why)
		}
	}
}
