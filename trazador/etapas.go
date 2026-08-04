// etapas.go — el TRAZADOR propiamente: hasta dónde llegó una solicitud y por qué se rompió.
//
// EL MODELO DE ETAPAS NO ES NUEVO. Sale del diseño que ya existía en `playground/soporte/`, borrado el
// 2026-07-22 y recuperable con `git show 3a01e53^:soporte/docs/ARQUITECTURA-TRACING.md`. De ahí vienen las
// siete etapas, los enums (`ok|warn|fail|skip`, `aprobado|roto|abandonado`) y —lo más importante— la
// **provenance por dato**: cada etapa dice de qué fuente salió, para que quien lee sepa cuánto confiar.
//
// LA REGLA QUE ORDENA TODO: la BD dice QUÉ pasó, los logs dicen POR QUÉ.
//   · La BD es un HECHO: una transición de estado ocurrió o no ocurrió, y punto.
//   · Un log AUSENTE no prueba nada — tiene cuatro causas indistinguibles (no se logueó · el level lo
//     filtró · el batch no hizo flush · lag de ingesta). Por eso los logs nunca marcan una etapa como
//     fallida: solo la explican. Si una etapa no tiene esqueleto en la BD, se marca `sin evidencia`, que
//     es distinto de `no ocurrió`.
//
// LA BD TAMBIÉN ANCLA LA CONSULTA, y esto es lo que la vuelve mejor que Loki solo (medido el 2026-08-04
// sobre la solicitud 464618, 295 líneas):
//   · anclando solo por el número de solicitud → 36 líneas (`user_request_id` + `user_request.id`)
//   · sumando el `user_id` que da la BD        → 50 líneas más (`user_id` + `user.id`), o sea 2,4×
//   Y más anclas no es solo más líneas: cada ancla nueva puede revelar un `trace_id` desconocido, y ahí
//   se expande a la petición completa.
//   El `user_id` solo es ambiguo (1,69 solicitudes por usuario en promedio, 228 el peor caso), así que
//   se usa SIEMPRE acotado a la ventana temporal que da el historial de estados. Preciso y amplio a la vez.
//
// LO QUE LA BD NO PUEDE DAR (verificado contra el dump local, no supuesto):
//   · `listado` — `displayed_lenders` es de lenders-v2 y no existe acá; para rt=1 vive en DynamoDB, que
//     se consulta por el pre-approvals-service.
//   · `cupo` (rt=2) — el diseño dice que NO se persiste la razón fina, a propósito.
//   Esas dos etapas se arman desde Loki, que sí las tiene (`Iniciando listado de entidades`,
//   `Evaluando reglas para entidad`, `QUOTA_CHECK_START`). Ahí Loki no es complemento: es la única fuente.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.

package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// ─── etapas ─────────────────────────────────────────────────────────────────────────────────────────

// Etapa es un paso del flujo, en el orden en que el cliente lo recorre.
type Etapa struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"` // ok | warn | fail | skip | sin-evidencia
	Detail string `json:"detail,omitempty"`
	Reason string `json:"reason,omitempty"` // el POR QUÉ; casi siempre de Loki
	Source string `json:"source"`           // db | loki | dynamodb | reeval | —
	At     string `json:"at,omitempty"`
	Lineas int    `json:"lineas,omitempty"` // cuántas líneas de log respaldan esta etapa
}

// orden es la secuencia canónica. `origen` es un agregado del pedido de Miguel: no es una etapa del
// backend sino de dónde entró el cliente, y hoy NO está en los logs — se deduce de la BD (canal/comercio).
var orden = []struct{ id, label string }{
	{"origen", "Origen"},
	{"registro", "Registro y OTP"},
	{"formulario", "Formulario de perfil"},
	{"buro", "Consulta a burós"},
	{"listado", "Listado de entidades"},
	{"seleccion", "Selección de entidad"},
	{"cupo", "Cupo / POS"},
	{"desembolso", "Desembolso"},
}

// estadoEtapa mapea cada estado de `user_request_statuses` a la etapa que prueba. Los estados que no
// están acá no mueven ninguna etapa (o son desenlaces, ver `malos`).
var estadoEtapa = map[int]string{
	1: "registro", 2: "registro",
	9:  "formulario",
	3:  "seleccion",
	10: "desembolso", // pendiente de autorización: ya está en el tramo final
	11: "desembolso", 28: "desembolso", 5: "desembolso",
	25: "desembolso", 26: "desembolso", // canal QR: sella en 25 y factura en 26
}

// malos son los desenlaces de muerte: llegar acá sin pedirlo es el fallo, no un matiz. Mismo criterio que
// `harness/pkg/trace.ts` para que "roto" signifique lo mismo en las dos herramientas.
var malos = map[int]string{
	6: "Negada", 8: "Cancelado", 12: "Autorización negada",
	24: "Rechazado por validación de identidad",
}

// sellados = llegó al final. 25 es el sello del canal QR (nunca pasa por 11).
var sellados = map[int]bool{11: true, 28: true, 5: true, 25: true, 26: true}

// patrones dice qué mensajes de log pertenecen a cada etapa. Salieron de MEDIR los logs reales de dev y
// prod, no de suponer: son los mensajes que el backend escribe de verdad hoy.
var patrones = map[string]*regexp.Regexp{
	"registro":   regexp.MustCompile(`(?i)RegisterCellPhone|sendOtpCode|validateOtpCode|OtpService|getOrCreateUser`),
	"formulario": regexp.MustCompile(`(?i)storePersonalInfo|storeLaboralInformation|storeSocialStratum|validateAndStorePersonalInfo|isForm\d+Completed`),
	"buro":       regexp.MustCompile(`(?i)Experian|datacredito|risk.?central|RiskV2|CheckIfAbleToOmit`),
	"listado":    regexp.MustCompile(`(?i)listado de entidades|reglas para entidad|CATEGORY_|RULE_|perfilamiento|lenderService`),
	"seleccion":  regexp.MustCompile(`(?i)update-?user-?request|updateUserRequest|Seleccion`),
	"cupo":       regexp.MustCompile(`(?i)QUOTA_|cupo|quota|PAYMENT_CAPACITY`),
	"desembolso": regexp.MustCompile(`(?i)authorize|promissory|disburse|desembolso|facturaci|CreditopXFlow`),
}

// ─── la solicitud según la BD ───────────────────────────────────────────────────────────────────────

// Solicitud es el esqueleto: lo que la BD afirma. Nada de acá se infiere de logs.
type Solicitud struct {
	ID        int64
	UserID    int64
	Documento string
	Estado    int
	EstadoN   string
	Lender    string
	LenderRT  int
	Comercio  string
	Sucursal  string
	// `Canal` es en realidad el flow_id: `user_requests` NO tiene columna de canal. El origen
	// (asesor / QR / ecommerce) hay que derivarlo, y hoy tampoco está en los logs — es el hueco del
	// nivel `[origen]` del modelo de etapas.
	Canal  string
	Monto  float64
	Creada time.Time
	// Transiciones ya colapsadas: `user_request_records` repite el mismo estado muchas veces (una fila
	// por cada toque), así que sin colapsar el "historial" miente sobre cuántas veces avanzó el flujo.
	Transiciones []Transicion
	Buro         []FilaBuro
}

type Transicion struct {
	Estado int
	Nombre string
	At     time.Time
}

type FilaBuro struct {
	Central string
	Score   *float64
	At      time.Time
}

func abrirBD(c config) (*sql.DB, error) {
	if c.dbHost == "" {
		return nil, fmt.Errorf("sin BD configurada para este target (DB_HOST vacío)")
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&timeout=10s&readTimeout=30s",
		c.dbUser, c.dbPass, c.dbHost, c.dbPort, c.dbName)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	return db, db.Ping()
}

// leerSolicitud trae el esqueleto. Todo con SELECT: el trazador NUNCA escribe — es de soporte, y una
// herramienta de soporte que puede escribir es una herramienta que algún día escribe.
func leerSolicitud(db *sql.DB, ureq int64) (*Solicitud, error) {
	s := &Solicitud{ID: ureq}
	var lender, comercio, sucursal, canal, doc sql.NullString
	var rt sql.NullInt64
	var monto sql.NullFloat64
	err := db.QueryRow(`
		SELECT ur.user_id, ur.user_request_status_id, COALESCE(st.name,''),
		       l.name, l.response_type, a.name, ab.name, CAST(ur.flow_id AS CHAR), u.document_number,
		       ur.amount, ur.created_at
		  FROM user_requests ur
		  LEFT JOIN user_request_statuses st ON st.id = ur.user_request_status_id
		  LEFT JOIN lenders l               ON l.id  = ur.lender_id
		  LEFT JOIN allied_branches ab      ON ab.id = ur.allied_branch_id
		  LEFT JOIN allieds a               ON a.id  = ab.allied_id
		  LEFT JOIN users u                 ON u.id  = ur.user_id
		 WHERE ur.id = ?`, ureq).
		Scan(&s.UserID, &s.Estado, &s.EstadoN, &lender, &rt, &comercio, &sucursal, &canal, &doc, &monto, &s.Creada)
	if err != nil {
		return nil, err
	}
	s.Lender, s.Comercio, s.Sucursal, s.Canal, s.Documento = lender.String, comercio.String, sucursal.String, canal.String, doc.String
	s.LenderRT, s.Monto = int(rt.Int64), monto.Float64

	// Historial, colapsando estados consecutivos repetidos.
	rows, err := db.Query(`
		SELECT r.user_request_status_id, COALESCE(st.name,''), r.created_at
		  FROM user_request_records r
		  LEFT JOIN user_request_statuses st ON st.id = r.user_request_status_id
		 WHERE r.user_request_id = ? ORDER BY r.created_at, r.id`, ureq)
	if err == nil {
		defer rows.Close()
		prev := -1
		for rows.Next() {
			var t Transicion
			if rows.Scan(&t.Estado, &t.Nombre, &t.At) == nil && t.Estado != prev {
				s.Transiciones = append(s.Transiciones, t)
				prev = t.Estado
			}
		}
	}

	// Burós: la tabla se indexa por `user_id`, NO por solicitud — así que una consulta de buró puede ser
	// de otro intento del mismo cliente. Se acota a partir de la creación de esta solicitud.
	brows, err := db.Query(`
		SELECT COALESCE(rc.name, CONCAT('central ', d.risk_central_id)), d.score, d.created_at
		  FROM risk_central_user_data d
		  LEFT JOIN risk_centrals rc ON rc.id = d.risk_central_id
		 WHERE d.user_id = ? AND d.deleted_at IS NULL AND d.created_at >= ?
		 ORDER BY d.created_at`, s.UserID, s.Creada.Add(-5*time.Minute))
	if err == nil {
		defer brows.Close()
		for brows.Next() {
			var f FilaBuro
			var sc sql.NullFloat64
			if brows.Scan(&f.Central, &sc, &f.At) == nil {
				if sc.Valid {
					v := sc.Float64
					f.Score = &v
				}
				s.Buro = append(s.Buro, f)
			}
		}
	}
	return s, nil
}

// ventana es el rango de tiempo de esta solicitud, y es lo que hace SEGURO anclar por `user_id`. Sin
// esto, buscar por usuario traería sus otras solicitudes mezcladas.
func (s *Solicitud) ventana() (time.Time, time.Time) {
	desde, hasta := s.Creada, s.Creada
	for _, t := range s.Transiciones {
		if t.At.After(hasta) {
			hasta = t.At
		}
		if t.At.Before(desde) {
			desde = t.At
		}
	}
	for _, b := range s.Buro {
		if b.At.After(hasta) {
			hasta = b.At
		}
	}
	// Colchón: el log de una petición puede caer fuera del instante en que se grabó el estado.
	return desde.Add(-10 * time.Minute), hasta.Add(30 * time.Minute)
}

// ─── ensamblado ─────────────────────────────────────────────────────────────────────────────────────

// Traza es lo que se imprime o se devuelve como JSON. El shape sigue al diseño recuperado para que un
// front pueda consumirlo sin traducir.
type Traza struct {
	UReq     int64    `json:"ureq"`
	Target   string   `json:"target"`
	Outcome  string   `json:"outcome"` // aprobado | roto | abandonado | en-curso
	BrokeAt  string   `json:"brokeAt,omitempty"`
	Etapas   []Etapa  `json:"etapas"`
	Sources  []string `json:"sources"`
	Warnings []string `json:"warnings,omitempty"`
}

// ensamblar arma la traza: primero el esqueleto de la BD (hechos), después el porqué de los logs.
func ensamblar(s *Solicitud, lineas []Linea, target string) Traza {
	t := Traza{UReq: s.ID, Target: target, Sources: []string{"db"}}
	if len(lineas) > 0 {
		t.Sources = append(t.Sources, "loki")
	}

	// Qué etapas prueba la BD, y cuándo.
	visto := map[string]time.Time{}
	for _, tr := range s.Transiciones {
		if e, ok := estadoEtapa[tr.Estado]; ok {
			if _, ya := visto[e]; !ya {
				visto[e] = tr.At
			}
		}
	}
	if len(s.Buro) > 0 {
		visto["buro"] = s.Buro[0].At
	}
	// `origen` lo prueba la existencia misma de la solicitud: alguien la creó por algún canal.
	visto["origen"] = s.Creada

	// El desenlace sale SOLO de la BD.
	switch {
	case sellados[s.Estado]:
		t.Outcome = "aprobado"
	case malos[s.Estado] != "":
		t.Outcome = "roto"
	case s.Estado == 7:
		t.Outcome = "abandonado"
	default:
		t.Outcome = "en-curso"
	}

	// Las líneas de log, repartidas por etapa.
	porEtapa := map[string][]Linea{}
	for _, l := range lineas {
		for id, re := range patrones {
			if re.MatchString(l.msg) {
				porEtapa[id] = append(porEtapa[id], l)
				break
			}
		}
	}

	for _, o := range orden {
		e := Etapa{ID: o.id, Label: o.label, Source: "—", Status: "skip"}
		ls := porEtapa[o.id]
		e.Lineas = len(ls)

		if at, ok := visto[o.id]; ok {
			e.Status, e.Source, e.At = "ok", "db", at.Format("15:04:05")
		} else if len(ls) > 0 {
			// Sin respaldo en la BD pero con logs: la etapa OCURRIÓ (los logs son evidencia positiva),
			// solo que la BD no la registra. Es el caso de `listado` y `cupo`, por diseño.
			e.Status, e.Source, e.Source = "ok", "loki", "loki"
			e.At = time.UnixMilli(ls[0].ts).Format("15:04:05")
		} else if o.id == "listado" || o.id == "cupo" {
			// Estas dos NO tienen esqueleto posible: decir "no ocurrió" sería mentir.
			e.Status, e.Detail = "sin-evidencia", "la BD no registra esta etapa (rt=2 no persiste; rt=1 vive en DynamoDB)"
		}

		// El porqué: el primer error de la etapa. Nunca cambia el status a fail por sí solo — eso lo
		// decide la BD. Un error logueado puede ser un reintento que después salió bien.
		for _, l := range ls {
			if l.level == "error" {
				if c := pick(l.ctx, []string{"error_code"}); c != "" {
					e.Reason = c
					if sub := pick(l.ctx, []string{"error_subcode", "subcode"}); sub != "" {
						e.Reason += "/" + sub
					}
					e.Reason += " · " + trim(l.msg, 90)
				} else {
					e.Reason = trim(l.msg, 110)
				}
				if e.Status == "ok" {
					e.Status = "warn" // pasó, pero con ruido: hay que mirarlo
				}
				break
			}
		}
		t.Etapas = append(t.Etapas, e)
	}

	// La etapa donde se rompió: la primera sin ok después de la última que sí ocurrió.
	if t.Outcome == "roto" || t.Outcome == "abandonado" {
		for _, e := range t.Etapas {
			if e.Status == "ok" || e.Status == "warn" {
				continue
			}
			t.BrokeAt = e.ID
			break
		}
	}
	if malos[s.Estado] != "" {
		t.Warnings = append(t.Warnings, fmt.Sprintf("desenlace de muerte en BD: estado %d «%s»", s.Estado, s.EstadoN))
	}
	if len(lineas) == 0 {
		t.Warnings = append(t.Warnings, "sin líneas de log: el porqué no se pudo enriquecer (¿fuera de retención? ¿backend sin instrumentar?)")
	}
	sort.Strings(t.Sources)
	return t
}

// ─── render tipo «checks» ───────────────────────────────────────────────────────────────────────────

func imprimirTraza(t Traza, s *Solicitud) {
	icono := map[string]string{
		"ok": paint("32", "✔"), "warn": paint("33", "!"), "fail": paint("31", "✘"),
		"skip": gray("·"), "sin-evidencia": paint("33", "?"),
	}
	fmt.Println()
	fmt.Printf("  %s\n", bold(fmt.Sprintf("── TRAZA · uReq %d · %s ──", t.UReq, t.Target)))
	fmt.Printf("     %s · %s%s · monto %s\n",
		orDash(s.Comercio), orDash(s.Sucursal),
		func() string {
			if s.Lender != "" {
				return fmt.Sprintf(" · %s (rt=%d)", s.Lender, s.LenderRT)
			}
			return ""
		}(),
		fmt.Sprintf("%.0f", s.Monto))

	res := map[string]string{"aprobado": green("aprobado"), "roto": red("roto"),
		"abandonado": paint("33", "abandonado"), "en-curso": gray("en curso")}[t.Outcome]
	fmt.Printf("     estado %d «%s» → %s%s\n", s.Estado, s.EstadoN, res,
		func() string {
			if t.BrokeAt != "" {
				return red(" · se rompió en «" + t.BrokeAt + "»")
			}
			return ""
		}())
	fmt.Println()

	for _, e := range t.Etapas {
		fuente := gray("")
		switch e.Source {
		case "db":
			fuente = gray("[BD]")
		case "loki":
			fuente = gray("[logs]")
		default:
			fuente = gray("[—]")
		}
		linea := fmt.Sprintf("     %s %-22s %-7s %s", icono[e.Status], e.Label, e.At, fuente)
		if e.Lineas > 0 {
			linea += gray(fmt.Sprintf(" %d líneas", e.Lineas))
		}
		fmt.Println(linea)
		if e.Detail != "" {
			fmt.Printf("          %s\n", gray(e.Detail))
		}
		if e.Reason != "" {
			fmt.Printf("          %s %s\n", red("→"), e.Reason)
		}
	}

	fmt.Println()
	fmt.Printf("     %s %s\n", gray("fuentes:"), strings.Join(t.Sources, " + "))
	for _, w := range t.Warnings {
		fmt.Printf("     %s %s\n", paint("33", "⚠"), w)
	}
	fmt.Printf("     %s\n", gray("la BD dice QUÉ pasó · los logs dicen POR QUÉ · «?» = la BD no registra esa etapa"))
}

func green(s string) string { return paint("32", s) }
func red(s string) string   { return paint("31", s) }

// ─── traer los logs de ESTA solicitud ───────────────────────────────────────────────────────────────

// Linea es una línea de log ya parseada.
type Linea struct {
	ts    int64
	level string
	msg   string
	ctx   map[string]any
}

// traerLineas hace el join de dos fases, pero ANCLADO POR LA BD — que es la mejora sobre buscar solo por
// el número de solicitud:
//
//	fase 1  anclas: se buscan las líneas que traigan el uReq **o el user_id** (que solo la BD conoce),
//	        acotadas a la ventana de la solicitud. El user_id aparece en más líneas (50 vs 36 en la
//	        medición) pero es ambiguo por sí solo; la ventana de la BD es lo que lo vuelve seguro.
//	fase 2  expansión: cada `trace_id` descubierto se trae completo, que es una búsqueda indexada.
func traerLineas(cl *client, s *Solicitud, envFiltro string) ([]Linea, []string) {
	desde, hasta := s.ventana()
	var notas []string

	sel := `{service_name=~".+"}`
	if envFiltro != "" {
		sel = fmt.Sprintf(`{environment=~"%s"}`, envFiltro)
	}

	// Se buscan los dos identificadores por separado: Loki filtra por substring, así que un solo `|=`
	// con los dos no existe. Dos consultas chicas son más baratas que traer todo y filtrar acá.
	traces := map[string]bool{}
	anclas := map[string]int{}
	var crudas []Linea
	for _, ancla := range []struct{ valor, campos string }{
		{fmt.Sprint(s.ID), "user_request_id"},
		{fmt.Sprint(s.UserID), "user_id"},
	} {
		if ancla.valor == "" || ancla.valor == "0" {
			continue
		}
		ls, tr, err := lineasYTraces(cl, fmt.Sprintf(`%s |= "%s"`, sel, ancla.valor), desde, hasta, ancla.valor)
		if err != nil {
			notas = append(notas, fmt.Sprintf("la búsqueda por %s falló: %v", ancla.campos, err))
			continue
		}
		crudas = append(crudas, ls...)
		anclas[ancla.campos] = len(ls)
		for t := range tr {
			traces[t] = true
		}
	}

	if len(traces) == 0 {
		if len(crudas) > 0 {
			notas = append(notas, fmt.Sprintf("%d líneas ancladas pero SIN trace_id: no se pudo expandir a la petición completa (falta Tempo/OTel en ese backend)", len(crudas)))
			return crudas, notas
		}
		notas = append(notas, "ninguna línea nombra esta solicitud ni su usuario en la ventana")
		return nil, notas
	}

	ids := make([]string, 0, len(traces))
	for t := range traces {
		ids = append(ids, t)
	}
	sort.Strings(ids)
	todas, _, err := lineasYTraces(cl, fmt.Sprintf(`{trace_id=~"%s"}`, strings.Join(ids, "|")), desde, hasta, "")
	if err != nil {
		notas = append(notas, fmt.Sprintf("la expansión por trace_id falló: %v", err))
		return crudas, notas
	}
	partes := make([]string, 0, len(anclas))
	for k, n := range anclas {
		partes = append(partes, fmt.Sprintf("%s→%d", k, n))
	}
	sort.Strings(partes)
	notas = append(notas, fmt.Sprintf("anclas %s · %d traces → %d líneas", strings.Join(partes, " "), len(ids), len(todas)))
	return todas, notas
}

// lineasYTraces corre una consulta y devuelve las líneas + los trace_id vistos. `valorAncla` no vacío
// exige que el valor aparezca como VALOR de un campo del context: sin eso, un documento o un monto que
// contenga los mismos dígitos anclaría la solicitud de otra persona.
func lineasYTraces(cl *client, logql string, desde, hasta time.Time, valorAncla string) ([]Linea, map[string]bool, error) {
	params := url.Values{
		"query":     {logql},
		"start":     {fmt.Sprint(desde.UnixNano())},
		"end":       {fmt.Sprint(hasta.UnixNano())},
		"limit":     {"5000"},
		"direction": {"forward"},
	}
	status, body, err := cl.get("/loki/api/v1/query_range", params)
	if err != nil {
		return nil, nil, err
	}
	if status != 200 {
		return nil, nil, fmt.Errorf("%s", explain(status, body))
	}
	var qr queryResp
	if json.Unmarshal(body, &qr) != nil {
		return nil, nil, fmt.Errorf("respuesta no parseable")
	}
	traces := map[string]bool{}
	var out []Linea
	for _, st := range qr.Data.Result {
		for _, v := range st.Values {
			var obj struct {
				Message string          `json:"message"`
				Context json.RawMessage `json:"context"`
			}
			l := Linea{level: st.Stream["level"], msg: v[1], ctx: map[string]any{}}
			if json.Unmarshal([]byte(v[1]), &obj) == nil {
				if obj.Message != "" {
					l.msg = obj.Message
				}
				var m map[string]any
				if json.Unmarshal(obj.Context, &m) == nil {
					l.ctx = m
				}
			}
			var ns int64
			fmt.Sscanf(v[0], "%d", &ns)
			l.ts = ns / 1e6
			if valorAncla != "" {
				hit := false
				for _, vv := range l.ctx {
					if fmt.Sprint(vv) == valorAncla {
						hit = true
						break
					}
				}
				if !hit {
					continue
				}
			}
			if t := st.Stream["trace_id"]; t != "" {
				traces[t] = true
			}
			out = append(out, l)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ts < out[j].ts })
	return out, traces, nil
}

// pick saca el primer valor no vacío de una lista de claves del context.
func pick(ctx map[string]any, keys []string) string {
	for _, k := range keys {
		if v, ok := ctx[k]; ok && v != nil && fmt.Sprint(v) != "" {
			return fmt.Sprint(v)
		}
	}
	return ""
}

func gray(s string) string { return paint("90", s) }

// ─── modo traza ─────────────────────────────────────────────────────────────────────────────────────

// modoTraza es la entrada del trazador cuando se pide una solicitud. Devuelve el exit code:
//
//	0  se pudo trazar
//	2  no concluyente (sin BD para este target, o la solicitud no existe)
//
// Nunca 1: como el forense del harness, esto EXPLICA — no dictamina que algo esté mal.
func modoTraza(c config, target string, ureq int64, jsonOut bool) int {
	db, err := abrirBD(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s no puedo armar la traza para target «%s»: %v\n", paint("31", "✘"), target, err)
		fmt.Fprintf(os.Stderr, "  La BD es el esqueleto: sin ella solo habría logs, y un log ausente no prueba nada.\n")
		fmt.Fprintf(os.Stderr, "  (prod todavía no tiene réplica de lectura — es el próximo pedido)\n\n")
		return 2
	}
	defer db.Close()

	s, err := leerSolicitud(db, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s la solicitud %d no está en la BD de «%s»: %v\n\n", paint("31", "✘"), ureq, target, err)
		return 2
	}

	// Los logs son el segundo paso y son OPCIONALES: si Loki no responde, la traza sale igual con el
	// esqueleto. Al revés no funciona — de ahí el orden.
	var lineas []Linea
	var notas []string
	if no := porQueNoLoki(c); no != "" {
		notas = append(notas, "sin logs: "+no)
	} else {
		cl := &client{http: &http.Client{Timeout: 60 * time.Second}, cfg: c,
			current: attempt{base: c.base, auth: authDe(c)}}
		lineas, notas = traerLineas(cl, s, c.env)
	}

	t := ensamblar(s, lineas, target)
	t.Warnings = append(t.Warnings, notas...)

	if jsonOut {
		b, _ := json.MarshalIndent(t, "", "  ")
		fmt.Println(string(b))
		return 0
	}
	imprimirTraza(t, s)
	return 0
}

// porQueNoLoki es la versión corta de `porQueNo` para el modo traza: acá Loki es opcional, así que un
// "no se puede" es una nota, no un error.
func porQueNoLoki(c config) string {
	if c.base == "" {
		return "falta LOKI_URL"
	}
	if !esLokiLocal(c.base) && (c.user == "" || c.token == "") {
		return "faltan LOKI_USER/LOKI_TOKEN"
	}
	return ""
}

// authDe elige la forma de autenticar: un Loki local no pide nada, Grafana Cloud exige el par
// `<ID de instancia>:<token>` (un Bearer pelado lo rechaza con `legacy auth cannot be upgraded`).
func authDe(c config) string {
	if c.user != "" {
		return "basic:" + c.user
	}
	return "bearer"
}

// esLokiLocal — un Loki de esta máquina no pide credenciales.
func esLokiLocal(u string) bool {
	return regexp.MustCompile(`(^|//)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:|/|$)`).MatchString(strings.TrimSpace(u))
}
