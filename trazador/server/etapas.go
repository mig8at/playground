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
	// Declarativo: este sub DESCRIBE lo que debería pasar (la configuración del lender, una regla del mapa),
	// no algo que se midió. No cuenta como evidencia. Es la segunda vez que hace falta: «Camino configurado:
	// Ado» pintó de verde la etapa biométrica primero en un rt=1 y después en la uReq 464709 de staging, que
	// tiene CERO centrales consultadas. Una declaración no puede encender una etapa.
	Declarativo bool       `json:"-"`
	Evidencia   *Evidencia `json:"evidencia,omitempty"`
}

// Evidencia es la consulta que respalda un paso de BD, con el `?` ya resuelto para que se pueda pegar en
// Redash y comprobar el renglón. `Filas` son los valores que produjeron ESTE paso —no la fila entera—:
// volcar `SELECT *` mete columnas que no participaron y el lector no puede saber cuáles miró el trazador.
type Evidencia struct {
	Fuente string   `json:"fuente"`
	SQL    string   `json:"sql"`
	Filas  []string `json:"filas,omitempty"`
}

// evidencia arma el bloque resolviendo los `?` posicionalmente. Se resuelven porque una consulta con
// placeholders no se puede pegar y correr, y una evidencia que no se puede correr no es evidencia.
func evidencia(fuente, sqlTexto string, args []any, filas ...string) *Evidencia {
	q := strings.TrimSpace(sqlTexto)
	for _, a := range args {
		q = strings.Replace(q, "?", fmt.Sprint(a), 1)
	}
	limpias := make([]string, 0, len(filas))
	for _, f := range filas {
		if f != "" {
			limpias = append(limpias, f)
		}
	}
	return &Evidencia{Fuente: fuente, SQL: q, Filas: limpias}
}

// orden es la secuencia canónica. `origen` es un agregado del pedido de Miguel: no es una etapa del
// backend sino de dónde entró el cliente, y hoy NO está en los logs — se deduce de la BD (canal/comercio).
var orden = []struct{ id, label string }{
	{"origen", "Origen"},
	{"registro", "Registro y OTP"},
	{"formulario", "Formulario de perfil"},
	{"cupo", "Cupo / POS"},
	{"listado", "Listado de entidades"},
	{"seleccion", "Selección de entidad"},
	{"desembolso", "Desembolso"},
}

// estadoEtapa / estadoCierra / estadoDetiene se derivan del MAPA (etapas.json → bd.estados/cierran/
// detienen) al entrar a ensamblar. Vivían hardcodeados acá y `Mapa.EstadoEtapa()` era código muerto:
// cero call sites, así que editar el JSON no cambiaba nada — el peor tipo de mentira, la que no falla.
// Verificado al cablear: el derivado y el hardcodeado eran idénticos, así que el cableado en sí no movió
// un byte; lo que sí agrega es que `detienen` ahora existe (9→formulario, 10/20/30→desembolso).
var (
	estadoEtapa   map[int]string
	estadoCierra  map[int]bool
	estadoDetiene map[int]string
)

// malos son los desenlaces de muerte: llegar acá sin pedirlo es el fallo, no un matiz. Mismo criterio que
// `harness/pkg/trace.ts` para que "roto" signifique lo mismo en las dos herramientas.
var malos = map[int]string{
	6: "Negada", 8: "Cancelado", 12: "Autorización negada",
	24: "Rechazado por validación de identidad",
}

// sellados = llegó al final. 25 es el sello del canal QR (nunca pasa por 11).
var sellados = map[int]bool{11: true, 28: true, 5: true, 25: true, 26: true}

// La prosa que explicaba estadoCierra/estadoDetiene vive ahora en dos lugares, a propósito: la mecánica
// en el comentario de las vars derivadas (arriba) y los HECHOS medidos en `etapas.json → bd.nota_estados`
// de cada etapa — al lado del dato que justifican, donde los va a leer quien edite el JSON. Los dos falsos
// verdes que motivaron la separación cierran/detienen: el estado 10 (F-103, uReq 464709) y el estado 9,
// cuya fila se escribe al CREAR la solicitud (≤1 s del created_at, 4/4 trazas del censo 2026-08-07).

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
	// La evaluación de categoría por entidad (`users_category_log`): POR QUÉ una entidad in-platform no le
	// salió al cliente. Es la única fuente que lo dice criterio por criterio; el log de texto no puede.
	Categorias []Categoria
	// Las operaciones contra Deceval (`deceval_logs`), el tramo del pagaré digital. Vacío = o el lender no
	// firma con Deceval, o no llegó — el veredicto se cruza con la etapa, no se decide acá.
	Deceval []OpDeceval
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
	// Hallazgos: el resumen de auditoría — todo lo que quedó en fail, con su ruta, ANTES del árbol. Existe
	// para que soporte lea cinco renglones y sepa dónde abrir, en vez de escanear el árbol buscando rojos.
	Hallazgos []string `json:"hallazgos,omitempty"`
	// El estado ACTUAL de la solicitud. Sin esto el outcome no se podía auditar desde el JSON: una traza
	// decía «aprobado» y no había forma de saber contra qué estado se calculó (la 522238 cambió de estado
	// entre dos lecturas y la diferencia era invisible).
	Estado       int    `json:"estado"`
	EstadoNombre string `json:"estadoNombre,omitempty"`
	// Huerfanas: las líneas que ningún patrón del mapa reclamó. Van EN LA TRAZA y no solo contadas en un
	// aviso, porque son el trabajo pendiente concreto: para cerrar el hueco hay que leerlas y declarar el
	// patrón que falta. Un contador no se puede accionar; una lista sí.
	Huerfanas []Evento `json:"huerfanas,omitempty"`
}

// ensamblar arma la traza: primero el esqueleto de la BD (hechos), después el porqué de los logs.
func ensamblar(mapa *Mapa, subMapa *SubMapa, s *Solicitud, lineas []Linea, target string,
	centrales map[int64]string, lenders map[int64]LenderInfo) Traza {
	// Los mapas de estado salen del JSON, no de este archivo: una sola fuente.
	estadoEtapa, estadoCierra, estadoDetiene = mapa.EstadoEtapa(), mapa.EstadoCierra(), mapa.EstadoDetiene()

	t := Traza{UReq: s.ID, Target: target, Sources: []string{"db"}, Estado: s.Estado, EstadoNombre: s.EstadoN}
	if len(lineas) > 0 {
		t.Sources = append(t.Sources, "loki")
	}

	// Qué etapas prueba la BD, y cuándo.
	visto := map[string]time.Time{}
	for _, tr := range s.Transiciones {
		// La misma compuerta que abajo: una transición prueba la etapa SOLO si su estado la cierra. La fila
		// de estado 9 se escribe al crear la solicitud (≤1 s del created_at, medido), así que dejarla pasar
		// acá pintaba «personal-info ✔» con el formulario sin tocar.
		if e, ok := estadoEtapa[tr.Estado]; ok && estadoCierra[tr.Estado] {
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
	// ⚠ SÓLO PARA LOS ESTADOS QUE PRUEBAN QUE LA ETAPA TERMINÓ. `estadoEtapa` contesta «¿a qué etapa
	// PERTENECE este estado?», que es otra pregunta: el estado 10 pertenece a `desembolso` porque el flujo ya
	// está en el tramo de cierre, pero significa que está ADENTRO, no que lo completó. Usar ese mapa acá
	// pintaba la etapa en VERDE para una solicitud detenida en 10 — reportado sobre la uReq 464709 de
	// staging, que falló firmando documentos y salía «Desembolso ✔». Un falso verde es el peor error que
	// puede tener esta herramienta: afirma un éxito que no ocurrió.
	if et, ok := estadoEtapa[s.Estado]; ok && estadoCierra[s.Estado] {
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
		if !declaradaEn(subMapa, "formulario", f.Central) {
			continue
		}
		if v, ya := visto["formulario"]; !ya || f.At.Before(v) {
			visto["formulario"] = f.At
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

	// La etapa de muerte se calcula UNA vez, con todo el material (transiciones + líneas por etapa), y
	// puede ser "": ver etapaDeMuerte.
	muerte := etapaDeMuerte(mapa, s, porEtapa)

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
			// EL MONTO ADELANTE, EL CANAL ABAJO. Esta era la única fila del árbol que no se medía: el canal
			// se ASUME asesor porque `user_requests` no tiene columna de canal. Abrir una traza con una
			// suposición es el peor lugar para ponerla — se lee como el resto, que sí está probado.
			e.Status, e.At, e.Source = "ok", hhmm(s.Creada), "db"
			e.Detail = fmt.Sprintf("%s solicitados", pesos(s.Monto))
			canal := Sub{Label: "Canal de entrada: " + s.Origen, Status: "ok", Source: "db",
				Detail: "derivado de ecommerce_requests"}
			if !s.OrigenDerivado {
				canal.Status, canal.Source = "skip", "default"
				canal.Detail = "ASUMIDO — user_requests no guarda el canal; sólo ecommerce se puede derivar"
				canal.Declarativo = true // una suposición no es evidencia: no puede encender la etapa
			}
			// Las líneas que el mapa enruta a esta etapa (los matchers de canal: «Corbeta checkout»,
			// IsCorbeta/IsEcommerce) se adjuntan al sub del canal: esta etapa no reparte por hitos y antes
			// se CONTABAN y se tiraban — 4 líneas en 2/25 trazas del censo, invisibles hasta en el backlog.
			if len(ls) > 0 {
				canal.Eventos, canal.EventosDe = eventosDe(ls, 40)
				if canal.Source == "default" {
					canal.Source = "loki"
				}
			}
			e.Subs = append(e.Subs, canal)
			// EL FLAG CORBETA ES DEL COMERCIO, NO EL CANAL — y no puede pisar el renglón de arriba: en el
			// censo hubo Corbeta SIN fila de ecommerce (522230, entró por otro lado) y Corbeta CON ella
			// (522215: el QR de Corbeta CREA la fila — «ecommerce» no es falso, es incompleto). Dos hechos
			// distintos, dos renglones. Este es además la fuente del «no aplica» del formulario: si las dos
			// filas salieran de lecturas distintas podrían discrepar, y ya pasó (origen decía «asesor
			// ASUMIDO» mientras formulario decía «Canal Corbeta → Bancolombia»).
			if s.Corbeta {
				e.Subs = append(e.Subs, Sub{
					Label: "Onboarding Corbeta: sí", Status: "ok", Source: "db",
					Detail: fmt.Sprintf("allied %d está en el setting corbeta_allieds — el formulario se "+
						"salta y la info laboral se fabrica", s.AlliedID),
					Evidencia: evidencia("settings", sqlCorbeta, nil,
						fmt.Sprintf("corbeta_allieds contiene %d", s.AlliedID),
						"⚠ es la variante de ONBOARDING del comercio, no el punto de entrada de la solicitud"),
				})
			}
			t.Etapas = append(t.Etapas, e)
			continue
		}
		if at, ok := visto[o.id]; ok {
			e.Status, e.Source, e.At = "ok", "db", hhmm(at)
		} else if estadoDetiene[s.Estado] == o.id {
			// DETENIDA ACÁ. La solicitud entró a esta etapa y no salió: en la BD no figura como rota —sigue
			// «en curso»— así que sin esto la etapa quedaba en gris y el corte no se veía en ninguna parte.
			// Es la respuesta a «¿dónde se quedó?», que es la pregunta con la que llega el soporte.
			//
			// Va como SUB-PASO y no sólo como texto de la etapa: el corte es un hecho de la BD igual que
			// «estado 3 · Seleccionó entidad», y ponerlo en prosa aparte lo sacaba de la lista donde se lee
			// todo lo demás. Con la misma forma que el resto se abre, se copia y se busca igual.
			e.Status, e.Source = "fail", "db"
			e.At = atDelEstado(s, s.Estado)
			e.Subs = append([]Sub{{
				Label:  fmt.Sprintf("estado %d · %s", s.Estado, s.EstadoN),
				Status: "fail", Source: "db",
				Detail: "DETENIDA acá — entró y no salió",
				// La afirmación más fuerte que hace el trazador ES la que más tiene que probarse: «no salió»
				// se sostiene en que el historial se termina acá, y sin el historial a la vista el lector
				// tiene que creer. Es el renglón que soporte copia a un ticket.
				// ⚠ La afirmación se apoya en DOS tablas y hay que decirlo, porque no siempre coinciden: el
				// estado actual vive en `user_requests.user_request_status_id` y el recorrido en
				// `user_request_records`. En la uReq 464709 de staging el estado actual es 10 y el historial
				// NO tiene fila para el 10 — o sea que el registro de transiciones no cubre todos los
				// estados. Escribir «última transición: estado 10» habría sido inventar una fila que no
				// existe, y fue este mismo bloque de evidencia el que lo destapó al mostrarlas juntas.
				Evidencia: evidencia("user_requests + user_request_records", sqlHistorial, []any{s.ID},
					append(historialFilas(s), estadoActualFila(s))...),
			}}, e.Subs...)
		} else if len(ls) > 0 {
			// Sin respaldo en la BD pero con logs: la etapa OCURRIÓ (los logs son evidencia positiva),
			// solo que la BD no la registra. Es el caso de `listado` y `cupo`, por diseño.
			e.Status, e.Source, e.Source = "ok", "loki", "loki"
			e.At = hhmm(time.UnixMilli(ls[0].ts))
		} else if malos[s.Estado] != "" && muerte != "" && o.id == muerte {
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
		// ── CADA LÍNEA VA A LA ENTIDAD QUE NOMBRA ──
		//
		// Muchas líneas del listado traen `lender_id` en su contexto —incluida la excepción de la
		// integración: `Exception in lenderServiceFactory->consult()` viene con `lender_id` Y con la causa en
		// `context_error` («No query results for model [LenderAlliedCredential]» = faltan credenciales, o el
		// 401 del proveedor)—. Mandarlas a un cajón «Fallo consultando al lender» borraba justo el dato que se
		// necesita: CUÁL entidad falló. Con esto la evidencia aterriza en la fila de esa entidad.
		//
		// Y se usa el SPAN para las hermanas mudas: el 401 crudo no trae `lender_id` pero comparte span con la
		// excepción que sí. Mismo criterio que la herencia de etapa — se hereda sólo si el span apunta a UNA
		// entidad; si abarca dos, elegir sería inventar.
		lineasDeLender := map[string][]Linea{}
		if o.id == "listado" && len(ls) > 0 {
			lenderDelSpan := map[string]string{}
			for _, l := range ls {
				if id := pick(l.ctx, []string{"lender_id"}); id != "" && l.span != "" {
					if otro, ya := lenderDelSpan[l.span]; ya && otro != id {
						lenderDelSpan[l.span] = "" // el span toca dos entidades: no desempata
					} else if !ya {
						lenderDelSpan[l.span] = id
					}
				}
			}
			for _, l := range ls {
				id := pick(l.ctx, []string{"lender_id"})
				if id == "" {
					id = lenderDelSpan[l.span]
				}
				if id != "" {
					lineasDeLender[id] = append(lineasDeLender[id], l)
				}
			}
		}

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
			// Se dejan PLANAS a propósito: el bloque de la BD las fusiona por `lender_id` y agrupa por
			// familia UNA vez. Agrupar acá producía dos árboles concatenados —cada entidad dos veces, una
			// con su veredicto y otra con su regla—, que es justo lo que este árbol vino a evitar.
			if len(e.Subs) > 0 {
				e.Status, e.Source = "ok", "loki"
				e.At = hhmm(time.UnixMilli(ls[0].ts))
			}
		}

		// SUB-STEPS DE LA BD — hechos, uno por transición de estado que cae en esta etapa. Van primero
		// porque son lo único que se puede afirmar; los de log vienen después como evidencia.
		for _, tr := range s.Transiciones {
			if estadoEtapa[tr.Estado] != o.id {
				continue
			}
			st, det := "ok", hhmm(tr.At)
			decl := false
			if malos[tr.Estado] != "" {
				st = "fail"
			}
			if tr.Estado == 9 {
				// El hecho se muestra, pero dice lo que es — y no puede encender la etapa (Declarativo):
				// probaría que la solicitud NACIÓ, no que el formulario se llenó.
				det += " · ⚠ esta fila se escribe al CREAR la solicitud: no prueba el formulario"
				decl = true
			}
			e.Subs = append(e.Subs, Sub{
				Label:  fmt.Sprintf("estado %d · %s", tr.Estado, tr.Nombre),
				Status: st, Detail: det, Source: "db", Declarativo: decl,
				// El historial COMPLETO, no sólo esta transición: el renglón afirma «pasó por acá» y lo
				// que lo respalda —o lo desmiente— es la secuencia entera. `user_request_records` repite
				// el mismo estado muchas veces, así que se muestra ya colapsada, igual que se leyó.
				Evidencia: evidencia("user_request_records", sqlHistorial, []any{s.ID}, historialFilas(s)...),
			})
		}
		// Las centrales son un hecho de BD y van en la etapa DONDE SE CONSULTAN, según el reparto declarado
		// en `mapa/substeps.json`. Antes se volcaba el catálogo entero en `buro`, y por eso `Ado` —que es del
		// tramo creditopx, después de elegir la entidad— salía «no consultada» bajo «Consulta a burós».
		for _, b := range subMapa.Bloques(o.id) {
			if b.Tipo == "catalogo" && len(b.Conocidos) > 0 {
				e.Subs = append(e.Subs, arbolCentrales(b.Label, b.Conocidos, centrales, s.Buro, s.UserID)...)
			}
		}
		// Las que tienen datos y ninguna etapa declaró se muestran en el buró, marcadas. Un dato medido que
		// desaparece porque el mapa no lo esperaba es peor que uno mal ubicado: el segundo se ve.
		if o.id == "formulario" {
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
				Detail: det, Declarativo: true}}, e.Subs...)
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
		// Cuántas veces corrió la cascada. Se calcula al repartir los logs y se usa mucho más abajo, al
		// armar el renglón de la etapa, así que vive acá afuera: usar `e.Detail` como buzón no sirve —ese
		// campo se REASIGNA después— y componer a ciegas llegó a pegar dos frases que se contradecían.
		var corridasNota string
		// Las líneas del profiler ML, apartadas ACÁ para que su paso las tenga. Reclamarlas explícitamente
		// —y no dejarlas en el reparto general— es lo que garantiza que aparezcan UNA vez: si además las
		// tomara un hito del mapa, la misma línea saldría en dos renglones y los conteos dirían el doble.
		var lineasProfiler []Linea
		if len(ls) > 0 {
			// El MS de pre-aprobación se agrupa POR ENTIDAD y sale del reparto por mensaje: sus líneas
			// pertenecen a llamadas independientes (una por lender), y mezclarlas en «Veredicto ×14» pierde
			// la pregunta real, que es por cuál de las entidades. Ver `arbolPreaprobacion`.
			var delMS []Linea
			resto0 := ls[:0:0]
			for _, l := range ls {
				if pick(l.ctx, []string{"service_name"}) == "preapprovals-service" {
					delMS = append(delMS, l)
				} else {
					resto0 = append(resto0, l)
				}
			}
			// La pre-aprobación se FUSIONA en la fila de cada entidad del listado, no va como bloque aparte.
			// Es la misma entidad vista por dos fuentes —el snapshot de `profiling_reviews` dice el veredicto,
			// el MS dice cómo se llegó a él— y tenerlas en listas paralelas obliga a cruzarlas de cabeza. La
			// llave es el `lender_id`, que las dos traen: el árbol del listado en `Detail2` y el MS en su
			// etiqueta. Mismo criterio que la fusión de centrales del buró.
			if len(delMS) > 0 {
				e.Subs = fusionarPreaprobacion(e.Subs, arbolPreaprobacion(delMS))
			}
			ls = resto0
			// Lo que ya se atribuyó a una entidad sale de acá: si no, cada línea aparecería dos veces —en su
			// entidad y en el bloque de proceso— y los conteos dirían el doble.
			if len(lineasDeLender) > 0 {
				yaEs := map[string]bool{}
				for _, crudas := range lineasDeLender {
					for _, l := range crudas {
						yaEs[fmt.Sprintf("%d|%s|%s", l.ts, l.span, l.msg)] = true
					}
				}
				quedan := ls[:0:0]
				for _, l := range ls {
					if !yaEs[fmt.Sprintf("%d|%s|%s", l.ts, l.span, l.msg)] {
						quedan = append(quedan, l)
					}
				}
				ls = quedan
			}
			// El LISTADO se parte por CORRIDA: la cascada corre varias veces en una misma solicitud y sus
			// líneas mezcladas no se pueden leer. El resto de las etapas se agrupa por hito, como siempre.
			if o.id == "listado" {
				// El timeout del profiler sale del reparto por hito: es del modelo que ORDENA el listado,
				// no de una entidad ni de la cascada. Se reconoce por la URL, que es la única parte del
				// mensaje que dice de qué era — leer sólo «cURL error 28» llevó a atribuírselo a un lender.
				quedan := ls[:0:0]
				for _, l := range ls {
					if strings.HasPrefix(l.msg, "cURL error 28") && strings.Contains(l.msg, "predict_w") {
						lineasProfiler = append(lineasProfiler, l)
						continue
					}
					quedan = append(quedan, l)
				}
				ls = quedan

				// ── LA CASCADA: UNA LÍNEA, Y SÓLO SI DICE ALGO ──
				//
				// De todo lo que loguea la cascada, UNA sola cosa informaba a soporte —si algo se cayó— y esa
				// ya no vive acá: el timeout del profiler es del ML y se muestra en su propio paso, junto al
				// perfilador que la BD dice que ordenó el listado. Lo que quedaba era el orquestador
				// narrándose a sí mismo («Arranque ×1», «Reglas heredadas ×2», «Recorrido ×2»): confirma que
				// el código ejecutó sus propios pasos y no contesta ninguna pregunta.
				//
				// Así que la fila desaparece y el único dato que sobrevive —CUÁNTAS veces corrió, porque más
				// de una es un reintento y no lo normal— se dice en el renglón de la etapa, sin gastar un
				// nivel de árbol. Las líneas no se pierden: caen en «eventos sin nombre de negocio», que es
				// lo que son.
				if n := corridasDeLaCascada(ls); n > 1 {
					corridasNota = fmt.Sprintf("la cascada corrió %d veces", n)
				}
				// Las líneas que NO son de una corrida (fragmentos de otras peticiones que tocaron el
				// listado) vuelven al agrupamiento por hito: no se pierden, sólo dejan de contarse como
				// ejecuciones de la cascada.
				// ⚠ Se descarta SOLO la línea de apertura, que ya se contó como corrida. La versión anterior
				// descartaba el TRACE ENTERO de cada corrida — o sea, justo el caso sano: la etapa declaraba
				// «22 líneas» y mostraba cero (medido en 522154 22→0, 522237 16→0, 520593 10→0), y el
				// comentario de al lado prometía lo contrario. No hay doble conteo posible: lo atribuido a
				// una entidad ya salió de `ls` más arriba.
				quedanCorrida := ls[:0:0]
				for _, l := range ls {
					if strings.HasPrefix(l.msg, "Iniciando listado de entidades") {
						continue
					}
					quedanCorrida = append(quedanCorrida, l)
				}
				ls = quedanCorrida
			}
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
				// El renglón ya no dice «candidatos a declararse como hitos»: ese es lenguaje del
				// mantenimiento del mapa, no de una auditoría. El backlog sigue siendo este mismo bloque —
				// está dicho acá y en el comentario de Huerfanas, que es donde lo busca quien mantiene.
				det := "informativos"
				if porSpan > 0 {
					det = fmt.Sprintf("informativos · %d ubicadas por span", porSpan)
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

		// ── LA RESPUESTA DEL LENDER: cinco casos que la BD sola no distingue ──
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
						Detail:    "profiling_reviews.disbursed_lender = " + nom,
						Evidencia: evidenciaWebhook(s)})
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
						Source: "db", Detail: "profiling_reviews.disbursed_lender = " + nom,
						Evidencia: evidenciaWebhook(s)})
					// warn y no ok: el mismo ramal rendía esta etapa «no aplica» en una traza y VERDE en la
					// de al lado (522190 vs 522227) — mismo mapa, veredictos opuestos. El dato queda; el
					// color dice que hay una contradicción entre el ramal declarado y el campo lleno.
					e.Status = "warn"
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
					Source: "db", Detail: "disbursed_lender vacío · sin excepción con la url del webhook",
					Evidencia: evidenciaWebhook(s)})
			case p != nil && p.Desembolsado == 0 &&
				estadoEtapa[s.Estado] != "registro" && estadoEtapa[s.Estado] != "formulario":
				// La compuerta de los dos primeros tramos: una solicitud que todavía está en el registro o
				// en el formulario no eligió entidad, y «no registra desembolso» ahí es cierto pero vacío —
				// dispararía en la mitad del universo. El caso que esta rama existe para atrapar es el
				// contrario: estados POSTERIORES (10, 11, 28) o muertes con la fila de perfilamiento vacía.
				// El predicado es el DATO, no el número de estado: los ids no son orden de flujo (el 9 va
				// antes que el 3; el 7 y el 8 son muertes). Cubre el caso más jugoso del censo: la 520593
				// quedó «Autorizada» con disbursed_lender vacío — y hasta acá salía muda.
				e.Status, e.Source = "sin-evidencia", "db"
				e.Detail = fmt.Sprintf("la solicitud está en «%s» y profiling_reviews NO registra desembolso", s.EstadoN)
				if malos[s.Estado] != "" {
					e.Detail = fmt.Sprintf("la solicitud murió en «%s» sin desembolso registrado", s.EstadoN)
				}
				e.Subs = append(e.Subs, Sub{Label: "Sin desembolso registrado", Status: "skip",
					Source: "db", Detail: "disbursed_lender vacío en profiling_reviews",
					Evidencia: evidenciaWebhook(s)})
			case p == nil && fam == "agregador":
				// El ramal que SÍ espera este webhook, sin fila de perfilamiento que citar: 4 de las 7
				// trazas mudas del censo eran exactamente esto, y no tenían ni un renglón que lo dijera.
				e.Status, e.Source = "sin-evidencia", "db"
				e.Detail = "no hay fila en profiling_reviews para esta solicitud: no hay contra qué comparar el webhook"
				e.Subs = append(e.Subs, Sub{Label: "Sin fila de perfilamiento", Status: "skip",
					Source: "db", Evidencia: evidenciaWebhook(s)})
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
			// UN SOLO ÁRBOL. El snapshot de `profiling_reviews` dice QUÉ vio el cliente y con qué
			// probabilidad; los logs dicen QUÉ REGLA lo decidió. Son la misma entidad por dos fuentes, así
			// que se fusionan por `lender_id` y recién ahí se agrupa por familia. Antes se concatenaban los
			// dos árboles YA agrupados y cada entidad salía dos veces — el comentario de este bloque decía
			// «para que el árbol sea uno y no dos» y el código hacía exactamente lo contrario.
			porID := map[string]int{}
			for i, h := range hijos {
				if h.Detail2 != "" {
					porID[h.Detail2] = i
				}
			}
			var sueltas []Sub
			for _, s2 := range e.Subs {
				i, ok := porID[s2.Detail2]
				if !ok || s2.Detail2 == "" {
					sueltas = append(sueltas, s2) // evaluada en logs y no mostrada al cliente: se conserva
					continue
				}
				if s2.Detail != "" {
					if hijos[i].Detail != "" {
						hijos[i].Detail += " · " + s2.Detail
					} else {
						hijos[i].Detail = s2.Detail
					}
				}
				// El estado de la BD manda —es el hecho— salvo que el log traiga un fallo.
				if s2.Status == "fail" {
					hijos[i].Status = "fail"
				}
				// Y SE LLEVAN LOS EVENTOS. Sin esto la fila fusionada mostraba «4 llamadas · 1 pending» y no
				// abría: el detalle viajaba y las líneas se quedaban en la fila que se descartó. Una fila que
				// anuncia evidencia y no la muestra es peor que no anunciarla.
				if len(s2.Eventos) > 0 {
					hijos[i].Eventos, hijos[i].EventosDe = s2.Eventos, s2.EventosDe
				}
				// Las líneas de legacy que nombran a ESTA entidad se suman a las del MS: la fila queda con
				// toda su evidencia junta, incluida la excepción de integración con su causa.
				if crudas := lineasDeLender[s2.Detail2]; len(crudas) > 0 {
					evs, de := eventosDe(crudas, 40)
					hijos[i].Eventos = append(hijos[i].Eventos, evs...)
					hijos[i].EventosDe += de
					sort.Slice(hijos[i].Eventos, func(a, b int) bool {
						return hijos[i].Eventos[a].At < hijos[i].Eventos[b].At
					})
					for _, ev := range evs {
						if ev.Level == "error" {
							hijos[i].Status = "fail"
							if hijos[i].Detail != "" && !strings.Contains(hijos[i].Detail, "con error") {
								hijos[i].Detail += " · con error"
							}
						}
					}
				}
				if s2.Status == "warn" {
					hijos[i].Status = "warn" // el `pending` del MS deja la entidad colgada
				}
				hijos[i].Source = "db+loki"
			}
			e.Subs = append(arbolListado(hijos, lenders), sueltas...)
			if e.Status == "skip" || e.Status == "sin-evidencia" {
				e.Status, e.Source = "ok", "db"
				e.At = hhmm(p.Creado)
			}
			e.Detail = fmt.Sprintf("%d entidades mostradas al cliente (snapshot de profiling_reviews)", len(p.Mostrados))
			if corridasNota != "" {
				e.Detail += " · " + corridasNota
			}

			// ── EL ORDEN DEL LISTADO: UN PASO PROPIO ──
			//
			// El perfilador ML no es una entidad y no debe ensuciar la lista de entidades, pero tampoco es
			// plomería: decide EN QUÉ ORDEN se le muestran los lenders al cliente, y cuando no responde el
			// orden lo dan las matrices de la BD. Antes esta información estaba a tres niveles de profundidad
			// —dentro de una corrida, dentro de un hito— cuando en la uReq 521997 de prod ES el titular: 4
			// timeouts de 15 s, 14 minutos de listado.
			//
			// El QUIÉN sale de la BD (`ML_predictions.perfilador`, que el backend guarda a propósito) y el
			// PORQUÉ de los logs. Va después de las entidades porque ese es su lugar en el flujo: primero se
			// evalúa, después se ordena.
			if p.Perfilador != "" || p.MLError != "" || p.MLRespondio {
				// Lo que este renglón contesta es «¿quién puso este orden?» — una pregunta que la lista de
				// entidades no puede contestar y que antes no contestaba nadie, con la evidencia del fallo
				// enterrada tres niveles adentro de «la cascada corrió N veces».
				//
				// ⚠ El fallback NO es «las matrices»: la estrategia es `new_then_legacy`, así que caer al
				// respaldo significa que el perfilador NUEVO falló y puntuó el H2O de siempre. Decirlo mal
				// mandaría a buscar un problema de configuración donde hay un servicio caído.
				st, det := "ok", p.Perfilador
				switch {
				case p.MLCrudo && p.Perfilador == "":
					// El sistema viejo guarda la respuesta sin transformar: trae el resultado pero no el autor.
					det = "no queda registrado cuál perfilador (lo escribió el sistema viejo)"
				case det == "":
					det = "sin registrar quién ordenó"
				}
				if p.MLFallback && p.MLError == "" {
					det += " · el perfilador nuevo falló y respondió el de respaldo"
					st = "warn"
				}
				switch {
				case p.MLError != "" && p.MLFallback:
					// Los dos fallaron. Decir «respondió el de respaldo» y «ninguno respondió» en el mismo
					// renglón, como salía antes, es una contradicción que obliga a leer dos veces.
					det += " · falló el nuevo y también el de respaldo: " + trim(p.MLError, 85)
					st = "fail"
				case p.MLError != "":
					det += " · no respondió: " + trim(p.MLError, 90)
					st = "fail"
				case p.MLPuntuadas > 0:
					det += fmt.Sprintf(" · %d entidades puntuadas", p.MLPuntuadas)
				case p.MLRespondio:
					det += " · respondió sin puntajes"
					st = "warn"
				}
				if p.MLPrevio != "" {
					det += " · antes intentó " + trim(p.MLPrevio, 80)
				}
				ml := Sub{Label: "Orden del listado (perfilador ML)", Status: st, Source: "db", Detail: det,
					Evidencia: evidencia("profiling_reviews.ML_predictions", sqlProfiling, []any{s.ID},
						"perfilador          = "+orDash(p.Perfilador),
						fmt.Sprintf("fallback_triggered  = %t", p.MLFallback),
						fmt.Sprintf("entidades puntuadas = %d", p.MLPuntuadas),
						cond(p.MLError != "", "error               = "+p.MLError),
						cond(p.MLPrevio != "", "previous_attempt    = "+p.MLPrevio),
						cond(p.MLCrudo, "⚠ fila escrita por el sistema VIEJO (legacy-application): guarda la respuesta cruda y no registra el perfilador"),
						"created_at          = "+fechaHora(p.Creado),
						"updated_at          = "+fechaHora(p.Actualizado)+"  (se mueve con el webhook del lender: no es la hora del listado)"),
				}
				// Y se le adjunta la evidencia de log del profiler, que hasta acá vivía enterrada tres
				// niveles adentro de «la cascada corrió N veces».
				if len(lineasProfiler) > 0 {
					ml.Eventos, ml.EventosDe = eventosDe(lineasProfiler, 40)
					ml.Source = "db+loki"
					ml.Status = "fail"
					ml.Detail += fmt.Sprintf(" · %s de 15 s", plural(len(lineasProfiler), "timeout", "timeouts"))
				}
				e.Subs = append(e.Subs, ml)
				// Y va ANTES del cajón de sastre: un paso con nombre propio no puede quedar debajo de
				// «eventos sin nombre de negocio», que es justamente lo que todavía no tiene nombre.
				for i, s := range e.Subs {
					if strings.HasPrefix(s.Label, "Eventos sin nombre") && i < len(e.Subs)-1 {
						e.Subs = append(append(e.Subs[:i:i], e.Subs[i+1:]...), s)
						break
					}
				}
			}
		}

		// ── EL PAGARÉ DIGITAL: LAS CUATRO OPERACIONES CONTRA DECEVAL ──
		//
		// Este tramo está al FINAL del embudo —el cliente ya completó todo y ya validó su OTP— así que un
		// fallo acá es el más caro de todos. Y hasta hoy el trazador no lo veía: `deceval_logs` es de las
		// pocas tablas de log que escriben `user_request_id` (F-108), o sea que se ancla sin inferir nada.
		//
		// ⚠ El detalle accionable es `mensajeRespuesta`; la `<descripcion>` de Deceval es genérica. Y el
		// log es best-effort (try/catch que nunca rompe la firma): que falte una operación NO prueba que
		// no corrió, por eso este bloque no baja el status de la etapa por ausencia — sólo por un rechazo
		// explícito.
		if o.id == "desembolso" && len(s.Deceval) > 0 {
			// El wrapper `createPromisoryNote` repite muchas veces por solicitud (medido en prod: 711 filas
			// para 174 solicitudes) y no aporta veredicto propio: las que deciden son las cuatro
			// operaciones SOAP. Se cuenta aparte en vez de tirarlo, porque su cantidad dice cuántos
			// intentos hubo.
			orden := map[string]int{"createGirador": 1, "createPagare": 2, "consultPagare": 3, "signPagare": 4}
			var ops []OpDeceval
			intentos := 0
			for _, op := range s.Deceval {
				if orden[op.Metodo] == 0 {
					intentos++
					continue
				}
				ops = append(ops, op)
			}
			var hijos []Sub
			rechazos, firmo := 0, false
			for _, op := range ops {
				st, det := "ok", op.Nombre
				switch {
				case op.Exitoso != nil && !*op.Exitoso:
					st, rechazos = "fail", rechazos+1
					det = "Deceval rechazó"
					if op.Codigo != "" {
						det += " · " + op.Codigo
					}
					if op.Mensaje != "" {
						det += " · " + trim(op.Mensaje, 110)
					}
				case op.Exitoso == nil:
					// Sin `<exitoso>` no se puede afirmar que salió bien. Pintarlo verde sería inventar.
					st, det = "sin-evidencia", op.Nombre+" · la respuesta no trae «exitoso»"
				case op.Metodo == "signPagare":
					firmo = true
				}
				etiqueta := map[string]string{
					"createGirador": "Registro del firmante (girador)",
					"createPagare":  "Creación del pagaré",
					"consultPagare": "Vista previa del pagaré (PDF)",
					"signPagare":    "Firma del pagaré",
				}[op.Metodo]
				hijos = append(hijos, Sub{Label: etiqueta, Status: st, Source: "db", Detail: det,
					Detail2: op.Metodo,
					Evidencia: evidencia("deceval_logs", sqlDeceval, []any{s.ID},
						"method            = "+op.Metodo,
						"name              = "+op.Nombre,
						"exitoso           = "+cond(op.Exitoso != nil, fmt.Sprintf("%t", op.Exitoso != nil && *op.Exitoso))+cond(op.Exitoso == nil, "(la respuesta no lo trae)"),
						cond(op.Codigo != "", "codigoError       = "+op.Codigo),
						cond(op.Mensaje != "", "mensajeRespuesta  = "+op.Mensaje),
						"created_at        = "+fechaHora(op.At),
						"⚠ el log es best-effort: una operación que falta NO prueba que no corrió")})
			}
			// ⚠ El orden es de FLUJO, no de hora ni de id: `consultPagare` se vuelve a llamar DURANTE la
			// firma para resolver el id numérico del pagaré, así que ordenar por timestamp lo intercala
			// después de `signPagare` y se lee como un ida y vuelta que no ocurrió. Mismo criterio que el
			// orden de las etapas del árbol.
			sort.SliceStable(hijos, func(a, b int) bool {
				return orden[hijos[a].Detail2] < orden[hijos[b].Detail2]
			})
			cab := Sub{Label: "Pagaré digital (Deceval)", Source: "db", Hijos: hijos}
			switch {
			case rechazos > 0:
				cab.Status = "fail"
				cab.Detail = fmt.Sprintf("%s de Deceval", plural(rechazos, "rechazo", "rechazos"))
			case firmo:
				cab.Status, cab.Detail = "ok", "el pagaré quedó firmado y registrado en Deceval"
			default:
				cab.Status, cab.Detail = "warn", "no hay evidencia de la firma"
			}
			if intentos > len(ops) {
				cab.Detail += fmt.Sprintf(" · %d registros del orquestador", intentos)
			}
			e.Subs = append([]Sub{cab}, e.Subs...)
			if rechazos > 0 && e.Status != "no-aplica" {
				e.Status, e.Source = "fail", "db"
				e.Detail = "Deceval rechazó el pagaré: " + cab.Detail
			}
		}

		// ── POR QUÉ NO PASÓ LA POLÍTICA: LA EVALUACIÓN, CRITERIO POR CRITERIO ──
		//
		// Contesta el reporte más frecuente de soporte —«¿por qué a este cliente no le salió CreditopX?»—
		// que hasta acá el trazador NO podía contestar: los logs `CATEGORY_*` no traen quién los llamó (el
		// mapa lo dice en su propia nota), así que ni siquiera se podía atribuir la evaluación a una entidad.
		// `users_category_log` sí: una fila por entidad, con la evaluación completa en JSON.
		//
		// ⚠ TRES cosas que hay que respetar al leerlo, y las tres se aprendieron mirando el escritor:
		//
		//  1. **Una clave ausente NO es un criterio que pasó**: es un criterio que NUNCA SE EVALUÓ. El motor
		//     mide 5 criterios básicos (ocupación, edad, ingreso, género, continuidad) y si alguno falla
		//     RETORNA sin tocar el buró (`LenderUserCategoryService::evaluateEligibility:425`). Por eso se
		//     muestra dónde cortó cada tier y no sólo qué falló.
		//  2. **La misma regla tiene DOS grafías** — `occupation` y `ocupations` — porque la escriben dos
		//     servicios distintos con el mismo nombre de clase. Ver F-118.
		//  3. **La fila no dice a qué solicitud pertenece**: se ata por `user_id` + ventana, igual que el
		//     buró. Lo que se puede afirmar es que cae dentro de ±120 s de la corrida del perfilamiento, y
		//     eso se marca como inferencia, no como hecho (mismo criterio que F-107).
		if o.id == "cupo" && len(s.Categorias) > 0 {
			// ⚠ COLAPSAR ES OBLIGATORIO, no cosmético. `getLenderUserCategory` se llama desde TRES sitios y
			// la cascada corre varias veces por solicitud: medido en la uReq 522511 de prod, **nueve filas
			// idénticas de CrediPullman**. Sin colapsar, el paso que existe para contestar «¿por qué no le
			// salió?» contesta lo mismo nueve veces y esconde a las otras entidades. Se agrupa por
			// (entidad + resultado + criterios que fallaron): dos evaluaciones que dieron distinto SÍ son
			// dos renglones, porque eso es información — el motor cambió de opinión.
			vistas := map[string]int{}
			unicas := make([]Categoria, 0, len(s.Categorias))
			repes := map[int]int{}
			for _, c := range s.Categorias {
				firma := fmt.Sprintf("%d|%d|%s|%v", c.LenderID, c.CatID, c.Especial, c.Fallas)
				if i, ya := vistas[firma]; ya {
					repes[i]++
					// El REPRESENTANTE del grupo tiene que ser la fila que SÍ se puede atribuir a esta
					// solicitud. Quedarse con la primera por orden de id hacía que un grupo con nueve filas
					// —ocho de esta corrida y una de otro intento del mismo cliente— se mostrara con la
					// advertencia «puede ser de otro intento» puesta al conjunto entero. Medido en la
					// uReq 522511 de prod, que tiene evaluaciones de dos solicitudes en la misma ventana.
					if c.Ventana == "misma" && unicas[i].Ventana != "misma" {
						unicas[i] = c
					}
					continue
				}
				vistas[firma] = len(unicas)
				unicas = append(unicas, c)
			}
			var subs []Sub
			conCat, sinCat := 0, 0
			for idx, c := range unicas {
				etiqueta := c.Lender
				if etiqueta == "" {
					etiqueta = fmt.Sprintf("entidad %d", c.LenderID)
				}
				st, det := "ok", ""
				switch {
				case c.Especial == "blacklisted":
					st, det = "fail", "documento en la LISTA NEGRA de esta entidad — se salta toda la evaluación"
					sinCat++
				case c.Especial != "":
					st, det = "warn", "atajo `"+c.Especial+"`: se saltaron TODAS las reglas y se asignó una categoría fija"
					conCat++
				case c.CatID > 0:
					det = "categoría " + orDash(c.CatNombre)
					if c.Cupo > 0 {
						det += fmt.Sprintf(" · cupo %s", pesos(c.Cupo))
					}
					conCat++
				default:
					st = "fail"
					det = fmt.Sprintf("ninguno de los %s de admisión pasó", plural(c.Tiers, "tier", "tiers"))
					sinCat++
				}
				// El detalle que importa: qué criterio bloqueó, y en qué tier. Se muestran los tiers en orden
				// y se recorta, porque un lender con 12 tiers repite el mismo motivo doce veces.
				var lineas []string
				claves := make([]string, 0, len(c.Fallas))
				for k := range c.Fallas {
					claves = append(claves, k)
				}
				sort.Strings(claves)
				for _, k := range claves {
					lineas = append(lineas, fmt.Sprintf("tier %-6s cortó en %-8s → %s",
						k, c.Corta[k], strings.Join(c.Fallas[k], ", ")))
				}
				if c.Tiers > 0 && len(c.Fallas) == 0 {
					lineas = append(lineas, fmt.Sprintf("los %d tiers pasaron todos sus criterios", c.Tiers))
				}
				if c.Especial != "" {
					lineas = append(lineas, "bandera de raíz: "+c.Especial+" = true (no hay evaluación de tiers)")
				}
				switch c.Ventana {
				case "otra":
					lineas = append(lineas, "⚠ fuera de ±120 s de la corrida del perfilamiento: puede ser de OTRO intento del mismo cliente")
				case "sin-referencia":
					lineas = append(lineas, "esta solicitud no tiene fila de profiling_reviews: no hay corrida contra la cual fechar esta evaluación")
				}
				// El motivo más repetido, arriba: es lo que soporte pega en el ticket.
				if st == "fail" && len(claves) > 0 {
					det += " · el criterio que más bloqueó: " + masRepetido(c.Fallas)
				}
				// Que se haya evaluado N veces con el MISMO resultado no cambia el diagnóstico, pero sí
				// dice que la cascada corrió N veces — que es lo que explica un listado lento.
				if n := repes[idx]; n > 0 {
					etiqueta += fmt.Sprintf("  ×%d", n+1)
					lineas = append(lineas, fmt.Sprintf("evaluada %d veces con idéntico resultado (getLenderUserCategory se llama desde 3 sitios)", n+1))
				}
				subs = append(subs, Sub{
					Label: etiqueta, Status: st, Source: "db", Detail: det,
					Evidencia: evidencia("users_category_log.category_rules_acceptance", sqlCategorias,
						[]any{s.UserID, "<desde>", "<hasta>"}, lineas...),
				})
			}
			sort.SliceStable(subs, func(a, b int) bool { return subs[a].Status == "fail" && subs[b].Status != "fail" })
			cab := Sub{Label: "Política por entidad (¿por qué no le salió?)", Source: "db", Hijos: subs,
				Detail: fmt.Sprintf("%d con categoría · %d sin ninguna", conCat, sinCat)}
			if len(s.Categorias) > len(unicas) {
				cab.Detail += fmt.Sprintf(" · %d evaluaciones colapsadas en %d", len(s.Categorias), len(unicas))
			}
			cab.Status = "ok"
			if conCat == 0 {
				cab.Status = "fail"
			} else if sinCat > 0 {
				cab.Status = "warn"
			}
			e.Subs = append([]Sub{cab}, e.Subs...)
			// ── EL STATUS DE `cupo` TAMBIÉN ES UN VEREDICTO ──
			//
			// Misma trampa que ya se corrigió en `listado`: la rama genérica «hay líneas ⇒ ok» pintaba
			// verde una etapa donde el cliente NO obtuvo categoría en ninguna entidad (uReq 522511 de prod:
			// 9 evaluaciones, 0 categorías, y la etapa salía ✔). Que el motor haya corrido no es que haya
			// aprobado. Ahora la BD manda, que es la fuente fuerte.
			if e.Status != "no-aplica" {
				switch {
				case conCat == 0:
					e.Status, e.Source = "fail", "db"
					if len(unicas) == 1 {
						e.Detail = "la única entidad evaluada no le dio categoría"
					} else {
						e.Detail = fmt.Sprintf("ninguna de las %d entidades evaluadas le dio categoría", len(unicas))
					}
				case e.Status == "sin-evidencia" || e.Status == "skip":
					e.Status, e.Source, e.Detail = "ok", "db", cab.Detail
				}
				if e.At == "" && len(s.Categorias) > 0 {
					e.At = hhmm(s.Categorias[0].At)
				}
			}
		}

		// ── EL STATUS DEL LISTADO ES UN VEREDICTO, NO UN PULSO ──
		//
		// La rama genérica «hay líneas ⇒ ok» pintaba verde trazas donde el cliente no vio NINGUNA oferta:
		// 522154 salía ✔ con su única entidad rechazada, y 522230/522238/522239 salían ✔ con puro backlog.
		// «Hubo logs» no es «el cliente vio ofertas». El veredicto, en orden de fuerza:
		//   1. la fila de perfilamiento (BD): len(Mostrados) manda — 0 mostradas es un FALLO del listado;
		//   2. sin fila, el cierre del log («Listado de entidades completado», trae lenders_count);
		//   3. sin veredicto, entidades armadas de logs: todas rechazadas ⇒ fail;
		//   4. sólo líneas y ningún veredicto ⇒ sin-evidencia, no ok.
		if o.id == "listado" && e.Status != "no-aplica" {
			p := s.Perfilamiento
			cuentaLog := -1
			for _, l := range porEtapa[o.id] {
				if strings.HasPrefix(l.msg, "Listado de entidades completado") {
					if v := pick(l.ctx, []string{"lenders_count"}); v != "" {
						fmt.Sscanf(v, "%d", &cuentaLog)
					}
				}
			}
			entidades, caidas := 0, 0
			for _, sb := range e.Subs {
				for _, h := range sb.Hijos {
					if h.Detail2 != "" {
						entidades++
						if h.Status == "fail" {
							caidas++
						}
					}
				}
				if sb.Detail2 != "" {
					entidades++
					if sb.Status == "fail" {
						caidas++
					}
				}
			}
			switch {
			case p != nil && len(p.Mostrados) == 0:
				e.Status, e.Source = "fail", "db"
				e.Detail = "0 entidades mostradas al cliente (profiling_reviews existe y está vacío)"
			case p != nil:
				// ya lo puso el bloque de arriba: ok/db con el snapshot
			case cuentaLog == 0:
				e.Status, e.Source = "fail", "loki"
				e.Detail = "el código cerró el listado con 0 entidades (lenders_count=0; sin snapshot en BD)"
			case cuentaLog > 0:
				e.Status, e.Source = "ok", "loki"
				e.Detail = fmt.Sprintf("el código cerró el listado con %d entidades (sin snapshot en BD)", cuentaLog)
			case entidades > 0 && caidas == entidades:
				e.Status = "fail"
				e.Detail = fmt.Sprintf("las %d entidades evaluadas quedaron rechazadas y no hay snapshot en BD", entidades)
			case e.Status == "ok" && e.Source == "loki":
				e.Status = "sin-evidencia"
				e.Detail = "hay actividad en los logs pero ningún veredicto: no se puede afirmar que el cliente vio ofertas"
			}
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
	// Las etapas que dependen del RAMAL: sin entidad elegida no hay ramal, y sin ramal no se puede afirmar
	// que estas ocurrieron. El default anterior (`fam=="" → true`) hacía exactamente eso: en la uReq 520593
	// (estado 11 SIN lender) el árbol decía que la selección de entidad «ocurrió» en una solicitud que no
	// tiene entidad. La salvaguarda del condicional sólo funcionaba cuando había ramal — fallaba justo en
	// la familia sin ramal, que es la mitad del universo.
	delRamal := map[string]bool{"seleccion": true, "respuesta-lender": true, "biometria": true, "desembolso": true}
	obligatoria := func(id string) bool {
		if fam == "" {
			return !delRamal[id] // el tronco sí se puede afirmar por progresión; el tramo ramal no
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
		if fam == "" {
			t.Etapas[i].Detail = "sin entidad elegida no hay ramal: no se puede afirmar si este tramo ocurrió"
		} else {
			t.Etapas[i].Detail = fmt.Sprintf("sin registro y CONDICIONAL en «%s»: el flujo siguió, pero esta "+
				"etapa puede no haber ocurrido — no se puede afirmar ninguna de las dos cosas", fam)
		}
	}

	// La etapa donde se rompió: la primera sin ok DESPUÉS de la última que sí ocurrió — y ahora el código
	// hace lo que este comentario siempre prometió. El bucle arrancaba en 0 e ignoraba `ultimaProbada`
	// (calculada veinte líneas más arriba), así que en 6 de 6 trazas rotas del censo señalaba una etapa
	// ANTERIOR a la evidencia. Y se excluye lo que el propio trazador declara no afirmable: culpar a una
	// etapa `no-aplica` o `sin-evidencia` es afirmar con la mano izquierda lo que se negó con la derecha.
	if t.Outcome == "roto" || t.Outcome == "abandonado" {
		for i := ultimaProbada + 1; i >= 0 && i < len(t.Etapas); i++ {
			switch t.Etapas[i].Status {
			case "ok", "warn", "sin-evidencia", "no-aplica", "condicional":
				continue
			}
			t.BrokeAt = t.Etapas[i].ID
			break
		}
	}
	if malos[s.Estado] != "" {
		t.Warnings = append(t.Warnings, fmt.Sprintf("desenlace de muerte en BD: estado %d «%s»", s.Estado, s.EstadoN))
	}
	// Un estado que el mapa no conoce Y que no es desenlace: la solicitud está parada en un lugar que el
	// árbol no puede señalar. Medido: 21 «En aprobación del médico» (13 casos en 5 semanas) y 22 (1 caso).
	// Con tan pocos casos no merecen etapa —sería el hito que nunca dispara—, pero callarlos convertiría
	// la cabecera en la única pista y nadie mira la cabecera buscando un hueco del mapa.
	if _, ok := estadoEtapa[s.Estado]; !ok && malos[s.Estado] == "" && s.Estado != 7 {
		t.Warnings = append(t.Warnings, fmt.Sprintf("el estado actual %d «%s» NO está mapeado a ninguna etapa: "+
			"el árbol no muestra dónde está parada esta solicitud", s.Estado, s.EstadoN))
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
	izarErroresSinHito(&t)
	armarHallazgos(&t)
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
		// La pantalla, al final del renglón: es lo que permite leer el árbol en el idioma del reporte sin
		// perder el del backend. Va con el nombre crudo de la ruta —`sign-documents`, no «Firma»— porque
		// así se busca en `routes.ts` y así se nombra entre quienes tocan el wizard.
		if b.Pantalla != "" {
			det += " · pantalla " + b.Pantalla
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
	// SIN TOPE: el recorte es decisión de la VISTA, no del dato. La versión con tope de 8 escondió ≥265
	// grupos en el censo de 25 trazas y el `-json` no publicaba ni su texto ni su conteo — o sea que el
	// propio censo que audita este mapa estaba censando una lista truncada sin saberlo. La terminal
	// recorta al imprimir (y lo dice); el JSON viaja completo, que para eso existe.
	var out []Sub
	for _, k := range orden {
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

// evidenciaWebhook cita la fila de perfilamiento en los tres desenlaces del webhook. Los tres se apoyan
// en el MISMO campo (`disbursed_lender` lleno o vacío), así que los tres tienen que poder mostrarlo — el
// que dice «no llegó» es justamente el que más necesita probar que miró.
func evidenciaWebhook(s *Solicitud) *Evidencia {
	p := s.Perfilamiento
	if p == nil {
		return evidencia("profiling_reviews", sqlProfiling, []any{s.ID},
			"(sin fila: esta solicitud nunca se perfiló)")
	}
	return evidencia("profiling_reviews", sqlProfiling, []any{s.ID},
		fmt.Sprintf("recommended_lender = %d", p.Recomendado),
		fmt.Sprintf("disbursed_lender   = %d%s", p.Desembolsado, cond(p.Desembolsado == 0, "   ← vacío")),
		fmt.Sprintf("displayed_lenders  = %d entidades", len(p.Mostrados)),
		"created_at         = "+fechaHora(p.Creado),
		"updated_at         = "+fechaHora(p.Actualizado),
		"⚠ F-94: el webhook NO registra su recepción y su endpoint acepta cualquier lender_id, así que este campo no dice QUIÉN lo escribió")
}

// cond devuelve el texto sólo si la condición se cumple; `evidencia` descarta los vacíos. Evita armar los
// bloques con ifs sueltos y que una línea quede en blanco diciendo nada.
func cond(ok bool, txt string) string {
	if ok {
		return txt
	}
	return ""
}

// estadoActualFila dice de dónde sale el estado que se está reportando y si el historial lo respalda.
// Separar las dos fuentes es el punto: si el estado actual no aparece en el recorrido, la fila lo dice en
// vez de dejar que el lector asuma que la lista de arriba está completa.
func estadoActualFila(s *Solicitud) string {
	for _, tr := range s.Transiciones {
		if tr.Estado == s.Estado {
			return fmt.Sprintf("← user_requests.user_request_status_id = %d · el historial termina acá y no registra ninguna transición posterior", s.Estado)
		}
	}
	return fmt.Sprintf("← user_requests.user_request_status_id = %d («%s») · ⚠ el historial NO tiene fila para este estado: "+
		"`user_request_records` no registra todas las transiciones, así que la lista de arriba no es el recorrido completo",
		s.Estado, s.EstadoN)
}

// historialFilas rinde el historial ya colapsado, en el mismo orden en que se leyó.
func historialFilas(s *Solicitud) []string {
	out := make([]string, 0, len(s.Transiciones))
	for _, tr := range s.Transiciones {
		out = append(out, fmt.Sprintf("%s  estado %d · %s", fechaHora(tr.At), tr.Estado, tr.Nombre))
	}
	return out
}

// etapaDeMuerte dice en qué etapa se detuvo: la siguiente a la última que la BD probó. Es una inferencia
// del ESQUELETO (no de logs), así que se puede afirmar.
func etapaDeMuerte(mapa *Mapa, s *Solicitud, porEtapa map[string][]Linea) string {
	// La última etapa CON EVIDENCIA —transición que cierra o líneas de log— y la muerte es la siguiente.
	//
	// ⚠ Antes ignoraba los logs y, sin historial mapeado, FABRICABA una etapa: en la uReq 522215 pintó
	// «registro fail · estado 8» con CERO líneas y CERO subs, mientras los únicos errores de la traza
	// estaban en cupo y desembolso. Un renglón rojo inventado manda a soporte a la etapa equivocada, que
	// es lo único peor que no señalar ninguna. Si no hay evidencia de ninguna etapa, se devuelve "" y la
	// muerte queda sin ubicar — «cancelada, no se puede ubicar» es una respuesta; un fantasma no.
	ord := mapa.Orden()
	ultima := -1
	for i, o := range ord {
		if len(porEtapa[o.id]) > 0 {
			ultima = i
		}
	}
	for _, tr := range s.Transiciones {
		e, ok := estadoEtapa[tr.Estado]
		if !ok || !estadoCierra[tr.Estado] {
			continue
		}
		for i, o := range ord {
			if o.id == e && i > ultima {
				ultima = i
			}
		}
	}
	switch {
	case ultima < 0:
		return ""
	case ultima+1 < len(ord):
		return ord[ultima+1].id
	}
	return ord[ultima].id
}

// hhmm es el ÚNICO formateador de horas: las de la BD llegan en UTC y las de los logs en epoch, y
// mezclarlas sin normalizar fue lo que desordenó la primera versión de la línea de tiempo.
func hhmm(t time.Time) string { return t.Local().Format("15:04:05") }

// fechaHora: la MISMA hora local que muestra el árbol, con la fecha. Va en la evidencia, y ahí la zona no
// es cosmética: la evidencia se copia y se pega en Redash junto al `created_at` de la consulta. Formatear
// en UTC mientras el árbol dice Bogotá manda a buscar en una ventana cinco horas corrida — el mismo tipo
// de desfase que ya se corrigió al parsear (`fecha`, en fuentes.go).
func fechaHora(t time.Time) string { return t.Local().Format("2006-01-02 15:04:05") }

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
	// EL RESUMEN PRIMERO: soporte abre esto con una pregunta («¿dónde se rompió?») y la respuesta no
	// puede estar repartida en cien renglones de árbol. Si no hay fallas, no hay sección.
	if len(t.Hallazgos) > 0 {
		fmt.Println()
		for _, h := range t.Hallazgos {
			fmt.Printf("     %s %s\n", red("✘"), h)
		}
	}
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
		// EL ÁRBOL: familia o central en un nivel, las entidades colgando. Con guías a propósito — sin
		// ellas hay que contar espacios para saber qué cuelga de qué, y entonces el árbol no ahorra nada.
		// Se imprime COMPLETO: nada se esconde por ser rutina (ver izarErroresSinHito).
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
			// El recorte vive ACÁ, en la vista: primero los que fallan (el recorte no puede comerse la
			// causa), después la rutina hasta el tope. El JSON no recorta nada.
			hijos := sb.Hijos
			recortados := 0
			if len(hijos) > 12 {
				conError := hijos[:0:0]
				var sanos []Sub
				for _, h := range hijos {
					if h.Status == "fail" {
						conError = append(conError, h)
					} else {
						sanos = append(sanos, h)
					}
				}
				if len(conError) < 12 {
					conError = append(conError, sanos[:12-len(conError)]...)
				}
				recortados = len(hijos) - len(conError)
				hijos = conError
			}
			for j, h := range hijos {
				sub := "├─"
				if j == len(hijos)-1 && recortados == 0 {
					sub = "└─"
				}
				fmt.Printf("          %s  %s %s %s  %s\n", gray(guia), gray(sub), puntito(h.Status),
					pad(h.Label, 28), gray(trim(h.Detail, 48)))
			}
			if recortados > 0 {
				fmt.Printf("          %s  %s %s\n", gray(guia), gray("└─ ·"),
					gray(fmt.Sprintf("… y %d más — completos en la UI y en -json; con error nunca se recorta", recortados)))
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

// ── IZAR LOS ERRORES SIN HITO · ARMAR EL RESUMEN ────────────────────────────────────────────────────
//
// Acá vivió un pliegue de la rutina: los pasos que corrían bien y no decidían nada se colapsaban a un
// renglón «N sin novedad». Se quitó a pedido, y la razón por la que no vuelve es buena: el criterio de
// qué es rutina era una HEURÍSTICA sobre la etiqueta (una regex de «rechaz|fall|erro|timeout…»), o sea
// que el árbol escondía renglones según una adivinanza. Para una herramienta cuyo trabajo es sostener
// afirmaciones, esconder por corazonada es el trato equivocado: quien audita quiere ver TODO lo que
// corrió, y el resumen de arriba ya contesta «¿dónde se rompió?» sin quitarle nada a la lista.

// izarErroresSinHito saca a la vista los errores que cayeron en «eventos sin nombre de negocio». Un error
// sin hito declarado seguía siendo un error: dejarlo dentro del cajón de sastre lo escondía detrás de un
// renglón gris que se lee como «acá no pasó nada».
func izarErroresSinHito(t *Traza) {
	for i := range t.Etapas {
		e := &t.Etapas[i]
		subs := e.Subs[:0:0]
		for _, s := range e.Subs {
			if !strings.HasPrefix(s.Label, "Eventos sin nombre") {
				subs = append(subs, s)
				continue
			}
			quedan := s.Hijos[:0:0]
			for _, h := range s.Hijos {
				if h.Status == "fail" {
					h.Detail += " · sin hito declarado"
					subs = append(subs, h)
					continue
				}
				quedan = append(quedan, h)
			}
			s.Hijos = quedan
			subs = append(subs, s)
		}
		e.Subs = subs
	}
}

// armarHallazgos junta TODO lo que quedó en fail con su ruta. Con tope declarado: si hay más de 8, el
// último renglón lo dice — un resumen que recorta en silencio se lee como completo, y no lo es.
func armarHallazgos(t *Traza) {
	visto := map[string]bool{}
	saltados := 0
	agregar := func(txt string) {
		if txt == "" || visto[txt] {
			return
		}
		visto[txt] = true
		if len(t.Hallazgos) >= 8 {
			saltados++
			return
		}
		t.Hallazgos = append(t.Hallazgos, txt)
	}
	for _, e := range t.Etapas {
		antes := len(t.Hallazgos)
		// Si un descendiente ya está en fail, el padre NO entra al resumen: «Registro del cliente — con
		// error · 6 pasos» y «redirect — 1 rechazada(s)» son el mismo hallazgo que su hijo, dicho sin la
		// causa. El renglón útil es la hoja.
		var tieneFalloAbajo func(s Sub) bool
		tieneFalloAbajo = func(s Sub) bool {
			for _, h := range s.Hijos {
				if h.Status == "fail" || tieneFalloAbajo(h) {
					return true
				}
			}
			return false
		}
		var rec func(s Sub)
		rec = func(s Sub) {
			if s.Status == "fail" && !tieneFalloAbajo(s) {
				txt := s.Detail
				// La primera línea de error del paso suele decir más que su Detail («HTTP 401 …» contra
				// «con error»); si existe, es la que va al resumen.
				for _, ev := range s.Eventos {
					if ev.Level == "error" {
						txt = ev.Msg
						break
					}
				}
				agregar(fmt.Sprintf("%s › %s — %s", e.Label, s.Label, trim(txt, 96)))
			}
			for _, h := range s.Hijos {
				rec(h)
			}
		}
		for _, s := range e.Subs {
			rec(s)
		}
		// El Reason de la etapa suele ser el MISMO error que ya aportó un paso; solo suma cuando la etapa
		// falló sin que ningún paso lo dijera.
		if e.Reason != "" && len(t.Hallazgos) == antes && saltados == 0 {
			agregar(fmt.Sprintf("%s — %s", e.Label, trim(e.Reason, 110)))
		}
	}
	// Las huérfanas con nivel error: líneas que NINGUNA etapa reclamó y que hasta acá no aparecían ni en
	// una etapa ni en el resumen — un error invisible en la herramienta que existe para encontrarlos.
	// Medido en el censo: ≥15 líneas de error así en 25 trazas.
	for _, ev := range t.Huerfanas {
		if ev.Level == "error" {
			agregar(fmt.Sprintf("sin etapa › %s — el mapa no ubica esta línea (está en «sin ubicar»)", trim(ev.Msg, 96)))
		}
	}
	if saltados > 0 {
		t.Hallazgos = append(t.Hallazgos, fmt.Sprintf("… y %d más, en el árbol", saltados))
	}
}

// pesos formatea el monto con separador de miles. 6395900 se lee mal; 6.395.900 se lee de un golpe, y el
// monto es de las pocas cosas que soporte compara contra lo que dice el cliente.
func pesos(v float64) string {
	s := fmt.Sprintf("%.0f", v)
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	return "$" + string(out)
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

	// ── EL FILTRO DE AMBIENTE SE VERIFICA ANTES DE USARSE ──
	//
	// `LOKI_ENV` decía `qa` para el target `staging`, y la etiqueta `environment` del stack `creditopdev`
	// SÓLO tiene `development`, `local` y `testing`: no existe ningún `qa`. Resultado: el selector no
	// matcheaba nada y toda traza de staging salía «sin líneas de log» — con los logs ahí, a un filtro de
	// distancia. Se descubrió con la uReq 464709, que falló firmando (`Deceval createGirador no exitoso`) y
	// se mostraba sin una sola línea.
	//
	// Un filtro que no matchea nada es peor que ninguno: no falla, devuelve vacío, y el vacío se lee como
	// «el backend no logueó». Por eso ahora se COMPRUEBA contra los valores reales del stack y, si no está,
	// se cae a no filtrar Y SE DICE.
	sel := `{service_name=~".+"}`
	if envFiltro != "" {
		if vals := valoresDeEtiqueta(cl, "environment", desde, hasta); len(vals) > 0 && !contiene(vals, envFiltro) {
			notas = append(notas, fmt.Sprintf("LOKI_ENV=%q NO existe como valor de `environment` en este stack "+
				"(los que hay: %s) — se consultó SIN filtrar por ambiente. ⚠ dev y staging comparten stack y BD, "+
				"así que un mismo user_request_id puede traer líneas de las DOS ramas de código",
				envFiltro, strings.Join(vals, " · ")))
		} else {
			sel = fmt.Sprintf(`{environment=~"%s"}`, envFiltro)
		}
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
	tracesEtiqueta := map[string]bool{}
	serviciosEtiqueta := map[string]bool{}
	anclas := map[string]int{}
	var crudas []Linea
	// Los MS Go llevan el id como ETIQUETA, no en el cuerpo: `| json` no los alcanza (el cuerpo es texto
	// plano y el parser los descarta), así que llevan su propia consulta con filtro de etiqueta. Medido:
	// `preapprovals-service` ancla 33 líneas en 4 h por `user_request_id`, todas invisibles antes. Y como su
	// trace_id es PROPIO (no se propaga desde legacy), la expansión posterior es la que trae su request
	// completo — autenticación, llamada al lender, veredicto.
	for _, ancla := range []struct{ valor, campos, filtro string }{
		{fmt.Sprint(s.ID), "user_request_id (etiqueta MS)", `user_request_id="%s"`},
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
		//
		// ⚠ La ancla de ETIQUETA va SIN `| json`: el cuerpo de un MS Go es texto plano, y `| json` marca esas
		// líneas con __error__ y el filtro posterior las tira — o sea que el pipeline que encuentra a Monolog
		// es exactamente el que hace invisible al microservicio. Se distinguen porque el filtro de etiqueta
		// no menciona campos `context_*`.
		q := fmt.Sprintf(`%s | json | %s`, sel, filtro)
		if !strings.Contains(ancla.filtro, "context_") {
			q = fmt.Sprintf(`%s | %s`, sel, filtro)
		}
		ls, tr, err := lineasYTraces(cl, q, desde, hasta, ancla.valor)
		if err != nil {
			notas = append(notas, fmt.Sprintf("la búsqueda por %s falló: %v", ancla.campos, err))
			continue
		}
		crudas = append(crudas, ls...)
		anclas[ancla.campos] = len(ls)
		esEtiqueta := !strings.Contains(ancla.filtro, "context_")
		for t := range tr {
			if esEtiqueta {
				tracesEtiqueta[t] = true // trace de MS: NO es indexado, la expansión normal no lo ve
			} else {
				traces[t] = true
			}
		}
		if esEtiqueta {
			for _, l := range ls {
				if v := pick(l.ctx, []string{"service_name"}); v != "" {
					serviciosEtiqueta[v] = true
				}
			}
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

	// ── LA EXPANSIÓN NO ALCANZA A LOS MICROSERVICIOS, y devolver solo la expansión los BORRABA ──
	//
	// `{trace_id=~"…"}` exige que `trace_id` sea etiqueta INDEXADA. En los monolitos lo es (LokiHandler la
	// promueve — de ahí sus 959 streams); en los MS Go via OTel es metadata estructurada, y el selector
	// devuelve 0 — medido con un trace de `preapprovals-service` que existía y el selector no encontraba.
	// Como esta función devolvía SOLO `todas`, las líneas del MS que el ancla sí había encontrado se
	// perdían en el camino: anclar 6 y devolver 0.
	//
	// Dos arreglos, los dos necesarios:
	//   1. la UNIÓN crudas ∪ expansión (dedupe por instante+span+mensaje): lo anclado nunca se pierde;
	//   2. una expansión PROPIA para esos traces, con filtro de metadata (`| trace_id=~"…"`) acotada a los
	//      service_name vistos en las anclas — trae el request completo del MS (autenticación → llamada al
	//      lender → veredicto), que el ancla sola no ve porque esas líneas no llevan el user_request_id.
	if len(tracesEtiqueta) > 0 {
		var tIDs, svcs []string
		for id := range tracesEtiqueta {
			tIDs = append(tIDs, id)
		}
		for s2 := range serviciosEtiqueta {
			svcs = append(svcs, s2)
		}
		sort.Strings(tIDs)
		sort.Strings(svcs)
		ms, _, errMS := lineasYTraces(cl, fmt.Sprintf(`{service_name=~"%s"} | trace_id=~"%s"`,
			strings.Join(svcs, "|"), strings.Join(tIDs, "|")), desde, hasta, "")
		if errMS != nil {
			notas = append(notas, fmt.Sprintf("la expansión del microservicio falló: %v", errMS))
		} else {
			todas = append(todas, ms...)
		}
	}
	// La unión. El dedupe es por (instante, span, mensaje): dos fuentes pueden traer la misma línea y
	// duplicarla inflaría los conteos de los hitos.
	vistoL := map[string]bool{}
	unidas := make([]Linea, 0, len(todas)+len(crudas))
	for _, l := range append(todas, crudas...) {
		k := fmt.Sprintf("%d|%s|%s", l.ts, l.span, l.msg)
		if vistoL[k] {
			continue
		}
		vistoL[k] = true
		unidas = append(unidas, l)
	}
	todas = unidas
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

	// El desglose por ancla (`user_id→110 user_request_id→37 …`) era jerga de diagnóstico en la vista de
	// auditoría; vive completo en `-anclas`, que es su modo. Acá queda lo que un lector necesita creer:
	// cuántas líneas y de cuántas peticiones.
	notas = append(notas, fmt.Sprintf("%d líneas de %d traces · el desglose por ancla: -anclas", len(limpias), len(ids)))
	return limpias, notas
}

// boilerplateOTel: las etiquetas de infraestructura que el SDK de OTel pega a toda línea y que no dicen
// nada de la solicitud. Se saltan al fusionar etiquetas al ctx para que éste siga siendo contexto de
// NEGOCIO y no un inventario de la máquina.
var boilerplateOTel = map[string]bool{
	"os_description": true, "os_type": true, "process_runtime_description": true,
	"telemetry_sdk_language": true, "telemetry_sdk_name": true, "telemetry_sdk_version": true,
	"host_name": true, "observed_timestamp": true, "loki_attribute_labels": true, "flags": true,
	"severity_number": true, "severity_text": true, "scope_version": true, "service_version": true,
	"detected_level": true, "level": true, "channel": true, "app": true, "cluster_name": true,
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
			// LAS ETIQUETAS DEL STREAM TAMBIÉN SON CONTEXTO. Los microservicios Go (OTel) no llevan el
			// contexto en el cuerpo como Monolog: lo llevan como etiquetas — `preapprovals-service` pone ahí
			// `user_request_id`, `lender_name`, `preapproval_id`, `status`. Descartarlas hacía tres cosas a
			// la vez: el chequeo del ancla no encontraba el valor y tiraba la línea, `pick()` no veía nada, y
			// ningún matcher con `campo` podía mirar `service_name`. El cuerpo GANA en caso de choque: es lo
			// que el que logueó quiso decir. La morralla de OTel se salta para que el ctx siga siendo legible.
			for k, v2 := range st.Stream {
				if _, ya := l.ctx[k]; ya || boilerplateOTel[k] {
					continue
				}
				l.ctx[k] = v2
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

	// La evaluación de categoría, entidad por entidad. Va acotada a la ventana de ESTA solicitud porque la
	// tabla se indexa por `user_id`: un cliente con dos intentos el mismo día trae las filas de los dos.
	// La ventana es generosa hacia atrás (la categoría se evalúa al armar el listado, que puede empezar
	// antes de que la fila de `user_requests` quede escrita) y corta hacia adelante.
	if !s.Creada.IsZero() {
		// La referencia es la corrida del perfilamiento, NUNCA la creación de la solicitud: la
		// categorización pasa minutos después de crearse la fila, así que compararla contra `created_at`
		// tira siempre «fuera de ventana» y la advertencia se vuelve ruido que se aprende a ignorar.
		var corrida time.Time
		if s.Perfilamiento != nil {
			corrida = s.Perfilamiento.Creado
		}
		s.Categorias = GetCategorias(fuente, s.UserID, s.Creada.Add(-15*time.Minute), s.Creada.Add(6*time.Hour), corrida)
	}
	// El pagaré digital. Ésta SÍ se ancla por `user_request_id`: no hace falta ventana ni heurística.
	s.Deceval = GetDeceval(fuente, s.ID)
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
// masRepetido dice qué criterio bloqueó en MÁS tiers. Un lender con doce tiers repite el mismo motivo
// doce veces: sin esto, el renglón que soporte pega en el ticket sería una lista y no un diagnóstico.
func masRepetido(fallas map[string][]string) string {
	cuenta := map[string]int{}
	for _, criterios := range fallas {
		for _, c := range criterios {
			cuenta[c]++
		}
	}
	mejor, n := "", 0
	for c, k := range cuenta {
		if k > n || (k == n && c < mejor) {
			mejor, n = c, k
		}
	}
	if n > 1 {
		return fmt.Sprintf("%s (en %d de %d tiers)", mejor, n, len(fallas))
	}
	return mejor
}

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
	// `consultada` dice qué centrales tienen fila en ESTA traza. Es lo que permite resolver las candidatas
	// sin inventar: la entidad a la que pertenece un hito ambiguo es la única de su familia que se consultó.
	consultada := map[string]bool{}
	for i := range subs {
		for _, h := range subs[i].Hijos {
			if h.Source == "db" && h.Status == "ok" {
				consultada[h.Label] = true
			}
		}
	}
	for _, b := range bloques {
		for _, h := range b.Hitos {
			if h.Central != 0 {
				if n, ok := centrales[h.Central]; ok && n != "" {
					enlace[h.Label] = n
				}
				continue
			}
			// Candidatas: sólo se resuelve si UNA sola de ellas fue consultada. Con cero no hay a dónde
			// colgarlo; con varias, cualquier elección sería una adivinanza con cara de dato.
			var unica string
			n := 0
			for _, id := range h.Centrales {
				if nom, ok := centrales[id]; ok && consultada[nom] {
					unica, n = nom, n+1
				}
			}
			if n == 1 {
				enlace[h.Label] = unica
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
	// ⚠ Es N:1, no 1:1. Con las candidatas resueltas, TRES hitos de Experian («disparado», «NO disparado»,
	// «Consulta terminada») caen en la misma fila. La versión anterior guardaba `aporta[destino] = h` y el
	// último pisaba a los dos anteriores: la fila decía «×1» y las otras dos evidencias desaparecían del
	// árbol sin dejar rastro. Un merge que descarta callado es peor que no fusionar.
	aporta := map[string][]Sub{}
	for i := range subs {
		var quedan []Sub
		for _, h := range subs[i].Hijos {
			if destino, ok := enlace[h.Label]; ok {
				aporta[destino] = append(aporta[destino], h)
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
			hs, ok := aporta[c.Label]
			if !ok {
				continue
			}
			// TODO LO DE LA ENTIDAD DENTRO DE SU PASO, en UN nivel. Como hijos serían nietos —la entidad ya
			// cuelga del grupo— y el árbol dibuja dos niveles a propósito. Así que sus líneas se juntan en
			// la entidad y sus nombres van al detalle: se abre el paso y está todo lo suyo, que era el punto.
			var nombres []string
			var total int
			for _, h := range hs {
				// La FILA DE BD manda en el estado —es el hecho—, salvo que el log traiga un error: eso el
				// esqueleto no lo sabe y es justo lo que se vino a buscar.
				if h.Status == "fail" {
					c.Status = "fail"
				}
				nombres = append(nombres, h.Label)
				total += h.EventosDe
				c.Eventos = append(c.Eventos, h.Eventos...)
			}
			// El tope se aplica DESPUÉS de juntar, y el total dice cuántas había: recortar en silencio acá
			// haría que un paso con 60 líneas se leyera como uno con 40.
			if len(c.Eventos) > 40 {
				c.Eventos = c.Eventos[:40]
			}
			c.EventosDe = total
			if len(nombres) > 0 {
				c.Detail += " · " + strings.Join(nombres, " · ")
			}
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
		if s.Status != "skip" && !s.Declarativo {
			return true
		}
	}
	return false
}

// fusionarPreaprobacion mete las llamadas del MS DENTRO de la fila de su entidad, por `lender_id`.
//
// Lo que sobra —una llamada a un lender que el listado no muestra— NO se tira: va en una fila propia al
// final. Que el MS haya consultado una entidad que después no apareció es exactamente la clase de cosa que
// hay que ver, no esconder.
func fusionarPreaprobacion(subs []Sub, porID map[string]Sub) []Sub {
	usados := map[string]bool{}
	var mete func(xs []Sub) []Sub
	mete = func(xs []Sub) []Sub {
		for i := range xs {
			if ms, ok := porID[xs[i].Detail2]; ok && xs[i].Detail2 != "" {
				usados[xs[i].Detail2] = true
				// El detalle del listado (el veredicto) manda; lo del MS se agrega detrás.
				if xs[i].Detail != "" {
					xs[i].Detail += " · " + ms.Detail
				} else {
					xs[i].Detail = ms.Detail
				}
				xs[i].Eventos, xs[i].EventosDe = ms.Eventos, ms.EventosDe
				xs[i].Source = "db+loki"
				if ms.Status == "warn" {
					xs[i].Status = "warn" // el `pending` deja la entidad colgada: se propaga
				}
			}
			xs[i].Hijos = mete(xs[i].Hijos)
		}
		return xs
	}
	subs = mete(subs)

	var sobran []Sub
	var claves []string
	for id := range porID {
		if !usados[id] {
			claves = append(claves, id)
		}
	}
	sort.Strings(claves)
	for _, id := range claves {
		s := porID[id]
		s.Label = fmt.Sprintf("%s (lender %s)", s.Label, id)
		sobran = append(sobran, s)
	}
	if len(sobran) > 0 {
		subs = append(subs, Sub{
			Label:  "Consultadas al MS pero NO en el listado",
			Status: "warn", Source: "loki",
			Detail: plural(len(sobran), "entidad", "entidades") + " — se pre-aprobaron y no aparecen arriba",
			Hijos:  sobran,
		})
	}
	return subs
}

// arbolCorridas parte las líneas comunes del listado POR CORRIDA, no por tipo de mensaje.
//
// La cascada se ejecuta VARIAS VECES en una misma solicitud —medido en la uReq 521997 de prod: tres, a las
// 18:33, 18:45 y 18:46— y cada ejecución es una petición HTTP con su `trace_id`, verificado: «Iniciando
// listado de entidades» y «Listado de entidades completado» comparten trace de a pares.
//
// Agrupadas por mensaje, las líneas de las tres corridas quedan mezcladas: abrir «Reglas por entidad» daba
// 10 renglones entre 18:33 y 18:46 sin forma de saber a cuál ejecución pertenecía cada uno. Por corrida, en
// cambio, cada bloque es una historia completa y comparable — y la que se colgó se ve sola.
func corridasDeLaCascada(ls []Linea) int {
	// ⚠ UNA CORRIDA ES UN TRACE QUE ARRANCÓ LA CASCADA, no cualquier trace con líneas del listado.
	//
	// La primera versión contaba traces a secas y decía «la cascada corrió 6 veces» cuando cuatro de esos
	// traces eran fragmentos —uno traía sólo `validatePreApproveLender: entered/exiting`— que ni siquiera
	// intentaban listar. Un número inventado es peor que no dar número.
	//
	// La marca de arranque es `Iniciando listado de entidades`, verificada contra Loki: aparece de a pares
	// con `Listado de entidades completado` bajo el MISMO trace.
	//
	// Antes esto armaba un ÁRBOL entero —una rama por corrida, con sus líneas adentro— y ese árbol se
	// eliminó a pedido: de todo lo que la cascada loguea, lo único que informaba era el timeout del
	// profiler, que hoy vive en su propio paso junto al perfilador que la BD dice que ordenó. Lo que
	// sobrevive es el conteo, porque más de una corrida es un reintento y eso sí es una señal.
	arranco := map[string]bool{}
	for _, l := range ls {
		if l.trace != "" && strings.HasPrefix(l.msg, "Iniciando listado de entidades") {
			arranco[l.trace] = true
		}
	}
	return len(arranco)
}

// arbolPreaprobacion agrupa las líneas del MS de pre-aprobación POR ENTIDAD, no por tipo de mensaje.
//
// La pre-aprobación se pide UNA VEZ POR LENDER: el front llama al MS lender por lender, así que cada
// llamada es un `trace_id` propio con su `lender_name` y su `status` en las etiquetas. Agrupar por mensaje
// («Autenticación ×40, Veredicto ×14») mezcla las cuatro entidades y pierde justo lo que se viene a
// preguntar — *«¿por qué Welli me rechazó?»*.
//
// Medido en la uReq 521997 de prod: 14 llamadas para 4 entidades — `creditop_x` ×6, `credifamilia` ×4,
// `welli` ×2, `bancolombia_bnpl` ×2. Ese conteo por sí solo es una señal: seis intentos contra el mismo
// lender es un patrón de reintento que agrupado por mensaje no se ve en ninguna parte.
func arbolPreaprobacion(ls []Linea) map[string]Sub {
	type acc struct {
		traces   map[string]bool
		estados  map[string]int
		lineas   []Linea
		primero  int64
		lenderID string // `lenders.id` real: la llave para fusionar con el árbol de entidades del listado
	}
	// PRIMERO POR TRACE, y recién después por lender. Dentro de una misma llamada las etiquetas están
	// repartidas entre líneas distintas: `lender_name` viaja en las de la llamada al lender y `status` sólo
	// en `preapproval checked successfully`. Agrupar directo por `lender_name` mandaba las 14 líneas de
	// veredicto —las que traen el status— a un cajón «(sin entidad)», que es el dato más útil de todos.
	// El trace es la unidad real: una llamada, un lender, un veredicto.
	lenderDe := map[string]string{}
	idDe := map[string]string{}
	estadoDe := map[string]string{}
	for _, l := range ls {
		if l.trace == "" {
			continue
		}
		if v := pick(l.ctx, []string{"lender_id"}); v != "" && idDe[l.trace] == "" {
			idDe[l.trace] = v
		}
		if v := pick(l.ctx, []string{"lender_name"}); v != "" && lenderDe[l.trace] == "" {
			lenderDe[l.trace] = v
		}
		if v := pick(l.ctx, []string{"status"}); v != "" && estadoDe[l.trace] == "" {
			estadoDe[l.trace] = v
		}
	}

	porLender := map[string]*acc{}
	var orden []string
	for _, l := range ls {
		nombre := lenderDe[l.trace]
		if nombre == "" {
			nombre = pick(l.ctx, []string{"lender_name"})
		}
		if nombre == "" {
			nombre = "(sin entidad en la etiqueta)"
		}
		// ⚠ SE AGRUPA POR `lender_id`, NO POR NOMBRE. `lender_name` del MS es la FAMILIA en algunos casos:
		// `creditop_x` cubre DENTIX FINANCIAL SERVICES (139) y DFS ORTODONCIA (181) a la vez, y agrupar por
		// ese nombre juntaría dos entidades distintas en una fila. El `lender_id` es el `lenders.id` real —
		// medido: 68 Bancolombia CPD, 24 Credifamilia, 23 Welli, 139/181 los dos DENTIX.
		id := idDe[l.trace]
		if id == "" {
			id = pick(l.ctx, []string{"lender_id"})
		}
		clave := id
		if clave == "" {
			clave = "sin-id:" + nombre
		}
		a := porLender[clave]
		if a == nil {
			a = &acc{traces: map[string]bool{}, estados: map[string]int{}, primero: l.ts, lenderID: clave}
			porLender[clave] = a
			orden = append(orden, clave)
		}
		a.lineas = append(a.lineas, l)
		if l.trace != "" && !a.traces[l.trace] {
			a.traces[l.trace] = true
			// El estado se cuenta UNA VEZ POR LLAMADA. Contarlo por línea daría «13 rejected» donde hay 13
			// llamadas rechazadas o una rechazada con 13 líneas — dos cosas muy distintas.
			if st := estadoDe[l.trace]; st != "" {
				a.estados[st]++
			}
		}
		if l.ts < a.primero {
			a.primero = l.ts
		}
	}
	// Por volumen de llamadas: el lender con más reintentos primero, que es el que suele ser el problema.
	sort.Slice(orden, func(i, j int) bool {
		if n, m := len(porLender[orden[i]].traces), len(porLender[orden[j]].traces); n != m {
			return n > m
		}
		return orden[i] < orden[j]
	})

	out := map[string]Sub{}
	for _, nombre := range orden {
		a := porLender[nombre]
		llamadas := len(a.traces)
		if llamadas == 0 {
			llamadas = 1
		}
		var partes []string
		partes = append(partes, plural(llamadas, "llamada", "llamadas"))
		// Los estados en orden estable: el conteo de un map en Go es aleatorio al recorrerlo.
		var claves []string
		for k := range a.estados {
			claves = append(claves, k)
		}
		sort.Strings(claves)
		st := "ok"
		for _, k := range claves {
			partes = append(partes, fmt.Sprintf("%d %s", a.estados[k], k))
			// `pending` es el que deja la solicitud colgada esperando al lender: se marca. `rejected` NO es
			// un error — es un veredicto de negocio, y pintarlo en rojo haría ver rota una evaluación sana.
			if k == "pending" {
				st = "warn"
			}
		}
		s := Sub{
			Label:  nombre,
			Status: st,
			Detail: strings.Join(partes, " · ") + " · " + hhmm(time.UnixMilli(a.primero)),
			Source: "loki",
		}
		s.Eventos, s.EventosDe = eventosDe(a.lineas, 40)
		out[a.lenderID] = s
	}
	return out
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
func arbolCentrales(etiqueta string, declaradas []ItemCatalogo, catalogo map[int64]string, filas []FilaBuro, userID int64) []Sub {
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
	// La evidencia va en el GRUPO y no en cada central: la afirmación auditable es «2 de 6», y para
	// comprobarla hace falta ver TODAS las filas que trajo la consulta, incluidas las que este bloque no
	// declara. Ahí es donde se descubre que una central que el mapa no conoce sí se consultó.
	crudas := make([]string, 0, len(filas))
	for _, f := range filas {
		sc := "sin score"
		if f.Score != nil {
			sc = fmt.Sprintf("score %.0f", *f.Score)
		}
		crudas = append(crudas, fmt.Sprintf("%s  %s · %s", fechaHora(f.At), f.Central, sc))
	}
	if len(crudas) == 0 {
		crudas = append(crudas, "(la consulta no devolvió filas para este user_id)")
	}
	// ⚠ El `?` es el user_id, NO la solicitud: el buró se indexa por cliente, así que estas filas pueden
	// ser de otro intento del mismo cliente. Va dicho acá porque quien copie esto va a pegar la consulta.
	ev := evidencia("risk_central_user_data (por user_id, no por solicitud)", sqlBuro, []any{userID}, crudas...)
	return []Sub{{Label: etiqueta, Status: st, Detail: det, Source: "db", Hijos: hijos, Evidencia: ev}}
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

// valoresDeEtiqueta lee los valores reales de una etiqueta en la ventana. Existe para que el trazador pueda
// DESCUBRIR que su propio filtro no aplica, en vez de devolver vacío y dejar que el vacío se lea como
// «el backend no logueó». Ante cualquier error devuelve nil: no poder comprobar no es lo mismo que
// comprobar que está mal, así que en ese caso el filtro configurado se respeta.
func valoresDeEtiqueta(cl *client, etiqueta string, desde, hasta time.Time) []string {
	status, body, err := cl.get("/loki/api/v1/label/"+etiqueta+"/values", url.Values{
		"start": {fmt.Sprint(desde.UnixNano())},
		"end":   {fmt.Sprint(hasta.UnixNano())},
	})
	if err != nil || status != 200 {
		return nil
	}
	var r struct {
		Status string   `json:"status"`
		Data   []string `json:"data"`
	}
	if json.Unmarshal(body, &r) != nil {
		return nil
	}
	sort.Strings(r.Data)
	return r.Data
}

func contiene(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
