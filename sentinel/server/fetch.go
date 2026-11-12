package main

// LA LECTURA DE PRODUCCIÓN, en bloques de 5 minutos: las solicitudes por entidad, por comercio y en total (Redash),
// los trabajos fallidos de la cola (Redash) y los errores de los logs por servicio (Loki). Todo sólo lectura.
//
// ⚠ LAS HORAS: en producción `created_at` y `failed_at` están en hora de Bogotá y `NOW()` de la base en UTC (medido el
// 2026-11-11). Las ventanas se arman acá y van como fechas literales; el día y el bloque se leen de la fecha guardada.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	connlogs "creditop/playground/connectors/logs"
	connsql "creditop/playground/connectors/sql"
)

// Los estados de `user_requests` (`user_request_statuses` de producción, leída el 2026-11-11), en dos grupos. Negar
// no es fallar —la entidad decidió—.
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

const stamp = "2006-01-02 15:04:05"

// Fresh es lo que llegó de una lectura, por día y por señal.
type Fresh map[string]map[Signal]*Counts

func (f Fresh) add(date string, sig Signal, field string, b, n int) {
	if n == 0 {
		return
	}
	if f[date] == nil {
		f[date] = map[Signal]*Counts{}
	}
	c := f[date][sig]
	if c == nil {
		c = &Counts{}
		f[date][sig] = c
	}
	m := &c.Total
	switch field {
	case "approved":
		m = &c.Approved
	case "denied":
		m = &c.Denied
	}
	if *m == nil {
		*m = map[int]int{}
	}
	(*m)[b] += n
}

// ── Redash ─────────────────────────────────────────────────────────────────────────────────────────────────────

type reader struct{ src connsql.Source }

func openReader() (reader, error) {
	cfg, _, err := connsql.LoadConfig("prod")
	if err != nil {
		return reader{}, err
	}
	src, err := connsql.Open(cfg)
	if err != nil {
		return reader{}, err
	}
	return reader{src}, nil
}

func (r reader) rows(q string) ([]connsql.Row, error) {
	if err := connsql.ValidateReadOnly(q); err != nil {
		return nil, err
	}
	rows, err := r.src.Rows(q)
	if os.Getenv("SENTINEL_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "debug: %d filas, err=%v · %.140s\n", len(rows), err, strings.Join(strings.Fields(q), " "))
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
	}
	return 0
}

func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return ""
	}
	return fmt.Sprint(v)
}

func dayOf(v any) string {
	d := str(v)
	if len(d) > 10 {
		d = d[:10]
	}
	return d
}

// requests: las solicitudes de [from, to) por bloque de 5 minutos, por entidad, por comercio y en total.
func (r reader) requests(from, to time.Time, f Fresh) error {
	q := fmt.Sprintf(`SELECT ur.lender_id AS l, ur.allied_id AS a, DATE(ur.created_at) AS d, HOUR(ur.created_at) AS h,
  FLOOR(MINUTE(ur.created_at) / 5) AS q, COUNT(*) AS n,
  SUM(ur.user_request_status_id IN (%s)) AS approved, SUM(ur.user_request_status_id IN (%s)) AS denied
FROM user_requests ur WHERE ur.created_at >= '%s' AND ur.created_at < '%s' GROUP BY 1, 2, 3, 4, 5`,
		approvedStates, deniedStates, from.Format(stamp), to.Format(stamp))
	rows, err := r.rows(q)
	if err != nil {
		return err
	}
	for _, row := range rows {
		date, b := dayOf(row["d"]), num(row["h"])*12+num(row["q"])
		n, approved, denied := num(row["n"]), num(row["approved"]), num(row["denied"])
		for _, sig := range []Signal{"all:production", fmt.Sprintf("lender:%d", num(row["l"])), fmt.Sprintf("merchant:%d", num(row["a"]))} {
			f.add(date, sig, "total", b, n)
			f.add(date, sig, "approved", b, approved)
			f.add(date, sig, "denied", b, denied)
		}
	}
	return nil
}

// failedJobs: los trabajos fallidos de la cola de [from, to), por bloque.
func (r reader) failedJobs(from, to time.Time, f Fresh) error {
	rows, err := r.rows(fmt.Sprintf(`SELECT DATE(failed_at) AS d, HOUR(failed_at) AS h, FLOOR(MINUTE(failed_at) / 5) AS q, COUNT(*) AS n
FROM failed_jobs WHERE failed_at >= '%s' AND failed_at < '%s' GROUP BY 1, 2, 3`, from.Format(stamp), to.Format(stamp)))
	if err != nil {
		return err
	}
	for _, row := range rows {
		f.add(dayOf(row["d"]), "queue:failed", "total", num(row["h"])*12+num(row["q"]), num(row["n"]))
	}
	return nil
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

// ── Loki ───────────────────────────────────────────────────────────────────────────────────────────────────────

// Las líneas de nivel error de producción, por servicio, en ventanas de 5 minutos. El filtro de ambiente va explícito
// aunque hoy esa instancia sólo tenga `production` (medido el 2026-11-11: legacy-backend y legacy-application).
const errorsLogQL = `sum by (service_name) (count_over_time({environment="production", level="error"} [5m]))`

// logErrors: los errores de [from, to) por servicio, por bloque. Cada punto de Loki cuenta los 5 minutos que terminan
// en él: va al bloque que empieza 5 minutos antes.
func logErrors(cl *connlogs.Client, from, to time.Time, f Fresh) error {
	status, body, err := cl.API("query_range", url.Values{
		"query": {errorsLogQL}, "start": {fmt.Sprint(from.Add(5 * time.Minute).UnixNano())}, "end": {fmt.Sprint(to.UnixNano())}, "step": {"300"},
	})
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("Loki contestó %d: %s", status, connlogs.Explain(status, body))
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
		return fmt.Errorf("la respuesta de Loki no se pudo leer: %w", err)
	}
	for _, series := range out.Data.Result {
		sig := "service:" + series.Metric["service_name"]
		for _, v := range series.Values {
			ts, _ := v[0].(float64)
			n, _ := strconv.ParseFloat(fmt.Sprint(v[1]), 64)
			t := time.Unix(int64(ts), 0).In(bogota).Add(-5 * time.Minute)
			f.add(t.Format("2006-01-02"), sig, "total", bucketOf(t), int(n))
		}
	}
	return nil
}

func lokiClient() (*connlogs.Client, error) {
	cfg, _, err := connlogs.LoadConfig("prod")
	if err != nil {
		return nil, err
	}
	return connlogs.New(cfg, 90*time.Second), nil
}

// ── los despliegues a producción (lo que da `make deploys`) ───────────────────────────────────────────────────

// Deploy es un despliegue a producción.
type Deploy struct {
	Repo    string `json:"repo"`
	Version string `json:"version"`
	Title   string `json:"title"`
	At      string `json:"at"` // hora de Bogotá, RFC3339
	OK      bool   `json:"ok"`
	URL     string `json:"url"`
}

func deploys(root string, days int) ([]Deploy, error) {
	cmd := exec.Command("go", "run", "./tablero/server/cmd/deploys", "-json", "-dias", strconv.Itoa(days))
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
