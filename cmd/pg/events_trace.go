package main

// Lo que vio el cliente en el navegador, por PostHog: el recorrido de UNA solicitud (`events request`) y el
// ranking de errores del front en un ambiente (`events errors`). Venía del trazador personal.
//
// El empalme es exacto: el wizard identifica a la persona con `distinct_id = loan_request_<ureq>` y manda
// `loan_request_id` en cada evento. Sólo el wizard nuevo emite: una solicitud del flujo clásico no aparece, y
// «sin eventos» NO significa «el cliente no hizo nada».

import (
	"creditop/playground/connectors/events"
	"flag"
	"fmt"
	"strings"
	"time"
)

// eventsClient arma el cliente de PostHog del ambiente, o dice por qué no se puede.
func eventsClient(target string) (*events.Client, int) {
	if !events.ValidTarget(target) {
		return nil, fail(2, "falta o no es válido --target (%s)", strings.Join(events.Targets, " · "))
	}
	cfg, _, err := events.LoadConfig(target)
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	if why := cfg.Missing(); why != "" {
		return nil, fail(2, "no se puede consultar PostHog en %s: %s", target, why)
	}
	return events.New(cfg, 60*time.Second), 0
}

// sinceFilter acota por hora; sin ventana no filtra.
func sinceFilter(d time.Duration) string {
	if d <= 0 {
		return ""
	}
	return fmt.Sprintf(" AND timestamp >= now() - INTERVAL %d SECOND", int64(d.Seconds()))
}

// logsEnvFilter: en la tabla `logs` el ambiente vive en `resource_attributes`, no en `properties`.
func logsEnvFilter(c events.Config) string {
	if c.Env == "" {
		return ""
	}
	return fmt.Sprintf(" AND resource_attributes['deployment.environment'] = '%s'", events.Escape(c.Env))
}

// phoneE164 replica `normalizePhoneE164` del wizard, que arma el `distinct_id` del teléfono: si divergen, el
// empalme falla en silencio.
func phoneE164(tel string) string {
	var d strings.Builder
	for _, r := range tel {
		if r >= '0' && r <= '9' {
			d.WriteRune(r)
		}
	}
	digits := d.String()
	switch {
	case digits == "":
		return ""
	case strings.HasPrefix(strings.TrimSpace(tel), "+"):
		return "+" + digits
	case len(digits) == 10:
		return "+57" + digits
	}
	return "+" + digits
}

func text(v any) string {
	if v == nil {
		return ""
	}
	s := fmt.Sprint(v)
	if s == "<nil>" || s == "null" {
		return ""
	}
	return s
}

// urlPath deja el path: el query del wizard lleva códigos de sesión y hashes de comercio.
func urlPath(u string) string {
	if i := strings.Index(u, "://"); i >= 0 {
		if j := strings.Index(u[i+3:], "/"); j >= 0 {
			u = u[i+3+j:]
		}
	}
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		u = u[:i]
	}
	return u
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func runEventsRequest(args []string) int {
	fs := flag.NewFlagSet("events request", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	ureq := fs.Int64("ureq", 0, "la solicitud (user_request_id)")
	tel := fs.String("tel", "", "el celular: sin él no se ve la fase de AUTH")
	since := fs.String("since", "1d", "ventana: 6h, 1d, 7d… (prod y los de pruebas comparten ids)")
	limit := fs.Int("limit", 200, "tope de eventos")
	if fs.Parse(args) != nil {
		return 2
	}
	if *ureq <= 0 {
		return fail(2, "falta --ureq")
	}
	d, err := parseSince(*since)
	if err != nil {
		return fail(2, "--since: %v", err)
	}
	cl, code := eventsClient(*target)
	if cl == nil {
		return code
	}

	// TRES llaves (cuatro con el teléfono): la fase de auth ocurre antes de que exista la solicitud, y el
	// `$exception` del servidor del wizard la nombra en camelCase.
	keys := []string{
		"distinct_id = '" + events.Escape(fmt.Sprintf("loan_request_%d", *ureq)) + "'",
		fmt.Sprintf("toString(properties.loan_request_id) = '%d'", *ureq),
		fmt.Sprintf("toString(properties.loanRequestId) = '%d'", *ureq),
	}
	fmt.Printf("solicitud %d · %s (env %s) · últimas %s\n", *ureq, *target, cl.Config.Env, *since)
	if e164 := phoneE164(*tel); e164 != "" {
		keys = append(keys, "distinct_id = '"+events.Escape("phone_"+e164)+"'")
	} else {
		fmt.Println("⚠ sin --tel no se ve la fase de AUTH (en prod, la mitad de los eventos)")
	}

	_, rows, err := cl.HogQL(fmt.Sprintf(`SELECT timestamp, event, properties.$current_url, properties.screen_name,
	    properties.known_exception_reason, properties.success, properties.$session_id, properties.service_runtime,
	    properties.$lib, properties.source, toString(properties.$exception_types), toString(properties.$exception_values)
	  FROM events WHERE (%s)%s%s ORDER BY timestamp ASC LIMIT %d`,
		strings.Join(keys, " OR "), cl.Config.EnvFilterTolerant(), sinceFilter(d), *limit))
	if err != nil {
		return fail(1, "PostHog en %s: %v", *target, err)
	}
	fmt.Printf("\n── eventos: %d\n", len(rows))
	var sessions []string
	seen := map[string]bool{}
	for _, f := range rows {
		if len(f) < 12 {
			continue
		}
		ts, ev := text(f[0]), text(f[1])
		if len(ts) > 19 {
			ts = ts[:19]
		}
		line := fmt.Sprintf("  %s  %-38s", ts, ev)
		if reason := text(f[4]); reason != "" {
			line += "  ✘ " + reason
		} else if text(f[5]) == "false" {
			line += "  ✘ success=false"
		}
		if screen := text(f[3]); screen != "" {
			line += "  " + screen
		} else if u := text(f[2]); u != "" {
			line += "  " + urlPath(u)
		}
		if text(f[7]) == "server" || text(f[8]) == "posthog-node" {
			line += " ·srv"
		}
		fmt.Println(line)
		if ev == "$exception" {
			fmt.Printf("      %s %s\n", text(f[9]), clip(strings.Trim(text(f[10])+": "+text(f[11]), ": []\""), 160))
		}
		if s := text(f[6]); s != "" && !seen[s] {
			seen[s] = true
			sessions = append(sessions, s)
		}
	}
	if len(rows) == 0 {
		fmt.Println("  (ninguno: flujo clásico, fuera de la ventana o de la retención, o el front no llegó a emitir)")
	}

	// La bitácora del front (OpenTelemetry): la PANTALLA, si fue loader o action, el error y el estado HTTP.
	_, lines, err := cl.HogQL(fmt.Sprintf(`SELECT toTimeZone(timestamp,'UTC'), level, event_name,
	       attributes['routeId'], attributes['routeLifecycle'], message, attributes['errorName'],
	       attributes['reason'], attributes['url_path'], attributes['response_status']
	  FROM logs WHERE attributes['loan_request_id'] = '%d'%s%s ORDER BY timestamp ASC LIMIT 300`,
		*ureq, logsEnvFilter(cl.Config), sinceFilter(d)))
	if err != nil {
		return fail(1, "PostHog (logs) en %s: %v", *target, err)
	}
	problems := 0
	fmt.Printf("\n── bitácora del front: %d líneas\n", len(lines))
	icon := map[string]string{"error": "✗", "warn": "⚠"}
	for _, r := range lines {
		if len(r) < 10 {
			continue
		}
		level := text(r[1])
		if level == "error" || level == "warn" {
			problems++
		}
		ts := text(r[0])
		if i := strings.Index(ts, "T"); i >= 0 {
			ts = ts[i+1:]
		}
		if len(ts) > 8 {
			ts = ts[:8]
		}
		where := strings.TrimPrefix(text(r[3]), "routes/")
		if lc := text(r[4]); where != "" && lc != "" {
			where += " " + lc
		}
		if where == "" {
			where = text(r[8])
		}
		what := text(r[5])
		if what == "" {
			what = text(r[6])
		}
		if st := text(r[9]); st != "" {
			what += " [" + st + "]"
		}
		mark := icon[level]
		if mark == "" {
			mark = "·"
		}
		fmt.Printf("  %s %s  %-42s %s\n", mark, ts, clip(where, 42), clip(oneLine(what), 110))
	}
	if len(lines) == 0 {
		fmt.Println("  (ninguna: warn y error no se muestrean, así que el front no reportó problemas de esta solicitud)")
	} else {
		fmt.Printf("  %d error/warn\n", problems)
	}

	if len(sessions) > 0 {
		fmt.Println("\n── session replay")
		for _, s := range sessions {
			fmt.Printf("  %s/project/%s/replay/%s\n", cl.Config.API, cl.Config.Project, s)
		}
	}
	// Sin nada en las dos tablas no es «todo bien»: sale 1 para que un script no lo lea como recorrido limpio.
	if len(rows) == 0 && len(lines) == 0 {
		return 1
	}
	return 0
}

func runEventsErrors(args []string) int {
	fs := flag.NewFlagSet("events errors", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	days := fs.Int("days", 7, "días hacia atrás")
	if fs.Parse(args) != nil {
		return 2
	}
	if *days <= 0 {
		return fail(2, "--days tiene que ser mayor que 0")
	}
	cl, code := eventsClient(*target)
	if cl == nil {
		return code
	}
	env := logsEnvFilter(cl.Config)
	_, where, err := cl.HogQL(fmt.Sprintf(`SELECT attributes['routeId'] AS pantalla, attributes['routeLifecycle'] AS etapa,
	       attributes['errorName'] AS err, event_name AS tipo, count() AS n, toTimeZone(max(timestamp),'UTC') AS ultimo
	  FROM logs WHERE level = 'error'%s AND timestamp > now() - INTERVAL %d DAY
	 GROUP BY pantalla, etapa, err, tipo ORDER BY n DESC LIMIT 20`, env, *days))
	if err != nil {
		return fail(1, "PostHog en %s: %v", *target, err)
	}
	fmt.Printf("errores del front · %s (env %s) · últimos %d días\n", *target, cl.Config.Env, *days)
	if len(where) == 0 {
		fmt.Println("  ninguno (warn y error no se muestrean: el silencio vale)")
		return 0
	}
	fmt.Println("\n── DÓNDE (pantalla · etapa · error)")
	for _, r := range where {
		if len(r) < 6 {
			continue
		}
		screen := strings.TrimPrefix(text(r[0]), "routes/")
		if screen == "" {
			screen = "(sin pantalla)"
		}
		last := text(r[5])
		if len(last) > 16 {
			last = last[:16]
		}
		fmt.Printf("  %6s  %-40s %-8s %-22s %s\n", text(r[4]), clip(screen, 40), text(r[1]), clip(text(r[2]), 22), last)
	}
	_, what, err := cl.HogQL(fmt.Sprintf(`SELECT pattern, count() AS n FROM logs
	 WHERE level = 'error'%s AND timestamp > now() - INTERVAL %d DAY
	 GROUP BY pattern ORDER BY n DESC LIMIT 15`, env, *days))
	if err != nil {
		return fail(1, "PostHog en %s: %v", *target, err)
	}
	fmt.Println("\n── QUÉ (mensaje por patrón)")
	for _, r := range what {
		if len(r) >= 2 {
			fmt.Printf("  %6s  %s\n", text(r[1]), clip(oneLine(text(r[0])), 140))
		}
	}
	return 0
}
