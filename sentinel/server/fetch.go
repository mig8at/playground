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

// slugs: el slug de cada entidad (normalizado con slugKey) → su id.
func (r reader) slugs() (map[string]int, error) {
	rows, err := r.rows("SELECT id, slug FROM lenders WHERE slug IS NOT NULL")
	if err != nil {
		return nil, err
	}
	out := map[string]int{}
	for _, row := range rows {
		if k := slugKey(str(row["slug"])); k != "" {
			if _, dup := out[k]; !dup { // dos con el mismo slug: gana el primero (el id más bajo)
				out[k] = num(row["id"])
			}
		}
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

// ── Loki ───────────────────────────────────────────────────────────────────────────────────────────────────────

// Lo que se lee de Loki, por servicio y en ventanas de 5 minutos: las líneas de nivel error (`service:<servicio>`) y
// TODAS las líneas (`logs:<servicio>`, la señal de vida: un servicio que deja de escribir probablemente se cayó).
//
// ⚠ El nivel va por `detected_level`, no por la etiqueta `level`: `level` (y `environment`) sólo las ponen los dos
// monolitos; los servicios en Go mandan por OpenTelemetry y su nivel llega como metadato (medido el 2026-11-12: con
// `level` se veían 2 servicios de 18). La instancia de Loki de producción sólo tiene producción.
const (
	errorsLogQL = `sum by (service_name) (count_over_time({service_name=~".+"} | detected_level="error" [5m]))`
	linesLogQL  = `sum by (service_name) (count_over_time({service_name=~".+"} [5m]))`
	// Los errores de UNA ENTIDAD (`lerr:<id>`), de las dos fuentes que la nombran: preapprovals-service la manda como
	// metadato `lender_name` (el slug de `lenders`: «credifamilia», «creditop_x»), y legacy-backend en el JSON de la
	// línea, `context.lender_id`. Medido el 2026-11-12, 7 días: ~1.000 y ~1.800 errores con entidad. Ningún otro servicio
	// la nombra, y el comercio casi nunca (90 en 7 días): no hay errores por comercio.
	lenderNameErrorsLogQL = `sum by (lender_name) (count_over_time({service_name=~".+"} | detected_level="error" | lender_name!="" [5m]))`
	lenderIDErrorsLogQL   = `sum by (context_lender_id) (count_over_time({service_name="legacy-backend"} | detected_level="error" | json | context_lender_id!="" [5m]))`
)

// logsVersion: cambia cuando cambia lo que se lee de Loki; un día guardado con una versión anterior se vuelve a pedir
// (sólo Loki, y sólo lo que esa versión no tenía) para que la historia de lo nuevo no arranque vacía.
//
//	2: errores y líneas de todos los servicios (`service:`, `logs:`)
//	3: errores por entidad (`lerr:`)
const logsVersion = 3

// logKindsSince: las clases de señal que agregó cada versión después de `since`. Se reemplazan sólo ésas: pasar una
// clase que no se pidió la dejaría en cero.
func logKindsSince(since int) []string {
	var kinds []string
	if since < 2 {
		kinds = append(kinds, "service", "logs")
	}
	if since < 3 {
		kinds = append(kinds, "lerr")
	}
	return kinds
}

// logErrors: lo de Loki de [from, to), por bloque, desde la versión `since` (0: todo).
func logErrors(cl *connlogs.Client, from, to time.Time, f Fresh, since int, slugs map[string]int) error {
	byService := func(prefix string) func(map[string]string) Signal {
		return func(m map[string]string) Signal { return prefix + m["service_name"] }
	}
	if since < 2 {
		if err := lokiSeries(cl, errorsLogQL, byService("service:"), from, to, f); err != nil {
			return err
		}
		if err := lokiSeries(cl, linesLogQL, byService("logs:"), from, to, f); err != nil {
			return err
		}
	}
	if since < 3 {
		bySlug := func(m map[string]string) Signal {
			if id := slugs[slugKey(m["lender_name"])]; id > 0 {
				return fmt.Sprintf("lerr:%d", id)
			}
			return "" // un nombre que no está en `lenders`: no se puede atribuir
		}
		if err := lokiSeries(cl, lenderNameErrorsLogQL, bySlug, from, to, f); err != nil {
			return err
		}
		byID := func(m map[string]string) Signal {
			if id, err := strconv.Atoi(m["context_lender_id"]); err == nil && id > 0 {
				return fmt.Sprintf("lerr:%d", id)
			}
			return ""
		}
		if err := lokiSeries(cl, lenderIDErrorsLogQL, byID, from, to, f); err != nil {
			return err
		}
	}
	return nil
}

// slugKey: el slug de una entidad sin la diferencia entre guion y guion bajo («creditop_x» en preapprovals,
// «creditop-x» en `lenders`).
func slugKey(s string) string {
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(s)), "-", "_")
}

// lokiSeries: una consulta de conteo por servicio. Cada punto de Loki cuenta los 5 minutos que terminan en él: va al
// bloque que empieza 5 minutos antes.
func lokiSeries(cl *connlogs.Client, query string, signalOf func(map[string]string) Signal, from, to time.Time, f Fresh) error {
	status, body, err := cl.API("query_range", url.Values{
		"query": {query}, "start": {fmt.Sprint(from.Add(5 * time.Minute).UnixNano())}, "end": {fmt.Sprint(to.UnixNano())}, "step": {"300"},
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
		sig := signalOf(series.Metric)
		if sig == "" {
			continue
		}
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
