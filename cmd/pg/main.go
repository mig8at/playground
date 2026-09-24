// pg es la puerta única a los conectores del playground (`connectors/`): una consulta por ambiente, con
// el ambiente siempre escrito y la fuente que contestó siempre dicha.
//
//	pg help [--json]                                           los comandos, de la misma lista que el binario
//	pg sql    --target T --query 'SELECT …' [--json | --csv]
//	pg logs   --target T --query '{…}' [--since 1h | --start … --end …] [--limit N] [--direction d] [--json]
//	pg logs labels --target T --label L [--since 1h]
//	pg logs config --target T                                  qué Loki atiende ese ambiente, sin secretos
//	pg logs raw --target T --path query_range --param k=v …    el cuerpo de Loki tal cual
//	pg events config --target T                                qué PostHog atiende ese ambiente, sin secretos
//	pg events hogql --target T --query 'SELECT …'              una consulta HogQL: columnas y filas en JSON
//
// `logs raw` existe para las herramientas que ya parsean la respuesta de Loki a su manera (el harness, en
// TypeScript; workers, en Python): conservan su parseo y pierden su cliente HTTP, que es lo que se
// duplicaba. Lo corre `bin/pg`, que lo compila cuando cambia su código.
//
// Exit: 0 ok · 1 falló la consulta · 2 mal pedida o rechazada.
package main

import (
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/playground/connectors/events"
	"creditop/playground/connectors/logs"
	dbsql "creditop/playground/connectors/sql"
)

// command es un verbo de pg. La lista es la fuente de la ayuda (y, más adelante, del catálogo y del
// servidor MCP): un comando que no está acá no existe.
type command struct {
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Usage   string `json:"usage"`
	run     func(args []string) int
}

var commands []command

func init() {
	commands = []command{
		{"sql", "SQL de sólo lectura contra la base del ambiente (MySQL directo; Redash en prod)",
			"pg sql --target T --query 'SELECT …' [--json | --csv]", runSQL},
		{"logs", "líneas de Loki del ambiente, legibles o en JSON",
			"pg logs --target T --query '{…}' [--since 1h | --start … --end …] [--limit N] [--direction forward|backward] [--json]", runLogs},
		{"logs labels", "los valores de una etiqueta de Loki en la ventana",
			"pg logs labels --target T --label L [--since 1h | --start … --end …]", runLabels},
		{"logs config", "qué Loki atiende el ambiente y si se puede leer, sin secretos",
			"pg logs config --target T", runLogsConfig},
		{"logs raw", "el cuerpo de Loki tal cual, para quien ya lo parsea (harness, workers)",
			"pg logs raw --target T --path query_range|query|labels|label/<x>/values --param k=v …", runLogsRaw},
		{"events config", "qué PostHog atiende el ambiente y si se puede consultar, sin secretos",
			"pg events config --target T", runEventsConfig},
		{"events hogql", "una consulta HogQL de sólo lectura: columnas y filas en JSON",
			"pg events hogql --target T --query 'SELECT … FROM events …'", runHogQL},
	}
}

func main() {
	args := os.Args[1:]
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		os.Exit(help(len(args) > 1 && args[1] == "--json"))
	}
	name := args[0]
	rest := args[1:]
	if len(rest) > 0 && !strings.HasPrefix(rest[0], "-") {
		if c, ok := find(name + " " + rest[0]); ok {
			os.Exit(c.run(rest[1:]))
		}
	}
	if c, ok := find(name); ok {
		os.Exit(c.run(rest))
	}
	fmt.Fprintf(os.Stderr, "pg: no existe el comando %q (pg help)\n", strings.Join(args, " "))
	os.Exit(2)
}

func find(name string) (command, bool) {
	for _, c := range commands {
		if c.Name == name {
			return c, true
		}
	}
	return command{}, false
}

func help(asJSON bool) int {
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(commands)
		return 0
	}
	fmt.Println("pg — una consulta por ambiente (local · dev · qa · staging · prod), con la fuente que contestó.")
	fmt.Println()
	for _, c := range commands {
		fmt.Printf("  %-12s %s\n  %-12s %s\n\n", c.Name, c.Summary, "", c.Usage)
	}
	return 0
}

func fail(code int, format string, args ...any) int {
	fmt.Fprintf(os.Stderr, "pg: "+format+"\n", args...)
	return code
}

// ─── sql ────────────────────────────────────────────────────────────────────────────────────────────

func runSQL(args []string) int {
	fs := flag.NewFlagSet("sql", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	query := fs.String("query", "", "SELECT o WITH, una sola sentencia")
	asJSON := fs.Bool("json", false, "filas en JSON, con el ambiente y la fuente")
	asCSV := fs.Bool("csv", false, "filas en CSV")
	if fs.Parse(args) != nil {
		return 2
	}
	if !dbsql.ValidTarget(*target) {
		return fail(2, "falta o no es válido --target (%s)", strings.Join(dbsql.Targets, " · "))
	}
	if err := dbsql.ValidateReadOnly(*query); err != nil {
		return fail(2, "consulta rechazada: %v", err)
	}
	cfg, _, err := dbsql.LoadConfig(*target)
	if err != nil {
		return fail(2, "%v", err)
	}
	rows, source, err := dbsql.Query(cfg, *query)
	if err != nil {
		return fail(1, "consulta en %s: %v", *target, err)
	}
	columns := dbsql.Columns(rows)
	switch {
	case *asJSON:
		if rows == nil {
			rows = []dbsql.Row{}
		}
		return writeJSON(map[string]any{"target": *target, "source": source, "query": *query, "columns": columns, "rows": rows})
	case *asCSV:
		w := csv.NewWriter(os.Stdout)
		_ = w.Write(columns)
		for _, r := range rows {
			rec := make([]string, len(columns))
			for i, c := range columns {
				rec[i] = cell(r[c])
			}
			_ = w.Write(rec)
		}
		w.Flush()
		return 0
	}
	fmt.Printf("%s · %s · %d fila(s)\n", *target, source, len(rows))
	for _, r := range rows {
		parts := make([]string, len(columns))
		for i, c := range columns {
			parts[i] = c + "=" + strings.ReplaceAll(cell(r[c]), "\n", " ")
		}
		fmt.Println("  " + strings.Join(parts, " · "))
	}
	return 0
}

func cell(v any) string {
	if v == nil {
		return "NULL"
	}
	return fmt.Sprint(v)
}

func writeJSON(v any) int {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return fail(1, "%v", err)
	}
	return 0
}

// ─── logs ───────────────────────────────────────────────────────────────────────────────────────────

// window resuelve --since o --start/--end. Una fecha es RFC3339 o milisegundos desde epoch.
func window(since, start, end string) (time.Time, time.Time, error) {
	parse := func(s string) (time.Time, error) {
		if ms, err := strconv.ParseInt(s, 10, 64); err == nil {
			return time.UnixMilli(ms), nil
		}
		return time.Parse(time.RFC3339, s)
	}
	to := time.Now()
	if end != "" {
		t, err := parse(end)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("--end %q: %w", end, err)
		}
		to = t
	}
	if start != "" {
		from, err := parse(start)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("--start %q: %w", start, err)
		}
		return from, to, nil
	}
	d, err := time.ParseDuration(since)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("--since %q: %w", since, err)
	}
	return to.Add(-d), to, nil
}

// client arma el cliente del ambiente, o dice por qué no se puede.
func client(target string) (*logs.Client, int) {
	if !logs.ValidTarget(target) {
		return nil, fail(2, "falta o no es válido --target (%s)", strings.Join(logs.Targets, " · "))
	}
	cfg, _, err := logs.LoadConfig(target)
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	if why := cfg.Missing(); why != "" {
		return nil, fail(2, "no se puede leer Loki en %s: %s", target, why)
	}
	return logs.New(cfg, 90*time.Second), 0
}

func runLogs(args []string) int {
	fs := flag.NewFlagSet("logs", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	query := fs.String("query", "", "LogQL de líneas")
	since := fs.String("since", "1h", "ventana hacia atrás desde --end (ej. 30m, 6h)")
	start := fs.String("start", "", "inicio: RFC3339 o ms desde epoch (pisa --since)")
	end := fs.String("end", "", "fin: RFC3339 o ms desde epoch (default: ahora)")
	limit := fs.Int("limit", 500, "tope de líneas")
	direction := fs.String("direction", "forward", "forward o backward")
	asJSON := fs.Bool("json", false, "los streams de Loki en JSON, con el ambiente")
	if fs.Parse(args) != nil {
		return 2
	}
	if *query == "" {
		return fail(2, "falta --query")
	}
	from, to, err := window(*since, *start, *end)
	if err != nil {
		return fail(2, "%v", err)
	}
	cl, code := client(*target)
	if cl == nil {
		return code
	}
	streams, err := cl.Range(*query, from, to, *limit, *direction)
	if err != nil {
		return fail(1, "Loki en %s: %v", *target, err)
	}
	if *asJSON {
		if streams == nil {
			streams = []logs.Stream{}
		}
		return writeJSON(map[string]any{"target": *target, "url": cl.Base, "query": *query,
			"start": from.UTC().Format(time.RFC3339), "end": to.UTC().Format(time.RFC3339), "streams": streams})
	}
	type line struct {
		ns   string
		text string
	}
	var lines []line
	for _, st := range streams {
		for _, v := range st.Values {
			lines = append(lines, line{v[0], v[1]})
		}
	}
	sort.Slice(lines, func(i, j int) bool { return lines[i].ns < lines[j].ns })
	for _, l := range lines {
		ns, _ := strconv.ParseInt(l.ns, 10, 64)
		msg := l.text
		var obj struct {
			Message string          `json:"message"`
			Msg     string          `json:"msg"`
			Context json.RawMessage `json:"context"`
		}
		if json.Unmarshal([]byte(l.text), &obj) == nil && (obj.Message != "" || obj.Msg != "") {
			msg = obj.Message + obj.Msg
			if len(obj.Context) > 0 && string(obj.Context) != "null" {
				msg += "  " + clip(string(obj.Context), 220)
			}
		}
		fmt.Println(time.Unix(0, ns).UTC().Format("15:04:05"), "·", clip(msg, 300))
	}
	fmt.Printf("-- %d líneas · %s · %s\n", len(lines), *target, cl.Base)
	return 0
}

func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func runLabels(args []string) int {
	fs := flag.NewFlagSet("logs labels", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	label := fs.String("label", "", "la etiqueta (ej. environment, service_name)")
	since := fs.String("since", "1h", "ventana hacia atrás")
	start := fs.String("start", "", "inicio: RFC3339 o ms desde epoch")
	end := fs.String("end", "", "fin: RFC3339 o ms desde epoch")
	if fs.Parse(args) != nil {
		return 2
	}
	if *label == "" {
		return fail(2, "falta --label")
	}
	from, to, err := window(*since, *start, *end)
	if err != nil {
		return fail(2, "%v", err)
	}
	cl, code := client(*target)
	if cl == nil {
		return code
	}
	values := cl.LabelValues(*label, from, to)
	sort.Strings(values)
	if values == nil {
		values = []string{}
	}
	return writeJSON(values)
}

func runLogsConfig(args []string) int {
	fs := flag.NewFlagSet("logs config", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	if fs.Parse(args) != nil {
		return 2
	}
	if !logs.ValidTarget(*target) {
		return fail(2, "falta o no es válido --target (%s)", strings.Join(logs.Targets, " · "))
	}
	cfg, file, err := logs.LoadConfig(*target)
	if err != nil {
		return fail(2, "%v", err)
	}
	return writeJSON(map[string]any{
		"target": cfg.Target, "url": cfg.URL, "env": cfg.Env, "service": cfg.Service,
		"local": logs.IsLocal(cfg.URL), "hasCredentials": cfg.User != "" && cfg.Token != "",
		"missing": cfg.Missing(), "file": file,
	})
}

// rawPath: sólo lectura, y sólo los endpoints que los consumidores usan.
func rawPath(p string) bool {
	switch p {
	case "query_range", "query", "labels":
		return true
	}
	return strings.HasPrefix(p, "label/") && strings.HasSuffix(p, "/values") && !strings.Contains(p, "..")
}

func runLogsRaw(args []string) int {
	fs := flag.NewFlagSet("logs raw", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	path := fs.String("path", "", "query_range · query · labels · label/<x>/values")
	var params multi
	fs.Var(&params, "param", "k=v, repetible (query, start, end, limit, direction, time…)")
	if fs.Parse(args) != nil {
		return 2
	}
	if !rawPath(*path) {
		return fail(2, "--path %q no es un endpoint de lectura de Loki", *path)
	}
	cl, code := client(*target)
	if cl == nil {
		return code
	}
	q := url.Values{}
	for _, kv := range params {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			return fail(2, "--param %q no es k=v", kv)
		}
		q.Add(k, v)
	}
	status, body, err := cl.API(""+*path, q)
	if err != nil {
		return fail(1, "Loki en %s: %v", *target, err)
	}
	if status != 200 {
		return fail(1, "Loki en %s: %s", *target, logs.Explain(status, body))
	}
	_, _ = io.Copy(os.Stdout, strings.NewReader(string(body)))
	return 0
}

type multi []string

func (m *multi) String() string     { return strings.Join(*m, ",") }
func (m *multi) Set(s string) error { *m = append(*m, s); return nil }

// ─── events ─────────────────────────────────────────────────────────────────────────────────────────

func runEventsConfig(args []string) int {
	fs := flag.NewFlagSet("events config", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	if fs.Parse(args) != nil {
		return 2
	}
	if !events.ValidTarget(*target) {
		return fail(2, "falta o no es válido --target (%s)", strings.Join(events.Targets, " · "))
	}
	cfg, file, err := events.LoadConfig(*target)
	if err != nil {
		return fail(2, "%v", err)
	}
	return writeJSON(map[string]any{
		"target": cfg.Target, "api": cfg.API, "project": cfg.Project, "env": cfg.Env,
		"hasToken": cfg.Token != "", "missing": cfg.Missing(), "file": file,
	})
}

func runHogQL(args []string) int {
	fs := flag.NewFlagSet("events hogql", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	query := fs.String("query", "", "HogQL (SELECT …)")
	if fs.Parse(args) != nil {
		return 2
	}
	if !events.ValidTarget(*target) {
		return fail(2, "falta o no es válido --target (%s)", strings.Join(events.Targets, " · "))
	}
	if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(*query)), "SELECT") {
		return fail(2, "sólo consultas SELECT")
	}
	cfg, _, err := events.LoadConfig(*target)
	if err != nil {
		return fail(2, "%v", err)
	}
	if why := cfg.Missing(); why != "" {
		return fail(2, "no se puede consultar PostHog en %s: %s", *target, why)
	}
	columns, rows, err := events.New(cfg, 60*time.Second).HogQL(*query)
	if err != nil {
		return fail(1, "PostHog en %s: %v", *target, err)
	}
	if rows == nil {
		rows = [][]any{}
	}
	return writeJSON(map[string]any{"target": *target, "env": cfg.Env, "columns": columns, "results": rows})
}
