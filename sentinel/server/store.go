package main

// LO GUARDADO: un archivo por día (`sentinel/.data/<día>.json`, fuera de git) con los conteos de cada señal cada 5
// minutos. Los días pasados se piden UNA vez (la carga inicial de 4 semanas) y quedan; en cada pasada se vuelven a pedir
// sólo las últimas horas, porque una solicitud cambia de estado durante horas después de entrar. Todo se tiene en
// memoria: unas 1.500 solicitudes por día, cuatro semanas caben de sobra.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Una señal: «lender:6», «merchant:24», «service:legacy-backend», «queue:failed». La clave lleva la clase.
type Signal = string

// Counts son los conteos de una señal en un día, por bloque de 5 minutos (0–287). Mapas, porque casi todos están en 0.
type Counts struct {
	Total    map[int]int `json:"total,omitempty"`
	Approved map[int]int `json:"approved,omitempty"`
	Denied   map[int]int `json:"denied,omitempty"`
}

// Day es lo guardado de un día, en hora de Bogotá.
type Day struct {
	Date    string             `json:"date"`
	Signals map[Signal]*Counts `json:"signals"`
	// Through: hasta cuándo se pidió (RFC3339). Un día pasado pedido entero tiene Through en su medianoche siguiente.
	Through string `json:"through"`
	// Logs: con qué versión de la lectura de Loki se guardó (logsVersion, en fetch.go). Menor: se vuelve a pedir.
	Logs int `json:"logs,omitempty"`
	// Ph: con qué versión de la lectura de PostHog (phVersion, en steps.go). Menor: se vuelve a pedir.
	Ph int `json:"ph,omitempty"`
}

const bucketsPerDay = 288

func bucketOf(t time.Time) int { return (t.Hour()*60 + t.Minute()) / 5 }

type store struct {
	mu   sync.RWMutex
	dir  string
	days map[string]*Day
}

func openStore(dir string) (*store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &store{dir: dir, days: map[string]*Day{}}
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var d Day
		if json.Unmarshal(raw, &d) == nil && d.Date != "" {
			if d.Signals == nil {
				d.Signals = map[Signal]*Counts{}
			}
			s.days[d.Date] = &d
		}
	}
	return s, nil
}

func (s *store) day(date string) *Day {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.days[date]
}

// put reemplaza, en un día, los bloques [from, to) de TODAS las señales con lo que llegó: lo que no vino en ese rango
// quedó en 0. Así una pasada que relee las últimas horas corrige y no suma dos veces.
func (s *store) put(date string, from, to int, fresh map[Signal]*Counts, through time.Time, kinds []string) error {
	s.mu.Lock()
	d := s.days[date]
	if d == nil {
		d = &Day{Date: date, Signals: map[Signal]*Counts{}}
		s.days[date] = d
	}
	for sig, c := range d.Signals {
		if !hasKind(sig, kinds) {
			continue
		}
		for b := from; b < to; b++ {
			delete(c.Total, b)
			delete(c.Approved, b)
			delete(c.Denied, b)
		}
	}
	for sig, c := range fresh {
		cur := d.Signals[sig]
		if cur == nil {
			cur = &Counts{}
			d.Signals[sig] = cur
		}
		merge(&cur.Total, c.Total)
		merge(&cur.Approved, c.Approved)
		merge(&cur.Denied, c.Denied)
	}
	if through.Format(time.RFC3339) > d.Through {
		d.Through = through.Format(time.RFC3339)
	}
	raw, err := json.Marshal(d)
	s.mu.Unlock()
	if err != nil {
		return err
	}
	tmp := filepath.Join(s.dir, date+".json.tmp")
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(s.dir, date+".json"))
}

func hasKind(sig Signal, kinds []string) bool {
	for _, k := range kinds {
		if len(sig) > len(k) && sig[:len(k)+1] == k+":" {
			return true
		}
	}
	return false
}

func merge(dst *map[int]int, src map[int]int) {
	if len(src) == 0 {
		return
	}
	if *dst == nil {
		*dst = map[int]int{}
	}
	for b, n := range src {
		(*dst)[b] = n
	}
}

// sum suma un campo de una señal en un día, en los bloques [from, to).
func (s *store) sum(date string, sig Signal, field string, from, to int) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d := s.days[date]
	if d == nil || d.Signals[sig] == nil {
		return 0
	}
	c := d.Signals[sig]
	m := c.Total
	switch field {
	case "approved":
		m = c.Approved
	case "denied":
		m = c.Denied
	}
	n := 0
	for b, v := range m {
		if b >= from && b < to {
			n += v
		}
	}
	return n
}

// signals: todas las señales guardadas en los días [first, last], ordenadas.
func (s *store) signals() []Signal {
	s.mu.RLock()
	defer s.mu.RUnlock()
	seen := map[Signal]bool{}
	for _, d := range s.days {
		for sig := range d.Signals {
			seen[sig] = true
		}
	}
	out := make([]Signal, 0, len(seen))
	for sig := range seen {
		out = append(out, sig)
	}
	sort.Strings(out)
	return out
}

// complete: ¿el día está pedido entero? (un día pasado con Through en su medianoche siguiente o después).
func (s *store) complete(date string) bool {
	d := s.day(date)
	if d == nil {
		return false
	}
	t, err := time.ParseInLocation("2006-01-02", date, bogota)
	if err != nil {
		return false
	}
	end := t.AddDate(0, 0, 1)
	through, err := time.Parse(time.RFC3339, d.Through)
	return err == nil && !through.Before(end)
}

// reach: hasta dónde llegó lo pedido (el Through más nuevo). Una pasada pide desde ahí: si el Mac durmió o la VPN se
// cayó, el hueco se llena en la pasada siguiente y no queda un día marcado completo con horas vacías adentro.
func (s *store) reach() time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out time.Time
	for _, d := range s.days {
		if t, err := time.Parse(time.RFC3339, d.Through); err == nil && t.After(out) {
			out = t
		}
	}
	return out
}

func (s *store) dates() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]string, 0, len(s.days))
	for d := range s.days {
		out = append(out, d)
	}
	sort.Strings(out)
	return out
}

func (s *store) String() string { return fmt.Sprintf("%d días en %s", len(s.days), s.dir) }

// markLogs: el día ya tiene la lectura de Loki de la versión v.
func (s *store) markLogs(date string, v int) {
	s.mark(date, func(d *Day) bool { ok := d.Logs < v; d.Logs = max(d.Logs, v); return ok })
}

// markPh: el día ya tiene la lectura de PostHog de la versión v.
func (s *store) markPh(date string, v int) {
	s.mark(date, func(d *Day) bool { ok := d.Ph < v; d.Ph = max(d.Ph, v); return ok })
}

func (s *store) mark(date string, set func(*Day) bool) {
	s.mu.Lock()
	d := s.days[date]
	if d == nil || !set(d) {
		s.mu.Unlock()
		return
	}
	raw, err := json.Marshal(d)
	s.mu.Unlock()
	if err != nil {
		return
	}
	tmp := filepath.Join(s.dir, date+".json.tmp")
	if os.WriteFile(tmp, raw, 0o644) == nil {
		_ = os.Rename(tmp, filepath.Join(s.dir, date+".json"))
	}
}
