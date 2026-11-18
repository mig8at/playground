package main

// EL EMBUDO DEL BACKEND: en qué etapa se quedan las solicitudes. Sentinel ve cuántas entran (`all:production`) y si el
// cliente envía cada pantalla (PostHog, steps.go), pero no si, entrando igual, el backend deja de perfilarlas o el
// cliente deja de elegir entidad. Las etapas son las de tracer (la herramienta del repo compartido que sigue UNA
// solicitud: «la base dice QUÉ pasó, los logs dicen POR QUÉ»), sumadas para todas y sólo con su parte de la base, que es
// barata; el porqué de cada una sigue en tracer, por solicitud (los casos de ejemplo enlazan ahí).
//
// Dos conversiones, contadas por la hora del EVENTO (no por la de la solicitud: así lo de hoy no está «todavía
// avanzando» y se compara con días asentados sin trampa):
//
//	funnel:profiled  de las que entraron (user_requests.created_at), cuántas se perfilaron (profiling_reviews)
//	funnel:selected  de las perfiladas, cuántas eligieron entidad (user_request_records con el estado 3)
//
// En lo guardado, como las pantallas: Approved es la etapa de antes (el denominador) y Total, las que llegaron.
//
// ⚠ Cuenta la PRIMERA vez de cada solicitud (el primer perfilamiento, la primera elección). Contando todas, una
// solicitud que se vuelve a perfilar contaba dos veces: muchas horas tenían más perfiladas que entradas, lo normal daba
// 100 % y la semana del 11 al 17/11/2026 sumaba 13 «para mirar» del perfilamiento.
//
// Lo que NO entra, medido en producción el 2026-11-18:
//   - El buró: `risk_central_user_data` no tiene filas del 10 al 12/11 (sí de antes y de después) y tiene fechas de 2027;
//     `user_request_risk_central_user_data` daba 0 por día y 536.266 el 18 (un relleno). Ninguna dice cuándo se consultó.
//   - La autorización (estado 11) y el desembolso: pasan horas o días después de la selección, así que en una hora no
//     hay con qué compararlas. El desembolso entra en la plata en juego (stake.go).
//
// Los días típicos (hábiles, del 10 al 17/11/2026): entran ~1.300, se perfilan ~1.200 (88–92 %) y eligen ~450 (35–45 %
// de las perfiladas).

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// FunnelStage: una conversión del embudo.
type FunnelStage struct {
	ID    string // funnel:<ID>
	Label string // lo que mide, para el porqué
	From  string // la etapa de antes
	To    string // la que se mide
}

var funnelStages = []FunnelStage{
	{ID: "profiled", Label: "Perfilamiento", From: "entraron", To: "se perfilaron"},
	{ID: "selected", Label: "Elección de entidad", From: "se perfilaron", To: "eligieron entidad"},
}

var funnelKinds = []string{"funnel"}

func funnelStage(sig Signal) *FunnelStage {
	id := strings.TrimPrefix(sig, "funnel:")
	for i := range funnelStages {
		if funnelStages[i].ID == id {
			return &funnelStages[i]
		}
	}
	return nil
}

func funnelName(key string) string {
	if st := funnelStage("funnel:" + key); st != nil {
		return "Embudo · " + st.Label
	}
	return "Embudo · " + key
}

// funnel: las tres cuentas del embudo de [from, to), por bloque de 5 minutos.
func (r reader) funnel(from, to time.Time, f Fresh) error {
	a, b := from.Format(stamp), to.Format(stamp)
	q := fmt.Sprintf(`SELECT s, DATE(t) AS d, HOUR(t) AS h, FLOOR(MINUTE(t) / 5) AS q, COUNT(DISTINCT u) AS n FROM (
  SELECT 'entered' AS s, created_at AS t, id AS u FROM user_requests WHERE created_at >= '%[1]s' AND created_at < '%[2]s'
  UNION ALL SELECT 'profiled', p.created_at, p.user_request_id FROM profiling_reviews p WHERE p.created_at >= '%[1]s' AND p.created_at < '%[2]s'
    AND NOT EXISTS (SELECT 1 FROM profiling_reviews o WHERE o.user_request_id = p.user_request_id AND o.created_at < p.created_at)
  UNION ALL SELECT 'selected', r.created_at, r.user_request_id FROM user_request_records r
    WHERE r.user_request_status_id = 3 AND r.created_at >= '%[1]s' AND r.created_at < '%[2]s'
    AND NOT EXISTS (SELECT 1 FROM user_request_records o WHERE o.user_request_id = r.user_request_id AND o.user_request_status_id = 3 AND o.created_at < r.created_at)
) x GROUP BY 1, 2, 3, 4`, a, b)
	rows, err := r.rows(q)
	if err != nil {
		return err
	}
	for _, row := range rows {
		date, bk, n := dayOf(row["d"]), num(row["h"])*12+num(row["q"]), num(row["n"])
		switch str(row["s"]) {
		case "entered":
			f.add(date, "funnel:profiled", "approved", bk, n)
		case "profiled":
			f.add(date, "funnel:profiled", "total", bk, n)
			f.add(date, "funnel:selected", "approved", bk, n)
		case "selected":
			f.add(date, "funnel:selected", "total", bk, n)
		}
	}
	return nil
}

// profilingReads: lo que sale de los perfilamientos (el rechazo de CreditopX y el embudo), en una lectura.
func (r reader) profilingReads(from, to time.Time, f Fresh) error {
	if err := r.rejections(from, to, f); err != nil {
		return err
	}
	return r.funnel(from, to, f)
}

// FunnelEval: una conversión del embudo en la ventana, contra la de siempre a esa hora.
type FunnelEval struct {
	From     int     `json:"from"`    // los de la etapa de antes
	Reached  int     `json:"reached"` // los que llegaron
	Rate     float64 `json:"rate"`
	BaseRate float64 `json:"baseRate"`
	FromText string  `json:"fromText"`
	ToText   string  `json:"toText"`
}

// funnelMinFrom: con menos de tantos en la etapa de antes, cualquier proporción es azar.
const funnelMinFrom = 30

// evalFunnel: lo malo es que la conversión CAIGA. Prueba binomial como las pantallas: alerta con z ≤ −4,5 y la
// conversión ≤ 60 % de la de siempre; para mirar con z ≤ −3 y ≤ 75 %. Si cae lo que ENTRA, la conversión no cambia:
// eso lo dice `all:production`. Esto dice que entran y se quedan.
func (e evaluator) evalFunnel(sig Signal, se *series, t time.Time) Eval {
	var ev Eval
	st := funnelStage(sig)
	minutes := e.rules.WindowMinutes
	for _, m := range append([]int{minutes}, e.rules.FollowedWindows...) {
		minutes = m
		if window(se.approved, t, m) >= funnelMinFrom {
			break
		}
	}
	ev.Minutes = minutes
	o := &FunnelEval{From: window(se.approved, t, minutes), Reached: window(se.total, t, minutes)}
	if st != nil {
		o.FromText, o.ToText = st.From, st.To
	}
	ev.Funnel, ev.Now = o, o.Reached
	var rates []float64
	for _, past := range comparable(t, e.rules.BaselineDays, e.have) {
		from, reached := window(se.approved, past, minutes), window(se.total, past, minutes)
		ev.Samples = append(ev.Samples, float64(reached))
		ev.Dates = append(ev.Dates, past.Format("2006-01-02"))
		if from >= 10 {
			rates = append(rates, math.Min(1, float64(reached)/float64(from)))
		}
	}
	ev.Median = median(ev.Samples)
	if o.From > 0 {
		o.Rate = math.Min(1, float64(o.Reached)/float64(o.From))
	}
	o.BaseRate = median(rates)
	label := sig
	if st != nil {
		label = st.Label
	}
	switch {
	case o.From < funnelMinFrom:
		ev.Level = levelQuiet
		ev.Why = fmt.Sprintf("%s: %d %s en %s, poco para comparar", label, o.From, o.FromText, span(minutes))
		return ev
	case len(rates) < e.rules.MinSamples || o.BaseRate <= 0:
		ev.Level = levelQuiet
		ev.Why = fmt.Sprintf("%s: poca historia para comparar (%d días)", label, len(rates))
		return ev
	}
	exp := float64(o.From) * o.BaseRate
	ev.Z = (float64(o.Reached) - exp) / math.Sqrt(math.Max(exp*(1-o.BaseRate), 1))
	switch {
	case ev.Z <= -4.5 && o.Rate <= 0.6*o.BaseRate:
		ev.Level = levelAlert
	case ev.Z <= -3 && o.Rate <= 0.75*o.BaseRate:
		ev.Level = levelWarn
	default:
		ev.Level = levelOK
	}
	ev.Why = fmt.Sprintf("%s: de %d que %s en %s, %d %s (%s); lo normal, %s", label, o.From, o.FromText, span(minutes),
		o.Reached, o.ToText, pctText(o.Rate), pctText(o.BaseRate))
	return ev
}
