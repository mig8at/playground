package main

// LO NORMAL Y EL VEREDICTO. Una señal se mira en una ventana (la última hora) y se compara con la MISMA ventana de los
// días comparables de la historia guardada (4 semanas): los días hábiles con días hábiles y el fin de semana con el fin
// de semana, porque un lunes a las 10 no se parece a un domingo a las 10.
//
// Lo normal es la MEDIANA de esas muestras y la dispersión el MAD (desvío absoluto mediano), no el mínimo y el máximo:
// un día raro (1.738 errores donde lo normal son 70) ya no ensancha todo. La dispersión tiene un piso de Poisson
// (raíz de la mediana): con pocos casos, 0 contra 2 no es una anomalía. Con eso, z = (ahora − mediana) / dispersión.
//
// Una señal pasa a «alerta» sólo si lo sostiene: el nivel de las últimas 3 evaluaciones (una cada 10 minutos), no sólo
// el de ahora. Corta la mayoría de las falsas. Los umbrales son de `sentinel/rules.json`.

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"time"
)

// ── las reglas ─────────────────────────────────────────────────────────────────────────────────────────────────

type Thresholds struct {
	MinMedian float64 `json:"minMedian"` // por debajo, «poco volumen»: no hay con qué comparar
	WarnZ     float64 `json:"warnZ"`     // con signo: negativo para lo que cae, positivo para lo que sube
	AlertZ    float64 `json:"alertZ"`
	// Ratio: además del z, cuánto se alejó de la mediana (≤ ratio × mediana si cae, ≥ ratio × mediana si sube). Evita
	// que una señal muy estable alerte por una diferencia chica en números.
	Ratio float64 `json:"ratio"`
	// Ceiling (sólo errores): el cuantil de TODAS las horas de los días comparables, no sólo la misma hora. Los errores
	// llegan en ráfagas a cualquier hora (legacy-application: de 300 a 95.000 por día): sin este techo, una ráfaga como
	// las de todos los días sonaba como alerta 28 veces en una semana. Para mirar, si pasa el techo; alerta, si pasa
	// CeilingAlert veces el techo.
	Ceiling      float64 `json:"ceiling,omitempty"`
	CeilingAlert float64 `json:"ceilingAlert,omitempty"`
	// MinNow (sólo errores): por debajo de esta cantidad en la ventana no se avisa, sea cual sea lo normal. Un servicio
	// que casi nunca tiene errores (lo normal, 0) daba alerta con 5: la semana del 2026-11-05 al 12, 20 de 23 avisos.
	MinNow int `json:"minNow,omitempty"`
}

type Override struct {
	Ignore    bool     `json:"ignore,omitempty"`
	MinMedian *float64 `json:"minMedian,omitempty"`
	Note      string   `json:"note,omitempty"`
}

type Rules struct {
	WindowMinutes int `json:"windowMinutes"`
	HistoryDays   int `json:"historyDays"` // lo que se guarda (y lo que mira el cambio de nivel)
	// BaselineDays: cuántos días atrás cuentan para lo normal. Menos que la historia A PROPÓSITO: un cambio que se queda
	// (los errores de legacy-backend ×6 desde el 2026-10-30) pasa a ser lo normal en una semana, y no avisa para siempre.
	// Ese cambio, en vez de alerta, se muestra como «cambio de nivel» (shift).
	BaselineDays int        `json:"baselineDays"`
	MinSamples   int        `json:"minSamples"`
	Sustain      int        `json:"sustain"`
	StepMinutes  int        `json:"stepMinutes"`
	Volume       Thresholds `json:"volume"`
	Errors       Thresholds `json:"errors"`
	// Liveness: la señal de vida de un servicio (`logs:`, todas sus líneas). Avisa sólo si casi deja de escribir
	// (ratio 0,1: un 10 % de lo normal), no cuando baja el tráfico: con las reglas del volumen, los bajones de la noche
	// de los servicios chicos daban 15 alertas por semana.
	Liveness          Thresholds          `json:"liveness"`
	AfterDeployHours  float64             `json:"afterDeployHours"`
	AfterDeployFactor float64             `json:"afterDeployFactor"`
	Signals           map[Signal]Override `json:"signals"`
	Notify            NotifyRules         `json:"notify"`
	// FollowedWindows: las ventanas más largas (minutos) para el VOLUMEN de lo que se sigue (following.go) cuando en una
	// hora no alcanza para comparar. Un comercio chico (Pullman, ~2,5 por hora) quedaba siempre en «poco volumen» y no
	// podía alertar nunca; se usa la primera de estas ventanas en la que lo normal llega a `minMedian`. Sólo para lo que
	// se sigue: lo demás sigue mirando una hora, y el backtest de todo lo otro no cambia. La última, 24 horas MÓVILES,
	// es para lo muy chico: Credifamilia entra ~7 por día y en 6 horas lo normal es 2; un día entero sin nada sí se ve.
	FollowedWindows []int `json:"followedWindows"`
}

func defaultRules() Rules {
	return Rules{
		WindowMinutes: 60, HistoryDays: 28, BaselineDays: 14, MinSamples: 4, Sustain: 3, StepMinutes: 10,
		Volume:           Thresholds{MinMedian: 3, WarnZ: -2.5, AlertZ: -3.5, Ratio: 0.6},
		Errors:           Thresholds{MinMedian: 3, WarnZ: 3, AlertZ: 4.5, Ratio: 1.5, Ceiling: 0.99, CeilingAlert: 2, MinNow: 10},
		Liveness:         Thresholds{MinMedian: 20, WarnZ: -2.5, AlertZ: -3.5, Ratio: 0.1},
		AfterDeployHours: 2, AfterDeployFactor: 0.75,
		Notify:          NotifyRules{Level: "alert", ClearMinutes: 30, StaleMinutes: 30, Recovered: true, Merchants: "following"},
		Signals:         map[Signal]Override{},
		FollowedWindows: []int{180, 360, 1440},
	}
}

// loadRules lee `rules.json` sobre los valores por defecto: lo que el archivo no dice, queda como está.
func loadRules(path string) (Rules, error) {
	r := defaultRules()
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return r, nil
	}
	if err != nil {
		return r, err
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return defaultRules(), fmt.Errorf("%s: %w", path, err)
	}
	if r.Signals == nil {
		r.Signals = map[Signal]Override{}
	}
	return r, nil
}

func kindOf(sig Signal) string { return sig[:strings.IndexByte(sig, ':')] }

// errorKind: en estas señales lo malo es que SUBAN; en las demás (también `logs:`, la señal de vida), que caigan.
func errorKind(sig Signal) bool {
	k := kindOf(sig)
	return k == "service" || k == "queue" || k == "lerr"
}

// ── las series en memoria, densas, para no recorrer mapas en cada cuenta ───────────────────────────────────────

type series struct {
	total, approved, denied map[string]*[bucketsPerDay]int
}

func (s *store) dense() map[Signal]*series {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[Signal]*series{}
	fill := func(m map[string]*[bucketsPerDay]int, date string, src map[int]int) {
		if len(src) == 0 {
			return
		}
		arr := m[date]
		if arr == nil {
			arr = &[bucketsPerDay]int{}
			m[date] = arr
		}
		for b, n := range src {
			if b >= 0 && b < bucketsPerDay {
				arr[b] = n
			}
		}
	}
	for date, d := range s.days {
		for sig, c := range d.Signals {
			se := out[sig]
			if se == nil {
				se = &series{map[string]*[bucketsPerDay]int{}, map[string]*[bucketsPerDay]int{}, map[string]*[bucketsPerDay]int{}}
				out[sig] = se
			}
			fill(se.total, date, c.Total)
			fill(se.approved, date, c.Approved)
			fill(se.denied, date, c.Denied)
		}
	}
	return out
}

// window suma un campo en [to − minutes, to), aunque cruce la medianoche.
func window(m map[string]*[bucketsPerDay]int, to time.Time, minutes int) int {
	n := 0
	for t := to.Add(-time.Duration(minutes) * time.Minute); t.Before(to); t = t.Add(5 * time.Minute) {
		if arr := m[t.Format("2006-01-02")]; arr != nil {
			n += arr[bucketOf(t)]
		}
	}
	return n
}

func weekend(t time.Time) bool { return t.Weekday() == time.Saturday || t.Weekday() == time.Sunday }

// comparable: las fechas de la historia del mismo tipo de día que t (hábil o fin de semana), con datos guardados.
func comparable(t time.Time, history int, have map[string]bool) []time.Time {
	var out []time.Time
	for d := 1; d <= history; d++ {
		past := t.AddDate(0, 0, -d)
		if weekend(past) == weekend(t) && have[past.Format("2006-01-02")] {
			out = append(out, past)
		}
	}
	return out
}

func median(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

func quantile(xs []float64, q float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	pos := q * float64(len(s)-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	return s[lo] + (s[hi]-s[lo])*(pos-float64(lo))
}

// spread: el MAD escalado (1,4826 lo hace comparable a un desvío estándar), con el piso de Poisson.
func spread(xs []float64, med float64) float64 {
	dev := make([]float64, len(xs))
	for i, x := range xs {
		dev[i] = math.Abs(x - med)
	}
	return math.Max(1.4826*median(dev), math.Sqrt(math.Max(med, 1)))
}

// ── una evaluación ─────────────────────────────────────────────────────────────────────────────────────────────

const (
	levelQuiet = -1
	levelOK    = 0
	levelWarn  = 1
	levelAlert = 2
)

type Eval struct {
	Minutes int      // la ventana que se miró: WindowMinutes, o una de FollowedWindows
	Silence *Silence // sólo `logs:`: desde cuándo no escribe, si es más que el silencio más largo de la historia
	Now     int
	Samples []float64
	Dates   []string
	Median  float64
	Spread  float64
	Z       float64
	Level   int
	Why     string
}

type evaluator struct {
	rules   Rules
	data    map[Signal]*series
	have    map[string]bool
	deploys []time.Time        // a producción
	ceils   map[string]float64 // el techo de los errores por señal y día, calculado una vez
	follows func(Signal) bool  // lo que se sigue: puede mirar una ventana más larga (FollowedWindows)
}

// span: la ventana en palabras, para los porqués.
func span(minutes int) string {
	if minutes == 60 {
		return "la última hora"
	}
	if minutes%60 == 0 {
		return fmt.Sprintf("las últimas %d horas", minutes/60)
	}
	return fmt.Sprintf("los últimos %d minutos", minutes)
}

// ceiling: el cuantil q de las ventanas de una hora, cada 10 minutos, de TODO el día, en los días comparables.
func (e evaluator) ceiling(sig Signal, se *series, t time.Time, q float64) float64 {
	key := sig + "|" + t.Format("2006-01-02")
	if c, ok := e.ceils[key]; ok {
		return c
	}
	var xs []float64
	for _, past := range comparable(t, e.rules.BaselineDays, e.have) {
		day := time.Date(past.Year(), past.Month(), past.Day(), 0, 0, 0, 0, bogota)
		for m := e.rules.WindowMinutes; m <= 24*60; m += 10 {
			xs = append(xs, float64(window(se.total, day.Add(time.Duration(m)*time.Minute), e.rules.WindowMinutes)))
		}
	}
	c := quantile(xs, q)
	if e.ceils != nil {
		e.ceils[key] = c
	}
	return c
}

func (e evaluator) afterDeploy(t time.Time) bool {
	for _, d := range e.deploys {
		if !d.After(t) && t.Sub(d) <= time.Duration(e.rules.AfterDeployHours*float64(time.Hour)) {
			return true
		}
	}
	return false
}

func (e evaluator) eval(sig Signal, t time.Time) Eval {
	se := e.data[sig]
	var ev Eval
	if se == nil {
		ev.Level, ev.Why = levelQuiet, "sin datos"
		return ev
	}
	th := e.rules.Volume
	if errorKind(sig) {
		th = e.rules.Errors
	} else if kindOf(sig) == "logs" {
		th = e.rules.Liveness
	}
	over := e.rules.Signals[sig]
	if over.MinMedian != nil {
		th.MinMedian = *over.MinMedian
	}
	measure := func(minutes int) {
		ev.Minutes, ev.Samples, ev.Dates = minutes, nil, nil
		ev.Now = window(se.total, t, minutes)
		for _, past := range comparable(t, e.rules.BaselineDays, e.have) {
			ev.Samples = append(ev.Samples, float64(window(se.total, past, minutes)))
			ev.Dates = append(ev.Dates, past.Format("2006-01-02"))
		}
		ev.Median = median(ev.Samples)
	}
	measure(e.rules.WindowMinutes)
	// Lo que se sigue y no alcanza en una hora mira más tiempo hacia atrás: la primera ventana en la que lo normal llega
	// al mínimo. Si ninguna alcanza, se queda con la más larga (y dice «poco volumen» con ese número).
	if !errorKind(sig) && e.follows != nil && e.follows(sig) && ev.Median < th.MinMedian {
		for _, m := range e.rules.FollowedWindows {
			if m > ev.Minutes {
				measure(m)
				if ev.Median >= th.MinMedian {
					break
				}
			}
		}
	}
	ev.Spread = spread(ev.Samples, ev.Median)
	ev.Z = (float64(ev.Now) - ev.Median) / ev.Spread
	factor := 1.0
	if e.afterDeploy(t) {
		factor = e.rules.AfterDeployFactor
	}
	normal := fmt.Sprintf("lo normal es %s (%d días comparables)", fmtNum(ev.Median), len(ev.Samples))
	switch {
	case over.Ignore:
		ev.Level, ev.Why = levelQuiet, "ignorada en rules.json"
	case len(ev.Samples) < e.rules.MinSamples:
		ev.Level, ev.Why = levelQuiet, fmt.Sprintf("poca historia para comparar (%d días)", len(ev.Samples))
	case ev.Median < th.MinMedian && !(errorKind(sig) && float64(ev.Now) >= th.Ratio*math.Max(ev.Median, 1)*3):
		ev.Level, ev.Why = levelQuiet, fmt.Sprintf("%d en %s; poco volumen para comparar (%s)", ev.Now, span(ev.Minutes), normal)
	case errorKind(sig):
		up := float64(ev.Now) >= th.Ratio*math.Max(ev.Median, 1) && ev.Now >= th.MinNow
		ceil := 0.0
		if th.Ceiling > 0 {
			ceil = e.ceiling(sig, se, t, th.Ceiling) * factor
		}
		alertCeil := ceil * math.Max(th.CeilingAlert, 1)
		switch {
		case up && ev.Z >= th.AlertZ*factor && float64(ev.Now) > alertCeil:
			ev.Level = levelAlert
		case up && ev.Z >= th.WarnZ*factor && float64(ev.Now) > ceil:
			ev.Level = levelWarn
		default:
			ev.Level = levelOK
		}
		ev.Why = fmt.Sprintf("%d errores en la última hora; %s", ev.Now, normal)
		if ceil > 0 {
			ev.Why += fmt.Sprintf("; en una hora cualquiera de esos días se llega hasta %s", fmtNum(math.Round(ceil)))
		}
	default:
		down := float64(ev.Now) <= th.Ratio*ev.Median
		switch {
		case down && ev.Z <= th.AlertZ*factor:
			ev.Level = levelAlert
		case down && ev.Z <= th.WarnZ*factor:
			ev.Level = levelWarn
		default:
			ev.Level = levelOK
		}
		ev.Why = fmt.Sprintf("entraron %d en %s; %s", ev.Now, span(ev.Minutes), normal)
		if kindOf(sig) == "logs" {
			ev.Why = fmt.Sprintf("escribió %d líneas en %s; %s", ev.Now, span(ev.Minutes), normal)
		}
	}
	// Un servicio callado más tiempo que nunca en las semanas guardadas: alerta, diga lo que diga la estadística de la
	// hora. Sin esto, un silencio que dura pasa a ser «lo normal» en dos semanas y deja de verse.
	if kindOf(sig) == "logs" && !over.Ignore {
		if sil := e.silence(se, t); sil != nil {
			ev.Silence = sil
			if sil.Level > ev.Level {
				ev.Level = sil.Level
			}
			if sil.Level >= levelWarn {
				ev.Why = sil.Why
			}
		}
	}
	if factor != 1 && ev.Level >= levelOK {
		ev.Why += " · más sensible: hubo un despliegue a producción hace menos de " + fmtNum(e.rules.AfterDeployHours) + " h"
	}
	return ev
}

// sustained: el nivel de ahora y si se sostuvo en las últimas `Sustain` evaluaciones (una cada `StepMinutes`). El nivel
// que cuenta es el MENOR de esas: una alerta de un solo instante queda como «para mirar».
func (e evaluator) sustained(sig Signal, t time.Time) (Eval, int) {
	now := e.eval(sig, t)
	level := now.Level
	for i := 1; i < e.rules.Sustain && level > levelOK; i++ {
		prev := e.eval(sig, t.Add(-time.Duration(i*e.rules.StepMinutes)*time.Minute))
		if prev.Level < level {
			level = max(prev.Level, levelOK)
			if now.Level == levelAlert {
				level = max(level, levelWarn) // una alerta que recién empieza se muestra como «para mirar»
			}
		}
	}
	return now, level
}

func fmtNum(x float64) string {
	if x == math.Trunc(x) {
		return fmt.Sprintf("%d", int(x))
	}
	return fmt.Sprintf("%.1f", x)
}

// ── el silencio de un servicio ─────────────────────────────────────────────────────────────────────────────────

// Silence: desde cuándo un servicio no escribe una línea, contra el silencio más largo de la historia guardada.
type Silence struct {
	Since   string `json:"since"`   // la última línea que escribió (el final de su bloque de 5 minutos), RFC3339
	Minutes int    `json:"minutes"` // cuánto lleva callado
	Longest int    `json:"longest"` // el silencio más largo antes de éste, en minutos
	Level   int    `json:"-"`
	Why     string `json:"why"`
}

// silenceMin: por debajo, un silencio no se marca (un servicio chico tiene huecos de minutos todo el tiempo).
const silenceMin = 60

// silence: el silencio en curso de una serie, si lo hay y pasa del más largo de la historia (warn) o del doble (alert).
// Los días sin guardar cortan la cuenta: no se sabe qué pasó ahí.
func (e evaluator) silence(se *series, t time.Time) *Silence {
	start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, bogota).AddDate(0, 0, -e.rules.HistoryDays)
	longest, run, last, first := 0, 0, time.Time{}, time.Time{}
	wrote := false
	for b := start; b.Before(t); b = b.Add(5 * time.Minute) {
		date := b.Format("2006-01-02")
		if !e.have[date] {
			run = 0
			continue
		}
		n := 0
		if arr := se.total[date]; arr != nil {
			n = arr[bucketOf(b)]
		}
		if n > 0 {
			if wrote && run > longest {
				longest = run
			}
			if !wrote {
				first = b
			}
			run, last, wrote = 0, b.Add(5*time.Minute), true
			continue
		}
		run += 5
	}
	// Con menos de una semana escribiendo no se sabe cuál es su silencio normal (messaging-service empezó a mandar
	// logs el 2026-11-10 y su primera noche ya parecía un silencio).
	if !wrote || run < silenceMin || run <= longest || last.Sub(first) < 7*24*time.Hour {
		return nil
	}
	sil := &Silence{Since: last.Format(time.RFC3339), Minutes: run, Longest: longest, Level: levelWarn}
	if run >= 2*max(longest, silenceMin) {
		sil.Level = levelAlert
	}
	sil.Why = fmt.Sprintf("no escribe una línea desde el %s (%s); en las semanas anteriores, el silencio más largo fue de %s",
		last.Format("02/01 15:04"), fmtDuration(run), fmtDuration(longest))
	return sil
}

func fmtDuration(minutes int) string {
	switch {
	case minutes >= 48*60:
		return fmt.Sprintf("%d días", minutes/(24*60))
	case minutes >= 120:
		return fmt.Sprintf("%d h", minutes/60)
	}
	return fmt.Sprintf("%d min", minutes)
}

// ── el cambio de nivel ─────────────────────────────────────────────────────────────────────────────────────────

// Shift: el nivel diario de la última semana contra el de las semanas anteriores (días del mismo tipo que hoy). No es
// una alerta: es lo que cambió y se quedó, que lo normal de 2 semanas termina absorbiendo.
type Shift struct {
	Before float64 `json:"before"` // la mediana diaria de los días 8 a 28 atrás
	After  float64 `json:"after"`  // la de los últimos 7
	Ratio  float64 `json:"ratio"`
}

func dayTotal(m map[string]*[bucketsPerDay]int, date string) int {
	arr := m[date]
	if arr == nil {
		return 0
	}
	n := 0
	for _, v := range arr {
		n += v
	}
	return n
}

// shift: el cambio de nivel de una señal, si se duplicó o cayó a la mitad (con un piso de volumen); nil si no.
func (e evaluator) shift(sig Signal, now time.Time) *Shift {
	se := e.data[sig]
	if se == nil {
		return nil
	}
	var before, after []float64
	for d := 1; d <= e.rules.HistoryDays; d++ {
		past := now.AddDate(0, 0, -d)
		date := past.Format("2006-01-02")
		if weekend(past) != weekend(now) || !e.have[date] {
			continue
		}
		if d <= 7 {
			after = append(after, float64(dayTotal(se.total, date)))
		} else {
			before = append(before, float64(dayTotal(se.total, date)))
		}
	}
	if len(after) < 3 || len(before) < 5 {
		return nil
	}
	b, a := median(before), median(after)
	floor := 20.0 // por día: con menos, una entidad chica «se duplica» con dos solicitudes
	if errorKind(sig) {
		floor = 50
	}
	if math.Max(a, b) < floor {
		return nil
	}
	ratio := a / math.Max(b, 1)
	if ratio < 2 && ratio > 0.5 {
		return nil
	}
	return &Shift{Before: b, After: a, Ratio: ratio}
}

// ── la prueba contra la historia ───────────────────────────────────────────────────────────────────────────────

// Episode es una vez que una señal habría pasado a «alerta» (o a «para mirar»).
type Episode struct {
	Signal Signal `json:"signal"`
	Start  string `json:"start"`
	Level  string `json:"level"`
	Why    string `json:"why"`
}

// backtest recorre los últimos `days` días cada `StepMinutes` y cuenta las veces que cada señal ENTRÓ en alerta o en
// «para mirar» (sostenido), como si las reglas hubieran estado prendidas.
func (e evaluator) backtest(days int, now time.Time) []Episode {
	var out []Episode
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, bogota).AddDate(0, 0, -days)
	step := time.Duration(e.rules.StepMinutes) * time.Minute
	for sig := range e.data {
		prev := levelOK
		for t := start; t.Before(now); t = t.Add(step) {
			ev, level := e.sustained(sig, t)
			if level > prev && level >= levelWarn {
				out = append(out, Episode{Signal: sig, Start: t.Format(time.RFC3339), Level: levelName(level), Why: ev.Why})
			}
			prev = max(level, levelOK)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

func levelName(l int) string {
	switch l {
	case levelAlert:
		return "alert"
	case levelWarn:
		return "warn"
	case levelOK:
		return "ok"
	}
	return "quiet"
}
