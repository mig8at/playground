// sources.go — de dónde salen los datos estructurados, sin que el trazador se entere.
//
// Qué base atiende cada ambiente (MySQL directo en local · dev · qa · staging; Redash en prod), sus
// credenciales, el ciclo de Redash, la guarda de inyección de sus argumentos y en qué zona vienen las
// fechas de cada fuente son de `connectors/sql`, y el trazador sólo le pide la fuente de su ambiente.
// Hasta el 2026-09-24 todo eso vivía acá y el tablero tenía otra copia, que ya no coincidía.
//
// Lo que sí es del trazador: las consultas, escritas UNA vez para las dos fuentes (ver las constantes
// `sql*`), y cómo se leen las filas. Sin eso habría dos juegos de consultas que derivan, que es el
// problema que este repo ya tuvo con `veredicto()`.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	dbsql "creditop/playground/connectors/sql"
)

// Row es una fila genérica, la del conector. Se usa un mapa y no structs por fuente porque el parseo a
// `Solicitud` pasa UNA vez, después de la fuente: así agregar una fuente no obliga a tocar el parseo.
type Row = dbsql.Row

// Runner es la fuente de un ambiente: `Rows` corre un SELECT, `Name` dice qué contestó y `Zone` en qué
// zona vienen sus fechas (ver la nota de F-241 en el conector: para dev dejó de ser una sola).
type Runner = dbsql.Source

// digitsOnly es la forma de los valores que se interpolan en una consulta: la misma regla que el conector
// aplica a sus argumentos, para lo que el trazador arma a mano.
var digitsOnly = regexp.MustCompile(`^\d{1,20}$`)

// openSource pide al conector la base del ambiente. Se abren hasta cuatro conexiones porque una traza
// hace varias consultas por etapa.
func openSource(c config) (Runner, error) {
	cfg, _, err := dbsql.LoadConfig(c.target)
	if err != nil {
		return nil, err
	}
	cfg.MaxOpen = 4
	return dbsql.Open(cfg)
}

// ─── las consultas, escritas UNA vez ────────────────────────────────────────────────────────────────
//
// Van acá y no pegadas a cada lector porque las ejecutan DOS fuentes (MySQL directo y Redash). Tenerlas
// duplicadas por fuente es exactamente cómo empiezan a derivar: se arregla un JOIN en una y no en la otra,
// y después el mismo uReq cuenta una historia distinta según el ambiente.

// ⚠ `validacion` = CÓMO valida identidad este lender, y sin eso la etapa biométrica es una trampa: medido
// en prod, **46 de los 119 lenders in-platform validan por AWS OCR+Rekognition**, que NO escribe fila en
// `risk_central_user_data`. Para ellos «las cuatro centrales no consultadas» se lee como «no pasó nada»
// cuando el OCR y el reconocimiento facial corrieron completos. Misma precedencia que
// `CreditopXFlowService.php:117`: la tabla puente primero, la columna del lender como fallback.
const sqlLoanRequest = `
	SELECT ur.user_id, ur.user_request_status_id AS st, COALESCE(stt.name,'') AS status,
	       COALESCE(l.name,'') AS lender, COALESCE(l.id,0) AS lender_id, COALESCE(l.response_type,0) AS rt,
	       COALESCE(a.name,'') AS merchant, COALESCE(a.id,0) AS allied_id, COALESCE(ab.name,'') AS branch,
	       COALESCE(u.document_number,'') AS document, COALESCE(u.cell_phone,'') AS phone,
	       COALESCE(ur.amount,0) AS amount, ur.created_at,
	       COALESCE(livt.identity_validation_type_id, l.validation_type, 0) AS validation
	  FROM user_requests ur
	  LEFT JOIN user_request_statuses stt ON stt.id = ur.user_request_status_id
	  LEFT JOIN lenders l                ON l.id   = ur.lender_id
	  LEFT JOIN lender_identity_validation_types livt ON livt.lender_id = l.id
	  LEFT JOIN allied_branches ab       ON ab.id  = ur.allied_branch_id
	  LEFT JOIN allieds a                ON a.id   = ab.allied_id
	  LEFT JOIN users u                  ON u.id   = ur.user_id
	 WHERE ur.id = ?`

const sqlHistory = `
	SELECT r.user_request_status_id AS st, COALESCE(stt.name,'') AS status, r.created_at
	  FROM user_request_records r
	  LEFT JOIN user_request_statuses stt ON stt.id = r.user_request_status_id
	 WHERE r.user_request_id = ? ORDER BY r.created_at, r.id`

// El buró se indexa por `user_id`, NO por solicitud: una consulta puede ser de otro intento del mismo
// cliente. Se acota desde la creación de esta solicitud, y aun así queda dicho en el árbol.
const sqlBureau = `
	SELECT COALESCE(rc.name, CONCAT('central ', d.risk_central_id)) AS central, d.score, d.created_at
	  FROM risk_central_user_data d
	  LEFT JOIN risk_centrals rc ON rc.id = d.risk_central_id
	 WHERE d.user_id = ? AND d.deleted_at IS NULL ORDER BY d.created_at`

const sqlBureaus = `SELECT id, COALESCE(name,'') AS name FROM risk_centrals ORDER BY id`

// ─── deceval_logs: el tramo del pagaré digital ─────────────────────────────────────────────────────
//
// De las 14 tablas de log de auditoría del esquema, ésta es **la única que ata al 100 % por
// `user_request_id`** (F-108: 1.404 filas / 174 solicitudes; medido de nuevo el 2026-08-07: 174
// solicitudes con girador, 157 que llegaron a firmar). No hay que inferir nada por fecha: la fila dice
// de qué solicitud es.
//
// ⚠ **Es best-effort.** Se escribe dentro de un try/catch que nunca rompe la firma, así que **una fila
// que falta NO prueba que la operación no corrió** — la regla de oro de este trazador, acá literal. Por
// eso el veredicto del tramo se cruza con `promissory_notes` y no se decide solo con estas filas.
//
// ⚠ **El detalle accionable está en `mensajeRespuesta`, no en `descripcion`**, que es genérica. Es lo
// primero que dice la receta de debugging del runbook y lo primero que se pierde si uno lee el XML por
// arriba.
const sqlDeceval = `
	SELECT id, COALESCE(name,'') AS name, COALESCE(method,'') AS method,
	       COALESCE(response,'') AS response, created_at
	  FROM deceval_logs
	 WHERE user_request_id = ?
	 ORDER BY id`

// DecevalOp es UNA operación contra Deceval, ya interpretada.
type DecevalOp struct {
	Method string // createGirador · createPagare · consultPagare · signPagare · createPromisoryNote
	Name   string // la etapa legible que escribió el backend
	At     time.Time
	// Succeeded: lo que dice el `<exitoso>` de la respuesta. Es un puntero porque «no vino» y «vino false»
	// son cosas distintas: la primera puede ser una operación sin ese campo (el wrapper), la segunda es
	// un rechazo. Colapsarlas convertiría un `sin dato` en un `falló`.
	Succeeded *bool
	Code      string // codigoError (SDL.*)
	Message   string // mensajeRespuesta: el accionable
}

var (
	reDecevalSucceeded   = regexp.MustCompile(`(?i)<(?:\w+:)?exitoso>\s*(true|false)\s*</`)
	reDecevalCode        = regexp.MustCompile(`(?i)<(?:\w+:)?codigoError>\s*([^<]{1,60})\s*</`)
	reDecevalMessage     = regexp.MustCompile(`(?i)<(?:\w+:)?mensajeRespuesta>\s*([^<]{1,400})\s*</`)
	reDecevalDescription = regexp.MustCompile(`(?i)<(?:\w+:)?descripcion>\s*([^<]{1,400})\s*</`)
	// El código SDL suelto, para las respuestas que no traen `<codigoError>` (ver abajo).
	reDecevalSDL = regexp.MustCompile(`SDL\.[A-Z]{2}\.\d{4}`)
)

// decevalOKCode es el «todo salió bien» del protocolo. Deceval no usa un booleano en todas las
// respuestas, así que en varias operaciones ESTE es el único veredicto disponible.
const decevalOKCode = "SDL.SE.0000"

// GetDeceval trae las operaciones contra Deceval de esta solicitud. Un error se devuelve, no se convierte
// en vacío: no saber no es saber que no (quien llama lo anota en `Unread`).
func GetDeceval(r Runner, ureq int64) ([]DecevalOp, error) {
	fs, err := r.Rows(sqlDeceval, ureq)
	if err != nil {
		return nil, err
	}
	out := make([]DecevalOp, 0, len(fs))
	for _, f := range fs {
		o := DecevalOp{
			Method: asText(f["method"]), Name: asText(f["name"]),
			At: date(f["created_at"], r.Zone()),
		}
		// El XML viene dentro de un JSON (`{"soap_response_xml": "..."}`) y con las barras escapadas. No
		// se parsea como XML a propósito: el envelope trae firma, timestamps y namespaces que no
		// interesan, y un parser estricto se rompe con respuestas parciales — que son justo las de los
		// casos que se están depurando.
		// ⚠ El XML viene DENTRO de un JSON, así que las barras están escapadas: el cierre real es
		// `<\/exitoso>`, no `</exitoso>`. Un regex que espere `</` no matchea NUNCA y el resultado se lee
		// como «la respuesta no trae exitoso» — o sea, un dato que sí está se reporta como ausente. Costó
		// una corrida en la uReq 522008 de prod, que había firmado perfecto.
		xml := strings.ReplaceAll(asText(f["response"]), `\/`, "/")
		if m := reDecevalSucceeded.FindStringSubmatch(xml); m != nil {
			v := strings.EqualFold(m[1], "true")
			o.Succeeded = &v
		}
		if m := reDecevalCode.FindStringSubmatch(xml); m != nil {
			o.Code = strings.TrimSpace(m[1])
		}
		if m := reDecevalMessage.FindStringSubmatch(xml); m != nil {
			o.Message = strings.TrimSpace(m[1])
		}
		// ⚠ `firmarPagares` responde con OTRA FORMA: `RespuestaFirmarPagaresDTO` **no trae `<exitoso>` ni
		// `<codigoError>`** — el código va embebido en el texto de `<descripcion>`
		// («SDL.SE.0000: Exitoso.»). O sea que la regla del runbook —«el detalle está en
		// `mensajeRespuesta`, la `descripcion` es genérica»— **no vale para la firma**: ahí la descripción
		// es lo único que hay. Sin este caso, la operación más importante del tramo se reportaba siempre
		// como «la respuesta no trae exitoso» — un éxito leído como falta de evidencia.
		if desc := reDecevalDescription.FindStringSubmatch(xml); desc != nil {
			if o.Message == "" {
				o.Message = strings.TrimSpace(desc[1])
			}
			if o.Code == "" {
				if m := reDecevalSDL.FindString(desc[1]); m != "" {
					o.Code = m
				}
			}
		}
		if o.Succeeded == nil && o.Code != "" {
			v := o.Code == decevalOKCode
			o.Succeeded = &v
		}
		out = append(out, o)
	}
	return out, nil
}

// ─── users_category_log: POR QUÉ el perfilamiento dijo que no ──────────────────────────────────────
//
// Es la evidencia que faltaba, y contesta el reporte más frecuente de soporte («¿por qué a este cliente
// no le salió CreditopX?»): guarda, POR ENTIDAD y POR TIER, qué criterio de admisión pasó y cuál no.
// Medido en prod: 26.846 filas en 7 días, TODAS con `category_rules_acceptance`. No es un log de texto
// que haya que interpretar — es la evaluación completa, en JSON, escrita por el propio motor.
//
// ⚠ NO tiene `user_request_id`: se indexa por (`user_id`, `lender_id`), igual que el buró. La ventana
// acota, no prueba. Y para saber si una fila es de ESTA corrida el backoffice usa una heurística que se
// replica acá: `|created_at − profiling_reviews.updated_at| <= 120 s`
// (`Modules/Backoffice/App/Services/ApplicationsService.php:1443`).
const sqlCategories = `
	SELECT ucl.id, ucl.lender_id, COALESCE(l.name,'') AS lender,
	       ucl.lender_users_category_id AS cat, COALESCE(c.name,'') AS cat_name,
	       ucl.current_available_amount AS quota, ucl.category_rules_acceptance AS rules, ucl.created_at
	  FROM users_category_log ucl
	  LEFT JOIN lenders l               ON l.id = ucl.lender_id
	  LEFT JOIN lender_users_categories c ON c.id = ucl.lender_users_category_id
	 WHERE ucl.user_id = ?
	   AND ucl.created_at BETWEEN STR_TO_DATE(?, '%Y%m%d%H%i%s') AND STR_TO_DATE(?, '%Y%m%d%H%i%s')
	 ORDER BY ucl.id`

// ⚠ DOS decisiones en esa cláusula de fecha, y las dos costaron una corrida en vacío:
//
//  1. La ventana va como `YYYYMMDDHHMMSS` (dígitos) y no como `'2026-08-07 10:00:00'` porque `Filas`
//     rechaza todo argumento que no sea de dígitos — la guarda de inyección del camino Redash.
//  2. **NO se usa `FROM_UNIXTIME`.** Sería lo natural, y da CERO filas en prod: la sesión de MySQL está en
//     UTC (`@@session.time_zone = UTC`, `NOW()` devuelve UTC) pero las columnas `created_at` guardan hora
//     de **Bogotá**. `FROM_UNIXTIME(instante)` rinde en UTC y compara contra un valor local: cinco horas
//     de corrimiento y ninguna fila, sin ningún error. Comparando reloj-de-pared contra reloj-de-pared
//     —en la zona que declara la fuente— la pregunta queda bien planteada en las dos fuentes.

// Category es la evaluación de UNA entidad para este cliente: qué categoría le tocó (0 = ninguna) y,
// tier por tier, qué criterio falló.
type Category struct {
	LenderID int64
	Lender   string
	CatID    int64
	CatName  string
	Quota    float64
	At       time.Time
	// Failures: tier → criterios en `false`. Un tier SIN entrada es un tier que pasó todo.
	Failures map[string][]string
	// Tiers evaluados en total (los que pasaron y los que no): sin esto, «3 tiers fallaron» no dice si
	// eran 3 de 3 o 3 de 12.
	Tiers int
	// Short dice DÓNDE se detuvo la evaluación de ese tier, que es lo que las claves ausentes significan:
	// el motor evalúa 5 criterios básicos, y si alguno falla RETORNA sin tocar el buró.
	// `básicos` = murió antes del buró · `sin buró` = no hay fila de datacrédito · `buró` = llegó.
	Short map[string]string
	// Special: bandera de nivel raíz, fuera del universo de tiers. Hoy dos: `blacklisted` (documento en
	// lista negra de esa entidad) y `validacion_venezolanos` (CE + lender 84: SALTA todas las reglas).
	Special string
	// Window dice qué se puede AFIRMAR sobre a qué corrida pertenece esta fila, y tiene tres valores
	// porque dos no alcanzan: `misma` (cae dentro de ±120 s de la corrida del perfilamiento) · `otra`
	// (cae fuera: puede ser de otro intento del mismo cliente) · `sin-referencia` (no hay fila de
	// `profiling_reviews` contra la cual comparar). Colapsar los dos últimos hacía que una solicitud sin
	// perfilamiento advirtiera «puede ser de otro intento» sin tener ninguna base para decirlo — que es
	// exactamente el error que este trazador comete cuando trata una ausencia como una negación.
	Window string
}

// GetCategories trae la evaluación de categoría de todas las entidades para este cliente en la ventana de
// la solicitud. Un error se devuelve, no se convierte en vacío: no saber no es saber que no.
func GetCategories(r Runner, userID int64, since, until time.Time, run time.Time) ([]Category, error) {
	if userID == 0 || since.IsZero() {
		return nil, nil
	}
	// El reloj de pared TAL COMO LO DEVUELVE ESTA FUENTE: `fecha()` parseó con `r.Zone()`, así que
	// volver a esa zona reconstruye exactamente el texto que hay en la columna.
	clock := func(t time.Time) string { return t.In(r.Zone()).Format("20060102150405") }
	fs, err := r.Rows(sqlCategories, userID, clock(since), clock(until))
	if err != nil {
		return nil, err
	}
	out := make([]Category, 0, len(fs))
	for _, f := range fs {
		c := Category{
			LenderID: integer(f["lender_id"]), Lender: asText(f["lender"]),
			CatID: integer(f["cat"]), CatName: asText(f["cat_name"]),
			Quota: decimal(f["quota"]), At: date(f["created_at"], r.Zone()),
			Failures: map[string][]string{}, Short: map[string]string{},
		}
		switch {
		case run.IsZero() || c.At.IsZero():
			c.Window = "sin-referencia"
		default:
			d := c.At.Sub(run)
			if d > -120*time.Second && d < 120*time.Second {
				c.Window = "misma"
			} else {
				c.Window = "otra"
			}
		}
		var raw map[string]json.RawMessage
		if json.Unmarshal([]byte(asText(f["rules"])), &raw) == nil {
			for k, v := range raw {
				// Las banderas de raíz son booleanos sueltos, no mapas de criterios.
				var flag bool
				if json.Unmarshal(v, &flag) == nil {
					if flag {
						c.Special = k
					}
					continue
				}
				var checks map[string]bool
				if json.Unmarshal(v, &checks) != nil {
					continue
				}
				c.Tiers++
				var badOnes []string
				for name, ok := range checks {
					if !ok {
						badOnes = append(badOnes, name)
					}
				}
				sort.Strings(badOnes)
				if len(badOnes) > 0 {
					c.Failures[k] = badOnes
				}
				// ⚠ Las dos grafías son reales, no un typo de este parser: `Modules/Loans/…:407` escribe
				// `occupation` y `Modules/Onboarding/…:93` escribe `ocupations`. Buscar una sola deja
				// ciegas las filas del otro escritor. Ver F-118.
				// ⚠ `checks["datacredito"] == false` sería un BUG, y es el mismo que este parser existe para
				// evitar: en Go una clave AUSENTE devuelve el cero del tipo, o sea `false`. Sin el `, ok`
				// todo tier que muriera en los cinco básicos —donde la clave `datacredito` ni se escribe—
				// se leería como «no tiene buró», que manda a buscar un problema de datos donde hay un
				// criterio de admisión que no se cumplió. Medido en la uReq 522511 de prod: el tier 12 salía
				// «sin buró» cuando lo que falló fue `employment_continuity`.
				_, hasDC := checks["datacredito"]
				switch {
				case hasDC:
					c.Short[k] = "sin buró"
				case len(checks) <= 5:
					c.Short[k] = "básicos"
				default:
					c.Short[k] = "buró"
				}
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// sqlCorbeta lee el setting que define el CANAL Corbeta. Es una LISTA EN BD, no una constante: en prod hoy
// vale [24, 209, 210, 211, 311] (Creditop, Alkosto, K-TRONIX, Alkomprar, Kalley) y agregar un comercio es
// editar el setting. Cablear los ids acá haría que el trazador mintiera el día que Corbeta sume una tienda.
//
// El flag decide TRES cosas en `ValidateOtpAuthService::validateOtpAuthOrchestrator` (legacy-backend
// Modules/OnboardingV2): un usuario temporal NO se manda a datos personales, la info laboral que falta se
// FABRICA con `storeDefaultEmploymentInformation`, y la respuesta sale con su propio código OBV22007 en vez
// del OBV22000 normal. Como el buró se dispara al guardar lo laboral, sin formulario no hay buró.
const sqlCorbeta = "SELECT value FROM settings WHERE `key` = 'corbeta_allieds' LIMIT 1"

// GetCorbetaAllieds devuelve los allied_id del canal Corbeta. Un error se devuelve: no saber es distinto
// de saber que no, y un canal mal supuesto esconde etapas que sí ocurrieron. Sin la fila de settings no
// hay comercios Corbeta, y eso no es un error.
func GetCorbetaAllieds(r Runner) (map[int64]bool, error) {
	out := map[int64]bool{}
	fs, err := r.Rows(sqlCorbeta)
	if err != nil {
		return out, err
	}
	if len(fs) == 0 {
		return out, nil
	}
	var ids []int64
	if err := json.Unmarshal([]byte(asText(fs[0]["value"])), &ids); err != nil {
		return out, fmt.Errorf("corbeta_allieds no es una lista de ids: %w", err)
	}
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

const sqlIsEcommerce = `SELECT COUNT(*) AS n FROM ecommerce_requests WHERE user_request_id = ?`

// GetLoanRequest arma el esqueleto usando cualquiera de las dos fuentes.
func GetLoanRequest(r Runner, ureq int64) (*LoanRequest, error) {
	fs, err := r.Rows(sqlLoanRequest, ureq)
	if err != nil {
		return nil, err
	}
	if len(fs) == 0 {
		return nil, fmt.Errorf("la solicitud %d no existe en %s", ureq, r.Name())
	}
	f := fs[0]
	s := &LoanRequest{
		ID: ureq, UserID: integer(f["user_id"]), Status: int(integer(f["st"])),
		StatusN: asText(f["status"]), Lender: asText(f["lender"]),
		LenderID: integer(f["lender_id"]), LenderRT: int(integer(f["rt"])),
		Merchant: asText(f["merchant"]), AlliedID: integer(f["allied_id"]), Branch: asText(f["branch"]),
		Document: asText(f["document"]), Phone: asText(f["phone"]),
		Amount: decimal(f["amount"]), Created: date(f["created_at"], r.Zone()),
		Validation: int(integer(f["validation"])),
	}

	hs, err := r.Rows(sqlHistory, ureq)
	s.couldNotRead("el historial de estados", err)
	if err == nil {
		prev := -1
		for _, h := range hs {
			st := int(integer(h["st"]))
			if st == prev {
				continue // se colapsan repetidos: `user_request_records` escribe una fila por cada toque
			}
			prev = st
			s.Transitions = append(s.Transitions, Transition{Status: st, Name: asText(h["status"]), At: date(h["created_at"], r.Zone())})
		}
	}
	bs, err := r.Rows(sqlBureau, s.UserID)
	s.couldNotRead("las consultas a buró", err)
	if err == nil {
		for _, b := range bs {
			at := date(b["created_at"], r.Zone())
			if at.Before(s.Created.Add(-5 * time.Minute)) {
				continue // de otro intento del mismo cliente
			}
			fb := BureauRow{Central: asText(b["central"]), At: at}
			if b["score"] != nil {
				v := decimal(b["score"])
				fb.Score = &v
			}
			s.Bureau = append(s.Bureau, fb)
		}
	}

	s.Profiling, err = GetProfiling(r, ureq)
	s.couldNotRead("el perfilamiento", err)

	s.Origin, s.DerivedOrigin = "asesor", false
	is, err := r.Rows(sqlIsEcommerce, ureq)
	s.couldNotRead("si entró por ecommerce", err)
	if err == nil && len(is) > 0 && integer(is[0]["n"]) > 0 {
		s.Origin, s.DerivedOrigin = "ecommerce", true
	}
	return s, nil
}

// GetBureaus trae el catálogo completo: es lo que permite mostrar las NO consultadas.
func GetBureaus(r Runner) map[int64]string {
	out := map[int64]string{}
	fs, err := r.Rows(sqlBureaus)
	if err != nil {
		return out
	}
	for _, f := range fs {
		out[integer(f["id"])] = asText(f["name"])
	}
	return out
}

// GetLenders trae nombre y response_type de las entidades vistas en los logs — el dato que convierte una
// lista plana en el árbol por familia. Ojo: el `response_type` es POR AMBIENTE (medido: Sistecrédito es
// rt=1 en local y rt=0 en dev), así que esto NO se puede cachear entre targets.
func GetLenders(r Runner, ids []int64) map[int64]LenderInfo {
	out := map[int64]LenderInfo{}
	if len(ids) == 0 {
		return out
	}
	uniques := map[int64]bool{}
	var list []string
	for _, id := range ids {
		if id > 0 && !uniques[id] {
			uniques[id] = true
			list = append(list, fmt.Sprint(id))
		}
	}
	// Interpolación directa: son enteros ya validados al parsearlos, y `IN (?)` con N placeholders no
	// existe en Redash. Se construye con dígitos, nunca con texto del usuario.
	q := fmt.Sprintf(`SELECT id, COALESCE(name,'') AS name, COALESCE(response_type,0) AS rt
	                    FROM lenders WHERE id IN (%s)`, strings.Join(list, ","))
	fs, err := r.Rows(q)
	if err != nil {
		return out
	}
	for _, f := range fs {
		id := integer(f["id"])
		out[id] = LenderInfo{ID: id, Name: asText(f["name"]), RT: int(integer(f["rt"]))}
	}
	return out
}

// ─── coerción ───────────────────────────────────────────────────────────────────────────────────────
// Las dos fuentes devuelven los mismos datos con tipos distintos: el driver de MySQL da []byte/int64 y
// Redash (JSON) da string/float64. Se normaliza acá, una vez, en vez de en cada lector.

func asText(v any) string {
	if v == nil {
		return ""
	}
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return fmt.Sprint(v)
}

func integer(v any) int64 {
	switch x := v.(type) {
	case nil:
		return 0
	case int64:
		return x
	case int:
		return int64(x)
	case float64:
		return int64(x)
	}
	var n int64
	fmt.Sscanf(asText(v), "%d", &n)
	return n
}

func decimal(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case int64:
		return float64(x)
	}
	var f float64
	fmt.Sscanf(asText(v), "%f", &f)
	return f
}

// date acepta los formatos de las dos fuentes. Redash devuelve ISO-8601 y el driver de MySQL un
// time.Time. Las dos vienen en UTC: la conversión a local es SOLO de presentación (ver `hhmm`).
func date(v any, zone *time.Location) time.Time {
	if t, ok := v.(time.Time); ok {
		return t
	}
	if zone == nil {
		zone = time.UTC
	}
	s := asText(v)
	// RFC3339 trae su propio offset, así que se respeta. Los formatos SIN zona se interpretan en la zona
	// que declaró la fuente: es ahí donde se corregía el desfase de 5 horas.
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC()
	}
	for _, f := range []string{"2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
		if t, err := time.ParseInLocation(f, s, zone); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func orSi(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// La búsqueda: una sola consulta con el WHERE variable. Se parte en tres constantes en vez de repetirla
// tres veces porque las columnas TIENEN que ser las mismas — si un camino trajera una columna distinta, el
// parseo la leería como vacía y la coincidencia aparecería a medias.
const sqlSearch = `
	SELECT ur.id, ur.user_request_status_id AS st, COALESCE(stt.name,'') AS status,
	       COALESCE(l.name,'') AS lender, COALESCE(a.name,'') AS merchant, ur.created_at,
	       COALESCE(ur.user_id,0) AS uid,
	       COALESCE(u.document_number,'') AS document, COALESCE(u.cell_phone,'') AS phone
	  FROM user_requests ur
	  LEFT JOIN user_request_statuses stt ON stt.id = ur.user_request_status_id
	  LEFT JOIN lenders l                ON l.id   = ur.lender_id
	  LEFT JOIN allied_branches ab       ON ab.id  = ur.allied_branch_id
	  LEFT JOIN allieds a                ON a.id   = ab.allied_id
	  LEFT JOIN users u                  ON u.id   = ur.user_id
	 WHERE `

// searchLimit: el tope de solicitudes que trae cada sonda. Se declara como constante y no inline en el
// SQL porque la vista NECESITA saber si se alcanzó — «12 solicitudes» cuando en realidad son 228 cambia el
// diagnóstico de «el cliente reintentó» a «algo está reintentando solo».
const searchLimit = 40

var sqlSearchOrder = fmt.Sprintf(" ORDER BY ur.id DESC LIMIT %d", searchLimit)

// ─── profiling_reviews: el snapshot del listado Y la huella del webhook ─────────────────────────────
//
// ⚠ CORRIGE UNA AFIRMACIÓN ANTERIOR. En el mapa quedó escrito que `listado` no tenía esqueleto en BD
// porque «displayed_lenders es de lenders-v2 y no existe». Falso: no existe como TABLA, pero sí como
// columna JSON de `profiling_reviews` — 588 filas, TODAS con `displayed_lenders` y `hard_rules`. Busqué
// una tabla, no la encontré, y concluí que el dato no existía. El dato estaba.
//
// Y de paso resuelve el reporte más frecuente de #tech-ops («el agregador aprobó pero CT quedó en
// seleccionar entidad», 10 casos en 10 días): `disbursed_lender` es el campo que escribe el webhook del
// lender (`ListLenderController::storeLenderResult` → `ProfilingReviewController::updateAsyncLender`).
// Su ausencia, con la solicitud en estado 3 y un lender elegido, ES la firma de que el webhook no se aplicó.
const sqlProfiling = `
	SELECT recommended_lender, disbursed_lender, datacredito_query,
	       displayed_lenders, hard_rules, ML_predictions, created_at, updated_at
	  FROM profiling_reviews
	 WHERE user_request_id = ? AND deleted_at IS NULL
	 ORDER BY id DESC LIMIT 1`

// Profiling es el snapshot que dejó el motor: qué se mostró y qué respondió el lender.
type Profiling struct {
	Recommended        int64
	Disbursed          int64
	QueriedDatacredito bool
	Shown              []ShownLender
	Rules              string // hard_rules crudo: se guarda entero porque su forma varía y recortarlo perdería el porqué
	// ML: quién ORDENÓ el listado y si hubo fallback. `ProfilingReviewController` guarda en `ML_predictions`
	// un `perfilador` (`PerfiladorNuevo`|`PerfiladorAntiguo`|`PerfiladorDesconocido`), un `fallback_triggered`
	// y, cuando el modelo no respondió, el `error` con el detalle. Es la respuesta de la BD a «¿por qué el
	// listado salió en este orden?», que hasta ahora no se leía en ninguna parte.
	Profiler   string
	MLFallback bool
	MLError    string
	MLScored   int    // entidades que el perfilador alcanzó a puntuar
	MLAnswered bool   // contestó algo, aunque fuera vacío
	MLPrevious string // por qué falló el perfilador PRIMARIO cuando se cayó al de respaldo
	MLRaw      bool   // lo escribió el sistema viejo: guarda la respuesta sin transformar y no dice quién
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type ShownLender struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Probability string   `json:"probability"`
	Score       float64  `json:"weighted_score"`
	Approve     *bool    `json:"is_approved"`
	Amount      *float64 `json:"available_amount"`
}

func GetProfiling(r Runner, ureq int64) (*Profiling, error) {
	fs, err := r.Rows(sqlProfiling, ureq)
	if err != nil {
		return nil, err
	}
	if len(fs) == 0 {
		return nil, nil
	}
	f := fs[0]
	p := &Profiling{
		Recommended:        integer(f["recommended_lender"]),
		Disbursed:          integer(f["disbursed_lender"]),
		QueriedDatacredito: integer(f["datacredito_query"]) == 1,
		Rules:              asText(f["hard_rules"]),
		CreatedAt:          date(f["created_at"], r.Zone()),
		UpdatedAt:          date(f["updated_at"], r.Zone()),
	}
	_ = json.Unmarshal([]byte(asText(f["displayed_lenders"])), &p.Shown)

	// `ML_predictions` tiene TRES formas porque lo escriben DOS SISTEMAS distintos, y hay que probarlas
	// todas: asumir la del caso feliz hacía que justo el caso que interesa se leyera «sin datos».
	// Censo en prod del 2026-07-01 al 2026-08-05 (59.841 filas):
	//
	//  1. ARRAY  (13.902) — `legacy-backend`: una entrada por entidad, con `perfilador` y `prediction`.
	//  2. OBJETO (12.480) — `legacy-backend` cuando NINGÚN perfilador respondió: `error` + `previous_attempt`.
	//  3. SOBRE  (33.459) — `legacy-application` guarda la respuesta CRUDA (`{data,status,message}`), sin
	//     transformar y sin `perfilador`: por eso esas filas no pueden decir quién ordenó.
	//
	// ⚠ `fallback_triggered` NO significa «lo ordenaron las matrices». La estrategia está cableada como
	// `new_then_legacy` (`ProfilerMLController::mlModelV1`): el PRIMARIO es `NewProfilerMLService` y el
	// RESPALDO es el modelo H2O de siempre. `true` quiere decir que el nuevo falló y contestó el viejo —
	// que es lo que dice `perfilador: PerfiladorAntiguo`. Sigue siendo un modelo el que puntúa.
	raw := strings.TrimSpace(asText(f["ML_predictions"]))
	if raw != "" && raw != "null" {
		var arr []struct {
			Profiler string `json:"perfilador"`
			Fallback bool   `json:"fallback_triggered"`
		}
		var obj struct {
			Profiler string `json:"perfilador"`
			Error    string `json:"error"`
			Fallback bool   `json:"fallback_triggered"`
			Status   string `json:"status"`
			Message  string `json:"message"`
			Previous *struct {
				Profiler string `json:"perfilador"`
				Message  string `json:"message"`
				Details  string `json:"details"`
			} `json:"previous_attempt"`
			Data []struct {
				Name string `json:"name"`
			} `json:"data"`
		}
		switch {
		case json.Unmarshal([]byte(raw), &arr) == nil && len(arr) > 0:
			p.Profiler, p.MLFallback = arr[0].Profiler, arr[0].Fallback
			p.MLScored, p.MLAnswered = len(arr), true
		case json.Unmarshal([]byte(raw), &obj) == nil:
			p.Profiler, p.MLFallback, p.MLError = obj.Profiler, obj.Fallback, obj.Error
			p.MLScored = len(obj.Data)
			if obj.Previous != nil {
				p.MLPrevious = strings.TrimSpace(obj.Previous.Details)
				if p.MLPrevious == "" {
					p.MLPrevious = strings.TrimSpace(obj.Previous.Message)
				}
				if p.MLPrevious != "" && obj.Previous.Profiler != "" {
					p.MLPrevious = obj.Previous.Profiler + ": " + p.MLPrevious
				}
			}
			if obj.Status != "" { // el sobre crudo del sistema viejo
				p.MLRaw = true
				p.MLAnswered = obj.Status == "success"
				if !p.MLAnswered && p.MLError == "" {
					p.MLError = obj.Message
				}
			}
		}
	}
	return p, nil
}
