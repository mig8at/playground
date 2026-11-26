package main

// EL MES A LA FECHA: cómo va el mes contra el mismo tramo del mes anterior, por entidad y por comercio. Es una VISTA,
// no una regla: no avisa ni entra a «Pide atención». Sentinel compara la última hora contra la misma hora de los días
// comparables para avisar pronto que algo se rompió; eso no ve una tendencia lenta (un comercio que en el mes coloca un
// tercio menos sin una sola hora fuera de lo normal). Medido el 26/11/2026, del 1 al 26 contra el 1 al 26 de octubre:
// DENTIX 83 desembolsos contra 126 y Crédito Directo 142 contra 195, sin ninguna alerta.
//
// Las dos ventanas terminan a la misma hora del mismo día del mes (el 31 de un mes corto cae al último día). Como un
// mes puede traer más fines de semana o festivos que el otro, además de los conteos va el RITMO: lo de cada ventana
// dividido por sus días, donde un día hábil pesa 1 y uno de descanso `restDayWeight`, y el de hoy sólo lo que lleva.
//
// Lee producción en el momento (Redash), no lo guardado: lo guardado son 28 días y el mes anterior no entra. Sólo
// comercios de Colombia, como la plata en juego (stake.go): los montos van en pesos. Con 30 minutos de caché.

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// restDayWeight: cuánto entra un día de descanso contra uno hábil. Medido el lunes festivo 16/11/2026: 739 solicitudes
// contra 1.341 de un hábil (0,55). Sólo ajusta el ritmo; los conteos van crudos.
const restDayWeight = 0.55

// MonthRow: una entidad, un comercio o toda la originación, este mes contra el anterior.
type MonthRow struct {
	Signal     string  `json:"signal"`
	Name       string  `json:"name"`
	Followed   bool    `json:"followed"`
	Req        int     `json:"req"`     // solicitudes creadas en la ventana
	ReqPrev    int     `json:"reqPrev"` // las del mismo tramo del mes anterior
	Disb       int     `json:"disb"`    // desembolsos (por `disbursed_at`)
	DisbPrev   int     `json:"disbPrev"`
	Amount     float64 `json:"amount"` // pesos desembolsados, `COALESCE(final_amount, amount)`
	AmountPrev float64 `json:"amountPrev"`
	ReqPace    float64 `json:"reqPace"`  // ritmo de solicitudes contra el mes anterior (1 = igual, 0 = nada); −1 si el anterior no tuvo
	DisbPace   float64 `json:"disbPace"` // ritmo de desembolsos
}

// MonthReport: el mes a la fecha.
type MonthReport struct {
	Now        string     `json:"now"`
	From       string     `json:"from"`
	PrevFrom   string     `json:"prevFrom"`
	PrevTo     string     `json:"prevTo"`
	Weight     float64    `json:"weight"`     // los días que pesa la ventana de este mes
	WeightPrev float64    `json:"weightPrev"` // los del mes anterior
	RestWeight float64    `json:"restWeight"` // cuánto pesa un día de descanso (restDayWeight)
	Total      MonthRow   `json:"total"`
	Lenders    []MonthRow `json:"lenders"`
	Merchants  []MonthRow `json:"merchants"`
	Note       string     `json:"note,omitempty"`
}

// monthWindows: el comienzo del mes y el mismo instante del mes anterior (con el día recortado al último del mes).
func monthWindows(now time.Time) (from, prevFrom, prevTo time.Time) {
	now = now.In(bogota)
	from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, bogota)
	prevFrom = from.AddDate(0, -1, 0)
	last := from.AddDate(0, 0, -1).Day()
	day := now.Day()
	if day > last {
		day = last
	}
	prevTo = time.Date(prevFrom.Year(), prevFrom.Month(), day, now.Hour(), now.Minute(), now.Second(), 0, bogota)
	return
}

// windowWeight: los días que pesa [from, to): un hábil 1, uno de descanso restDayWeight, el último sólo su parte.
func windowWeight(from, to time.Time) float64 {
	w := 0.0
	for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
		end := d.AddDate(0, 0, 1)
		frac := 1.0
		if end.After(to) {
			frac = to.Sub(d).Hours() / 24
		}
		if restDay(d) {
			frac *= restDayWeight
		}
		w += frac
	}
	return w
}

func pace(cur, prev int, w, wPrev float64) float64 {
	if prev == 0 || w <= 0 || wPrev <= 0 {
		return -1 // sin con qué comparar
	}
	return (float64(cur) / w) / (float64(prev) / wPrev)
}

var monthCache struct {
	mu  sync.Mutex
	at  time.Time
	out *MonthReport
}

// month: el mes a la fecha, con caché de 30 minutos. `followed` marca lo que se sigue.
func month(followed []Signal) (*MonthReport, error) {
	monthCache.mu.Lock()
	defer monthCache.mu.Unlock()
	if monthCache.out == nil || time.Since(monthCache.at) > 30*time.Minute {
		out, err := readMonth(time.Now().In(bogota))
		if err != nil {
			return nil, err
		}
		monthCache.out, monthCache.at = out, time.Now()
	}
	// Una copia con lo que se sigue AHORA: seguir algo no espera a que venza la caché.
	is := map[string]bool{}
	for _, s := range followed {
		is[string(s)] = true
	}
	c := *monthCache.out
	mark := func(rows []MonthRow) []MonthRow {
		out := make([]MonthRow, len(rows))
		for i, r := range rows {
			r.Followed = is[r.Signal]
			out[i] = r
		}
		return out
	}
	c.Lenders, c.Merchants = mark(c.Lenders), mark(c.Merchants)
	return &c, nil
}

func readMonth(now time.Time) (*MonthReport, error) {
	from, prevFrom, prevTo := monthWindows(now)
	r, err := openReader()
	if err != nil {
		return nil, err
	}
	cur := fmt.Sprintf("BETWEEN '%s' AND '%s'", from.Format(stamp), now.Format(stamp))
	prev := fmt.Sprintf("BETWEEN '%s' AND '%s'", prevFrom.Format(stamp), prevTo.Format(stamp))
	rows, err := r.rows(fmt.Sprintf(`SELECT u.lender_id AS l, u.allied_id AS a,
  SUM(u.created_at %[1]s) AS req, SUM(u.created_at %[2]s) AS req_prev,
  SUM(u.disbursed_at %[1]s) AS disb, SUM(u.disbursed_at %[2]s) AS disb_prev,
  SUM(CASE WHEN u.disbursed_at %[1]s THEN COALESCE(u.final_amount, u.amount) ELSE 0 END) AS amount,
  SUM(CASE WHEN u.disbursed_at %[2]s THEN COALESCE(u.final_amount, u.amount) ELSE 0 END) AS amount_prev
FROM user_requests u JOIN allieds al ON al.id = u.allied_id
WHERE al.country_id = 47 AND (u.created_at >= '%[3]s' OR u.disbursed_at >= '%[3]s')
GROUP BY 1, 2`, cur, prev, prevFrom.Format(stamp)))
	if err != nil {
		return nil, err
	}
	out := &MonthReport{Now: now.Format(time.RFC3339), From: from.Format(time.RFC3339), PrevFrom: prevFrom.Format(time.RFC3339),
		PrevTo: prevTo.Format(time.RFC3339), RestWeight: restDayWeight, Weight: windowWeight(from, now), WeightPrev: windowWeight(prevFrom, prevTo)}
	lenders, merchants := map[int]*MonthRow{}, map[int]*MonthRow{}
	add := func(x *MonthRow, row map[string]any) {
		x.Req += num(row["req"])
		x.ReqPrev += num(row["req_prev"])
		x.Disb += num(row["disb"])
		x.DisbPrev += num(row["disb_prev"])
		x.Amount += float64(num(row["amount"]))
		x.AmountPrev += float64(num(row["amount_prev"]))
	}
	for _, row := range rows {
		add(&out.Total, row)
		if l := num(row["l"]); l > 0 {
			if lenders[l] == nil {
				lenders[l] = &MonthRow{Signal: fmt.Sprintf("lender:%d", l)}
			}
			add(lenders[l], row)
		}
		if a := num(row["a"]); a > 0 {
			if merchants[a] == nil {
				merchants[a] = &MonthRow{Signal: fmt.Sprintf("merchant:%d", a)}
			}
			add(merchants[a], row)
		}
	}
	out.Total.Signal, out.Total.Name = "all:production", "Toda la originación"
	finish := func(x *MonthRow) {
		x.ReqPace = pace(x.Req, x.ReqPrev, out.Weight, out.WeightPrev)
		x.DisbPace = pace(x.Disb, x.DisbPrev, out.Weight, out.WeightPrev)
	}
	finish(&out.Total)
	names := func(table string, ids map[int]*MonthRow) {
		if len(ids) == 0 {
			return
		}
		list := make([]string, 0, len(ids))
		for id := range ids {
			list = append(list, fmt.Sprint(id))
		}
		rows, err := r.rows(fmt.Sprintf("SELECT id, name FROM %s WHERE id IN (%s)", table, strings.Join(list, ",")))
		if err != nil {
			out.Note = "sin nombres: " + err.Error()
			return
		}
		for _, row := range rows {
			if x := ids[num(row["id"])]; x != nil {
				x.Name = strings.TrimSpace(fmt.Sprint(row["name"]))
			}
		}
	}
	names("lenders", lenders)
	names("allieds", merchants)
	collect := func(m map[int]*MonthRow) []MonthRow {
		var list []MonthRow
		for _, x := range m {
			// Lo que no tuvo nada en ninguna de las dos ventanas no dice nada.
			if x.Req+x.ReqPrev+x.Disb+x.DisbPrev == 0 {
				continue
			}
			if x.Name == "" {
				x.Name = x.Signal
			}
			finish(x)
			list = append(list, *x)
		}
		// De lo que más desembolsó (en las dos ventanas) a lo que menos: lo que pesa, arriba.
		sort.Slice(list, func(i, j int) bool {
			a, b := list[i].Amount+list[i].AmountPrev, list[j].Amount+list[j].AmountPrev
			if a != b {
				return a > b
			}
			return list[i].Req+list[i].ReqPrev > list[j].Req+list[j].ReqPrev
		})
		return list
	}
	out.Lenders, out.Merchants = collect(lenders), collect(merchants)
	return out, nil
}

// paceText: «+24 %», «−33 %», «×24» (de 3 veces para arriba), «—» sin el mes anterior.
func paceText(p float64) string {
	if p < 0 {
		return "—"
	}
	if p >= 3 {
		return fmt.Sprintf("×%.0f", p)
	}
	d := math.Round((p - 1) * 100)
	switch {
	case d > 0:
		return fmt.Sprintf("+%.0f %%", d)
	case d < 0:
		return fmt.Sprintf("−%.0f %%", -d)
	}
	return "igual"
}

// Text: el mes a la fecha para la consola. Lo que se sigue primero; después, lo que más se movió de lo demás.
func (m *MonthReport) Text() string {
	var b strings.Builder
	from, _ := time.Parse(time.RFC3339, m.From)
	now, _ := time.Parse(time.RFC3339, m.Now)
	pf, _ := time.Parse(time.RFC3339, m.PrevFrom)
	pt, _ := time.Parse(time.RFC3339, m.PrevTo)
	fmt.Fprintf(&b, "El mes a la fecha · del %s al %s contra el %s al %s\n", from.In(bogota).Format("02/01"), now.In(bogota).Format("02/01 15:04"),
		pf.In(bogota).Format("02/01"), pt.In(bogota).Format("02/01 15:04"))
	comma := func(x float64, d int) string { return strings.Replace(strconv.FormatFloat(x, 'f', d, 64), ".", ",", 1) }
	fmt.Fprintf(&b, "El ritmo cuenta los días: %s contra %s (un día de descanso pesa %s). Es una vista: no avisa.\n\n",
		comma(m.Weight, 1), comma(m.WeightPrev, 1), comma(restDayWeight, 2))
	row := func(x MonthRow) {
		mark := " "
		if x.Followed {
			mark = "·"
		}
		fmt.Fprintf(&b, "  %s %-28.28s solicitudes %6s / %-6s %-7s desembolsos %5s / %-5s %-7s %s\n", mark, x.Name,
			thousands(x.Req), thousands(x.ReqPrev), paceText(x.ReqPace), thousands(x.Disb), thousands(x.DisbPrev), paceText(x.DisbPace), moneyText(x.Amount))
	}
	row(m.Total)
	for _, g := range []struct {
		title string
		rows  []MonthRow
	}{{"Entidades", m.Lenders}, {"Comercios", m.Merchants}} {
		fmt.Fprintf(&b, "\n%s (· = lo que seguís; el resto, los 10 que más desembolsan)\n", g.title)
		n := 0
		for _, x := range g.rows {
			if x.Followed {
				row(x)
			}
		}
		for _, x := range g.rows {
			if !x.Followed && n < 10 {
				row(x)
				n++
			}
		}
	}
	if m.Note != "" {
		fmt.Fprintf(&b, "\n%s\n", m.Note)
	}
	return b.String()
}
