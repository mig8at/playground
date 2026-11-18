package main

// EL RECHAZO DE CREDITOPX POR ENTIDAD: de lo que la plataforma le ofreció al cliente en cada perfilamiento, cuánto salió
// «Rechazado». Sale de `profiling_reviews.displayed_lenders` (cada entidad con su `probability`), sólo para las entidades
// CreditopX (`lenders.response_type` 2 y 3). Es lo que hace el embudo de CreditopX de forecast (el panel comercial del
// repo compartido), llevado a una señal.
//
// Por qué existe. Sentinel cuenta cuántas solicitudes entran y cuántas se aprueban o se niegan, pero no ve si una
// política o el perfilador empiezan a rechazar más con el MISMO tráfico: la falla más cara del dominio. Medido el
// 2026-11-18: el rechazo de CreditopX venía en 14–16 % a comienzos de noviembre y pasó a 20–25 % desde el 13, en varias
// entidades a la vez, con el volumen igual; ninguna señal de Sentinel lo mostraba.
//
// Señales `reject:<entidad>` y `reject:all`. En lo guardado, por bloque de 5 minutos (por la hora del perfilamiento):
//
//	Total     las ofertas (la entidad apareció en lo que vio el cliente)
//	Approved  las que no salieron rechazadas
//	Denied    las rechazadas
//
// ⚠ Son perfilamientos, no personas: una persona que vuelve a perfilarse cuenta dos veces. Y un perfilamiento que se
// reescribe después (lender-listing en knowledge) cuenta con su última versión.
//
// Lo malo es que la TASA suba contra la de siempre a esa hora: una prueba binomial, como los proveedores (outbound.go),
// con un mínimo de ofertas y de rechazos para hablar y un piso en puntos porcentuales (el rechazo normal va de 10 a 40 %
// según la entidad: un ×1,5 sobre 30 % es mucho más que sobre 10 %).
//
// LOS CAMBIOS DE POLÍTICA (`lender_rules_snapshots`: cada versión de las reglas de una entidad, con su hora) son la otra
// mitad: se marcan como los despliegues, y el porqué de una señal de rechazo nombra el cambio de política de su entidad
// de las horas anteriores.

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"
)

// rejectVersion: con qué versión de esta lectura se guardó un día (`Day.Rej`). Menor: se vuelve a pedir.
const rejectVersion = 3 // 2: con el embudo (funnel.go), que sale de la misma lectura · 3: el embudo, la primera vez de cada solicitud

var rejectKinds = []string{"reject", "funnel"} // lo que guarda profilingReads

// Lo mínimo para hablar del rechazo de una entidad: con menos ofertas o rechazos, cualquier tasa es azar.
const (
	rejectMinOffers  = 30
	rejectMinRejects = 10
	// rejectAlertOffers: para ALERTA (la que manda aviso), además, al menos tantas ofertas en la ventana. Con 30, la
	// semana del 11 al 18/11/2026 daba 11 alertas, casi todas de madrugada con 34 a 46 ofertas; con poco volumen queda
	// «para mirar».
	rejectAlertOffers = 100
	// rejectPolicyHours: cuántas horas después de un cambio de política se lo nombra en el porqué de su entidad. Una
	// política nueva se nota con las solicitudes que entran después, que a veces tardan.
	rejectPolicyHours = 24
)

// rejections: las ofertas y los rechazos de las entidades CreditopX de [from, to), por bloque de 5 minutos.
func (r reader) rejections(from, to time.Time, f Fresh) error {
	q := fmt.Sprintf(`SELECT d.lender_id AS l, DATE(pr.created_at) AS d, HOUR(pr.created_at) AS h, FLOOR(MINUTE(pr.created_at) / 5) AS q,
  COUNT(*) AS n, SUM(d.probability = 'Rechazado') AS rej
FROM profiling_reviews pr
JOIN JSON_TABLE(pr.displayed_lenders, '$[*]' COLUMNS (lender_id INT PATH '$.id', probability VARCHAR(60) PATH '$.probability')) AS d
JOIN lenders ln ON ln.id = d.lender_id AND ln.response_type IN (2, 3)
WHERE pr.created_at >= '%s' AND pr.created_at < '%s' GROUP BY 1, 2, 3, 4`, from.Format(stamp), to.Format(stamp))
	rows, err := r.rows(q)
	if err != nil {
		return err
	}
	for _, row := range rows {
		date, b := dayOf(row["d"]), num(row["h"])*12+num(row["q"])
		n, rej := num(row["n"]), num(row["rej"])
		for _, sig := range []Signal{"reject:all", fmt.Sprintf("reject:%d", num(row["l"]))} {
			f.add(date, sig, "total", b, n)
			f.add(date, sig, "approved", b, n-rej)
			f.add(date, sig, "denied", b, rej)
		}
	}
	return nil
}

// PolicyChange: una versión nueva de las reglas de una entidad.
type PolicyChange struct {
	LenderID int    `json:"lenderId"`
	Lender   string `json:"lender"`
	Version  int    `json:"version"`
	At       string `json:"at"` // hora de Bogotá, RFC3339
}

// policyChanges: los cambios de política de los últimos `days` días, del más nuevo al más viejo. Sin el autor ni el
// contenido: `state` es un JSON de cientos de KB que no hace falta para marcar una hora.
func (r reader) policyChanges(days int) ([]PolicyChange, error) {
	rows, err := r.rows(fmt.Sprintf(`SELECT s.lender_id AS l, ln.name AS name, s.version AS v, DATE_FORMAT(s.created_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS at
FROM lender_rules_snapshots s JOIN lenders ln ON ln.id = s.lender_id
WHERE s.created_at >= NOW() - INTERVAL %d DAY ORDER BY s.created_at DESC LIMIT 500`, days))
	if err != nil {
		return nil, err
	}
	var list []PolicyChange
	for _, row := range rows {
		t, err := time.ParseInLocation(stamp, str(row["at"]), bogota)
		if err != nil {
			continue
		}
		list = append(list, PolicyChange{LenderID: num(row["l"]), Lender: str(row["name"]), Version: num(row["v"]), At: t.Format(time.RFC3339)})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].At > list[j].At })
	return list, nil
}

// rejectName: «Crédito Directo X LB · rechazo», o «CreditopX · rechazo» para todas.
func rejectName(names map[int]string, key string) string {
	if key == "all" {
		return "CreditopX · rechazo"
	}
	id, _ := strconv.Atoi(key)
	return nameOr(names, id) + " · rechazo"
}

// RejectEval: el rechazo de una entidad en la ventana, contra el de siempre a esa hora.
type RejectEval struct {
	Offers   int     `json:"offers"`
	Rejects  int     `json:"rejects"`
	Rate     float64 `json:"rate"`
	BaseRate float64 `json:"baseRate"` // la mediana de la tasa en los días comparables
	Policy   string  `json:"policy,omitempty"`
}

// policyBefore: el cambio de política más reciente de la entidad de la señal (de cualquiera, para `reject:all`) en las
// `rejectPolicyHours` antes de t.
func (e evaluator) policyBefore(sig Signal, t time.Time) (PolicyChange, bool) {
	key := sig[len("reject:"):]
	id, _ := strconv.Atoi(key)
	for _, p := range e.policies { // del más nuevo al más viejo
		at, err := time.Parse(time.RFC3339, p.At)
		if err != nil || at.After(t) {
			continue
		}
		if t.Sub(at) > rejectPolicyHours*time.Hour {
			break
		}
		if key == "all" || p.LenderID == id {
			return p, true
		}
	}
	return PolicyChange{}, false
}

func (e evaluator) evalReject(sig Signal, se *series, t time.Time) Eval {
	var ev Eval
	minutes := e.rules.WindowMinutes
	// Una entidad de pocas ofertas mira más tiempo, hasta juntar las que hacen falta para hablar.
	for _, m := range append([]int{minutes}, e.rules.FollowedWindows...) {
		minutes = m
		if window(se.total, t, m) >= rejectMinOffers {
			break
		}
	}
	ev.Minutes = minutes
	o := &RejectEval{Offers: window(se.total, t, minutes), Rejects: window(se.denied, t, minutes)}
	ev.Reject, ev.Now = o, o.Offers
	var rates []float64
	for _, past := range comparable(t, e.rules.BaselineDays, e.have) {
		n, r := window(se.total, past, minutes), window(se.denied, past, minutes)
		ev.Samples = append(ev.Samples, float64(n))
		ev.Dates = append(ev.Dates, past.Format("2006-01-02"))
		if n >= 10 {
			rates = append(rates, float64(r)/float64(n))
		}
	}
	ev.Median = median(ev.Samples)
	if o.Offers > 0 {
		o.Rate = float64(o.Rejects) / float64(o.Offers)
	}
	o.BaseRate = median(rates)
	if p, ok := e.policyBefore(sig, t); ok {
		at, _ := time.Parse(time.RFC3339, p.At)
		o.Policy = fmt.Sprintf("cambió la política de %s (versión %d) el %s", p.Lender, p.Version, at.In(bogota).Format("02/01 a las 15:04"))
	}
	switch {
	case o.Offers < rejectMinOffers:
		ev.Level = levelQuiet
		ev.Why = fmt.Sprintf("%d ofertas en %s: poco para comparar", o.Offers, span(minutes))
		return ev
	case len(rates) < e.rules.MinSamples:
		ev.Level = levelQuiet
		ev.Why = fmt.Sprintf("poca historia para comparar (%d días con ofertas)", len(rates))
		return ev
	}
	exp := float64(o.Offers) * o.BaseRate
	ev.Z = (float64(o.Rejects) - exp) / math.Sqrt(math.Max(exp*(1-o.BaseRate), 1))
	// Además del z, que la tasa suba de verdad: en puntos (con 30 % de base, ×1,5 son 15 puntos; con 10 %, 5) y en
	// proporción, para que una entidad de mucho volumen no avise por un punto.
	up := o.Rate - o.BaseRate
	switch {
	case o.Rejects >= rejectMinRejects && o.Offers >= rejectAlertOffers && ev.Z >= 4.5 && up >= 0.10 && o.Rate >= 1.5*o.BaseRate:
		ev.Level = levelAlert
	case o.Rejects >= rejectMinRejects && ev.Z >= 3 && up >= 0.05 && o.Rate >= 1.25*o.BaseRate:
		ev.Level = levelWarn
	default:
		ev.Level = levelOK
	}
	ev.Why = fmt.Sprintf("rechazó %d de %d ofertas en %s (%s); lo normal, %s", o.Rejects, o.Offers, span(minutes), pctText(o.Rate), pctText(o.BaseRate))
	if o.Policy != "" {
		ev.Why += " · " + o.Policy
	}
	return ev
}
