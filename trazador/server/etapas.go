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
	ID    string `json:"id"`
	Label string `json:"label"`
	// Status: ok | warn | fail | skip | sin-evidencia | no-aplica. `skip` y `no-aplica` NO son lo mismo y
	// mezclarlos fue un error real del mapa: `skip` es «podía pasar acá y no pasó» (una pregunta abierta),
	// `no-aplica` es «acá esto no ocurre nunca en este ramal» (una pregunta cerrada, declarada en ramales.json).
	Status string `json:"status"`
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
	// Eventos: LAS LÍNEAS QUE PRODUJO ESTE SUB-PASO, no las de la etapa. Es el cambio que vuelve esto
	// navegable como un run de CI: se abre un paso y se ven SUS logs, en vez de un panel al final con las
	// 110 líneas de la etapa entera mezcladas y sin dueño. `EventosDe` dice cuántas había si se recortó —
	// un sub que muestra 40 de 66 sin decirlo se lee como completo.
	Eventos   []Evento `json:"eventos,omitempty"`
	EventosDe int      `json:"eventosDe,omitempty"`
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

// desenlaceDe traduce un estado de `user_requests` a uno de los CUATRO desenlaces. Una sola definición,
// porque ya había dos y no coincidían: `ArmarTraza` contemplaba `abandonado` (estado 7) y el buscador de
// la API no, así que la MISMA solicitud salía «en curso» en la lista de intentos y «abandonado» al abrirla.
// La vista incluso tenía color para un desenlace que su fuente nunca emitía.
func desenlaceDe(estado int) string {
	switch {
	case sellados[estado]:
		return "aprobado"
	case malos[estado] != "":
		return "roto"
	case estado == 7:
		return "abandonado"
	default:
		return "en-curso"
	}
}

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
	// Validacion: `lender_identity_validation_types.identity_validation_type_id` (o el fallback
	// `lenders.validation_type`). Enum en Modules/Identity/App/Enums/IdentityValidationType.php:
	// 0 Unknown · 1 None · 2 AwsOcrRekognition · 3 Questions · 4 Ado · 5 CrossCore · 6 Evidente.
	Validacion int
	AlliedID   int64
	// Corbeta: este comercio está en el setting `corbeta_allieds`, o sea que su onboarding es el del
	// canal Corbeta→Bancolombia y NO el del resto. Se lee de la BD del target, no se supone.
	Corbeta bool
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
	// Huerfanas: las líneas que ningún patrón del mapa reclamó. Van EN LA TRAZA y no solo contadas en un
	// aviso, porque son el trabajo pendiente concreto: para cerrar el hueco hay que leerlas y declarar el
	// patrón que falta. Un contador no se puede accionar; una lista sí.
	Huerfanas []Evento `json:"huerfanas,omitempty"`
}

// ensamblar arma la traza: primero el esqueleto de la BD (hechos), después el porqué de los logs.
func ensamblar(mapa *Mapa, subMapa *SubMapa, s *Solicitud, lineas []Linea, target string,
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
	// EL ESTADO FINAL TAMBIÉN ES UN HECHO, y faltaba. `visto` se armaba sólo con `user_request_records`, o
	// sea con el HISTORIAL — y hay solicitudes sin historial: medido en prod, dos de tres solicitudes de
	// Alkosto en estado 11 tienen CERO filas en `user_request_records` (520374 y 519546; la tercera tiene
	// una, del estado 9). Para ellas el trazador mostraba «Desembolso ·» mientras `user_requests` decía
	// «Autorizada». La columna de la solicitud es tan afirmable como el registro histórico; lo único que no
	// da es la HORA, así que se usa la de la solicitud sólo si el historial no aportó nada.
	if et, ok := estadoEtapa[s.Estado]; ok {
		if _, ya := visto[et]; !ya {
			visto[et] = s.Creada
		}
	}

	// ⚠ SÓLO las centrales DECLARADAS en `buro` prueban la etapa del buró. Antes era `s.Buro[0].At` — la
	// primera fila de CUALQUIER central—, y con el catálogo repartido eso miente sin avisar: en la uReq
	// 520830 de prod los cuatro burós reales eran del DÍA ANTERIOR (cliente que vuelve, dato en caché) y las
	// únicas filas nuevas eran de `TusDatos - AML` y `Ado`, que son del tramo biométrico. Resultado: «✔
	// Consulta a burós 16:00:27» con las seis centrales en «no consultada» — un check verde tomado prestado
	// de otra etapa. Es el mismo error que tenía `Ado`, ahora en la dimensión del TIEMPO.
	for _, f := range s.Buro {
		if !declaradaEn(subMapa, "buro", f.Central) {
			continue
		}
		if v, ya := visto["buro"]; !ya || f.At.Before(v) {
			visto["buro"] = f.At
		}
	}
	// `origen` lo prueba la existencia misma de la solicitud: alguien la creó por algún canal.
	visto["origen"] = s.Creada

	// El desenlace sale SOLO de la BD.
	t.Outcome = desenlaceDe(s.Estado)

	// Las líneas de log, repartidas por etapa. DOS LLAVES, en este orden:
	//
	//	1. EL PATRÓN declarado en el mapa (determinista, y es la llave fuerte).
	//	2. EL SPAN, para lo que el patrón no reclamó: si las demás líneas del MISMO span cayeron todas en una
	//	   sola etapa, la línea hereda esa etapa.
	//
	// Por qué hace falta la segunda. 152 de los 153 patrones matchean la PROSA del mensaje, así que siempre
	// se escapa algo por cómo está redactado: `Starting RegisterCellPhoneService::…` no matchea un patrón
	// anclado en `^RegisterCellPhone` por culpa del verbo. Declarar una variante por cada forma de escribir lo
	// mismo es una carrera que no se gana. El span no es una redacción: es la unidad de trabajo en que se
	// emitió la línea. Medido en la uReq 519245 de prod: de 38 líneas sin ubicar, 30 se resuelven así — la
	// cobertura pasa de 92 % a 98 %.
	//
	// ⚠ LA HERENCIA NO PUEDE INVENTAR UNA ETAPA, y eso es una propiedad de la construcción, no una promesa:
	// sólo se hereda hacia una etapa que YA tenía líneas por patrón en ese mismo span. Una etapa vacía nunca
	// se enciende por herencia.
	//
	// Y cuando el span abarca DOS etapas no se hereda: pasa de verdad —guardar los datos personales dispara
	// la consulta de buró dentro de la misma operación— así que ahí el span no desempata y elegir sería
	// inventar. Esas líneas quedan «sin ubicar», que es la respuesta honesta.
	porEtapa := map[string][]Linea{}
	etapasDelSpan := map[string]map[string]bool{}
	var sinPatron []Linea
	for _, l := range lineas {
		if id := mapa.EtapaDe(l.msg, l.ctx); id != "" {
			porEtapa[id] = append(porEtapa[id], l)
			if etapasDelSpan[l.span] == nil {
				etapasDelSpan[l.span] = map[string]bool{}
			}
			etapasDelSpan[l.span][id] = true
		} else {
			sinPatron = append(sinPatron, l)
		}
	}
	heredadas := 0
	var sinEtapa []Linea
	for _, l := range sinPatron {
		es := etapasDelSpan[l.span]
		if l.span == "" || len(es) != 1 {
			sinEtapa = append(sinEtapa, l)
			continue
		}
		for id := range es {
			l.heredada = true
			porEtapa[id] = append(porEtapa[id], l)
			heredadas++
		}
	}
	if heredadas > 0 {
		t.Warnings = append(t.Warnings, fmt.Sprintf("%d líneas se ubicaron por SPAN y no por patrón del mapa: "+
			"van en la etapa correcta pero sin nombre de negocio (aparecen bajo «eventos sin nombre»)", heredadas))
	}
	// Las líneas que NADA reclama SE MUESTRAN, no solo se cuentan. Un aviso que dice «38 líneas no las pude
	// ubicar» sin decir cuáles no se puede accionar: para cerrar el hueco hay que leerlas y declarar el patrón
	// que falta. Antes esto era un contador, y por eso el hueco no se cerraba nunca.
	if len(sinEtapa) > 0 {
		t.Huerfanas, _ = eventosDe(sinEtapa, 120)
		t.Warnings = append(t.Warnings, fmt.Sprintf("%d de %d líneas no las ubica ni el patrón ni el span "+
			"(mapa v%s): están listadas en «sin ubicar» — o el span abarca dos etapas, o ninguna hermana suya "+
			"está ubicada", len(sinEtapa), len(lineas), mapa.Version))
	}

	// LA FAMILIA, una sola vez y antes del loop. Sale del `response_type` del lender ya sellado en la
	// solicitud, así que sólo existe DESPUÉS de que el cliente eligió: antes de `seleccion` no hay ramal, y
	// eso es correcto — no se puede declarar «esta etapa no aplica» sin saber a qué ramal fue.
	fam := ""
	if s.Lender != "" {
		fam = ramalDeRT(s.LenderID, s.LenderRT)
	}

	for _, o := range mapa.Orden() {
		e := Etapa{ID: o.id, Label: o.label, Source: "—", Status: "skip"}
		ls := porEtapa[o.id]
		e.Lineas = len(ls)

		// ¿Esta etapa está DECLARADA como inexistente para esta solicitud? Se resuelve acá arriba, antes de
		// armar nada, porque además de decidir el estado final decide qué NO hay que agregar: un sub que
		// describe un tramo que no existe se cuenta como evidencia y evita que el tramo se marque ausente.
		// Pasó exactamente eso — «Camino configurado: Ado» apareció en una solicitud rt=1 (Alkosto +
		// Bancolombia) y la etapa biométrica salió ✔ en un ramal donde no ocurre.
		declNoAplica, declPorque := noAplicaPorQue(mapa, s, fam, o.id)

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
		// Las centrales son un hecho de BD y van en la etapa DONDE SE CONSULTAN, según el reparto declarado
		// en `mapa/substeps.json`. Antes se volcaba el catálogo entero en `buro`, y por eso `Ado` —que es del
		// tramo creditopx, después de elegir la entidad— salía «no consultada» bajo «Consulta a burós».
		for _, b := range subMapa.Bloques(o.id) {
			if b.Tipo == "catalogo" && len(b.Conocidos) > 0 {
				e.Subs = append(e.Subs, arbolCentrales(b.Label, b.Conocidos, centrales, s.Buro)...)
			}
		}
		// Las que tienen datos y ninguna etapa declaró se muestran en el buró, marcadas. Un dato medido que
		// desaparece porque el mapa no lo esperaba es peor que uno mal ubicado: el segundo se ve.
		if o.id == "buro" {
			e.Subs = append(e.Subs, centralesHuerfanas(subMapa, mapa, s.Buro)...)
		}
		// ── QUÉ CAMINO DE IDENTIDAD LE TOCA A ESTE LENDER ──
		//
		// Es lo que vuelve interpretable la ausencia. El tipo lo elige el LENDER
		// (`lender_identity_validation_types`, fallback `lenders.validation_type`;
		// `CreditopXFlowService.php:117` → `IdentityValidationStepResolver`), y sólo `Ado`, `CrossCore` y
		// `Evidente` escriben fila en `risk_central_user_data`. Medido en prod: de 119 lenders in-platform,
		// **64 usan Ado, 46 usan AWS OCR+Rekognition y 9 no validan**. Para esos 46 las cuatro centrales
		// salen «no consultada» y sin esta línea se lee como «no pasó nada», cuando corrieron el OCR y el
		// reconocimiento facial completos — su evidencia son los LOGS, no la BD.
		if o.id == "biometria" && s.Validacion > 0 && declNoAplica == "" {
			v := validacionIdentidad[s.Validacion]
			st, det := "ok", v.nombre
			if !v.dejaFila {
				st = "sin-evidencia"
				det += " — NO escribe fila de central: la ausencia de filas acá es ESPERADA, el rastro está en los logs"
			}
			e.Subs = append([]Sub{{Label: "Camino configurado: " + v.nombre, Status: st, Source: "db",
				Detail: det}}, e.Subs...)
		}
		// Una etapa que la BD no prueba por ESTADO puede estar probada por sus centrales. `biometria` es el
		// caso: ningún `user_request_status` la marca, así que quedaba en `skip` con dos centrales consultadas
		// a la vista — y después la inferencia la rotulaba «puede no haber ocurrido» encima de la evidencia.
		if e.Status == "skip" && e.At == "" && tieneEvidencia(e) {
			e.Status, e.Source = "ok", "db"
			e.At = primeraHoraDeSubs(e.Subs)
		}
		if o.id == "seleccion" && fam != "" {
			// El único punto del flujo donde SÍ hay un camino elegido: una entidad ganó, y su familia es
			// «por dónde se fue». En el listado no lo hay — ahí conviven todas las familias.
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
		//
		// ⚠ ACÁ NO SE EXCLUYE NINGUNA ETAPA. `listado` y `respuesta-lender` estaban excluidas porque arman su
		// propio árbol desde la BD (las entidades por familia, el diagnóstico del webhook) y no quería una
		// segunda lista en paralelo. El costo era invisible y grave: `listado` mostraba «52 líneas» en la
		// cabecera y CERO pasos donde abrirlas — los logs de la etapa se tiraban enteros. Es el mismo error
		// que tenían las centrales duplicadas, y la solución es la misma: no borrar una de las dos vistas,
		// sino ponerlas juntas. El árbol de la BD es el RESULTADO; los logs, el PROCESO.
		if len(ls) > 0 {
			porNegocio, resto := agruparPorHitos(subMapa.Bloques(o.id), ls)
			e.Subs = append(e.Subs, porNegocio...)
			// Y se FUSIONAN los pasos que son la misma consulta vista por BD y por log: una fila por cosa,
			// con el hecho y la evidencia juntos, en vez de dos filas que hay que cruzar de cabeza.
			e.Subs = fusionarCentrales(e.Subs, subMapa.Bloques(o.id), centrales)
			if len(resto) > 0 {
				// Cuántas de estas llegaron acá POR SPAN y no por patrón. Se dice, porque son las dos cosas a
				// la vez: están en la etapa correcta (el span lo garantiza) y el mapa no las nombra. Ese número
				// es el backlog concreto de hitos por declarar.
				porSpan := 0
				for _, l := range resto {
					if l.heredada {
						porSpan++
					}
				}
				det := "candidatos a declararse como hitos en mapa/substeps.json"
				if porSpan > 0 {
					det = fmt.Sprintf("%d ubicadas por span · %s", porSpan, det)
				}
				e.Subs = append(e.Subs, Sub{
					Label:  fmt.Sprintf("Eventos sin nombre de negocio (%d líneas)", len(resto)),
					Status: "skip", Source: "loki",
					Detail: det,
					Hijos:  gruposDeLog(resto),
				})
			}
		}

		// EL LOG YA NO VIVE EN LA ETAPA: vive en cada sub-paso, que es el que lo produjo. Antes esta etapa
		// volcaba sus 110 líneas en un panel al final, mezcladas y sin dueño — había que leerlas enteras para
		// saber cuál correspondía a «Datos personales» y cuál a la cascada de KYC. Con las líneas repartidas
		// se abre el paso que interesa y se ven SUS líneas, como en un run de CI.
		//
		// `EventosDe` a nivel etapa se mantiene como TOTAL (lo usa la cabecera y el aviso de recorte), pero
		// sin `Eventos`: duplicar las líneas en los dos niveles es peso y una segunda verdad que deriva.
		e.EventosDe = len(ls)

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
				// ⚠ `disbursed_lender` LLENO no significa «el webhook llegó»: significa que alguien escribió
				// quién desembolsa, y quién es ese alguien DEPENDE DEL RAMAL. Visto en prod: la uReq 520830
				// (Crediemo, rt=2) y la 509592 (Credifamilia) decían «el webhook se aplicó» — una decide
				// in-platform y la otra radica por SOAP; ninguna tiene ese webhook. Es el mismo error que
				// `Ado` en el buró —un mecanismo atribuido al lugar equivocado— y manda a soporte a revisar
				// una integración inexistente.
				//
				// No se pregunta por el nombre del ramal sino por su DECLARACIÓN: si el ramal puso
				// `respuesta-lender` en `noAplica`, este webhook no es lo que llenó el campo. Así, agregar un
				// ramal nuevo no obliga a volver acá.
				porWebhook := true
				if r := mapa.Ramal(fam); r != nil {
					for _, p := range r.NoAplica {
						if p.ID == "respuesta-lender" {
							porWebhook = false
						}
					}
				}
				if porWebhook {
					e.Detail = "el webhook se aplicó: desembolsa " + nom
					e.Subs = append(e.Subs, Sub{Label: "Llegó y se aplicó", Status: "ok", Source: "db",
						Detail: "profiling_reviews.disbursed_lender = " + nom})
				} else {
					// Se dice qué se SABE (el campo está lleno) y qué NO (quién lo llenó). El endpoint del
					// webhook acepta cualquier `lender_id` sin lista blanca —verificado en
					// ListLenderController::storeLenderResult— y no deja huella de recepción (F-94), así que
					// «lo llenó el flujo local» sería una afirmación sin evidencia. La declaración del ramal es
					// lo único que hay, y se cita como lo que es: una declaración.
					e.Detail = fmt.Sprintf("desembolsa %s. ⚠ el ramal «%s» declara que NO espera este webhook "+
						"(%s) — y el campo no dice QUIÉN lo escribió: el webhook no registra su recepción "+
						"(F-94) y su endpoint acepta cualquier lender. El dato es bueno; la etiqueta «webhook» "+
						"no se puede afirmar.", nom, fam, porqueNoAplica(mapa, fam, "respuesta-lender"))
					e.Subs = append(e.Subs, Sub{Label: "Desembolso registrado, autor desconocido", Status: "ok",
						Source: "db", Detail: "profiling_reviews.disbursed_lender = " + nom})
				}
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

		// ── «NO APLICA A ESTE RAMAL» ──
		//
		// Los ramales ya declaraban en `noAplica` qué etapas no existen para cada familia, pero eso sólo se
		// usaba para dibujar el diagrama: el ensamblado mostraba las nueve etapas para toda solicitud. Por eso
		// una solicitud rt=0 (que SALE a una url externa y no vuelve) mostraba «Validación biométrica · no
		// consultada», como si hubiera un tramo que se saltó. Es la misma familia de error que tenía `Ado` en
		// el buró: un lugar del flujo donde eso no ocurre nunca.
		//
		// ⚠ SÓLO cuando la etapa NO TIENE EVIDENCIA, y «evidencia» no es «tiene subs»: el catálogo declarado
		// ya mete una fila por central con «no consultada», que es un placeholder, no un hecho. Si se mide
		// por `len(Subs)` la regla nunca dispara — así lo escribí primero y no disparó. Evidencia = un sub
		// con datos (status ≠ skip), líneas de log, o una hora.
		//
		// Si aparece evidencia en una etapa declarada no-aplicable, se muestra tal cual: declarar «no aplica»
		// NO puede hacer desaparecer un dato medido, y la contradicción es un hallazgo — o el mapa está mal o
		// el flujo cambió.
		// Se miran LOS DOS EJES: el canal (por comercio) y el ramal (por response_type del lender). El canal
		// va primero porque decide antes en el flujo —en la validación del OTP— y porque existe sin que haya
		// lender elegido todavía, mientras el ramal sólo se conoce después de `seleccion`.
		if declNoAplica != "" && !tieneEvidencia(e) {
			e.Status, e.Source = "no-aplica", "db"
			e.Detail = "no aplica a « " + declNoAplica + " » — " + declPorque
			e.Reason = "" // el diagnóstico de la etapa asume que el tramo existe; acá no existe
			e.Subs = nil  // eran placeholders del catálogo: listarlos invita a buscar lo que no hay
		}
		t.Etapas = append(t.Etapas, e)
	}

	// Las etapas anteriores a la última probada se marcan `sin-registro`: ocurrieron (el flujo pasó por
	// ahí) pero la BD no las anotó. Distinto de `skip`, que es "el flujo no llegó".
	//
	// ⚠ SÓLO SI EL RAMAL LA DECLARA OBLIGATORIA. «El flujo siguió, así que esto ocurrió» vale para una etapa
	// por la que hay que pasar; para una CONDICIONAL es una invención. Los ramales ya declaran `obligatorio`
	// exactamente para esto y la inferencia no lo miraba: por eso `formulario` —cuyas dos pantallas salen
	// sólo con ONB002/ONB004, y que un usuario ya registrado se salta entero— venía diciendo «ocurrió pero no
	// quedó registrada» de una pantalla que probablemente nunca se mostró.
	obligatoria := func(id string) bool {
		if fam == "" {
			return true // sin ramal conocido no hay nada que consultar: se mantiene el comportamiento previo
		}
		r := mapa.Ramal(fam)
		if r == nil {
			return true
		}
		for _, p := range r.Pasos {
			if p.ID == id {
				return p.Obligatorio
			}
		}
		return false // no está entre los pasos del ramal: no se puede afirmar que ocurrió
	}
	ultimaProbada := -1
	for i, e := range t.Etapas {
		if e.Status == "ok" || e.Status == "warn" || e.Status == "fail" {
			ultimaProbada = i
		}
	}
	for i := range t.Etapas {
		if i >= ultimaProbada || t.Etapas[i].Status != "skip" {
			continue
		}
		if obligatoria(t.Etapas[i].ID) {
			t.Etapas[i].Status = "sin-registro"
			t.Etapas[i].Detail = "ocurrió (el flujo siguió más adelante) pero no quedó registrada"
			continue
		}
		// `condicional` y no `skip`: la vista traduce `skip` como «no se ejecutó», que es una AFIRMACIÓN — la
		// misma que este texto se niega a hacer. Dejarlo en `skip` ponía el rótulo «no se ejecutó» justo
		// encima de «no se puede afirmar ninguna de las dos cosas».
		t.Etapas[i].Status = "condicional"
		t.Etapas[i].Detail = fmt.Sprintf("sin registro y CONDICIONAL en «%s»: el flujo siguió, pero esta "+
			"etapa puede no haber ocurrido — no se puede afirmar ninguna de las dos cosas", fam)
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

// agruparPorHitos reparte las líneas de una etapa entre los HITOS declarados en mapa/substeps.json y
// devuelve un Sub por hito con actividad — con su NOMBRE DE NEGOCIO — más las líneas que ningún hito
// reclamó. Es lo que hace legible la vista: «Datos personales ×24» dice algo; el nombre del orquestador
// no. Los nombres viven en el JSON a propósito: afinarlos es editar datos, no Go.
//
// Lo no reclamado NO se esconde: se pliega como «eventos sin nombre de negocio», que es el backlog
// honesto de hitos por declarar. Esconderlo haría parecer que el mapa cubre todo, que es justo lo que no
// se puede saber sin mirarlo.
func agruparPorHitos(bloques []*BloqueDef, ls []Linea) ([]Sub, []Linea) {
	type acc struct {
		n       int
		primero int64
		err     string
		lineas  []Linea // las líneas de ESTE hito, para poder abrirlo y ver sus logs
	}
	porHito := map[string]*acc{}
	var resto []Linea
	for _, l := range ls {
		var dueno *HitoDef
		for _, b := range bloques {
			for i := range b.Hitos {
				h := &b.Hitos[i]
				if h.Matcher != nil && h.Matcher.coincide(l.msg, l.ctx) {
					dueno = h
					break
				}
			}
			if dueno != nil {
				break
			}
		}
		if dueno == nil {
			resto = append(resto, l)
			continue
		}
		a := porHito[dueno.ID]
		if a == nil {
			a = &acc{primero: l.ts}
			porHito[dueno.ID] = a
		}
		a.n++
		a.lineas = append(a.lineas, l)
		if l.level == "error" && a.err == "" {
			if c := pick(l.ctx, []string{"error_code"}); c != "" {
				a.err = c
			} else {
				a.err = "error"
			}
		}
	}
	// UN SUB POR BLOQUE, con sus hitos como hijos. Antes esto devolvía la lista plana de hitos y el mapa ya
	// declaraba los grupos —«Centrales», «Validación de identidad (KYC)», «¿Se disparó?»—, así que el
	// agrupamiento existía y se tiraba: el buró mostraba «Pasos 14» mezclando el RESULTADO (a quién se
	// consultó y qué dijo) con el PROCESO (qué fue pasando). Son dos preguntas distintas y en una lista de 14
	// no se lee ninguna.
	var subs []Sub
	for _, b := range bloques {
		var hijos []Sub
		erroneo, primero := false, int64(0)
		for _, h := range b.Hitos {
			a := porHito[h.ID]
			if a == nil {
				continue // los hitos SIN actividad los pinta la vista desde el mapa, apagados
			}
			st := "ok"
			// Un hito ENLAZADO a una central no lleva hora: se va a fusionar con la fila de BD, que ya trae
			// la suya, y dos horas seguidas en un mismo renglón no se leen — parecen dos eventos.
			det := fmt.Sprintf("×%d · %s", a.n, hhmm(time.UnixMilli(a.primero)))
			if h.Central != 0 {
				det = fmt.Sprintf("×%d", a.n)
			}
			if a.err != "" {
				// `a.err` es el `error_code` cuando existe y el literal "error" cuando no. Concatenarlo
				// siempre daba «×10 con error error».
				sufijo := " con error"
				if a.err != "error" {
					sufijo += " " + a.err
				}
				st, det, erroneo = "fail", det+sufijo, true
			}
			hj := Sub{Label: h.Label, Status: st, Detail: det, Source: "loki"}
			hj.Eventos, hj.EventosDe = eventosDe(a.lineas, 40)
			hijos = append(hijos, hj)
			if primero == 0 || a.primero < primero {
				primero = a.primero
			}
		}
		if len(hijos) == 0 {
			continue
		}
		st, det := "ok", fmt.Sprintf("%s · %s", plural(len(hijos), "paso", "pasos"), hhmm(time.UnixMilli(primero)))
		if erroneo {
			st, det = "fail", "con error · "+det
		}
		subs = append(subs, Sub{Label: b.Label, Status: st, Detail: det, Source: "loki", Hijos: hijos})
	}
	return subs, resto
}

// eventosDe convierte líneas crudas en eventos para la vista, en orden cronológico y con tope.
//
// LOS ERRORES VAN PRIMERO AL RECORTAR y después se reordena por hora: si hay que cortar, lo que no puede
// faltar es la línea que explica el fallo. Es la misma regla que ya usaba el panel de log de la etapa —
// vive acá para que valga igual en los dos lugares en vez de duplicarse y derivar.
func eventosDe(ls []Linea, tope int) ([]Evento, int) {
	if len(ls) == 0 {
		return nil, 0
	}
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
	if tope > 0 && len(orden) > tope {
		orden = orden[:tope]
	}
	sort.Slice(orden, func(i, j int) bool { return orden[i].ts < orden[j].ts })
	out := make([]Evento, 0, len(orden))
	for _, l := range orden {
		out = append(out, Evento{At: hhmm(time.UnixMilli(l.ts)), Level: l.level, Msg: trim(l.msg, 400)})
	}
	return out, len(ls)
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
		lineas []Linea // igual que en los hitos: abrir el renglón muestra SUS líneas
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
		it.lineas = append(it.lineas, l)
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
		sb := Sub{Label: k, Status: st, Detail: d, Source: "loki"}
		sb.Eventos, sb.EventosDe = eventosDe(it.lineas, 40)
		out = append(out, sb)
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
		// `no-aplica` lleva glifo PROPIO y no el punto de `skip`: «acá esto no ocurre nunca en este ramal» es
		// una pregunta cerrada, y verla igual que «podía pasar y no pasó» manda a buscar un tramo que no existe.
		"no-aplica": gray("∅"), "condicional": gray("·"),
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
	// span: el `span_id` que Loki trae COMO ETIQUETA. Se guardaba nada de las etiquetas salvo `level`, y ese
	// descarte es la causa del hueco de cobertura: un span es una unidad de trabajo REAL (una acción de
	// controlador, un método de servicio), así que todas las líneas de un mismo span pertenecen al mismo
	// momento del flujo. Con el span, ubicar una línea no depende de reconocer su prosa.
	span  string
	trace string
	// heredada: esta línea NO matcheó ningún patrón — la ubicó el span. Se marca porque es evidencia más
	// débil que una línea reclamada por un patrón declarado, y mezclarlas haría que el mapa parezca cubrir
	// más de lo que cubre. La vista la muestra bajo «eventos sin nombre de negocio» de su etapa.
	heredada bool
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

	// ── EL ANCLA FILTRA POR CAMPO, NO POR SUBSTRING ──
	//
	// Antes era `|= "88255"` más una verificación acá de que algún campo del contexto valiera eso. Misma
	// precisión, pero el filtrado ocurría DESPUÉS de traer las líneas, y eso tiene dos costos: se transfiere
	// ruido (medido: `|= "88255"` trae 66 líneas y sólo 45 son del usuario — el resto lo lleva en una clave de
	// caché, un monto o el texto del mensaje), y ese ruido consume el `limit` de 5000. Para un cliente que
	// aparece en muchas líneas, las anclas de verdad se pueden quedar afuera del tope sin que nada avise.
	//
	// `| json | context_user_id="X"` lo resuelve del lado del servidor. Y aplana los anidados: un mismo filtro
	// alcanza `user_id` y `user.id` (medido: 33 + 12 = 45).
	//
	// ⚠ SE VERIFICÓ QUE `| json` NO PIERDA LÍNEAS antes de cablearlo, porque descarta en silencio lo que no
	// puede parsear —sería perder evidencia, justo lo contrario de lo que se busca—. Medido sobre un trace
	// entero: 24 líneas sin `| json` y 24 con, y `__error__="JSONParserErr"` devuelve cero. Si algún día el
	// backend loguea texto plano, esta consulta lo va a callar: el chequeo hay que repetirlo.
	traces := map[string]bool{}
	anclas := map[string]int{}
	var crudas []Linea
	for _, ancla := range []struct{ valor, campos, filtro string }{
		// ⚠ LAS DOS GRAFÍAS, y no es prolijidad: la integración BNPL de Bancolombia loguea
		// `context_userRequestId` en camelCase mientras el resto del backend usa snake_case. Cablear sólo
		// snake_case costó 5 de las 7 líneas ancladas de la uReq 520374 (Alkosto) y 3 de sus 5 traces — la
		// traza pasó de 12 líneas a 6 sin que nada avisara. Lo atrapó comparar antes/contra-después; si se
		// agrega una integración nueva, este es el chequeo que hay que repetir.
		// `context_request_id` es el TERCER nombre, y el más delicado: es el id de correlación del
		// microservicio de PDFs (`PdfMapperClient`: `$request->requestId ?? Str::uuid()`), al que le pasan el
		// uReq. Su valor coincide con nuestra solicitud, pero el campo no significa «user_request» — si otro
		// llamador le pasa un id numérico distinto, podría anclar de más. Se incluye porque es la ÚNICA
		// evidencia del tramo de generación de documentos (4 líneas medidas en la uReq 520835) y porque el
		// chequeo por valor de contexto sigue puesto detrás.
		{fmt.Sprint(s.ID), "user_request_id",
			`context_user_request_id="%s" or context_userRequestId="%s" or context_request_id="%s"`},
		{fmt.Sprint(s.UserID), "user_id",
			`context_user_id="%s" or context_userId="%s" or context_user_by_cell_phone_id="%s"`},
	} {
		if ancla.valor == "" || ancla.valor == "0" {
			continue
		}
		filtro := strings.ReplaceAll(ancla.filtro, "%s", ancla.valor)
		// El chequeo por contexto se mantiene aunque el filtro ya sea exacto: es la red que atrapa un cambio
		// de nombre de campo del lado del backend. Si el filtro dejara de aplicar, esto lo cortaría igual.
		ls, tr, err := lineasYTraces(cl, fmt.Sprintf(`%s | json | %s`, sel, filtro), desde, hasta, ancla.valor)
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
	// ── DESCARTAR LO QUE ES DE OTRA SOLICITUD ──
	//
	// La expansión trae la petición completa, y ahí entra la única contaminación real que tiene este método:
	// se ancla también por `user_id`, así que un cliente con VARIAS solicitudes arrastra los traces de las
	// otras. Medido en prod: la uReq 520530 traía 5 líneas de la 520535 y la 519372, 3 de la 519397 — las dos
	// de clientes con 4 solicitudes. En clientes de una sola solicitud, cero.
	//
	// Y no hay que suponer nada para arreglarlo: esas líneas dicen a qué solicitud pertenecen EN SU PROPIO
	// CONTEXTO. Una línea que trae `user_request_id` de otra solicitud no es dudosa, es ajena. Se descarta.
	//
	// ⚠ Lo que NO se puede descartar son las líneas sin `user_request_id` de un trace mezclado: no dicen de
	// quién son. Se quedan —tirarlas costaría la mayoría de la evidencia— y el trace mezclado se AVISA, que
	// es la diferencia entre una duda declarada y una suposición silenciosa.
	mio := comoTexto(s.ID)
	tracesMezclados := map[string]bool{}
	ajenas := map[string]int{}
	limpias := make([]Linea, 0, len(todas))
	for _, l := range todas {
		ur := pick(l.ctx, []string{"user_request_id", "userRequestId", "user_request"})
		if ur != "" && ur != mio {
			ajenas[ur]++
			tracesMezclados[l.trace] = true
			continue
		}
		limpias = append(limpias, l)
	}
	if len(ajenas) > 0 {
		var quienes []string
		total := 0
		for k, n := range ajenas {
			quienes = append(quienes, fmt.Sprintf("%s×%d", k, n))
			total += n
		}
		sort.Strings(quienes)
		notas = append(notas, fmt.Sprintf("%d líneas DESCARTADAS por ser de otra solicitud del mismo cliente "+
			"(%s): las trae la expansión por trace y lo dicen en su propio contexto", total, strings.Join(quienes, " ")))
		// Las líneas SIN uReq de esos mismos traces no se pueden atribuir con certeza. Se cuentan y se avisa.
		dudosas := 0
		for _, l := range limpias {
			if tracesMezclados[l.trace] && pick(l.ctx, []string{"user_request_id", "userRequestId", "user_request"}) == "" {
				dudosas++
			}
		}
		if dudosas > 0 {
			notas = append(notas, fmt.Sprintf("%d líneas vienen de un trace que toca DOS solicitudes y no "+
				"dicen de cuál son: se muestran, pero no se pueden afirmar de esta", dudosas))
		}
	}

	partes := make([]string, 0, len(anclas))
	for k, n := range anclas {
		partes = append(partes, fmt.Sprintf("%s→%d", k, n))
	}
	sort.Strings(partes)
	notas = append(notas, fmt.Sprintf("anclas %s · %d traces → %d líneas", strings.Join(partes, " "), len(ids), len(limpias)))
	return limpias, notas
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
			l := Linea{level: st.Stream["level"], msg: v[1], ctx: map[string]any{},
				span: st.Stream["span_id"], trace: st.Stream["trace_id"]}
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
	subMapa, err := CargarSub()
	if err != nil {
		return Traza{}, nil, fmt.Errorf("el árbol declarado no carga: %w", err)
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
	s.Corbeta = GetCorbetaAllieds(fuente)[s.AlliedID]
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
	// Y los del SNAPSHOT del listado. Faltaban: los ids se juntaban sólo de los logs, pero las entidades
	// mostradas salen de `profiling_reviews.displayed_lenders`, que es BD. Con pocas líneas de log —el caso
	// normal cuando el flujo salió bien— el árbol quedaba con la elegida clasificada y el resto en «sin
	// clasificar», incluidos lenders tan conocidos como Addi o Sistecrédito (uReq 520830 de prod: 1 de 5).
	if s.Perfilamiento != nil {
		for _, l := range s.Perfilamiento.Mostrados {
			if l.ID > 0 {
				idsLender = append(idsLender, l.ID)
			}
		}
	}
	lenders := GetLenders(fuente, idsLender)

	t := ensamblar(mapa, subMapa, s, lineas, target, centrales, lenders)
	t.Warnings = append(t.Warnings, notas...)
	return t, s, nil
}

// Resolver traduce cédula/teléfono/uReq a intentos, sobre cualquier fuente.
func Resolver(r Runner, valor string) ([]Coincidencia, []string, error) {
	return resolverFuente(r, valor)
}

func modoTraza(c config, target string, ureq int64, jsonOut bool, htmlOut string) int {
	// Render-only: el armado vive en ArmarTraza, que es el MISMO camino del server y del HTML. Este modo
	// duplicaba ese cuerpo entero — la clase de deriva que este repo señala en trace.ts/veredicto().
	_ = c
	t, s, err := ArmarTraza(target, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s no puedo armar la traza para target «%s»: %v\n\n", paint("31", "✘"), target, err)
		return 2
	}

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
	UserID    int64
	Estado    int
	EstadoN   string
	Lender    string
	Comercio  string
	Creada    time.Time
	Documento string
	Telefono  string
	// Directa: lo trajo la búsqueda literal, no la expansión a la persona. La distinción no es cosmética
	// —es la diferencia entre «esto es lo que pediste» y «esto es el resto de su vida»—, y sin marcarla la
	// lista de un ureq pasa de 1 fila a 40 sin decir cuál era la que se buscó.
	Directa bool
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

	traer := func(where, etiqueta, arg string, directa bool) error {
		fs, err := r.Filas(sqlBuscar+where+sqlBuscarOrden, arg)
		if err != nil {
			return err
		}
		nuevos := 0
		for _, f := range fs {
			id := entero(f["id"])
			if vistos[id] {
				continue
			}
			vistos[id] = true
			nuevos++
			out = append(out, Coincidencia{
				UReq: id, UserID: entero(f["uid"]), Estado: int(entero(f["st"])), EstadoN: texto(f["estado"]),
				Lender: texto(f["lender"]), Comercio: texto(f["comercio"]), Creada: fecha(f["created_at"], r.Zona()),
				Documento: texto(f["documento"]), Telefono: texto(f["telefono"]), Directa: directa,
			})
		}
		if nuevos > 0 && etiqueta != "" {
			como = append(como, fmt.Sprintf("%s → %d", etiqueta, nuevos))
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
		if err := traer(p.where, p.etiqueta, valor, true); err != nil {
			return nil, nil, err
		}
	}

	// SE EXPANDE A LA PERSONA. Buscar por número de solicitud devolvía UNA fila, y ahí se perdía lo que el
	// soporte más necesita: si esta persona ya intentó antes y qué le pasó. El caso real es el de todos los
	// días — llega un ureq por Jira, se abre, y para saber si es un reintento hay que buscar de nuevo por
	// cédula. La cédula y el teléfono son únicos en `users`, así que esto resuelve a un puñado de user_id
	// (normalmente uno) y cada uno cuesta una consulta más.
	//
	// Con `user_id`, no con el documento: el documento se puede corregir en el camino (ver F-97, el caso de
	// la cédula transpuesta) y buscar por el valor final se comería los intentos hechos con el equivocado.
	personas := map[int64]bool{}
	for _, c := range out {
		if c.UserID > 0 {
			personas[c.UserID] = true
		}
	}
	ids := make([]int64, 0, len(personas))
	for id := range personas {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] }) // determinista: el orden de un map no lo es
	//
	// La expansión NO entra en `como`: `como` responde «cómo coincidió lo que escribiste», y su aviso de
	// ambigüedad («⚠ coincidió como documento y como número de solicitud — mirá bien cuál buscabas») se
	// dispara cuando hay más de una forma. Contar acá la expansión haría saltar ese aviso en casi toda
	// búsqueda, y un aviso que suena siempre deja de avisar. Lo expandido se cuenta en la Historia.
	for _, uid := range ids {
		if err := traer("ur.user_id = ?", "", strconv.FormatInt(uid, 10), false); err != nil {
			return nil, nil, err
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Creada.After(out[j].Creada) })
	return out, como, nil
}

// Historia es la vida de una persona en CreditOp, contada por sus solicitudes. El conteo se hace ACÁ y no
// en la vista por la razón de siempre: «roto» es una definición de negocio (`malos`/`sellados`), y si la
// Vue tallara sus propios totales habría dos respuestas para «¿cuántas veces le fue mal a esta persona?».
type Historia struct {
	Total     int    `json:"total"`
	Aprobadas int    `json:"aprobadas"`
	Rotas     int    `json:"rotas"`
	Abandonad int    `json:"abandonadas"`
	EnCurso   int    `json:"enCurso"`
	Desde     string `json:"desde"`
	Hasta     string `json:"hasta"`
	Personas  int    `json:"personas"`  // >1 = el valor coincidió con clientes distintos: mirá bien cuál
	MismoDia  int    `json:"mismoDia"`  // el día con más intentos: 5 en un día es un reintento, no un cliente indeciso
	Truncada  bool   `json:"truncada"`  // se llegó al LIMIT: hay más solicitudes de las que se ven
	Comercios int    `json:"comercios"` // intentar en varios comercios distingue «no le alcanza» de «este comercio falla»
	// Expandidas: las que NO pidió la búsqueda literal y aparecieron por ser del mismo cliente. Se cuenta
	// acá y no en `como` para no disparar el aviso de ambigüedad en cada búsqueda (ver resolverFuente).
	Expandidas int `json:"expandidas"`
}

// plural evita el «1 solicitud(es)», que en una herramienta de soporte se lee como descuido.
func plural(n int, uno, muchos string) string {
	if n == 1 {
		return "1 " + uno
	}
	return fmt.Sprintf("%d %s", n, muchos)
}

// resumirHistoria arma el resumen y su versión en una línea para la consola.
func armarHistoria(cs []Coincidencia) Historia {
	h := Historia{Total: len(cs)}
	if len(cs) == 0 {
		return h
	}
	porDia := map[string]int{}
	personas, comercios := map[int64]bool{}, map[string]bool{}
	for _, c := range cs {
		switch desenlaceDe(c.Estado) {
		case "aprobado":
			h.Aprobadas++
		case "roto":
			h.Rotas++
		case "abandonado":
			h.Abandonad++
		default:
			h.EnCurso++
		}
		d := c.Creada.Local().Format("2006-01-02")
		porDia[d]++
		if porDia[d] > h.MismoDia {
			h.MismoDia = porDia[d]
		}
		if c.UserID > 0 {
			personas[c.UserID] = true
		}
		if c.Comercio != "" {
			comercios[c.Comercio] = true
		}
		if !c.Directa {
			h.Expandidas++
		}
	}
	h.Personas, h.Comercios = len(personas), len(comercios)
	// `cs` viene ordenado de más nueva a más vieja (lo ordena resolverFuente).
	h.Hasta = cs[0].Creada.Local().Format("2006-01-02")
	h.Desde = cs[len(cs)-1].Creada.Local().Format("2006-01-02")
	// El LIMIT del buscador. Si se alcanzó exacto, hay que decirlo: un «12 solicitudes» que en realidad son
	// 228 cambia el diagnóstico de «reintentó» a «algo la está reintentando sola».
	h.Truncada = len(cs) >= limiteBusqueda
	return h
}

func resumirHistoria(cs []Coincidencia) string {
	h := armarHistoria(cs)
	if h.Total == 0 {
		return ""
	}
	partes := []string{plural(h.Total, "solicitud", "solicitudes")}
	for _, p := range []struct {
		n    int
		u, m string
	}{{h.Aprobadas, "aprobada", "aprobadas"}, {h.Rotas, "rota", "rotas"},
		{h.Abandonad, "abandonada", "abandonadas"}, {h.EnCurso, "en curso", "en curso"}} {
		if p.n > 0 {
			partes = append(partes, plural(p.n, p.u, p.m))
		}
	}
	if h.Desde != h.Hasta {
		partes = append(partes, "de "+h.Desde+" a "+h.Hasta)
	} else {
		partes = append(partes, "todas el "+h.Hasta)
	}
	if h.MismoDia > 1 {
		partes = append(partes, fmt.Sprintf("hasta %d el mismo día", h.MismoDia))
	}
	if h.Comercios > 1 {
		partes = append(partes, fmt.Sprintf("%d comercios", h.Comercios))
	}
	if h.Personas > 1 {
		partes = append(partes, fmt.Sprintf("⚠ %d clientes distintos", h.Personas))
	}
	if h.Expandidas > 0 {
		partes = append(partes, fmt.Sprintf("%d por la misma persona", h.Expandidas))
	}
	if h.Truncada {
		partes = append(partes, fmt.Sprintf("⚠ recortado en %d", limiteBusqueda))
	}
	return strings.Join(partes, " · ")
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
	fmt.Printf("     %s\n\n", gray(resumirHistoria(cs)))
	for _, c := range cs {
		res := map[string]string{
			"aprobado": green("aprobado"), "roto": red(malos[c.Estado]),
			"abandonado": paint("33", "abandonado"), "en-curso": gray("en curso"),
		}[desenlaceDe(c.Estado)]
		marca := "  "
		if c.Directa {
			marca = paint("36", "◂ ") // lo que se buscó, frente a lo que trajo la expansión a la persona
		}
		fmt.Printf("   %s%-8d %s  %-11s %-24s %s\n", marca, c.UReq, c.Creada.Local().Format("2006-01-02 15:04"),
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

// validacionIdentidad traduce el enum `IdentityValidationType` (Modules/Identity/App/Enums) y dice —lo
// importante— si ese camino DEJA FILA en `risk_central_user_data`. Sin ese dato, la etapa biométrica no se
// puede leer: para casi la mitad de los lenders la ausencia de filas es lo normal, no una señal.
var validacionIdentidad = map[int]struct {
	nombre   string
	dejaFila bool
}{
	0: {"sin configurar (Unknown)", false},
	1: {"ninguna — el lender no valida identidad", false},
	2: {"AWS OCR + Rekognition", false}, // documento + facial; rastro sólo en logs
	3: {"preguntas de seguridad", false},
	4: {"Ado (enrolamiento externo)", true},
	5: {"CrossCore (Credifamilia V2)", true},
	6: {"Evidente (Credifamilia V2)", true},
}

// primeraHoraDeSubs: la hora más temprana entre los subs CON datos. El detalle de una central viene como
// «score 488 · 16:00:27» o «sin score · 16:00:27», así que la hora son los últimos 8 caracteres — se lee
// desde ahí y no de la fila original porque `Sub` es lo único que llega hasta acá.
func primeraHoraDeSubs(subs []Sub) string {
	mejor := ""
	for _, s := range subs {
		if s.Status == "skip" || len(s.Detail) < 8 {
			continue
		}
		h := s.Detail[len(s.Detail)-8:]
		if !reHora.MatchString(h) {
			continue
		}
		if mejor == "" || h < mejor {
			mejor = h
		}
	}
	return mejor
}

var reHora = regexp.MustCompile(`^\d{2}:\d{2}:\d{2}$`)

// noAplicaPorQue contesta «¿esta etapa NO EXISTE para esta solicitud?» mirando los DOS ejes, y devuelve
// quién lo declara más el motivo. Vacío = no está declarado, y entonces la etapa se muestra: la diferencia
// entre «acá esto no ocurre nunca» y «acá no hay evidencia» es la que hace que un árbol dinámico sea útil o
// mentiroso.
func noAplicaPorQue(m *Mapa, s *Solicitud, fam, etapa string) (string, string) {
	// CANAL primero: decide en la validación del OTP, o sea antes de que exista un lender elegido.
	if s.Corbeta {
		if c := m.Canal("corbeta"); c != nil {
			for _, p := range c.NoAplica {
				if p.ID == etapa {
					return c.Label, p.Porque
				}
			}
		}
	}
	if fam == "" {
		return "", "" // sin lender no hay ramal que consultar, y eso es correcto: aún no se decidió
	}
	if r := m.Ramal(fam); r != nil {
		for _, p := range r.NoAplica {
			if p.ID == etapa {
				return "ramal " + fam, p.Porque
			}
		}
	}
	return "", ""
}

// porqueNoAplica devuelve el motivo declarado, recortado para caber en una línea de detalle. El motivo
// completo vive en `mapa/ramales.json` y se lee ahí.
func porqueNoAplica(m *Mapa, fam, etapa string) string {
	if r := m.Ramal(fam); r != nil {
		for _, p := range r.NoAplica {
			if p.ID == etapa {
				return trim(p.Porque, 90)
			}
		}
	}
	return "declarado en mapa/ramales.json"
}

// declaradaEn: ¿esta central está declarada como propia de esta etapa? El reparto vive en
// `mapa/substeps.json`, así que la respuesta es un dato, no una lista en Go.
func declaradaEn(sub *SubMapa, etapa, central string) bool {
	for _, b := range sub.Bloques(etapa) {
		for _, c := range b.Conocidos {
			if c.Label == central {
				return true
			}
		}
	}
	return false
}

// fusionarCentrales junta los pasos que son LA MISMA COSA vista desde dos fuentes: la fila de
// `risk_central_user_data` (el hecho: se consultó, esto devolvió) y las líneas de log de esa misma consulta
// (la evidencia: cuántos intentos, con qué error).
//
// El enlace lo declara el mapa (`hito.central` → `risk_centrals.id`), no una coincidencia de nombres:
// «Agildata» y «Identidad con AgilData» no se parecen lo suficiente para adivinarlo, y adivinar acá uniría
// pasos que no van juntos. Los hitos que NO declaran central (la compuerta de reintentos, la persistencia)
// quedan como están: son proceso, no una consulta.
func fusionarCentrales(subs []Sub, bloques []*BloqueDef, centrales map[int64]string) []Sub {
	// hito label → nombre de la central con la que se fusiona.
	enlace := map[string]string{}
	for _, b := range bloques {
		for _, h := range b.Hitos {
			if h.Central == 0 {
				continue
			}
			if n, ok := centrales[h.Central]; ok && n != "" {
				enlace[h.Label] = n
			}
		}
	}
	if len(enlace) == 0 {
		return subs
	}
	// DOS FASES, y el orden importa. La primera versión indexaba las filas de central con punteros y en la
	// misma pasada reemplazaba `Hijos` por un slice nuevo: los punteros quedaban apuntando al array viejo y
	// el enriquecimiento se escribía en memoria descartada. Compilaba, corría, y no hacía nada.
	//
	// Fase 1: sacar los hitos enlazados y guardar lo que aportan.
	aporta := map[string]Sub{}
	for i := range subs {
		var quedan []Sub
		for _, h := range subs[i].Hijos {
			if destino, ok := enlace[h.Label]; ok {
				aporta[destino] = h
				continue
			}
			quedan = append(quedan, h)
		}
		subs[i].Hijos = quedan
	}
	// Fase 2: aplicarlo sobre la fila de la central, ya con los slices definitivos.
	for i := range subs {
		for j := range subs[i].Hijos {
			c := &subs[i].Hijos[j]
			h, ok := aporta[c.Label]
			if !ok {
				continue
			}
			// La FILA DE BD manda en el estado —es el hecho—, salvo que el log traiga un error: eso el
			// esqueleto no lo sabe y es justo lo que se vino a buscar.
			if h.Status == "fail" {
				c.Status = "fail"
			}
			if h.Detail != "" {
				c.Detail = c.Detail + " · " + h.Detail
			}
			c.Eventos, c.EventosDe = h.Eventos, h.EventosDe
			c.Source = "db+loki"
		}
	}
	// Un grupo que se quedó sin hijos (todos fusionados) ya no dice nada: se cae. Y el que sobrevive
	// RECUENTA: decía «5 pasos» mostrando 3, porque el resumen se armaba antes de fusionar.
	var out []Sub
	for _, s := range subs {
		if len(s.Hijos) == 0 && len(s.Eventos) == 0 && s.Source == "loki" {
			continue
		}
		if s.Source == "loki" && len(s.Hijos) > 0 {
			hora := ""
			if i := strings.LastIndex(s.Detail, " · "); i >= 0 {
				hora = s.Detail[i:]
			}
			err := false
			for _, h := range s.Hijos {
				if h.Status == "fail" {
					err = true
				}
			}
			s.Detail = plural(len(s.Hijos), "paso", "pasos") + hora
			if err {
				s.Detail = "con error · " + s.Detail
			} else {
				s.Status = "ok"
			}
		}
		out = append(out, s)
	}
	return out
}

// tieneEvidencia: ¿esta etapa tiene algo MEDIDO, o sólo el esqueleto declarado? Un sub en `skip` es un
// placeholder («esta central existe y no se consultó»), no un hecho — contarlo como evidencia haría que la
// regla de «no aplica a este ramal» nunca dispare.
func tieneEvidencia(e Etapa) bool {
	if e.Lineas > 0 || e.At != "" {
		return true
	}
	for _, s := range e.Subs {
		if s.Status != "skip" {
			return true
		}
	}
	return false
}

// arbolCentrales lista las centrales que le TOCAN a una etapa: las consultadas con su score y las que no,
// marcadas. Mostrar solo las consultadas dejaría la pregunta a medias — «no fue a consultar» es una
// respuesta.
//
// ⚠ FILTRA POR ETAPA, y esto corrige un error que el mapa tenía: la versión anterior volcaba TODO el
// catálogo de `risk_centrals` en «Consulta a burós», así que `Ado` salía «no consultada» en una etapa donde
// nunca se consulta — ADO es del tramo creditopx, después de elegir la entidad. `risk_centrals` no es «la
// lista de burós»: es donde se guarda cualquier dato de un tercero de identidad o riesgo, y sus filas se
// escriben en momentos distintos. El reparto se declara en `mapa/substeps.json` (bloque `centrales` de cada
// etapa) con el call site que lo prueba, así que afinarlo es editar datos.
//
// `huerfanas` recibe las centrales CON DATOS que ninguna etapa declaró. No se descartan: se devuelven para
// que la etapa del buró las muestre marcadas. Un dato medido que desaparece de la vista porque el mapa no lo
// esperaba es peor que un dato mal ubicado — el segundo se ve, el primero no.
func arbolCentrales(etiqueta string, declaradas []ItemCatalogo, catalogo map[int64]string, filas []FilaBuro) []Sub {
	hechas := map[string]FilaBuro{}
	for _, f := range filas {
		hechas[f.Central] = f
	}
	// UN SOLO GRUPO, con las CONSULTADAS como hijos y las demás resumidas en un renglón. La lista completa
	// de 6 (4 de ellas «no consultada») convertía la pregunta «¿a quién se consultó y qué dijo?» en un
	// ejercicio de descarte. Pero el universo NO se puede omitir: «no se consultó Mareigua» sólo significa
	// algo si sabés que Mareigua existía como opción, así que las no consultadas se cuentan y se nombran.
	var hechos, faltan []Sub
	var nombresFaltan []string
	for _, d := range declaradas {
		// El NOMBRE sale de la BD cuando existe: el catálogo varía por ambiente y el label declarado es solo
		// para dibujar el árbol antes de consultar.
		nombre := d.Label
		if n, ok := catalogo[d.ID]; ok && n != "" {
			nombre = n
		}
		s := subCentral(nombre, hechas)
		if s.Status == "ok" {
			hechos = append(hechos, s)
		} else {
			faltan = append(faltan, s)
			nombresFaltan = append(nombresFaltan, nombre)
		}
	}
	if len(hechos) == 0 && len(faltan) == 0 {
		return nil
	}
	hijos := hechos
	if len(faltan) > 0 {
		hijos = append(hijos, Sub{
			Label:  plural(len(faltan), "no consultada", "no consultadas"),
			Status: "skip", Source: "db", Detail: trim(strings.Join(nombresFaltan, " · "), 70),
		})
	}
	st, det := "ok", fmt.Sprintf("%d de %d consultadas", len(hechos), len(declaradas))
	if len(hechos) == 0 {
		st = "skip"
	}
	return []Sub{{Label: etiqueta, Status: st, Detail: det, Source: "db", Hijos: hijos}}
}

// subCentral arma la fila de UNA central. Separado porque lo usan el reparto declarado y las huérfanas.
func subCentral(nombre string, hechas map[string]FilaBuro) Sub {
	f, ok := hechas[nombre]
	if !ok {
		return Sub{Label: nombre, Status: "skip", Detail: "no consultada", Source: "db"}
	}
	d := hhmm(f.At)
	if f.Score != nil {
		d = fmt.Sprintf("score %.0f · %s", *f.Score, d)
	} else {
		d = "sin score · " + d // Agildata nunca trae score: 0 de 202 filas medidas
	}
	return Sub{Label: nombre, Status: "ok", Detail: d, Source: "db"}
}

// centralesHuerfanas: las que tienen FILAS pero ninguna etapa las declara. Se busca en TODAS las etapas
// (no solo en la del buró) para que una central nueva en la BD aparezca marcada en vez de desaparecer.
func centralesHuerfanas(sub *SubMapa, mapa *Mapa, filas []FilaBuro) []Sub {
	declarada := map[string]bool{}
	for id := range mapa.porEtapa {
		for _, b := range sub.Bloques(id) {
			for _, c := range b.Conocidos {
				declarada[c.Label] = true
			}
		}
	}
	hechas, vistos := map[string]FilaBuro{}, map[string]bool{}
	var nombres []string
	for _, f := range filas {
		hechas[f.Central] = f
		if !declarada[f.Central] && !vistos[f.Central] {
			vistos[f.Central] = true
			nombres = append(nombres, f.Central)
		}
	}
	sort.Strings(nombres)
	var out []Sub
	for _, n := range nombres {
		s := subCentral(n, hechas)
		s.Status = "warn"
		s.Detail += " · ⚠ sin etapa declarada en mapa/substeps.json"
		out = append(out, s)
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
