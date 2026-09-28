package scan

/* Las cuatro vistas: uso, fricción, deriva y una sesión. Todas son CONTEOS de lo que ya pasó, sin modelo. */

import (
	"sort"
	"strings"
	"time"
)

// Count es una herramienta y cuánto se usó.
type Count struct {
	Key      string    `json:"key"`
	Calls    int       `json:"calls"`
	Sessions int       `json:"sessions"`
	Last     time.Time `json:"last"`
	Note     string    `json:"note,omitempty"`
	Example  string    `json:"example,omitempty"`
}

// tally cuenta por clave; `keep` decide qué claves entran y `rename` cómo se muestran.
func tally(calls []Call, keep func(Call, string) bool, rename func(string) (string, string)) []Count {
	byKey := map[string]*Count{}
	sessions := map[string]map[string]bool{}
	for _, c := range calls {
		keys := c.Keys
		if c.Outcome != OutcomeOK && c.Culprit != nil {
			keys = c.Culprit
		}
		for _, k := range keys {
			if !keep(c, k) {
				continue
			}
			name, note := k, ""
			if rename != nil {
				name, note = rename(k)
			}
			row := byKey[name]
			if row == nil {
				row = &Count{Key: name}
				byKey[name] = row
				sessions[name] = map[string]bool{}
			}
			if note != "" && !strings.Contains(row.Note, note) {
				if row.Note != "" {
					row.Note += " · "
				}
				row.Note += note
			}
			row.Calls++
			sessions[name][c.Session] = true
			if c.Time.After(row.Last) {
				row.Last = c.Time
				if c.Command != "" {
					row.Example = c.Command
				}
			}
		}
	}
	out := make([]Count, 0, len(byKey))
	for k, row := range byKey {
		row.Sessions = len(sessions[k])
		out = append(out, *row)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Calls != out[j].Calls {
			return out[i].Calls > out[j].Calls
		}
		return out[i].Key < out[j].Key
	})
	return out
}

// Usage es la vista de uso, en tres grupos.
type Usage struct {
	Make   []Count `json:"make"`
	Skills []Count `json:"skills"`
	Agents []Count `json:"agents"`
	Other  []Count `json:"other"`
}

// UsageView: qué se usa. Un nombre viejo cuenta para el nuevo, y lo dice.
func UsageView(calls []Call, mk Makefile) Usage {
	is := func(prefix string) func(Call, string) bool {
		return func(_ Call, k string) bool { return strings.HasPrefix(k, prefix) }
	}
	canonical := func(k string) (string, string) {
		t := strings.TrimPrefix(k, "make ")
		if n, ok := mk.Aliases[t]; ok {
			return "make " + n, "incluye el nombre viejo `" + t + "`"
		}
		if !mk.Known(t) {
			return k, "hoy no existe (ver la deriva)"
		}
		return k, ""
	}
	other := func(_ Call, k string) bool {
		return !strings.HasPrefix(k, "make ") && !strings.HasPrefix(k, "skill ") && !strings.HasPrefix(k, "agent ") &&
			(strings.HasPrefix(k, "pg ") || strings.HasPrefix(k, "mcp__"))
	}
	return Usage{
		Make:   tally(calls, is("make "), canonical),
		Skills: tally(calls, is("skill "), nil),
		Agents: tally(calls, is("agent "), nil),
		Other:  tally(calls, other, nil),
	}
}

// Friction es la vista de fricción, por tipo de desenlace.
type Friction struct {
	Denied   []Count `json:"denied"`
	Rejected []Count `json:"rejected"`
	Blocked  []Count `json:"blocked"`
	Errors   []Count `json:"errors"`
}

// FrictionView: lo que no terminó bien. ⚠ Un permiso APROBADO no deja marca en la transcripción, así que
// acá no aparece: `denied` es lo que pidió aprobación y no la tuvo.
func FrictionView(calls []Call) Friction {
	of := func(outcome string) func(Call, string) bool {
		return func(c Call, _ string) bool { return c.Outcome == outcome }
	}
	byHook := func(c Call, k string) bool { return c.Outcome == OutcomeBlocked }
	f := Friction{
		Denied:   tally(calls, of(OutcomeDenied), nil),
		Rejected: tally(calls, of(OutcomeRejected), nil),
		Blocked:  tally(calls, byHook, nil),
		Errors:   tally(calls, of(OutcomeError), nil),
	}
	// el hook que frenó va en la nota de cada fila
	hooks := map[string]map[string]bool{}
	for _, c := range calls {
		if c.Outcome != OutcomeBlocked || c.Hook == "" {
			continue
		}
		for _, k := range c.Keys {
			if hooks[k] == nil {
				hooks[k] = map[string]bool{}
			}
			hooks[k][c.Hook] = true
		}
	}
	for i := range f.Blocked {
		var hs []string
		for h := range hooks[f.Blocked[i].Key] {
			hs = append(hs, h)
		}
		sort.Strings(hs)
		f.Blocked[i].Note = strings.Join(hs, ", ")
	}
	return f
}

// Drift es la vista de deriva.
type Drift struct {
	// UsedAfterRemoval: targets que alguien siguió invocando DESPUÉS de que salieron del Makefile.
	UsedAfterRemoval []Count `json:"usedAfterRemoval"`
	// NeverExisted: invocados sin haber estado nunca en el Makefile (un error de tipeo, casi siempre).
	NeverExisted []Count `json:"neverExisted"`
	// OldNames: nombres viejos que se siguen usando; andan, pero el nuevo es el que dicen los documentos.
	OldNames []Count `json:"oldNames"`
	// UnusedTargets y UnusedSkills: documentados y sin una sola llamada en el período. Una SEÑAL, no un veredicto.
	UnusedTargets []Unused `json:"unusedTargets"`
	UnusedSkills  []string `json:"unusedSkills"`
}

// Unused es un target sin llamadas en el período, con la fecha en que nació: uno de hace tres días no dice
// lo mismo que uno de hace tres meses.
type Unused struct {
	Target string    `json:"target"`
	Since  time.Time `json:"since"`
}

// DriftView cruza el uso con lo que hoy existe, y con CUÁNDO existió cada cosa.
func DriftView(calls []Call, mk Makefile, hist History, skills []string) Drift {
	var d Drift
	usedTargets, usedSkills := map[string]bool{}, map[string]bool{}
	missing := map[string][]Call{}
	for _, c := range calls {
		for _, k := range c.Keys {
			switch {
			case strings.HasPrefix(k, "skill "):
				usedSkills[strings.TrimPrefix(k, "skill ")] = true
			case strings.HasPrefix(k, "make "):
				t := strings.TrimPrefix(k, "make ")
				usedTargets[mk.Canonical(t)] = true
				if !mk.Known(t) {
					missing[t] = append(missing[t], c)
				}
			}
		}
	}
	for t, cs := range missing {
		removed, existed := hist.Removed[t]
		if _, added := hist.Added[t]; !added {
			existed = false
		}
		if !existed {
			d.NeverExisted = append(d.NeverExisted, tally(cs, func(_ Call, k string) bool { return k == "make "+t }, nil)...)
			continue
		}
		var after []Call
		for _, c := range cs {
			if c.Time.After(removed) {
				after = append(after, c)
			}
		}
		if len(after) > 0 {
			rows := tally(after, func(_ Call, k string) bool { return k == "make "+t }, nil)
			rows[0].Note = "salió del Makefile el " + removed.Format("2006-01-02")
			d.UsedAfterRemoval = append(d.UsedAfterRemoval, rows...)
		}
	}
	// un nombre viejo sólo es «viejo» DESPUÉS de que existió su alias: antes era el nombre.
	d.OldNames = tally(calls, func(c Call, k string) bool {
		t := strings.TrimPrefix(k, "make ")
		since, ok := hist.AliasAdded[t]
		return strings.HasPrefix(k, "make ") && mk.Aliases[t] != "" && ok && c.Time.After(since)
	}, func(k string) (string, string) {
		t := strings.TrimPrefix(k, "make ")
		return k, "hoy se llama `" + mk.Aliases[t] + "`"
	})
	for t := range mk.Targets {
		if !usedTargets[t] {
			d.UnusedTargets = append(d.UnusedTargets, Unused{Target: t, Since: hist.Added[t]})
		}
	}
	for _, s := range skills {
		if !usedSkills[s] {
			d.UnusedSkills = append(d.UnusedSkills, s)
		}
	}
	sort.Slice(d.UnusedTargets, func(i, j int) bool { return d.UnusedTargets[i].Since.Before(d.UnusedTargets[j].Since) })
	sort.Strings(d.UnusedSkills)
	byCalls := func(rows []Count) {
		sort.Slice(rows, func(i, j int) bool { return rows[i].Calls > rows[j].Calls })
	}
	byCalls(d.UsedAfterRemoval)
	byCalls(d.NeverExisted)
	return d
}
