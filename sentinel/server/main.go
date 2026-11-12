// sentinel es la API del vigía de producción: cada pocos minutos lee producción (SÓLO LECTURA, por Redash, con el
// conector de siempre) y dice, por entidad y por comercio, si lo que entra y avanza se salió de lo normal. Lo normal
// es la MISMA hora de los 7 días anteriores: el volumen cambia mucho por hora y por día, y un umbral fijo mentiría.
// Además, los trabajos fallidos de la cola y los despliegues a producción, que son el «antes y después».
//
//	go run ./sentinel/server -serve 127.0.0.1:5211      (desde la raíz del playground; `make sentinel` lo hace)
//
// ⚠ LAS HORAS: en producción `created_at` está en hora de Bogotá y `NOW()` de la base en UTC (medido el 2026-11-11).
// Por eso las ventanas se arman ACÁ, en hora de Bogotá, y van a la consulta como fechas literales; nunca con `NOW()`.
//
// Sólo escucha en 127.0.0.1. Nada de esto escribe: cada consulta pasa por la guarda de sólo lectura del conector.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	connlogs "creditop/playground/connectors/logs"
	connsql "creditop/playground/connectors/sql"
)

// Los estados de `user_requests` (`user_request_statuses` de producción, leída el 2026-11-11), en tres grupos. Negar
// no es fallar —la entidad decidió—, pero una negación que se dispara de golpe después de un despliegue sí es una señal.
const (
	approvedStates = "5,11,13,14,15,16,20,25,26,27,28,30" // desembolsada, autorizada…, aprobada, facturación, paz y salvo
	deniedStates   = "6,12,24"                            // negada, autorización negada, rechazada por identidad
)

var bogota = func() *time.Location {
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		return time.FixedZone("COT", -5*3600)
	}
	return loc
}()

// ── lo que contesta la API ─────────────────────────────────────────────────────────────────────────────────────

// Window son los números de una ventana (la última hora, o la misma hora de un día anterior).
type Window struct {
	Total    int `json:"total"`
	Approved int `json:"approved"`
	Denied   int `json:"denied"`
}

// Subject es una entidad o un comercio, con su última hora, lo normal y la curva del día.
type Subject struct {
	Kind     string  `json:"kind"` // lender · merchant · all
	ID       int     `json:"id"`
	Name     string  `json:"name"`
	Now      Window  `json:"now"`
	Baseline []int   `json:"baseline"` // el total de esa misma hora en cada uno de los 7 días anteriores
	Median   float64 `json:"median"`
	Low      int     `json:"low"`
	High     int     `json:"high"`
	// DeniedRate y su normal: la proporción de negadas sobre lo que terminó (aprobadas + negadas).
	DeniedRate       float64 `json:"deniedRate"`
	DeniedRateNormal float64 `json:"deniedRateNormal"`
	State            string  `json:"state"` // alert · warn · ok · quiet
	Why              string  `json:"why"`
	// Today y Normal: por hora del día (0–23); Normal es la mediana de los 7 días anteriores a esa hora.
	Today  []int     `json:"today"`
	Normal []float64 `json:"normal"`
	NormLo []int     `json:"normalLow"`
	NormHi []int     `json:"normalHigh"`
}

// Deploy es un despliegue a producción (de `make deploys`).
type Deploy struct {
	Repo    string `json:"repo"`
	Version string `json:"version"`
	Title   string `json:"title"`
	At      string `json:"at"` // hora de Bogotá, RFC3339
	OK      bool   `json:"ok"`
	URL     string `json:"url"`
}

// Overview es una pasada entera.
type Overview struct {
	CheckedAt  string    `json:"checkedAt"`
	WindowFrom string    `json:"windowFrom"`
	WindowTo   string    `json:"windowTo"`
	Source     string    `json:"source"`
	All        Subject   `json:"all"`
	Lenders    []Subject `json:"lenders"`
	Merchants  []Subject `json:"merchants"`
	FailedJobs Window    `json:"failedJobs"` // Total: en la última hora; Approved: lo normal (mediana) — reusa la forma
	FailedNorm float64   `json:"failedJobsNormal"`
	// Services: los errores de los logs de producción (Loki) por servicio, contra lo normal. LogsNote dice por qué
	// faltan, si faltan: Loki es una señal más, y sin ella la pasada sigue.
	Services    []Subject `json:"services"`
	LogsNote    string    `json:"logsNote,omitempty"`
	Deploys     []Deploy  `json:"deploys"`
	DeploysNote string    `json:"deploysNote,omitempty"`
	Seconds     float64   `json:"seconds"`
}

// ── la lectura de producción ───────────────────────────────────────────────────────────────────────────────────

type reader struct{ src connsql.Source }

func (r reader) rows(q string) ([]connsql.Row, error) {
	if err := connsql.ValidateReadOnly(q); err != nil {
		return nil, err
	}
	rows, err := r.src.Rows(q)
	if os.Getenv("SENTINEL_DEBUG") != "" {
		log.Printf("debug: %d filas, err=%v · %.120s", len(rows), err, strings.Join(strings.Fields(q), " "))
	}
	return rows, err
}

// num lee un número de una fila. Redash los manda como `json.Number` (el conector usa `UseNumber`, para no perder
// precisión): sin ese caso, todo daba 0.
func num(v any) int {
	switch x := v.(type) {
	case json.Number:
		n, _ := x.Float64()
		return int(n)
	case float64:
		return int(x)
	case int64:
		return int(x)
	case int:
		return x
	case string:
		n, _ := strconv.ParseFloat(x, 64)
		return int(n)
	case []byte:
		n, _ := strconv.ParseFloat(string(x), 64)
		return int(n)
	}
	return 0
}

func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case []byte:
		return string(x)
	case nil:
		return ""
	}
	return fmt.Sprint(v)
}

const stamp = "2006-01-02 15:04:05"

// windowCounts: por `column` (lender_id o allied_id) y por día, lo que entró en la franja horaria [from, to) de cada
// uno de los 8 días (hoy y los 7 anteriores). La franja se compara por hora del día, así que cruzar la medianoche se
// parte en dos.
func (r reader) windowCounts(column string, now time.Time) (map[int]map[string]Window, error) {
	from := now.Add(-time.Hour)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, bogota).AddDate(0, 0, -7)
	fromT, toT := from.Format("15:04:05"), now.Format("15:04:05")
	slot := fmt.Sprintf("TIME(ur.created_at) >= '%s' AND TIME(ur.created_at) < '%s'", fromT, toT)
	if fromT > toT { // la última hora cruzó la medianoche
		slot = fmt.Sprintf("(TIME(ur.created_at) >= '%s' OR TIME(ur.created_at) < '%s')", fromT, toT)
	}
	// El día de la franja: si cruzó la medianoche, lo de antes de las 00:00 cuenta para el día siguiente.
	day := "DATE(ur.created_at)"
	if fromT > toT {
		day = fmt.Sprintf("DATE(ur.created_at + INTERVAL %d SECOND)", 24*3600-secondsOfDay(from))
	}
	q := fmt.Sprintf(`SELECT ur.%[1]s AS id, %[2]s AS d, COUNT(*) AS n,
  SUM(ur.user_request_status_id IN (%[3]s)) AS approved, SUM(ur.user_request_status_id IN (%[4]s)) AS denied
FROM user_requests ur
WHERE ur.created_at >= '%[5]s' AND ur.created_at < '%[6]s' AND %[7]s
GROUP BY 1, 2`, column, day, approvedStates, deniedStates, start.Format(stamp), now.Format(stamp), slot)
	rows, err := r.rows(q)
	if err != nil {
		return nil, err
	}
	out := map[int]map[string]Window{}
	for _, row := range rows {
		id := num(row["id"])
		if out[id] == nil {
			out[id] = map[string]Window{}
		}
		d := str(row["d"])
		if len(d) > 10 {
			d = d[:10]
		}
		out[id][d] = Window{Total: num(row["n"]), Approved: num(row["approved"]), Denied: num(row["denied"])}
	}
	return out, nil
}

func secondsOfDay(t time.Time) int { return t.Hour()*3600 + t.Minute()*60 + t.Second() }

// hourlyCounts: por `column` y por día y hora, lo que entró desde hace 7 días: la curva del día y su normal.
func (r reader) hourlyCounts(column string, now time.Time) (map[int]map[string][24]int, error) {
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, bogota).AddDate(0, 0, -7)
	q := fmt.Sprintf(`SELECT ur.%s AS id, DATE(ur.created_at) AS d, HOUR(ur.created_at) AS h, COUNT(*) AS n
FROM user_requests ur WHERE ur.created_at >= '%s' AND ur.created_at < '%s' GROUP BY 1, 2, 3`,
		column, start.Format(stamp), now.Format(stamp))
	rows, err := r.rows(q)
	if err != nil {
		return nil, err
	}
	out := map[int]map[string][24]int{}
	for _, row := range rows {
		id := num(row["id"])
		if out[id] == nil {
			out[id] = map[string][24]int{}
		}
		d := str(row["d"])
		if len(d) > 10 {
			d = d[:10]
		}
		h := num(row["h"])
		if h < 0 || h > 23 {
			continue
		}
		arr := out[id][d]
		arr[h] = num(row["n"])
		out[id][d] = arr
	}
	return out, nil
}

func (r reader) names(table string) (map[int]string, error) {
	rows, err := r.rows(fmt.Sprintf("SELECT id, name FROM %s", table))
	if err != nil {
		return nil, err
	}
	out := map[int]string{}
	for _, row := range rows {
		out[num(row["id"])] = str(row["name"])
	}
	return out, nil
}

// failedJobs: los trabajos fallidos de la cola en la última hora, y su mediana en esa misma hora de los 7 días
// anteriores. Una sola consulta: una columna por día.
func (r reader) failedJobs(now time.Time) (int, float64, error) {
	var cols []string
	for d := 0; d <= 7; d++ {
		to := now.AddDate(0, 0, -d)
		cols = append(cols, fmt.Sprintf("SUM(failed_at >= '%s' AND failed_at < '%s') AS d%d", to.Add(-time.Hour).Format(stamp), to.Format(stamp), d))
	}
	rows, err := r.rows(fmt.Sprintf("SELECT %s FROM failed_jobs WHERE failed_at >= '%s'", strings.Join(cols, ", "),
		now.AddDate(0, 0, -7).Add(-time.Hour).Format(stamp)))
	if err != nil || len(rows) == 0 {
		return 0, 0, err
	}
	var past []int
	for d := 1; d <= 7; d++ {
		past = append(past, num(rows[0][fmt.Sprintf("d%d", d)]))
	}
	return num(rows[0]["d0"]), median(past), nil
}

// ── los errores de los logs (Loki de producción) ────────────────────────────────────────────────────────────

// Las líneas de nivel error de producción, por servicio. El filtro de ambiente va explícito aunque hoy esa instancia
// sólo tenga `production` (medido el 2026-11-11: legacy-backend y legacy-application).
const errorsLogQL = `sum by (service_name) (count_over_time({environment="production", level="error"} [1h]))`

// logErrors: por servicio, los errores de la última hora en cada uno de los 8 días (hoy y la misma hora de los 7
// anteriores) y, por hora del día, la curva de los 8 días.
func logErrors(now time.Time) (map[string]map[string]Window, map[string]map[string][24]int, error) {
	cfg, _, err := connlogs.LoadConfig("prod")
	if err != nil {
		return nil, nil, err
	}
	cl := connlogs.New(cfg, 60*time.Second)
	windows := map[string]map[string]Window{}
	for d := 0; d <= 7; d++ {
		at := now.AddDate(0, 0, -d)
		res, err := cl.Query(errorsLogQL, at.Add(-time.Hour), at, 100, "backward")
		if err != nil {
			return nil, nil, err
		}
		for _, sr := range res.Series {
			name := sr.Labels["service_name"]
			if windows[name] == nil {
				windows[name] = map[string]Window{}
			}
			windows[name][at.Format("2006-01-02")] = Window{Total: int(sr.Value)}
		}
	}
	// La curva: un punto por hora (cada uno cuenta la hora que termina ahí), desde las 01:00 de hace 7 días.
	start := time.Date(now.Year(), now.Month(), now.Day(), 1, 0, 0, 0, bogota).AddDate(0, 0, -7)
	status, body, err := cl.API("query_range", url.Values{
		"query": {errorsLogQL}, "start": {fmt.Sprint(start.UnixNano())}, "end": {fmt.Sprint(now.UnixNano())}, "step": {"3600"},
	})
	if err != nil {
		return nil, nil, err
	}
	if status != http.StatusOK {
		return nil, nil, fmt.Errorf("Loki contestó %d: %s", status, connlogs.Explain(status, body))
	}
	var out struct {
		Data struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Values [][2]any          `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, nil, fmt.Errorf("la curva de Loki no se pudo leer: %w", err)
	}
	hourly := map[string]map[string][24]int{}
	for _, series := range out.Data.Result {
		name := series.Metric["service_name"]
		if hourly[name] == nil {
			hourly[name] = map[string][24]int{}
		}
		for _, v := range series.Values {
			ts, _ := v[0].(float64)
			n, _ := strconv.ParseFloat(fmt.Sprint(v[1]), 64)
			// El punto de las HH:00 cuenta la hora anterior: va a esa hora (y el de las 00:00, a las 23 del día de antes).
			t := time.Unix(int64(ts), 0).In(bogota).Add(-time.Minute)
			day := t.Format("2006-01-02")
			arr := hourly[name][day]
			arr[t.Hour()] = int(n)
			hourly[name][day] = arr
		}
	}
	// La hora en curso, que el rango no trae entera: lo que va desde las HH:00 hasta ahora.
	if mins := now.Minute(); mins > 0 {
		partial := strings.Replace(errorsLogQL, "[1h]", fmt.Sprintf("[%dm]", mins), 1)
		if res, err := cl.Query(partial, now.Add(-time.Duration(mins)*time.Minute), now, 100, "backward"); err == nil {
			day := now.Format("2006-01-02")
			for _, sr := range res.Series {
				name := sr.Labels["service_name"]
				if hourly[name] == nil {
					hourly[name] = map[string][24]int{}
				}
				arr := hourly[name][day]
				arr[now.Hour()] = int(sr.Value)
				hourly[name][day] = arr
			}
		}
	}
	return windows, hourly, nil
}

// ── lo normal y el veredicto ───────────────────────────────────────────────────────────────────────────────────

func median(xs []int) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]int(nil), xs...)
	sort.Ints(s)
	if len(s)%2 == 1 {
		return float64(s[len(s)/2])
	}
	return float64(s[len(s)/2-1]+s[len(s)/2]) / 2
}

func rate(denied, approved int) float64 {
	if denied+approved == 0 {
		return 0
	}
	return float64(denied) / float64(denied+approved)
}

/*
judge decide el estado de una ventana contra su normal. Las reglas son pocas a propósito: muchas alertas falsas

	cansan y se ignoran.
	- quiet: lo normal es menos de 3 por hora; no hay con qué comparar.
	- alert: en la última hora no entró NADA, y en cada uno de los 7 días anteriores a esa hora entró al menos una (con
	  lo normal en 3 o más). Si algún día anterior también entró 0, que hoy entre 0 es posible: no es alerta (medido el
	  2026-11-11: un comercio con «normal 3, entre 0 y 7» daba una alerta falsa).
	- warn:  entró menos del 40 % de lo normal (con lo normal en 5 o más), o la proporción de negadas subió más de
	  30 puntos sobre lo normal con al menos 5 terminadas.
*/
func judge(s *Subject) {
	switch {
	case s.Median < 3:
		s.State, s.Why = "quiet", fmt.Sprintf("poco volumen para comparar (normal %s por hora)", fmtNum(s.Median))
	case s.Now.Total == 0 && s.Low >= 1:
		s.State, s.Why = "alert", fmt.Sprintf("no entró ninguna en la última hora; lo normal es %s (entre %d y %d)", fmtNum(s.Median), s.Low, s.High)
	case s.Median >= 5 && float64(s.Now.Total) < 0.4*s.Median:
		s.State, s.Why = "warn", fmt.Sprintf("entraron %d; lo normal es %s (entre %d y %d)", s.Now.Total, fmtNum(s.Median), s.Low, s.High)
	case s.Now.Approved+s.Now.Denied >= 5 && s.DeniedRate > s.DeniedRateNormal+0.30:
		s.State, s.Why = "warn", fmt.Sprintf("negadas %.0f %% de las terminadas; lo normal es %.0f %%", s.DeniedRate*100, s.DeniedRateNormal*100)
	default:
		s.State, s.Why = "ok", fmt.Sprintf("entraron %d; lo normal es %s (entre %d y %d)", s.Now.Total, fmtNum(s.Median), s.Low, s.High)
	}
}

/*
judgeErrors es el veredicto de los errores de un servicio: acá lo malo es que SUBAN.

  - quiet: lo normal es menos de 5 por hora; no hay con qué comparar.
  - alert: el triple de lo normal o más, y 20 o más por encima del máximo de los 7 días anteriores.
  - warn:  por encima del máximo de los 7 días, y al menos una vez y media lo normal.
*/
func judgeErrors(s *Subject) {
	n, m := float64(s.Now.Total), s.Median
	switch {
	case m < 5:
		s.State, s.Why = "quiet", fmt.Sprintf("%d errores; pocos de costumbre para comparar (normal %s por hora)", s.Now.Total, fmtNum(m))
	case n >= 3*m && s.Now.Total >= s.High+20:
		s.State, s.Why = "alert", fmt.Sprintf("%d errores en la última hora; lo normal es %s (entre %d y %d)", s.Now.Total, fmtNum(m), s.Low, s.High)
	case s.Now.Total > s.High && n >= 1.5*m:
		s.State, s.Why = "warn", fmt.Sprintf("%d errores, más que cualquier día anterior a esta hora; lo normal es %s (entre %d y %d)", s.Now.Total, fmtNum(m), s.Low, s.High)
	default:
		s.State, s.Why = "ok", fmt.Sprintf("%d errores en la última hora; lo normal es %s (entre %d y %d)", s.Now.Total, fmtNum(m), s.Low, s.High)
	}
}

func fmtNum(x float64) string {
	if x == float64(int(x)) {
		return strconv.Itoa(int(x))
	}
	return strconv.FormatFloat(x, 'f', 1, 64)
}

// build arma un Subject con su ventana de hoy, sus 7 días anteriores y su curva.
func build(kind string, id int, name string, now time.Time, windows map[string]Window, hourly map[string][24]int) Subject {
	today := now.Format("2006-01-02")
	s := Subject{Kind: kind, ID: id, Name: name, Now: windows[today]}
	var deniedSum, approvedSum int
	for d := 1; d <= 7; d++ {
		w := windows[now.AddDate(0, 0, -d).Format("2006-01-02")]
		s.Baseline = append(s.Baseline, w.Total)
		deniedSum += w.Denied
		approvedSum += w.Approved
	}
	s.Median = median(s.Baseline)
	s.Low, s.High = s.Baseline[0], s.Baseline[0]
	for _, n := range s.Baseline {
		s.Low, s.High = min(s.Low, n), max(s.High, n)
	}
	s.DeniedRate = rate(s.Now.Denied, s.Now.Approved)
	s.DeniedRateNormal = rate(deniedSum, approvedSum)
	// La curva: hoy hasta la hora actual, y la mediana y el rango de los 7 días anteriores en cada hora.
	todayArr := hourly[today]
	for h := 0; h < 24; h++ {
		if h <= now.Hour() {
			s.Today = append(s.Today, todayArr[h])
		}
		var past []int
		for d := 1; d <= 7; d++ {
			past = append(past, hourly[now.AddDate(0, 0, -d).Format("2006-01-02")][h])
		}
		lo, hi := past[0], past[0]
		for _, n := range past {
			lo, hi = min(lo, n), max(hi, n)
		}
		s.Normal = append(s.Normal, median(past))
		s.NormLo = append(s.NormLo, lo)
		s.NormHi = append(s.NormHi, hi)
	}
	if kind == "service" {
		judgeErrors(&s)
	} else {
		judge(&s)
	}
	return s
}

// subjects arma todos los de una columna, sin los que no tuvieron nada en los 8 días; los que piden atención, primero.
func subjects(kind string, now time.Time, windows map[int]map[string]Window, hourly map[int]map[string][24]int, names map[int]string) []Subject {
	var out []Subject
	for id, byDay := range hourly {
		if id == 0 {
			continue // sin entidad o sin comercio todavía (la solicitud no llegó a elegir)
		}
		name := names[id]
		if name == "" {
			name = fmt.Sprintf("#%d", id)
		}
		out = append(out, build(kind, id, name, now, windows[id], byDay))
	}
	rank := map[string]int{"alert": 0, "warn": 1, "ok": 2, "quiet": 3}
	sort.Slice(out, func(i, j int) bool {
		if rank[out[i].State] != rank[out[j].State] {
			return rank[out[i].State] < rank[out[j].State]
		}
		if out[i].Median != out[j].Median {
			return out[i].Median > out[j].Median
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// ── los despliegues a producción (lo que da `make deploys`) ───────────────────────────────────────────────────

func deploys(root string) ([]Deploy, error) {
	cmd := exec.Command("go", "run", "./tablero/server/cmd/deploys", "-json", "-dias", "2")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("make deploys no contestó (¿gh autenticado?): %v", err)
	}
	var runs []struct {
		Repo, Title, Created, URL, Environment, State, Branch string
	}
	if err := json.Unmarshal(out, &runs); err != nil {
		return nil, err
	}
	var list []Deploy
	for _, r := range runs {
		if !strings.Contains(strings.ToLower(r.Environment), "produc") {
			continue
		}
		t, err := time.Parse(time.RFC3339, r.Created)
		if err != nil {
			continue
		}
		list = append(list, Deploy{Repo: r.Repo, Version: r.Branch, Title: r.Title, At: t.In(bogota).Format(time.RFC3339), OK: r.State == "success", URL: r.URL})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].At > list[j].At })
	return list, nil
}

// ── la pasada y el servidor ────────────────────────────────────────────────────────────────────────────────────

func check(root string) (*Overview, error) {
	started := time.Now()
	cfg, _, err := connsql.LoadConfig("prod")
	if err != nil {
		return nil, err
	}
	src, err := connsql.Open(cfg)
	if err != nil {
		return nil, err
	}
	defer src.Close()
	r := reader{src}
	now := time.Now().In(bogota).Truncate(time.Minute)

	lenderNames, err := r.names("lenders")
	if err != nil {
		return nil, err
	}
	merchantNames, err := r.names("allieds")
	if err != nil {
		return nil, err
	}
	o := &Overview{CheckedAt: now.Format(time.RFC3339), WindowFrom: now.Add(-time.Hour).Format(time.RFC3339), WindowTo: now.Format(time.RFC3339), Source: "prod · " + src.Name()}
	for _, kind := range []struct{ name, column string }{{"lender", "lender_id"}, {"merchant", "allied_id"}} {
		windows, err := r.windowCounts(kind.column, now)
		if err != nil {
			return nil, err
		}
		hourly, err := r.hourlyCounts(kind.column, now)
		if err != nil {
			return nil, err
		}
		names := lenderNames
		if kind.name == "merchant" {
			names = merchantNames
		}
		list := subjects(kind.name, now, windows, hourly, names)
		if kind.name == "lender" {
			o.Lenders = list
			// Toda la originación: la suma de todo, con o sin entidad.
			allWindows := map[string]Window{}
			for _, byDay := range windows {
				for d, w := range byDay {
					a := allWindows[d]
					a.Total += w.Total
					a.Approved += w.Approved
					a.Denied += w.Denied
					allWindows[d] = a
				}
			}
			allHourly := map[string][24]int{}
			for _, byDay := range hourly {
				for d, arr := range byDay {
					a := allHourly[d]
					for h := range arr {
						a[h] += arr[h]
					}
					allHourly[d] = a
				}
			}
			o.All = build("all", 0, "Toda la originación", now, allWindows, allHourly)
		} else {
			o.Merchants = list
		}
	}
	if windows, hourly, err := logErrors(now); err != nil {
		o.LogsNote = "sin los errores de Loki: " + err.Error()
	} else {
		for name, byDay := range hourly {
			o.Services = append(o.Services, build("service", 0, name, now, windows[name], byDay))
		}
		sort.Slice(o.Services, func(i, j int) bool { return o.Services[i].Name < o.Services[j].Name })
	}
	if o.FailedJobs.Total, o.FailedNorm, err = r.failedJobs(now); err != nil {
		return nil, err
	}
	if list, err := deploys(root); err != nil {
		o.DeploysNote = err.Error()
	} else {
		o.Deploys = list
	}
	o.Seconds = time.Since(started).Seconds()
	return o, nil
}

type state struct {
	mu      sync.Mutex
	last    *Overview
	err     string
	running bool
}

func (s *state) run(root string) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()
	o, err := check(root)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = false
	if err != nil {
		s.err = err.Error()
		log.Printf("sentinel: %v", err)
		return
	}
	s.last, s.err = o, ""
}

func (s *state) view() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]any{"overview": s.last, "error": s.err, "running": s.running}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	serve := flag.String("serve", "127.0.0.1:5211", "dónde escucha la API (sólo 127.0.0.1)")
	every := flag.Duration("every", 5*time.Minute, "cada cuánto lee producción")
	once := flag.Bool("once", false, "una pasada por consola, en JSON, y sale")
	flag.Parse()
	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "connectors", "sql")); err != nil {
		log.Fatalf("sentinel: corré desde la raíz del playground (no encuentro connectors/ en %s)", root)
	}
	if *once {
		o, err := check(root)
		if err != nil {
			log.Fatal(err)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(o)
		return
	}
	if !strings.HasPrefix(*serve, "127.0.0.1:") {
		log.Fatal("sentinel: la API escucha sólo en 127.0.0.1")
	}
	st := &state{}
	go func() {
		for {
			st.run(root)
			time.Sleep(*every)
		}
	}()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/overview", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, st.view()) })
	mux.HandleFunc("POST /api/refresh", func(w http.ResponseWriter, r *http.Request) {
		go st.run(root)
		writeJSON(w, http.StatusOK, st.view())
	})
	log.Printf("sentinel: API en http://%s · lee producción cada %s", *serve, *every)
	log.Fatal((&http.Server{Addr: *serve, Handler: mux, ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
