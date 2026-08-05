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
	"strconv"
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
	Subs   []Sub  `json:"subs,omitempty"`   // el detalle de la etapa, como los steps de un job
	// Eventos: las líneas crudas de esta etapa, para el panel de log numerado. Van TOPEADAS y el tope se
	// declara — una etapa puede tener 300 líneas y volcarlas todas convierte la vista en un archivo.
	Eventos   []Evento `json:"eventos,omitempty"`
	EventosDe int      `json:"eventosDe,omitempty"` // cuántas había en total, si se recortó
}

// Evento es una línea de log tal como se leerá en el panel derecho.
type Evento struct {
	At    string `json:"at"`
	Level string `json:"level"`
	Msg   string `json:"msg"`
}

// Sub es un paso DENTRO de una etapa — lo que en un Action serían los steps de un job. Hoy salen de dos
// lugares medidos: las entidades evaluadas (una por lender, con su regla y veredicto) y las fallas
// deduplicadas por código. Ambos vienen de los logs, así que llevan su fuente.
type Sub struct {
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
	Source string `json:"source"`
	// Detail2 es de uso interno (el lender_id, para poder agrupar por familia después). No se serializa.
	Detail2 string `json:"-"`
	// Hijos permite DOS niveles: familia → entidad en `listado`, y nada más. Más profundidad no aporta y
	// vuelve el árbol ilegible, que es justo lo contrario de para qué existe.
	Hijos []Sub `json:"hijos,omitempty"`
}

// orden es la secuencia canónica. `origen` es un agregado del pedido de Miguel: no es una etapa del
// backend sino de dónde entró el cliente, y hoy NO está en los logs — se deduce de la BD (canal/comercio).
var orden = []struct{ id, label string }{
	{"origen", "Origen"},
	{"registro", "Registro y OTP"},
	{"formulario", "Formulario de perfil"},
	{"buro", "Consulta a burós"},
	{"cupo", "Cupo / POS"},
	{"listado", "Listado de entidades"},
	{"seleccion", "Selección de entidad"},
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

// LOS PATRONES YA NO VIVEN ACÁ. Están declarados en `mapa/etapas.json` y los resuelve `mapa.go`.
//
// ⚠ POR QUÉ SE MOVIERON, y no fue por prolijidad: la versión anterior era un `map[string]*regexp.Regexp`
// que se iteraba con `range` y cortaba en el primer match. **El orden de iteración de un map en Go es
// aleatorio**, así que un mensaje que matcheara dos etapas caía en una etapa DISTINTA en cada corrida —
// el trazador daba respuestas diferentes para los mismos datos, sin que nada avisara. `Mapa.EtapaDe`
// recorre un slice ordenado por el campo `orden`, así que es determinista y el empate lo gana la etapa
// que va antes en el flujo.

// ─── la solicitud según la BD ───────────────────────────────────────────────────────────────────────

// Solicitud es el esqueleto: lo que la BD afirma. Nada de acá se infiere de logs.
type Solicitud struct {
	ID        int64
	UserID    int64
	Documento string
	Estado    int
	EstadoN   string
	Lender    string
	LenderID  int64
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
	// Origen y si fue DERIVADO o asumido. Se separa porque `asesor` es el default y un default que se
	// lee como verificado es peor que no tenerlo.
	Origen         string
	OrigenDerivado bool
	// El snapshot del motor de perfilamiento. Es el esqueleto de `listado` y la huella del webhook del
	// lender — nil si esta solicitud nunca llegó a perfilarse.
	Perfilamiento *Perfilamiento
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
	// El parseo queda en UTC (el default) A PROPÓSITO: la columna `timestamp` de MySQL vuelve como
	// wall-clock UTC, así que marcarla como Local correría el instante 5 horas y con él la ventana de
	// búsqueda de logs. Lo que se convierte es la PRESENTACIÓN (ver `hhmm`), no el dato: si no, la BD
	// mostraría 21:49 y los logs 16:48 para el mismo momento y la cronología se leería al revés.
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
		       l.name, COALESCE(l.id,0), l.response_type, a.name, ab.name, CAST(ur.flow_id AS CHAR), u.document_number,
		       ur.amount, ur.created_at
		  FROM user_requests ur
		  LEFT JOIN user_request_statuses st ON st.id = ur.user_request_status_id
		  LEFT JOIN lenders l               ON l.id  = ur.lender_id
		  LEFT JOIN allied_branches ab      ON ab.id = ur.allied_branch_id
		  LEFT JOIN allieds a               ON a.id  = ab.allied_id
		  LEFT JOIN users u                 ON u.id  = ur.user_id
		 WHERE ur.id = ?`, ureq).
		Scan(&s.UserID, &s.Estado, &s.EstadoN, &lender, &s.LenderID, &rt, &comercio, &sucursal, &canal, &doc, &monto, &s.Creada)
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
	// ORIGEN. `user_requests` no tiene columna de canal, así que se deriva de lo que sí existe: si hay una
	// solicitud de ecommerce ligada, el origen es ecommerce. Si no, se asume ASESOR — que es el caso normal
	// y lo que pidió Miguel como default, pero queda marcado como supuesto, no como hecho.
	s.Origen, s.OrigenDerivado = "asesor", false
	var n int
	if db.QueryRow(`SELECT COUNT(*) FROM ecommerce_requests WHERE user_request_id = ?`, ureq).Scan(&n) == nil && n > 0 {
		s.Origen, s.OrigenDerivado = "ecommerce", true
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
func ensamblar(mapa *Mapa, s *Solicitud, lineas []Linea, target string,
	centrales map[int64]string, lenders map[int64]LenderInfo) Traza {
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

	// Las líneas de log, repartidas por etapa según el mapa declarado (determinista).
	porEtapa := map[string][]Linea{}
	sinEtapa := 0
	for _, l := range lineas {
		if id := mapa.EtapaDe(l.msg, l.ctx); id != "" {
			porEtapa[id] = append(porEtapa[id], l)
		} else {
			sinEtapa++
		}
	}
	// Las líneas que ningún matcher reclama se CUENTAN y se declaran. Callarlas haría parecer que el mapa
	// cubre todo, que es justo lo que no se puede saber sin medirlo.
	if sinEtapa > 0 {
		t.Warnings = append(t.Warnings, fmt.Sprintf("%d de %d líneas no las reclama ninguna etapa del mapa "+
			"(mapa v%s): el mapa no cubre todo lo que el backend loguea", sinEtapa, len(lineas), mapa.Version))
	}

	for _, o := range mapa.Orden() {
		e := Etapa{ID: o.id, Label: o.label, Source: "—", Status: "skip"}
		ls := porEtapa[o.id]
		e.Lineas = len(ls)

		if o.id == "origen" {
			e.Status, e.At = "ok", hhmm(s.Creada)
			e.Detail = "canal: " + s.Origen
			if s.OrigenDerivado {
				e.Source = "db"
			} else {
				e.Source = "default"
				e.Detail += "  (asumido — user_requests no guarda el canal)"
			}
			t.Etapas = append(t.Etapas, e)
			continue
		}
		if at, ok := visto[o.id]; ok {
			e.Status, e.Source, e.At = "ok", "db", hhmm(at)
		} else if len(ls) > 0 {
			// Sin respaldo en la BD pero con logs: la etapa OCURRIÓ (los logs son evidencia positiva),
			// solo que la BD no la registra. Es el caso de `listado` y `cupo`, por diseño.
			e.Status, e.Source, e.Source = "ok", "loki", "loki"
			e.At = hhmm(time.UnixMilli(ls[0].ts))
		} else if malos[s.Estado] != "" && t.BrokeAt == "" && o.id == etapaDeMuerte(mapa, s) {
			// La etapa donde murió: lo dice la BD (el estado final), no un log.
			e.Status, e.Source, e.Detail = "fail", "db", fmt.Sprintf("estado %d «%s»", s.Estado, s.EstadoN)
			e.At = atDelEstado(s, s.Estado)
		} else if o.id == "listado" || o.id == "cupo" {
			// Estas dos NO tienen esqueleto posible: decir "no ocurrió" sería mentir.
			e.Status, e.Detail = "sin-evidencia", "la BD no registra esta etapa (rt=2 no persiste; rt=1 vive en DynamoDB)"
		}

		// Sub-steps de `listado`: una fila por entidad. El veredicto se lee SOLO de la línea «Resultado de
		// evaluación» — tomar cualquier `rule_id` emparejaría el veredicto con la regla de una categoría
		// rechazada, que es lo contrario de lo que decidió.
		if o.id == "listado" {
			type ent struct {
				nombre, regla, res string
				cats               []string
			}
			byID := map[string]*ent{}
			var ids []string
			for _, l := range ls {
				id := pick(l.ctx, []string{"lender_id"})
				if id == "" {
					continue
				}
				e0, ok := byID[id]
				if !ok {
					e0 = &ent{}
					byID[id] = e0
					ids = append(ids, id)
				}
				if n := pick(l.ctx, []string{"lender_name"}); n != "" {
					e0.nombre = n
				}
				r := pick(l.ctx, []string{"rule_id"})
				if regexp.MustCompile(`(?i)Resultado de evaluaci`).MatchString(l.msg) {
					if r != "" {
						e0.regla = r
					}
					if v := pick(l.ctx, []string{"result", "resultado"}); v != "" {
						e0.res = v
					}
				} else if regexp.MustCompile(`CATEGORY_RULE_REJECTED`).MatchString(l.msg) && r != "" {
					e0.cats = append(e0.cats, r)
				}
			}
			for _, id := range ids {
				e0 := byID[id]
				st := "ok"
				if e0.res != "" && e0.res != "aprobado" {
					st = "fail"
				} else if e0.res == "" {
					st = "skip"
				}
				d := ""
				if e0.regla != "" {
					d = "regla " + e0.regla
				}
				if len(e0.cats) > 0 {
					d += fmt.Sprintf("  ·  %d categoría(s) rechazada(s): %s", len(e0.cats), strings.Join(e0.cats, ", "))
				}
				nombre := e0.nombre
				if nombre == "" {
					nombre = "lender " + id
				}
				e.Subs = append(e.Subs, Sub{Label: nombre, Status: st, Detail: d, Source: "loki", Detail2: id})
			}
			if len(e.Subs) > 0 {
				n := len(e.Subs)
				e.Subs = arbolListado(e.Subs, lenders)
				e.Status, e.Source = "ok", "loki"
				e.Detail = fmt.Sprintf("%d entidades evaluadas en %d familia(s)", n, len(e.Subs))
				e.At = hhmm(time.UnixMilli(ls[0].ts))
			}
		}

		// SUB-STEPS DE LA BD — hechos, uno por transición de estado que cae en esta etapa. Van primero
		// porque son lo único que se puede afirmar; los de log vienen después como evidencia.
		for _, tr := range s.Transiciones {
			if estadoEtapa[tr.Estado] != o.id {
				continue
			}
			st := "ok"
			if malos[tr.Estado] != "" {
				st = "fail"
			}
			e.Subs = append(e.Subs, Sub{
				Label:  fmt.Sprintf("estado %d · %s", tr.Estado, tr.Nombre),
				Status: st, Detail: hhmm(tr.At), Source: "db",
			})
		}
		// El buró tiene su propio hecho por central consultada, con score.
		if o.id == "buro" {
			e.Subs = append(e.Subs, arbolBuro(centrales, s.Buro)...)
		}
		if o.id == "seleccion" && s.Lender != "" {
			// El único punto del flujo donde SÍ hay un camino elegido: una entidad ganó, y su familia es
			// «por dónde se fue». En el listado no lo hay — ahí conviven todas las familias.
			fam := ramalDeRT(s.LenderID, s.LenderRT)
			e.Subs = append(e.Subs, Sub{
				Label: fam, Status: "ok", Source: "db",
				Detail: "◄ por acá se fue",
				Hijos: []Sub{{Label: s.Lender, Status: "ok", Source: "db",
					Detail: fmt.Sprintf("lender %d · response_type %d", s.LenderID, s.LenderRT)}},
			})
		}

		// SUB-STEPS DE LOG — un renglón por método/evento distinto, con su conteo. Agrupar es obligatorio:
		// sin esto, `registro` tendría 312 renglones y dejaría de ser legible, que es lo contrario de lo
		// que un resumen tiene que hacer.
		if o.id != "listado" && len(ls) > 0 {
			e.Subs = append(e.Subs, gruposDeLog(ls)...)
		}

		// Los eventos crudos, para el panel de log. Se priorizan los errores: si hay que recortar, lo que
		// no puede faltar es la línea que explica el fallo.
		if len(ls) > 0 {
			const tope = 60
			e.EventosDe = len(ls)
			orden := make([]Linea, 0, len(ls))
			for _, l := range ls {
				if l.level == "error" {
					orden = append(orden, l)
				}
			}
			for _, l := range ls {
				if l.level != "error" {
					orden = append(orden, l)
				}
			}
			if len(orden) > tope {
				orden = orden[:tope]
			}
			sort.Slice(orden, func(i, j int) bool { return orden[i].ts < orden[j].ts })
			for _, l := range orden {
				e.Eventos = append(e.Eventos, Evento{At: hhmm(time.UnixMilli(l.ts)), Level: l.level, Msg: trim(l.msg, 400)})
			}
		}

		// ── LA RESPUESTA DEL LENDER: tres casos que la BD sola no distingue ──
		//
		// «no llegó» y «llegó y falló» se ven IDÉNTICOS desde la BD (disbursed_lender vacío en los dos) y
		// sólo la excepción HTTP los separa. Confundirlos manda a revisar el lugar equivocado: uno es
		// problema del agregador y el otro es nuestro.
		if o.id == "respuesta-lender" {
			p := s.Perfilamiento
			fallo := len(ls) > 0 // alguna línea con la url del webhook = llegó y explotó
			switch {
			case p != nil && p.Desembolsado > 0:
				e.Status, e.Source = "ok", "db"
				e.At = hhmm(p.Actualizado)
				nom := fmt.Sprint(p.Desembolsado)
				for _, l := range p.Mostrados {
					if l.ID == p.Desembolsado && l.Nombre != "" {
						nom = l.Nombre
					}
				}
				e.Detail = "el webhook se aplicó: desembolsa " + nom
				e.Subs = append(e.Subs, Sub{Label: "Llegó y se aplicó", Status: "ok", Source: "db",
					Detail: "profiling_reviews.disbursed_lender = " + nom})
			case fallo:
				e.Status, e.Source = "fail", "loki"
				e.At = hhmm(time.UnixMilli(ls[0].ts))
				e.Detail = "el webhook LLEGÓ y terminó en error — el agregador sí respondió, el problema es nuestro"
				e.Subs = append(e.Subs, Sub{Label: "Llegó y falló", Status: "fail", Source: "loki",
					Detail: fmt.Sprintf("%d línea(s) con la url del webhook", len(ls))})
			case s.Estado == 3:
				// Estado 3 con lender elegido y sin respuesta: la firma exacta del reporte más frecuente.
				e.Status, e.Source = "sin-evidencia", "db"
				e.Detail = ("sin evidencia de RECEPCIÓN del webhook y la solicitud sigue en «Seleccionó entidad». " +
					"Es la firma del reporte más común de soporte. ⚠ NO se puede afirmar que el agregador no llamó: " +
					"el webhook no loguea su recepción, así que la ausencia no prueba nada.")
				e.Subs = append(e.Subs, Sub{Label: "No llegó (o llegó y no dejó huella)", Status: "skip",
					Source: "db", Detail: "disbursed_lender vacío · sin excepción con la url del webhook"})
			default:
				e.Status = "skip"
			}
		}

		// ── LISTADO desde la BD: el snapshot exacto de lo que se mostró, con su probabilidad ──
		// Es MEJOR que inferirlo de los logs: `displayed_lenders` es lo que el cliente vio de verdad.
		if o.id == "listado" && s.Perfilamiento != nil && len(s.Perfilamiento.Mostrados) > 0 {
			p := s.Perfilamiento
			var hijos []Sub
			for _, l := range p.Mostrados {
				st, det := "ok", l.Probabilidad
				if l.Aprobado != nil && !*l.Aprobado {
					st = "fail"
					det += " · el lender NO aprobó"
				}
				if l.ID == p.Recomendado {
					det += " · RECOMENDADO"
				}
				hijos = append(hijos, Sub{Label: l.Nombre, Status: st, Detail: det, Source: "db",
					Detail2: fmt.Sprint(l.ID)})
			}
			// Se agrupan por familia igual que los del log, para que el árbol sea uno y no dos.
			e.Subs = append(arbolListado(hijos, lenders), e.Subs...)
			if e.Status == "skip" || e.Status == "sin-evidencia" {
				e.Status, e.Source = "ok", "db"
				e.At = hhmm(p.Creado)
			}
			e.Detail = fmt.Sprintf("%d entidades mostradas al cliente (snapshot de profiling_reviews)", len(p.Mostrados))
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

	// Las etapas anteriores a la última probada se marcan `sin-registro`: ocurrieron (el flujo pasó por
	// ahí) pero la BD no las anotó. Distinto de `skip`, que es "el flujo no llegó".
	ultimaProbada := -1
	for i, e := range t.Etapas {
		if e.Status == "ok" || e.Status == "warn" || e.Status == "fail" {
			ultimaProbada = i
		}
	}
	for i := range t.Etapas {
		if i < ultimaProbada && t.Etapas[i].Status == "skip" {
			t.Etapas[i].Status = "sin-registro"
			t.Etapas[i].Detail = "ocurrió (el flujo siguió más adelante) pero no quedó registrada"
		}
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
	// Las horas de las etapas deberían crecer. Cuando no crecen, el historial de esa solicitud NO está en
	// orden de flujo — pasa de verdad (visto en la 464432: cancelada 10:38, selección 16:29, formulario
	// 16:49). Puede ser una solicitud reutilizada, un backfill, o un estado escrito fuera de secuencia. Se
	// avisa en vez de ordenarlo por hora: reordenar escondería el dato y la etapa quedaría en el lugar
	// equivocado del flujo.
	prev, desordenada := "", ""
	for _, et := range t.Etapas {
		if et.At == "" || (et.Status != "ok" && et.Status != "warn" && et.Status != "fail") {
			continue
		}
		if prev != "" && et.At < prev {
			desordenada = et.Label
		}
		prev = et.At
	}
	if desordenada != "" {
		t.Warnings = append(t.Warnings, "las horas no son monótonas («"+desordenada+"» es anterior a la etapa previa): "+
			"el historial de esta solicitud no está en orden de flujo — ¿reutilizada? ¿backfill? Las etapas se muestran "+
			"en orden de FLUJO, no de hora.")
	}

	if len(lineas) == 0 {
		t.Warnings = append(t.Warnings, "sin líneas de log: el porqué no se pudo enriquecer (¿fuera de retención? ¿backend sin instrumentar?)")
	}
	sort.Strings(t.Sources)
	return t
}

// gruposDeLog colapsa las líneas de una etapa en renglones legibles: uno por `Clase::metodo` (o por
// mensaje normalizado si no lo tiene), con su conteo y marcado en rojo si alguna de esas líneas fue error.
//
// El tope de 8 renglones se DECLARA cuando corta: un resumen que esconde que recortó se lee como completo,
// y eso es peor que mostrar mucho.
func gruposDeLog(ls []Linea) []Sub {
	type g struct {
		n      int
		err    string
		primer int64
	}
	claves := map[string]*g{}
	var orden []string
	reMet := regexp.MustCompile(`^([A-Za-z][\w\\]*?(?:Controller|Service|Repository|Orchestrator))::(\w+)`)
	reNum := regexp.MustCompile(`\d{3,}`)
	reVerbo := regexp.MustCompile(`^(?:Starting|Ending|Calling)\s+`)
	for _, l := range ls {
		k := ""
		msg := reVerbo.ReplaceAllString(l.msg, "")
		if m := reMet.FindStringSubmatch(msg); m != nil {
			partes := strings.Split(m[1], `\`)
			k = partes[len(partes)-1] + "::" + m[2]
		} else {
			k = trim(reNum.ReplaceAllString(msg, "N"), 64)
		}
		it, ok := claves[k]
		if !ok {
			it = &g{primer: l.ts}
			claves[k] = it
			orden = append(orden, k)
		}
		it.n++
		if l.level == "error" && it.err == "" {
			if c := pick(l.ctx, []string{"error_code"}); c != "" {
				it.err = c
			} else {
				it.err = "error"
			}
		}
	}
	sort.Slice(orden, func(i, j int) bool { return claves[orden[i]].primer < claves[orden[j]].primer })
	var out []Sub
	for i, k := range orden {
		if i == 8 {
			out = append(out, Sub{
				Label:  fmt.Sprintf("… y %d evento(s) más", len(orden)-8),
				Status: "skip", Detail: "recortado para que se lea", Source: "loki",
			})
			break
		}
		it := claves[k]
		st, d := "ok", fmt.Sprintf("×%d · %s", it.n, hhmm(time.UnixMilli(it.primer)))
		if it.err != "" {
			st, d = "fail", it.err+" · "+d
		}
		out = append(out, Sub{Label: k, Status: st, Detail: d, Source: "loki"})
	}
	return out
}

// etapaDeMuerte dice en qué etapa se detuvo: la siguiente a la última que la BD probó. Es una inferencia
// del ESQUELETO (no de logs), así que se puede afirmar.
func etapaDeMuerte(mapa *Mapa, s *Solicitud) string {
	ultima := "origen"
	for _, tr := range s.Transiciones {
		if e, ok := estadoEtapa[tr.Estado]; ok {
			ultima = e
		}
	}
	ord := mapa.Orden()
	for i, o := range ord {
		if o.id == ultima && i+1 < len(ord) {
			return ord[i+1].id
		}
	}
	return ultima
}

// hhmm es el ÚNICO formateador de horas: las de la BD llegan en UTC y las de los logs en epoch, y
// mezclarlas sin normalizar fue lo que desordenó la primera versión de la línea de tiempo.
func hhmm(t time.Time) string { return t.Local().Format("15:04:05") }

// atDelEstado busca cuándo se registró un estado puntual. Se usa para la etapa de muerte: tomar "la
// última transición" daba una hora ANTERIOR al resto del flujo, porque `user_request_records` no siempre
// viene en orden cronológico.
func atDelEstado(s *Solicitud, estado int) string {
	for i := len(s.Transiciones) - 1; i >= 0; i-- {
		if s.Transiciones[i].Estado == estado {
			return hhmm(s.Transiciones[i].At)
		}
	}
	return ultimoAt(s)
}

func ultimoAt(s *Solicitud) string {
	if n := len(s.Transiciones); n > 0 {
		return hhmm(s.Transiciones[n-1].At)
	}
	return hhmm(s.Creada)
}

// ─── render tipo «checks» ───────────────────────────────────────────────────────────────────────────

func imprimirTraza(t Traza, s *Solicitud) {
	icono := map[string]string{
		"ok": paint("32", "✔"), "warn": paint("33", "!"), "fail": paint("31", "✘"),
		"skip": gray("·"), "sin-evidencia": paint("33", "?"), "sin-registro": gray("~"),
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
		case "default":
			fuente = gray("[supuesto]")
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
		// EL ÁRBOL: familia o central en un nivel, las entidades colgando. Con guías a propósito — sin
		// ellas hay que contar espacios para saber qué cuelga de qué, y entonces el árbol no ahorra nada.
		for i, sb := range e.Subs {
			ult := i == len(e.Subs)-1
			rama := "├─"
			if ult {
				rama = "└─"
			}
			fmt.Printf("          %s %s %s  %s\n", gray(rama), puntito(sb.Status),
				pad(sb.Label, 32), gray(trim(sb.Detail, 54)))
			guia := "│ "
			if ult {
				guia = "  "
			}
			for j, h := range sb.Hijos {
				sub := "├─"
				if j == len(sb.Hijos)-1 {
					sub = "└─"
				}
				fmt.Printf("          %s  %s %s %s  %s\n", gray(guia), gray(sub), puntito(h.Status),
					pad(h.Label, 28), gray(trim(h.Detail, 48)))
			}
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
					if comoTexto(vv) == valorAncla {
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

// comoTexto formatea un valor del context para comparar. Existe por un bug que costó encontrar: el JSON
// del log deserializa los números a `float64`, y `fmt.Sprint(float64(1827791))` devuelve "1.827791e+06"
// (Go usa %g y salta a notación científica). O sea que anclar por un id de 6 dígitos funcionaba y por uno
// de 7 fallaba EN SILENCIO — el bug dependía de la cantidad de dígitos.
func comoTexto(v any) string {
	if f, ok := v.(float64); ok && f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return fmt.Sprint(v)
}

// pick saca el primer valor no vacío de una lista de claves del context.
func pick(ctx map[string]any, keys []string) string {
	for _, k := range keys {
		if v, ok := ctx[k]; ok && v != nil && comoTexto(v) != "" {
			return comoTexto(v)
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
// ArmarTraza es el ÚNICO camino que arma una traza: lo usan la consola, el HTML y el server. Tener dos
// caminos sería tener dos definiciones de «qué pasó con esta solicitud».
func ArmarTraza(target string, ureq int64) (Traza, *Solicitud, error) {
	c, _ := loadConfig(target)
	mapa, err := Cargar()
	if err != nil {
		return Traza{}, nil, fmt.Errorf("el mapa del flujo no carga: %w", err)
	}
	fuente, err := abrirFuente(c)
	if err != nil {
		return Traza{}, nil, err
	}
	defer fuente.Close()

	s, err := GetSolicitud(fuente, ureq)
	if err != nil {
		return Traza{}, nil, err
	}

	var lineas []Linea
	var notas []string
	if no := porQueNoLoki(c); no != "" {
		notas = append(notas, "sin logs: "+no)
	} else {
		cl := &client{http: &http.Client{Timeout: 60 * time.Second}, cfg: c,
			current: attempt{base: c.base, auth: authDe(c)}}
		lineas, notas = traerLineas(cl, s, c.env)
	}

	centrales := GetCentrales(fuente)
	var idsLender []int64
	for _, l := range lineas {
		if v := pick(l.ctx, []string{"lender_id"}); v != "" {
			var id int64
			if fmt.Sscanf(v, "%d", &id); id > 0 {
				idsLender = append(idsLender, id)
			}
		}
	}
	if s.LenderID > 0 {
		idsLender = append(idsLender, s.LenderID)
	}
	lenders := GetLenders(fuente, idsLender)

	t := ensamblar(mapa, s, lineas, target, centrales, lenders)
	t.Warnings = append(t.Warnings, notas...)
	return t, s, nil
}

// Resolver traduce cédula/teléfono/uReq a intentos, sobre cualquier fuente.
func Resolver(r Runner, valor string) ([]Coincidencia, []string, error) {
	return resolverFuente(r, valor)
}

func modoTraza(c config, target string, ureq int64, jsonOut bool, htmlOut string) int {
	// El mapa se carga primero: si el flujo declarado no es válido, no tiene sentido ir a buscar datos.
	mapa, err := Cargar()
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s el mapa del flujo no carga: %v\n\n", paint("31", "✘"), err)
		return 2
	}
	fuente, err := abrirFuente(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s no puedo armar la traza para target «%s»: %v\n", paint("31", "✘"), target, err)
		fmt.Fprintf(os.Stderr, "  El esqueleto sale de la BD: sin ella solo habría logs, y un log ausente no prueba nada.\n\n")
		return 2
	}
	defer fuente.Close()

	s, err := GetSolicitud(fuente, ureq)
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

	// El catálogo de centrales y la info de las entidades vistas en los logs: es lo que convierte una lista
	// plana en el ÁRBOL (qué buró se consultó y de qué familia es cada lender). Best-effort: si falla, el
	// árbol se degrada a lista y la traza sale igual.
	centrales := GetCentrales(fuente)
	var idsLender []int64
	for _, l := range lineas {
		if v := pick(l.ctx, []string{"lender_id"}); v != "" {
			var id int64
			if fmt.Sscanf(v, "%d", &id); id > 0 {
				idsLender = append(idsLender, id)
			}
		}
	}
	if s.LenderID > 0 {
		idsLender = append(idsLender, s.LenderID)
	}
	lenders := GetLenders(fuente, idsLender)

	t := ensamblar(mapa, s, lineas, target, centrales, lenders)
	t.Warnings = append(t.Warnings, notas...)

	if jsonOut {
		b, _ := json.MarshalIndent(t, "", "  ")
		fmt.Println(string(b))
		return 0
	}
	imprimirTraza(t, s)
	if htmlOut != "" {
		if err := escribirHTML(t, s, htmlOut); err != nil {
			fmt.Fprintf(os.Stderr, "  no pude escribir %s: %v\n", htmlOut, err)
		} else {
			fmt.Printf("\n  %s\n", gray("vista de checks: "+htmlOut))
		}
	}
	return 0
}

// modoBuscar lista los intentos que coinciden con lo que se escribió. Es la puerta natural del soporte:
// quien llama dice su cédula o su celular, no un `user_request_id`.
func modoBuscar(c config, target, valor string) int {
	fuente, err := abrirFuente(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s sin BD para «%s»: %v\n\n", paint("31", "✘"), target, err)
		return 2
	}
	defer fuente.Close()
	cs, como, err := resolverFuente(fuente, valor)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s %v\n\n", paint("31", "✘"), err)
		return 2
	}
	imprimirCoincidencias(valor, cs, como, target)
	if len(cs) == 0 {
		return 2
	}
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

// ─── buscar por teléfono, cédula o número de solicitud ──────────────────────────────────────────────

// Coincidencia es un intento encontrado a partir de lo que se buscó.
type Coincidencia struct {
	UReq      int64
	Estado    int
	EstadoN   string
	Lender    string
	Comercio  string
	Creada    time.Time
	Documento string
	Telefono  string
}

// resolver traduce lo que el usuario escribió a una lista de solicitudes.
//
// NO ADIVINA EL TIPO DE DATO: consulta los tres (solicitud, teléfono, documento) y reporta cuál coincidió.
// Adivinar por la forma es tentador —10 dígitos que empiezan con 3 parece un celular— pero una cédula
// también puede tener 10 dígitos y empezar con 3, y un `user_request_id` de 7 dígitos se parece a todo.
// Un buscador que elige mal en silencio te muestra la solicitud de otra persona con total seguridad.
//
// Teléfono y documento son únicos en `users` (medido: 1.00 usuarios por cada uno, máximo 1), así que
// resuelven a UN cliente — pero ese cliente puede tener varios intentos (1,69 en promedio, 228 el peor).
func resolverFuente(r Runner, valor string) ([]Coincidencia, []string, error) {
	valor = strings.TrimSpace(valor)
	if valor == "" {
		return nil, nil, fmt.Errorf("no me pasaste nada que buscar")
	}
	// Todo lo que se busca es de dígitos, y esa restricción es lo que hace segura la interpolación en
	// Redash (ver `validarArgs`). Un valor con letras se rechaza acá, con un mensaje que lo explica.
	if !soloDigitos.MatchString(valor) {
		return nil, nil, fmt.Errorf("«%s» no es un número: el trazador busca por cédula, teléfono o "+
			"número de solicitud, y los tres son de dígitos", trim(valor, 30))
	}

	var como []string
	vistos := map[int64]bool{}
	var out []Coincidencia

	traer := func(where, etiqueta string) error {
		fs, err := r.Filas(sqlBuscar+where+sqlBuscarOrden, valor)
		if err != nil {
			return err
		}
		if len(fs) > 0 {
			como = append(como, fmt.Sprintf("%s → %d", etiqueta, len(fs)))
		}
		for _, f := range fs {
			id := entero(f["id"])
			if vistos[id] {
				continue
			}
			vistos[id] = true
			out = append(out, Coincidencia{
				UReq: id, Estado: int(entero(f["st"])), EstadoN: texto(f["estado"]),
				Lender: texto(f["lender"]), Comercio: texto(f["comercio"]), Creada: fecha(f["created_at"], r.Zona()),
				Documento: texto(f["documento"]), Telefono: texto(f["telefono"]),
			})
		}
		return nil
	}

	// Se prueban los TRES y se reporta cuál coincidió. Adivinar por la forma es tentador —10 dígitos que
	// empiezan con 3 parece un celular— pero una cédula también puede serlo, y un id de solicitud de 7
	// dígitos se parece a todo. Un buscador que elige mal en silencio muestra la solicitud de otra persona.
	for _, p := range []struct{ where, etiqueta string }{
		{"ur.id = ?", "número de solicitud"},
		{"u.cell_phone = ?", "teléfono"},
		{"u.document_number = ?", "documento"},
	} {
		if err := traer(p.where, p.etiqueta); err != nil {
			return nil, nil, err
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Creada.After(out[j].Creada) })
	return out, como, nil
}

// imprimirCoincidencias lista los intentos para elegir. Cuando el mismo valor coincide como DOS cosas
// distintas (por ejemplo una cédula que además es un id de solicitud válido), lo dice: es el caso en que
// un buscador que adivina te da la respuesta de otra persona.
func imprimirCoincidencias(valor string, cs []Coincidencia, como []string, target string) {
	fmt.Println()
	fmt.Printf("  %s\n", bold(fmt.Sprintf("── «%s» en %s ──", valor, target)))
	if len(como) > 1 {
		fmt.Printf("     %s\n", paint("33", "⚠ coincidió como "+strings.Join(como, " y ")+
			" — mirá bien cuál es el que buscabas"))
	} else if len(como) == 1 {
		fmt.Printf("     %s\n", gray("coincidió como "+como[0]))
	}
	if len(cs) == 0 {
		fmt.Printf("     %s\n", gray("sin coincidencias"))
		return
	}
	fmt.Println()
	for _, c := range cs {
		res := gray("en curso")
		if sellados[c.Estado] {
			res = green("aprobado")
		} else if malos[c.Estado] != "" {
			res = red(malos[c.Estado])
		}
		fmt.Printf("     %-8d %s  %-11s %-24s %s\n", c.UReq, c.Creada.Local().Format("2006-01-02 15:04"),
			res, trim(c.Comercio, 24), gray(trim(c.Lender, 26)))
	}
	fmt.Printf("\n     %s\n", gray(fmt.Sprintf("para ver una: -ureq <número>  (target %s)", target)))
}

// ─── el árbol de caminos ────────────────────────────────────────────────────────────────────────────

// LenderInfo es lo que la BD sabe de una entidad. El `rt` es lo que decide a qué FAMILIA pertenece, y por
// eso sale de la BD y no de los logs: los logs traen `lender_id` y `lender_name`, nunca el response_type.
type LenderInfo struct {
	ID     int64
	Nombre string
	RT     int
}

// ramalDeRT traduce el response_type a la familia. Los ids son los de `mapa/ramales.json` y de
// `harness/panel/steps.json`, a propósito.
//
// Credifamilia (lender 24) es un caso aparte y no un rt: tiene tres integraciones propias (REST de
// preaprobación, KYC V2 con Evidente/CrossCore/Jumio, y radicación SOAP), así que mezclarla con el resto
// de su rt escondería que su camino es distinto.
func ramalDeRT(id int64, rt int) string {
	if id == 24 {
		return "credifamilia"
	}
	switch rt {
	case 2, 3, 4:
		return "creditopx"
	case 1:
		return "agregador"
	default:
		return "redirect"
	}
}

// leerLenders trae nombre y response_type de las entidades que aparecieron en los logs. Sin esto no se
// puede agrupar por familia: es el dato que convierte una lista plana de 12 lenders en el árbol de caminos.
func leerLenders(db *sql.DB, ids []int64) map[int64]LenderInfo {
	out := map[int64]LenderInfo{}
	if len(ids) == 0 {
		return out
	}
	marcas := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, v := range ids {
		args[i] = v
	}
	rows, err := db.Query(`SELECT id, COALESCE(name,''), COALESCE(response_type,0) FROM lenders WHERE id IN (`+marcas+`)`, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var l LenderInfo
		if rows.Scan(&l.ID, &l.Nombre, &l.RT) == nil {
			out[l.ID] = l
		}
	}
	return out
}

// leerCentrales trae el catálogo COMPLETO de centrales de riesgo. Es lo que permite mostrar las que NO se
// consultaron, que es la mitad de la pregunta: «¿por dónde se fue el buró, o no fue?». Sin el catálogo solo
// se pueden listar las que sí respondieron, y una ausencia sin universo no se puede leer.
func leerCentrales(db *sql.DB) map[int64]string {
	out := map[int64]string{}
	rows, err := db.Query(`SELECT id, COALESCE(name,'') FROM risk_centrals ORDER BY id`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var n string
		if rows.Scan(&id, &n) == nil {
			out[id] = n
		}
	}
	return out
}

// arbolListado agrupa las entidades evaluadas por FAMILIA.
//
// La forma sale de medir, no de suponer: una solicitud NO elige un ramal en el listado — evalúa entidades
// de todas las familias a la vez (en la uReq 464630, 12 entidades entre agregadores, CreditopX y
// Credifamilia). El ramal recién se vuelve «por dónde se fue» en `seleccion`, cuando una gana. Un árbol que
// mostrara «esta solicitud fue por agregador» en el listado estaría mintiendo.
func arbolListado(planas []Sub, info map[int64]LenderInfo) []Sub {
	porRamal := map[string][]Sub{}
	var ordenRamal []string
	for _, s := range planas {
		var id int64
		fmt.Sscanf(s.Detail2, "%d", &id) // Detail2 lleva el lender_id
		fam := "sin clasificar"
		if l, ok := info[id]; ok {
			fam = ramalDeRT(l.ID, l.RT)
			if l.Nombre != "" {
				s.Label = l.Nombre
			}
		}
		if _, ya := porRamal[fam]; !ya {
			ordenRamal = append(ordenRamal, fam)
		}
		porRamal[fam] = append(porRamal[fam], s)
	}
	// Orden estable y con sentido de negocio: primero in-platform, después terceros.
	prio := map[string]int{"creditopx": 0, "agregador": 1, "credifamilia": 2, "redirect": 3, "sin clasificar": 9}
	sort.Slice(ordenRamal, func(i, j int) bool { return prio[ordenRamal[i]] < prio[ordenRamal[j]] })

	var out []Sub
	for _, fam := range ordenRamal {
		hijos := porRamal[fam]
		aprob, rech := 0, 0
		for _, h := range hijos {
			if h.Status == "fail" {
				rech++
			} else if h.Status == "ok" {
				aprob++
			}
		}
		st := "ok"
		if aprob == 0 && rech > 0 {
			st = "fail"
		}
		det := fmt.Sprintf("%d evaluada(s)", len(hijos))
		if rech > 0 {
			det += fmt.Sprintf(" · %d rechazada(s)", rech)
		}
		out = append(out, Sub{Label: fam, Status: st, Detail: det, Source: "db", Hijos: hijos})
	}
	return out
}

// arbolBuro lista TODAS las centrales del catálogo: las consultadas con su score y las que no, marcadas.
// Mostrar solo las consultadas dejaría la pregunta a medias — «no fue a consultar» es una respuesta.
func arbolBuro(catalogo map[int64]string, filas []FilaBuro) []Sub {
	hechas := map[string]FilaBuro{}
	for _, f := range filas {
		hechas[f.Central] = f
	}
	ids := make([]int64, 0, len(catalogo))
	for id := range catalogo {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	var out []Sub
	for _, id := range ids {
		nombre := catalogo[id]
		if f, ok := hechas[nombre]; ok {
			d := hhmm(f.At)
			if f.Score != nil {
				d = fmt.Sprintf("score %.0f · %s", *f.Score, d)
			} else {
				d = "sin score · " + d // Agildata nunca trae score: 0 de 202 filas medidas
			}
			out = append(out, Sub{Label: nombre, Status: "ok", Detail: d, Source: "db"})
		} else {
			out = append(out, Sub{Label: nombre, Status: "skip", Detail: "no consultada", Source: "db"})
		}
	}
	return out
}

// puntito y pad: el vocabulario visual del árbol. Se comparten para que consola y HTML digan lo mismo.
func puntito(st string) string {
	switch st {
	case "ok":
		return green("●")
	case "fail":
		return red("●")
	case "warn":
		return paint("33", "●")
	}
	return gray("○")
}

func pad(s string, n int) string {
	s = trim(s, n)
	if len(s) < n {
		return s + strings.Repeat(" ", n-len(s))
	}
	return s
}
