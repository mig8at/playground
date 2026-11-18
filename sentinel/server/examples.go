package main

// DE LA SEÑAL AL CASO: lo que se pide al abrir el detalle de una señal, no en cada pasada.
//
//   - Los casos de ejemplo (`GET /api/examples?signal=…`): algunas solicitudes de la ventana de la señal, para abrirlas en
//     tracer (la herramienta del repo compartido que traza UNA solicitud: etapas, logs y lo que vio el cliente) o por
//     consola. Sentinel dice «Refurbicredit rechaza el 31 %»; esto dice cuáles.
//   - Las reglas que rechazan (`GET /api/rules?lender=…`): de las reglas duras de la entidad, cuáles fallan ahora contra
//     los 7 días anteriores. ⚠ Sólo las reglas duras (`profiling_reviews.hard_rules`): el rechazo por categorías del
//     perfilador no queda registrado regla por regla, así que en muchas entidades CreditopX esto viene vacío.
//
// Sólo números de solicitud, nunca cédula, teléfono ni nombre.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	connlogs "creditop/my-tools/connectors/logs"
)

// tracerURL: dónde se abre una solicitud en tracer (con la VPN).
const tracerURL = "https://tracer.playground.creditop.com/?ureq="

const examplesMax = 8

// Example: una solicitud de la ventana de una señal.
type Example struct {
	UReq   int    `json:"ureq"`
	At     string `json:"at"`             // hora de Bogotá, RFC3339
	Status int    `json:"status"`         // user_request_status_id (0 si viene de los logs)
	Note   string `json:"note,omitempty"` // por qué es ejemplo: «rechazada por X», «error: …»
	Tracer string `json:"tracer"`
	Cmd    string `json:"cmd"` // el mismo caso por consola
}

// Examples: los casos de una señal, con lo que se miró.
type Examples struct {
	Signal string    `json:"signal"`
	From   string    `json:"from"`
	To     string    `json:"to"`
	Source string    `json:"source"` // de dónde salieron: «la base», «los logs de legacy-backend»
	List   []Example `json:"list"`
	Note   string    `json:"note,omitempty"`
}

func example(ureq int, at time.Time, status int, note string) Example {
	return Example{UReq: ureq, At: at.In(bogota).Format(time.RFC3339), Status: status, Note: note,
		Tracer: tracerURL + strconv.Itoa(ureq), Cmd: fmt.Sprintf("bin/pg request timeline --target prod --ureq %d", ureq)}
}

var reUReqInLog = regexp.MustCompile(`"user_request_id":\s*"?(\d{3,9})`)

// examples: las solicitudes de ejemplo de una señal en [from, to).
func (s *sentinel) examples(sig Signal, from, to time.Time) (Examples, error) {
	out := Examples{Signal: sig, From: from.Format(time.RFC3339), To: to.Format(time.RFC3339), List: []Example{}}
	kind := kindOf(sig)
	key := sig[len(kind)+1:]
	id, _ := strconv.Atoi(key)
	switch kind {
	case "reject":
		r, err := openReader()
		if err != nil {
			return out, err
		}
		filter := ""
		if key != "all" {
			filter = fmt.Sprintf(" AND d.lender_id = %d", id)
		}
		rows, err := r.rows(fmt.Sprintf(`SELECT pr.user_request_id AS u, DATE_FORMAT(pr.created_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS at, ln.name AS lender
FROM profiling_reviews pr
JOIN JSON_TABLE(pr.displayed_lenders, '$[*]' COLUMNS (lender_id INT PATH '$.id', probability VARCHAR(60) PATH '$.probability')) AS d
JOIN lenders ln ON ln.id = d.lender_id AND ln.response_type IN (2, 3)
WHERE d.probability = 'Rechazado' AND pr.user_request_id IS NOT NULL AND pr.created_at >= '%s' AND pr.created_at < '%s'%s
ORDER BY pr.created_at DESC LIMIT %d`, from.Format(stamp), to.Format(stamp), filter, examplesMax))
		if err != nil {
			return out, err
		}
		out.Source = "la base (profiling_reviews): perfilamientos en que la entidad salió «Rechazado»"
		for _, row := range rows {
			at, _ := time.ParseInLocation(stamp, str(row["at"]), bogota)
			out.List = append(out.List, example(num(row["u"]), at, 0, "rechazada por "+str(row["lender"])))
		}
	case "lender", "merchant", "all", "lerr":
		if kind == "lerr" {
			// los errores de una entidad: primero los logs que la nombran; si no hay, sus solicitudes
			if ex, err := s.examplesFromLogs(fmt.Sprintf(`{service_name="legacy-backend"} | detected_level="error" | json | context_lender_id="%d"`, id), from, to); err == nil && len(ex) > 0 {
				out.Source, out.List = "los logs de legacy-backend que nombran a la entidad", ex
				break
			}
		}
		r, err := openReader()
		if err != nil {
			return out, err
		}
		where := ""
		switch kind {
		case "lender", "lerr":
			where = fmt.Sprintf(" AND ur.lender_id = %d", id)
		case "merchant":
			where = fmt.Sprintf(" AND ur.allied_id = %d", id)
		}
		rows, err := r.rows(fmt.Sprintf(`SELECT ur.id AS u, DATE_FORMAT(ur.created_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS at, ur.user_request_status_id AS st,
  ur.user_request_status_id IN (%s) AS denied
FROM user_requests ur WHERE ur.created_at >= '%s' AND ur.created_at < '%s'%s
ORDER BY denied DESC, ur.created_at DESC LIMIT %d`, deniedStates, from.Format(stamp), to.Format(stamp), where, examplesMax))
		if err != nil {
			return out, err
		}
		out.Source = "la base (user_requests): las negadas primero"
		for _, row := range rows {
			at, _ := time.ParseInLocation(stamp, str(row["at"]), bogota)
			note := ""
			if num(row["denied"]) == 1 {
				note = "negada"
			}
			out.List = append(out.List, example(num(row["u"]), at, num(row["st"]), note))
		}
	case "service":
		ex, err := s.examplesFromLogs(fmt.Sprintf(`{service_name=%q} | detected_level="error"`, key), from, to)
		if err != nil {
			return out, err
		}
		out.Source, out.List = "los logs de error de "+key, ex
		if len(ex) == 0 {
			out.Note = "sus líneas de error de esta ventana no nombran ninguna solicitud (sólo legacy-backend manda `user_request_id`)"
		}
	default:
		out.Note = "esta señal no tiene solicitudes de ejemplo"
	}
	return out, nil
}

// examplesFromLogs: las solicitudes que nombran las líneas de una consulta de Loki, la más reciente primero, sin repetir.
func (s *sentinel) examplesFromLogs(logql string, from, to time.Time) ([]Example, error) {
	cl, err := lokiClient()
	if err != nil {
		return nil, err
	}
	status, body, err := cl.API("query_range", url.Values{"query": {logql}, "start": {fmt.Sprint(from.UnixNano())},
		"end": {fmt.Sprint(to.UnixNano())}, "limit": {"300"}, "direction": {"backward"}})
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("Loki contestó %d: %s", status, connlogs.Explain(status, body))
	}
	var res struct {
		Data struct {
			Result []struct {
				Values [][2]string `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, err
	}
	type hit struct {
		at   time.Time
		ureq int
		msg  string
	}
	var hits []hit
	for _, st := range res.Data.Result {
		for _, v := range st.Values {
			m := reUReqInLog.FindStringSubmatch(v[1])
			if m == nil {
				continue
			}
			ns, _ := strconv.ParseInt(v[0], 10, 64)
			u, _ := strconv.Atoi(m[1])
			hits = append(hits, hit{time.Unix(0, ns), u, messageOf(nil, v[1])})
		}
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].at.After(hits[j].at) })
	var out []Example
	seen := map[int]bool{}
	for _, h := range hits {
		if seen[h.ureq] || len(out) == examplesMax {
			continue
		}
		seen[h.ureq] = true
		msg := h.msg
		if len([]rune(msg)) > 90 {
			msg = string([]rune(msg)[:90]) + "…"
		}
		out = append(out, example(h.ureq, h.at, 0, "error: "+strings.TrimSpace(msg)))
	}
	return out, nil
}

// RuleFail: una regla dura de la entidad, cuánto falla ahora y antes.
type RuleFail struct {
	Rule        string  `json:"rule"`
	Column      string  `json:"column"`
	Operator    string  `json:"operator"`
	Value       string  `json:"value"`
	FailsNow    int     `json:"failsNow"`
	EvalsNow    int     `json:"evalsNow"`
	FailsBefore int     `json:"failsBefore"`
	EvalsBefore int     `json:"evalsBefore"`
	RateNow     float64 `json:"rateNow"`
	RateBefore  float64 `json:"rateBefore"`
}

// RuleFails: las reglas que rechazan de una entidad, ahora (las últimas `hours`) contra los 7 días anteriores.
type RuleFails struct {
	Lender int        `json:"lender"`
	Hours  int        `json:"hours"`
	List   []RuleFail `json:"list"`
	Note   string     `json:"note,omitempty"`
}

// blockingRules: las reglas duras de la entidad que fallan, ahora contra antes, ordenadas por cuánto subió su falla.
// Las reglas se copian a cada sucursal con otro id: se agrupan por lo que dicen (nombre, columna, operador y valor).
func blockingRules(lender, hours int, now time.Time) (RuleFails, error) {
	out := RuleFails{Lender: lender, Hours: hours, List: []RuleFail{}}
	r, err := openReader()
	if err != nil {
		return out, err
	}
	cut := now.Add(-time.Duration(hours) * time.Hour)
	start := cut.AddDate(0, 0, -7)
	rows, err := r.rows(fmt.Sprintf(`SELECT lr.name AS rule, lr.column AS col, lr.operator AS op, lr.value AS val,
  SUM(jt.response = 0 AND pr.created_at >= '%[1]s') AS fn, SUM(pr.created_at >= '%[1]s') AS evals_now,
  SUM(jt.response = 0 AND pr.created_at < '%[1]s') AS fb, SUM(pr.created_at < '%[1]s') AS eb
FROM profiling_reviews pr
JOIN JSON_TABLE(pr.hard_rules, '$.*.*[*]' COLUMNS (rule_id INT PATH '$.rule_id', response BOOLEAN PATH '$.response')) AS jt
JOIN lender_rules lr ON lr.id = jt.rule_id
WHERE lr.lender_id = %[2]d AND pr.created_at >= '%[3]s' AND pr.created_at < '%[4]s' AND pr.deleted_at IS NULL
GROUP BY 1, 2, 3, 4 HAVING (fn + fb) > 0 LIMIT 40`, cut.Format(stamp), lender, start.Format(stamp), now.Format(stamp)))
	if err != nil {
		return out, err
	}
	for _, row := range rows {
		x := RuleFail{Rule: str(row["rule"]), Column: str(row["col"]), Operator: str(row["op"]), Value: str(row["val"]),
			FailsNow: num(row["fn"]), EvalsNow: num(row["evals_now"]), FailsBefore: num(row["fb"]), EvalsBefore: num(row["eb"])}
		if x.EvalsNow > 0 {
			x.RateNow = float64(x.FailsNow) / float64(x.EvalsNow)
		}
		if x.EvalsBefore > 0 {
			x.RateBefore = float64(x.FailsBefore) / float64(x.EvalsBefore)
		}
		out.List = append(out.List, x)
	}
	sort.Slice(out.List, func(i, j int) bool {
		di, dj := out.List[i].RateNow-out.List[i].RateBefore, out.List[j].RateNow-out.List[j].RateBefore
		if di != dj {
			return di > dj
		}
		return out.List[i].FailsNow > out.List[j].FailsNow
	})
	if len(out.List) == 0 {
		out.Note = "la entidad no tiene reglas duras que hayan fallado: su rechazo sale de las categorías del perfilador, que no se registran regla por regla"
	}
	return out, nil
}

// casesOrRules: `bin/sentinel cases <señal> [--hours 2]` y `bin/sentinel rules <id de la entidad> [--hours 24]`.
func casesOrRules(cmd string, positional []string, hours float64) (any, error) {
	now := time.Now().In(bogota)
	if cmd == "cases" {
		if len(positional) == 0 || !strings.Contains(positional[0], ":") {
			return nil, fmt.Errorf("falta la señal como clase:clave: «reject:167», «lender:24», «merchant:94», «service:legacy-backend»")
		}
		s := &sentinel{}
		return s.examples(positional[0], now.Add(-time.Duration(hours*float64(time.Hour))), now)
	}
	if len(positional) == 0 {
		return nil, fmt.Errorf("falta el id de la entidad: «167»")
	}
	id, err := strconv.Atoi(strings.TrimPrefix(strings.TrimPrefix(positional[0], "reject:"), "lender:"))
	if err != nil {
		return nil, fmt.Errorf("el id de la entidad va como número: %v", err)
	}
	if hours == 2 { // lo de partida de --hours es para deploy; para las reglas, un día
		hours = 24
	}
	return blockingRules(id, int(hours), now)
}

// Text: los casos para la consola.
func (e Examples) Text() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Casos de %s · de %s a %s · de %s\n\n", e.Signal, clockOf(e.From), clockOf(e.To), e.Source)
	for _, x := range e.List {
		fmt.Fprintf(&b, "  %s  %-8d %s\n           %s\n", clockOf(x.At), x.UReq, x.Note, x.Tracer)
	}
	if len(e.List) == 0 {
		b.WriteString("  ninguna en la ventana\n")
	}
	if e.Note != "" {
		fmt.Fprintf(&b, "\n  %s\n", e.Note)
	}
	b.WriteString("\n  (por consola: bin/pg request timeline --target prod --ureq <n>)\n")
	return b.String()
}

// Text: las reglas que rechazan, para la consola.
func (r RuleFails) Text() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Reglas duras de la entidad %d que fallan · últimas %d horas contra los 7 días anteriores\n\n", r.Lender, r.Hours)
	for _, x := range r.List {
		fmt.Fprintf(&b, "  %-28s %3d de %-5d (%5.1f %%)   antes %3d de %-5d (%5.1f %%)\n", x.Rule, x.FailsNow, x.EvalsNow, 100*x.RateNow, x.FailsBefore, x.EvalsBefore, 100*x.RateBefore)
	}
	if r.Note != "" {
		fmt.Fprintf(&b, "  %s\n", r.Note)
	}
	b.WriteString("\n  ⚠ Una regla que falla no siempre descarta a la entidad: puede pasar por otro grupo de reglas. Es dónde se frena, no la causa exacta.\n")
	return b.String()
}

func clockOf(rfc string) string {
	t, err := time.Parse(time.RFC3339, rfc)
	if err != nil {
		return rfc
	}
	return t.In(bogota).Format("02/01 15:04")
}
