package main

// LAS PANTALLAS DEL WIZARD (PostHog): lo que Sentinel no ve por el backend. Si un despliegue del front rompe el botón de
// «continuar», el backend no se entera —simplemente no llegan pedidos—; acá se ve como una conversión que cae: muchos
// ven la pantalla y pocos la envían. Y si el paso tiene resultado (el OTP, la selección de entidad), cuántos fallan.
//
// Señales `step:<paso>` (todo el wizard) y `step:<paso>@<comercio>`. En lo guardado, por bloque de 5 minutos:
//
//	Total     los que la ENVIARON (la curva del día: gente que pasa el paso)
//	Approved  los que la VIERON (el denominador de la conversión)
//	Denied    los resultados FALLIDOS (`success = false`)
//
// Los eventos son los del wizard (`event_schema_version`), con `properties.environment = 'production'` y
// `merchant_id`. Medido el 2026-11-12: ~6.200 filas por día agrupando por 5 minutos, paso y comercio, en 1,6 s.

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	connevents "creditop/my-tools/connectors/events"
)

// Step: un paso del wizard. View y Done arman la conversión; Result, la tasa de fallo (sobre los que enviaron).
type Step struct {
	ID, Label          string
	View, Done, Result string
}

var wizardSteps = []Step{
	{ID: "otp", Label: "Código OTP", View: "auth_otp_screen_viewed", Done: "auth_otp_submitted", Result: "auth_otp_result"},
	{ID: "amount", Label: "Monto", View: "amount_entered", Done: "amount_submitted"},
	{ID: "registration", Label: "Formulario de registro", View: "registration_form_viewed", Done: "registration_form_submitted"},
	{ID: "offer", Label: "Oferta y elección de entidad", View: "primary_offer_viewed", Done: "lender_selection_submitted", Result: "lender_selection_result"},
	{ID: "amount-update", Label: "Cambio de monto con la entidad", Done: "lender_amount_update_result", Result: "lender_amount_update_result"},
}

// phVersion: como logsVersion, para la historia de PostHog.
const phVersion = 3 // 2: con la zona explícita (la 1 dejó huecos) · 3: los errores del front (`jserr:`)

var stepKinds = []string{"step", "jserr"}

func stepByID(id string) *Step {
	for i := range wizardSteps {
		if wizardSteps[i].ID == id {
			return &wizardSteps[i]
		}
	}
	return nil
}

// stepSignal: `step:otp` o `step:otp@94`.
func stepSignal(id, merchant string) Signal {
	if merchant == "" {
		return "step:" + id
	}
	return "step:" + id + "@" + merchant
}

// stepParts: el paso y el comercio de una señal `step:`.
func stepParts(sig Signal) (id, merchant string) {
	key := sig[len("step:"):]
	id, merchant, _ = strings.Cut(key, "@")
	return id, merchant
}

func phClient() (*connevents.Client, error) {
	cfg, _, err := connevents.LoadConfig("prod")
	if err != nil {
		return nil, err
	}
	if m := cfg.Missing(); m != "" {
		return nil, fmt.Errorf("PostHog de producción: falta %s", m)
	}
	return connevents.New(cfg, 90*time.Second), nil
}

// wizardEvents: los pasos de [from, to), por bloque de 5 minutos, en todo el wizard y por comercio.
func wizardEvents(cl *connevents.Client, from, to time.Time, f Fresh) error {
	role := map[string][]struct {
		step  string
		field string
	}{}
	var names []string
	add := func(event, step, field string) {
		if event == "" {
			return
		}
		if _, ok := role[event]; !ok {
			names = append(names, "'"+connevents.Escape(event)+"'")
		}
		role[event] = append(role[event], struct{ step, field string }{step, field})
	}
	for _, s := range wizardSteps {
		add(s.View, s.ID, "approved")
		add(s.Done, s.ID, "total")
		if s.Result != "" {
			add(s.Result, s.ID, "fail")
		}
	}
	// ⚠ Las horas van en UTC y con la zona EXPLÍCITA: `toDateTime('…')` sin zona se lee en la hora del proyecto
	// (Bogotá). Sin 'UTC', cada pasada de las últimas 3 horas pedía 5 horas en el futuro, recibía nada y borraba lo
	// guardado (medido el 2026-11-12).
	q := fmt.Sprintf(`SELECT toStartOfFiveMinutes(toTimeZone(timestamp, 'America/Bogota')) AS b, event, toString(properties.merchant_id) AS m,
  count() AS n, countIf(properties.success = false) AS ko
FROM events WHERE event IN (%s) AND timestamp >= toDateTime('%s', 'UTC') AND timestamp < toDateTime('%s', 'UTC')%s
GROUP BY b, event, m LIMIT 100000`, strings.Join(names, ","), from.UTC().Format(stamp), to.UTC().Format(stamp), cl.Config.EnvFilter())
	cols, rows, err := cl.HogQL(q)
	if err != nil {
		return err
	}
	at := map[string]int{}
	for i, c := range cols {
		at[c] = i
	}
	for _, row := range rows {
		bt, err := time.Parse(time.RFC3339, str(row[at["b"]]))
		if err != nil {
			if bt, err = time.ParseInLocation(stamp, str(row[at["b"]]), bogota); err != nil {
				continue
			}
		}
		bt = bt.In(bogota)
		event, merchant := str(row[at["event"]]), str(row[at["m"]])
		if merchant == "null" || merchant == "<nil>" || merchant == "0" {
			merchant = ""
		}
		if _, err := strconv.Atoi(merchant); merchant != "" && err != nil {
			merchant = ""
		}
		n, ko := num(row[at["n"]]), num(row[at["ko"]])
		date, b := bt.Format("2006-01-02"), bucketOf(bt)
		for _, r := range role[event] {
			v := n
			field := r.field
			if field == "fail" {
				v, field = ko, "denied"
			}
			f.add(date, stepSignal(r.step, ""), field, b, v)
			if merchant != "" {
				f.add(date, stepSignal(r.step, merchant), field, b, v)
			}
		}
	}
	return nil
}

// ── la evaluación de un paso ─────────────────────────────────────────────────────────────────────────────────────

// StepEval: la conversión y los fallos de un paso en la ventana, contra los días comparables.
type StepEval struct {
	Views    int     `json:"views"`
	Done     int     `json:"done"`
	Fails    int     `json:"fails"`
	Rate     float64 `json:"rate"`     // done / views (−1: sin pantalla vista que contar)
	BaseRate float64 `json:"baseRate"` // la mediana de los días comparables
	FailRate float64 `json:"failRate"` // fails / done
	BaseFail float64 `json:"baseFail"`
}

// Lo mínimo para hablar de una conversión o de una tasa de fallo: con menos, cualquier número es azar.
const (
	stepMinViews = 20
	stepMinFails = 10
)

func (e evaluator) evalStep(sig Signal, se *series, t time.Time) Eval {
	var ev Eval
	minutes := e.rules.WindowMinutes
	id, merchant := stepParts(sig)
	st := stepByID(id)
	label := id
	if st != nil {
		label = st.Label
	}
	// Un comercio chico mira más tiempo, como el volumen de lo que se sigue.
	for _, m := range append([]int{minutes}, e.rules.FollowedWindows...) {
		minutes = m
		if merchant == "" || window(se.approved, t, m) >= stepMinViews || window(se.total, t, m) >= stepMinViews {
			break
		}
	}
	ev.Minutes = minutes
	s := &StepEval{Views: window(se.approved, t, minutes), Done: window(se.total, t, minutes), Fails: window(se.denied, t, minutes), Rate: -1}
	ev.Step, ev.Now = s, s.Done
	var rates, fails []float64
	for _, past := range comparable(t, e.rules.BaselineDays, e.have) {
		v, d, f := window(se.approved, past, minutes), window(se.total, past, minutes), window(se.denied, past, minutes)
		ev.Samples = append(ev.Samples, float64(d))
		ev.Dates = append(ev.Dates, past.Format("2006-01-02"))
		if v >= 10 {
			rates = append(rates, math.Min(1, float64(d)/float64(v)))
		}
		if d >= 10 {
			fails = append(fails, float64(f)/float64(d))
		}
	}
	ev.Median = median(ev.Samples)
	if s.Views > 0 {
		s.Rate = math.Min(1, float64(s.Done)/float64(s.Views))
	}
	if s.Done > 0 {
		s.FailRate = float64(s.Fails) / float64(s.Done)
	}
	s.BaseRate, s.BaseFail = median(rates), median(fails)
	ev.Level = levelOK
	var why []string
	// La conversión: los que enviaron contra los que se esperaban con la proporción de siempre (binomial).
	if st != nil && st.View != "" && s.Views >= stepMinViews && len(rates) >= e.rules.MinSamples && s.BaseRate > 0 {
		exp := float64(s.Views) * s.BaseRate
		z := (float64(s.Done) - exp) / math.Sqrt(math.Max(exp*(1-s.BaseRate), 1))
		ev.Z = z
		lvl := levelOK
		switch {
		case z <= -4.5 && s.Rate <= 0.6*s.BaseRate:
			lvl = levelAlert
		case z <= -3 && s.Rate <= 0.75*s.BaseRate:
			lvl = levelWarn
		}
		ev.Level = max(ev.Level, lvl)
		why = append(why, fmt.Sprintf("de %d que vieron la pantalla la enviaron %d (%s); lo normal, %s", s.Views, s.Done, pctText(s.Rate), pctText(s.BaseRate)))
	} else if st != nil && st.View != "" {
		why = append(why, fmt.Sprintf("%d vieron la pantalla y %d la enviaron: poco para comparar", s.Views, s.Done))
	}
	// Los fallos: sobre los que enviaron.
	if st != nil && st.Result != "" && s.Done >= stepMinViews && len(fails) >= e.rules.MinSamples {
		exp := float64(s.Done) * s.BaseFail
		z := (float64(s.Fails) - exp) / math.Sqrt(math.Max(exp*(1-s.BaseFail), 1))
		lvl := levelOK
		switch {
		case s.Fails >= stepMinFails && z >= 4.5 && s.FailRate >= 2*math.Max(s.BaseFail, 0.01):
			lvl = levelAlert
		case s.Fails >= stepMinFails && z >= 3 && s.FailRate >= 1.5*math.Max(s.BaseFail, 0.01):
			lvl = levelWarn
		}
		if lvl > levelOK || ev.Z == 0 {
			ev.Z = z
		}
		ev.Level = max(ev.Level, lvl)
		why = append(why, fmt.Sprintf("fallaron %d de %d (%s); lo normal, %s", s.Fails, s.Done, pctText(s.FailRate), pctText(s.BaseFail)))
	}
	if len(why) == 0 || (s.Views < stepMinViews && s.Done < stepMinViews) {
		ev.Level = levelQuiet
	}
	if len(why) == 0 {
		why = append(why, fmt.Sprintf("%d resultados, %d fallidos: poco para comparar", s.Done, s.Fails))
	}
	where := ""
	if minutes != 60 {
		where = " (" + span(minutes) + ")"
	}
	ev.Why = label + where + ": " + strings.Join(why, "; ")
	return ev
}

func pctText(x float64) string {
	if x < 0 {
		return "—"
	}
	return fmt.Sprintf("%d %%", int(math.Round(x*100)))
}

// ── el front en producción: sus errores y su versión ─────────────────────────────────────────────────────────────

// Los errores de JavaScript del front (`$exception`), en todo el front: la señal `jserr:front`. Llegan unos 455 por
// día (medido el 2026-11-12); el mensaje está en `$exception_values` (no en `$exception_message`, que viene vacío).
func frontErrors(cl *connevents.Client, from, to time.Time, f Fresh) error {
	q := fmt.Sprintf(`SELECT toStartOfFiveMinutes(toTimeZone(timestamp, 'America/Bogota')) AS b, count() AS n
FROM events WHERE event = '$exception' AND timestamp >= toDateTime('%s', 'UTC') AND timestamp < toDateTime('%s', 'UTC')
GROUP BY b LIMIT 100000`, from.UTC().Format(stamp), to.UTC().Format(stamp))
	cols, rows, err := cl.HogQL(q)
	if err != nil {
		return err
	}
	at := map[string]int{}
	for i, c := range cols {
		at[c] = i
	}
	for _, row := range rows {
		bt, err := time.Parse(time.RFC3339, str(row[at["b"]]))
		if err != nil {
			continue
		}
		bt = bt.In(bogota)
		f.add(bt.Format("2006-01-02"), "jserr:front", "total", bucketOf(bt), num(row[at["n"]]))
	}
	return nil
}

// frontReleases: cada versión del front que se vio en producción, con la primera vez que apareció. Sale de
// `$exception_release` (el commit con que se construyó y se subieron los source maps): el front NO se despliega por un
// workflow de GitHub que se vea (el último «Deploy Loan Request Wizard Production» es la v1.11.4 del 2026-10-30, y en
// producción corre la v1.11.7). El commit se traduce a su tag. Antes de la v1.11.7 los errores no traían versión.
func frontReleases(cl *connevents.Client, days int) ([]Deploy, error) {
	q := fmt.Sprintf(`SELECT JSONExtractString(toString(properties.$exception_release), 'version') AS v, min(timestamp) AS first
FROM events WHERE event = '$exception' AND timestamp > now() - INTERVAL %d DAY
  AND JSONExtractString(toString(properties.$exception_release), 'project') = 'frontend-monorepo'
GROUP BY v ORDER BY first`, days)
	cols, rows, err := cl.HogQL(q)
	if err != nil {
		return nil, err
	}
	at := map[string]int{}
	for i, c := range cols {
		at[c] = i
	}
	tags := frontTags()
	var out []Deploy
	for _, row := range rows {
		sha := str(row[at["v"]])
		t, err := time.Parse(time.RFC3339, str(row[at["first"]]))
		if sha == "" || err != nil {
			continue
		}
		version, url := sha[:min(8, len(sha))], "https://github.com/Creditop-SAS/frontend-monorepo/commit/"+sha
		if tag := tags[sha]; tag != "" {
			version, url = tag, "https://github.com/Creditop-SAS/frontend-monorepo/releases/tag/"+tag
		}
		out = append(out, Deploy{Repo: "frontend-monorepo", Version: version, At: t.In(bogota).Format(time.RFC3339), OK: true, URL: url,
			Title: "primera vez vista en producción (PostHog, commit " + sha[:min(8, len(sha))] + ")"})
	}
	return out, nil
}

// frontTags: el tag de cada commit del front (los últimos 100).
func frontTags() map[string]string {
	out := map[string]string{}
	raw, err := runTool(ghTimeout, "", "gh", "api", "repos/Creditop-SAS/frontend-monorepo/tags?per_page=100", "-q", `.[] | [.commit.sha, .name] | @tsv`)
	if err != nil {
		return out
	}
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if sha, tag, ok := strings.Cut(line, "\t"); ok {
			if _, seen := out[sha]; !seen {
				out[sha] = tag
			}
		}
	}
	return out
}

// NewError: un mensaje de error del front que aparece después de un despliegue y no en los días de antes.
type NewError struct {
	Message string `json:"message"`
	After   int    `json:"after"`
}

// newFrontErrors: los mensajes de `$exception` de [from, to) que no aparecieron en los `before` días anteriores.
func newFrontErrors(cl *connevents.Client, from, to time.Time, before int) ([]NewError, error) {
	q := fmt.Sprintf(`SELECT substring(toString(properties.$exception_values), 1, 200) AS m,
  countIf(timestamp >= toDateTime('%[1]s', 'UTC') AND timestamp < toDateTime('%[2]s', 'UTC')) AS after,
  countIf(timestamp < toDateTime('%[1]s', 'UTC')) AS prior
FROM events WHERE event = '$exception' AND timestamp >= toDateTime('%[1]s', 'UTC') - INTERVAL %[3]d DAY AND timestamp < toDateTime('%[2]s', 'UTC')
GROUP BY m HAVING prior = 0 AND after >= 3 ORDER BY after DESC LIMIT 15`, from.UTC().Format(stamp), to.UTC().Format(stamp), before)
	cols, rows, err := cl.HogQL(q)
	if err != nil {
		return nil, err
	}
	at := map[string]int{}
	for i, c := range cols {
		at[c] = i
	}
	var out []NewError
	for _, row := range rows {
		m := strings.TrimSuffix(strings.TrimPrefix(str(row[at["m"]]), `["`), `"]`)
		out = append(out, NewError{Message: m, After: num(row[at["after"]])})
	}
	return out, nil
}
