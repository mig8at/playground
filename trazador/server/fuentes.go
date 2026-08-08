// fuentes.go — de dónde salen los datos estructurados, sin que el trazador se entere.
//
// Hay DOS caminos a la misma información y el ensamblado no debe distinguirlos:
//
//	local · dev · staging → MySQL directo (`database/sql`)
//	prod                  → Redash sobre HTTP, porque no hay acceso directo a la BD de producción
//
// Por eso existe `Runner`: una interfaz de UN método que devuelve filas como mapas. Las consultas SQL se
// escriben UNA vez (ver las constantes `sql*`) y cada fuente sabe cómo ejecutarlas. Sin esto habría dos
// juegos de consultas que derivan, que es el problema que este repo ya tuvo con `veredicto()`.
//
// ⚠ REDASH NO TIENE PLACEHOLDERS. `POST /api/query_results` recibe SQL como texto, así que los parámetros
// hay que interpolarlos — y ahí se abre la puerta a inyección. La defensa no es escapar mejor: es que
// `Filas` RECHACE cualquier argumento que no sea de dígitos. Todo lo que el trazador consulta (uReq,
// user_id, teléfono, documento) son dígitos, así que la restricción no cuesta nada y cierra la puerta.
// Un escape casero sí costaría: es la clase de código que parece bien hasta que no.
//
// ⚠ REDASH ES ASÍNCRONO Y QUEDA AUDITADO. Cada consulta son tres saltos (POST job → polling → leer
// resultado) y se registra a nombre del usuario del token. Conviene UNA consulta gorda por etapa, no diez
// chiquitas — y conviene saber que no es anónimo.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Fila es una fila genérica. Se usa un mapa y no structs por fuente porque el parseo a `Solicitud` pasa
// UNA vez, después del Runner: así agregar una fuente no obliga a tocar el parseo.
type Fila map[string]any

// Runner ejecuta un SELECT y devuelve filas. Es todo lo que el trazador necesita de una base.
type Runner interface {
	Filas(consulta string, args ...any) ([]Fila, error)
	Nombre() string
	// Zona dice en qué zona vienen los `datetime` de ESTA fuente. No es un detalle: las dos fuentes
	// devuelven la misma columna en zonas distintas, y equivocarse corre la ventana de búsqueda de logs
	// cinco horas — con lo cual la traza sale sin un solo log y parece que el backend no instrumentó nada.
	//
	// MEDIDO el 2026-08-05, no supuesto:
	//   MySQL directo (dev): @@session.time_zone = UTC · uReq 464618 created_at = 15:56:13
	//                        y su primera línea de log está en 15:56:02 UTC → COINCIDEN, es UTC.
	//   Redash (prod):       uReq 519245 created_at = 08:41:47
	//                        y sus líneas de log están en 13:41:46 UTC → 5 horas de desfase, es LOCAL.
	Zona() *time.Location
	Close()
}

// soloDigitos es la guarda de inyección para el camino Redash. También se aplica al camino MySQL, donde no
// hace falta, a propósito: si la regla vale solo en una fuente, alguien la va a violar en la otra y el bug
// aparece cuando se cambia de target.
var soloDigitos = regexp.MustCompile(`^\d{1,20}$`)

func validarArgs(args []any) error {
	for i, a := range args {
		if !soloDigitos.MatchString(fmt.Sprint(a)) {
			return fmt.Errorf("argumento %d (%q) no es de dígitos: el trazador solo consulta por id, "+
				"teléfono o documento, y esa restricción es lo que hace segura la interpolación en Redash", i+1, a)
		}
	}
	return nil
}

// ─── MySQL directo (local · dev · staging) ──────────────────────────────────────────────────────────

type fuenteMySQL struct {
	db     *sql.DB
	nombre string
}

func (f *fuenteMySQL) Nombre() string { return f.nombre }

// Zona: el driver con `parseTime=true` y sin `loc` interpreta como UTC, y la sesión de MySQL está en UTC
// (verificado: @@session.time_zone = UTC), así que el instante es correcto tal cual.
func (f *fuenteMySQL) Zona() *time.Location { return time.UTC }
func (f *fuenteMySQL) Close()               { _ = f.db.Close() }

func (f *fuenteMySQL) Filas(consulta string, args ...any) ([]Fila, error) {
	if err := validarArgs(args); err != nil {
		return nil, err
	}
	rows, err := f.db.Query(consulta, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []Fila
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if rows.Scan(ptrs...) != nil {
			continue
		}
		fila := Fila{}
		for i, c := range cols {
			// El driver devuelve []byte para texto y fechas: se pasa a string para que las dos fuentes
			// entreguen lo mismo y el parseo no tenga que preguntar de dónde vino.
			if b, ok := vals[i].([]byte); ok {
				fila[c] = string(b)
			} else {
				fila[c] = vals[i]
			}
		}
		out = append(out, fila)
	}
	return out, rows.Err()
}

// ─── Redash (prod) ──────────────────────────────────────────────────────────────────────────────────

type fuenteRedash struct {
	zona   *time.Location
	base   string
	token  string
	dsID   int
	http   *http.Client
	nombre string
}

func (f *fuenteRedash) Nombre() string { return f.nombre }

// Zona: Redash serializa los datetime en la zona de SU servidor, que devuelve hora de Bogotá. Se fija
// explícitamente en vez de usar `time.Local` para que la traza no cambie de significado según dónde corra
// el binario — una herramienta de soporte que da horas distintas en dos máquinas no sirve para auditar.
func (f *fuenteRedash) Zona() *time.Location { return f.zona }
func (f *fuenteRedash) Close()               {}

// Filas corre el ciclo completo de Redash. No hay atajo: la API responde con un job y hay que esperarlo.
func (f *fuenteRedash) Filas(consulta string, args ...any) ([]Fila, error) {
	if err := validarArgs(args); err != nil {
		return nil, err
	}
	// Interpolación posicional. Segura porque `validarArgs` ya garantizó que todo es de dígitos.
	sqlTexto := consulta
	for _, a := range args {
		sqlTexto = strings.Replace(sqlTexto, "?", fmt.Sprint(a), 1)
	}

	cuerpo, _ := json.Marshal(map[string]any{
		"query": sqlTexto, "data_source_id": f.dsID, "max_age": 0,
	})
	var arranque struct {
		Job struct {
			ID     string `json:"id"`
			Status int    `json:"status"`
			Error  string `json:"error"`
			RID    int    `json:"query_result_id"`
		} `json:"job"`
		QueryResult *struct {
			Data struct {
				Columns []struct{ Name string } `json:"columns"`
				Rows    []Fila                  `json:"rows"`
			} `json:"data"`
		} `json:"query_result"`
	}
	if err := f.pedir("POST", "/api/query_results", cuerpo, &arranque); err != nil {
		return nil, err
	}
	// Redash puede devolver el resultado ya cacheado; en ese caso no hay job que esperar.
	if arranque.QueryResult != nil {
		return arranque.QueryResult.Data.Rows, nil
	}
	if arranque.Job.ID == "" {
		return nil, fmt.Errorf("Redash no devolvió job ni resultado")
	}

	// Polling. Estados de Redash: 1 pendiente · 2 corriendo · 3 ok · 4 falló · 5 cancelado.
	rid := 0
	for intento := 0; intento < 60; intento++ {
		var est struct {
			Job struct {
				Status int    `json:"status"`
				Error  string `json:"error"`
				RID    int    `json:"query_result_id"`
			} `json:"job"`
		}
		if err := f.pedir("GET", "/api/jobs/"+arranque.Job.ID, nil, &est); err != nil {
			return nil, err
		}
		switch est.Job.Status {
		case 3:
			rid = est.Job.RID
		case 4, 5:
			return nil, fmt.Errorf("la consulta falló en Redash: %s", est.Job.Error)
		}
		if rid > 0 {
			break
		}
		time.Sleep(time.Second)
	}
	if rid == 0 {
		return nil, fmt.Errorf("timeout esperando a Redash (60s): la cola está lenta o la consulta es muy grande")
	}

	var res struct {
		QueryResult struct {
			Data struct {
				Rows []Fila `json:"rows"`
			} `json:"data"`
		} `json:"query_result"`
	}
	if err := f.pedir("GET", fmt.Sprintf("/api/query_results/%d", rid), nil, &res); err != nil {
		return nil, err
	}
	return res.QueryResult.Data.Rows, nil
}

func (f *fuenteRedash) pedir(metodo, ruta string, cuerpo []byte, dest any) error {
	var body *bytes.Reader
	if cuerpo != nil {
		body = bytes.NewReader(cuerpo)
	} else {
		body = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(metodo, f.base+ruta, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Key "+f.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.http.Do(req)
	if err != nil {
		// El ELB de Redash es INTERNO: sin VPN esto es un timeout, no un 401. Vale decirlo acá porque el
		// síntoma no se parece a la causa.
		return fmt.Errorf("%s %s: %w — ¿la VPN está puesta? el ELB de Redash es interno", metodo, ruta, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		var b bytes.Buffer
		_, _ = b.ReadFrom(resp.Body)
		return fmt.Errorf("%s %s → %d: %s", metodo, ruta, resp.StatusCode, trim(b.String(), 200))
	}
	return json.NewDecoder(resp.Body).Decode(dest)
}

// ─── elegir la fuente ───────────────────────────────────────────────────────────────────────────────

// abrirFuente decide por dónde leer. La preferencia es MySQL directo (una consulta, sin cola, sin quedar
// auditado); Redash es el camino para producción, donde no hay otra puerta.
func abrirFuente(c config) (Runner, error) {
	if c.dbHost != "" {
		db, err := abrirBD(c)
		if err != nil {
			return nil, err
		}
		return &fuenteMySQL{db: db, nombre: "mysql " + c.dbHost}, nil
	}
	if c.redashURL != "" && c.redashToken != "" {
		ds := c.redashDS
		if ds == 0 {
			ds = 1 // la fuente "Live" (rds_mysql) de producción
		}
		// Zona explícita y pisable por si el servidor de Redash cambia de configuración.
		zona, err := time.LoadLocation(orSi(c.redashTZ, "America/Bogota"))
		if err != nil {
			return nil, fmt.Errorf("REDASH_TZ %q no es una zona válida: %w", c.redashTZ, err)
		}
		return &fuenteRedash{
			zona: zona,
			base: strings.TrimRight(c.redashURL, "/"), token: c.redashToken, dsID: ds,
			http: &http.Client{Timeout: 90 * time.Second}, nombre: "redash ds=" + fmt.Sprint(ds),
		}, nil
	}
	return nil, fmt.Errorf("sin fuente de datos: falta DB_HOST (MySQL directo) o REDASH_URL + REDASH_TOKEN")
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
const sqlSolicitud = `
	SELECT ur.user_id, ur.user_request_status_id AS st, COALESCE(stt.name,'') AS estado,
	       COALESCE(l.name,'') AS lender, COALESCE(l.id,0) AS lender_id, COALESCE(l.response_type,0) AS rt,
	       COALESCE(a.name,'') AS comercio, COALESCE(a.id,0) AS allied_id, COALESCE(ab.name,'') AS sucursal,
	       COALESCE(u.document_number,'') AS documento, COALESCE(ur.amount,0) AS monto, ur.created_at,
	       COALESCE(livt.identity_validation_type_id, l.validation_type, 0) AS validacion
	  FROM user_requests ur
	  LEFT JOIN user_request_statuses stt ON stt.id = ur.user_request_status_id
	  LEFT JOIN lenders l                ON l.id   = ur.lender_id
	  LEFT JOIN lender_identity_validation_types livt ON livt.lender_id = l.id
	  LEFT JOIN allied_branches ab       ON ab.id  = ur.allied_branch_id
	  LEFT JOIN allieds a                ON a.id   = ab.allied_id
	  LEFT JOIN users u                  ON u.id   = ur.user_id
	 WHERE ur.id = ?`

const sqlHistorial = `
	SELECT r.user_request_status_id AS st, COALESCE(stt.name,'') AS estado, r.created_at
	  FROM user_request_records r
	  LEFT JOIN user_request_statuses stt ON stt.id = r.user_request_status_id
	 WHERE r.user_request_id = ? ORDER BY r.created_at, r.id`

// El buró se indexa por `user_id`, NO por solicitud: una consulta puede ser de otro intento del mismo
// cliente. Se acota desde la creación de esta solicitud, y aun así queda dicho en el árbol.
const sqlBuro = `
	SELECT COALESCE(rc.name, CONCAT('central ', d.risk_central_id)) AS central, d.score, d.created_at
	  FROM risk_central_user_data d
	  LEFT JOIN risk_centrals rc ON rc.id = d.risk_central_id
	 WHERE d.user_id = ? AND d.deleted_at IS NULL ORDER BY d.created_at`

const sqlCentrales = `SELECT id, COALESCE(name,'') AS name FROM risk_centrals ORDER BY id`

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
const sqlCategorias = `
	SELECT ucl.id, ucl.lender_id, COALESCE(l.name,'') AS lender,
	       ucl.lender_users_category_id AS cat, COALESCE(c.name,'') AS cat_nombre,
	       ucl.current_available_amount AS cupo, ucl.category_rules_acceptance AS reglas, ucl.created_at
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

// Categoria es la evaluación de UNA entidad para este cliente: qué categoría le tocó (0 = ninguna) y,
// tier por tier, qué criterio falló.
type Categoria struct {
	LenderID  int64
	Lender    string
	CatID     int64
	CatNombre string
	Cupo      float64
	At        time.Time
	// Fallas: tier → criterios en `false`. Un tier SIN entrada es un tier que pasó todo.
	Fallas map[string][]string
	// Tiers evaluados en total (los que pasaron y los que no): sin esto, «3 tiers fallaron» no dice si
	// eran 3 de 3 o 3 de 12.
	Tiers int
	// Corta dice DÓNDE se detuvo la evaluación de ese tier, que es lo que las claves ausentes significan:
	// el motor evalúa 5 criterios básicos, y si alguno falla RETORNA sin tocar el buró.
	// `básicos` = murió antes del buró · `sin buró` = no hay fila de datacrédito · `buró` = llegó.
	Corta map[string]string
	// Especial: bandera de nivel raíz, fuera del universo de tiers. Hoy dos: `blacklisted` (documento en
	// lista negra de esa entidad) y `validacion_venezolanos` (CE + lender 84: SALTA todas las reglas).
	Especial string
	// Ventana dice qué se puede AFIRMAR sobre a qué corrida pertenece esta fila, y tiene tres valores
	// porque dos no alcanzan: `misma` (cae dentro de ±120 s de la corrida del perfilamiento) · `otra`
	// (cae fuera: puede ser de otro intento del mismo cliente) · `sin-referencia` (no hay fila de
	// `profiling_reviews` contra la cual comparar). Colapsar los dos últimos hacía que una solicitud sin
	// perfilamiento advirtiera «puede ser de otro intento» sin tener ninguna base para decirlo — que es
	// exactamente el error que este trazador comete cuando trata una ausencia como una negación.
	Ventana string
}

// GetCategorias trae la evaluación de categoría de todas las entidades para este cliente en la ventana de
// la solicitud. Ante cualquier error devuelve vacío: no saber no es saber que no.
func GetCategorias(r Runner, userID int64, desde, hasta time.Time, corrida time.Time) []Categoria {
	if userID == 0 || desde.IsZero() {
		return nil
	}
	// El reloj de pared TAL COMO LO DEVUELVE ESTA FUENTE: `fecha()` parseó con `r.Zona()`, así que
	// volver a esa zona reconstruye exactamente el texto que hay en la columna.
	reloj := func(t time.Time) string { return t.In(r.Zona()).Format("20060102150405") }
	fs, err := r.Filas(sqlCategorias, userID, reloj(desde), reloj(hasta))
	if err != nil {
		return nil
	}
	out := make([]Categoria, 0, len(fs))
	for _, f := range fs {
		c := Categoria{
			LenderID: entero(f["lender_id"]), Lender: texto(f["lender"]),
			CatID: entero(f["cat"]), CatNombre: texto(f["cat_nombre"]),
			Cupo: decimal(f["cupo"]), At: fecha(f["created_at"], r.Zona()),
			Fallas: map[string][]string{}, Corta: map[string]string{},
		}
		switch {
		case corrida.IsZero() || c.At.IsZero():
			c.Ventana = "sin-referencia"
		default:
			d := c.At.Sub(corrida)
			if d > -120*time.Second && d < 120*time.Second {
				c.Ventana = "misma"
			} else {
				c.Ventana = "otra"
			}
		}
		var crudo map[string]json.RawMessage
		if json.Unmarshal([]byte(texto(f["reglas"])), &crudo) == nil {
			for k, v := range crudo {
				// Las banderas de raíz son booleanos sueltos, no mapas de criterios.
				var flag bool
				if json.Unmarshal(v, &flag) == nil {
					if flag {
						c.Especial = k
					}
					continue
				}
				var checks map[string]bool
				if json.Unmarshal(v, &checks) != nil {
					continue
				}
				c.Tiers++
				var malos []string
				for nombre, ok := range checks {
					if !ok {
						malos = append(malos, nombre)
					}
				}
				sort.Strings(malos)
				if len(malos) > 0 {
					c.Fallas[k] = malos
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
				_, tieneDC := checks["datacredito"]
				switch {
				case tieneDC:
					c.Corta[k] = "sin buró"
				case len(checks) <= 5:
					c.Corta[k] = "básicos"
				default:
					c.Corta[k] = "buró"
				}
			}
		}
		out = append(out, c)
	}
	return out
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

// GetCorbetaAllieds devuelve los allied_id del canal Corbeta. Ante cualquier error devuelve vacío: no saber
// es distinto de saber que no, y un canal mal supuesto esconde etapas que sí ocurrieron.
func GetCorbetaAllieds(r Runner) map[int64]bool {
	out := map[int64]bool{}
	fs, err := r.Filas(sqlCorbeta)
	if err != nil || len(fs) == 0 {
		return out
	}
	var ids []int64
	if err := json.Unmarshal([]byte(texto(fs[0]["value"])), &ids); err != nil {
		return out
	}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

const sqlEsEcommerce = `SELECT COUNT(*) AS n FROM ecommerce_requests WHERE user_request_id = ?`

// GetSolicitud arma el esqueleto usando cualquiera de las dos fuentes.
func GetSolicitud(r Runner, ureq int64) (*Solicitud, error) {
	fs, err := r.Filas(sqlSolicitud, ureq)
	if err != nil {
		return nil, err
	}
	if len(fs) == 0 {
		return nil, fmt.Errorf("la solicitud %d no existe en %s", ureq, r.Nombre())
	}
	f := fs[0]
	s := &Solicitud{
		ID: ureq, UserID: entero(f["user_id"]), Estado: int(entero(f["st"])),
		EstadoN: texto(f["estado"]), Lender: texto(f["lender"]),
		LenderID: entero(f["lender_id"]), LenderRT: int(entero(f["rt"])),
		Comercio: texto(f["comercio"]), AlliedID: entero(f["allied_id"]), Sucursal: texto(f["sucursal"]),
		Documento: texto(f["documento"]), Monto: decimal(f["monto"]), Creada: fecha(f["created_at"], r.Zona()),
		Validacion: int(entero(f["validacion"])),
	}

	if hs, err := r.Filas(sqlHistorial, ureq); err == nil {
		prev := -1
		for _, h := range hs {
			st := int(entero(h["st"]))
			if st == prev {
				continue // se colapsan repetidos: `user_request_records` escribe una fila por cada toque
			}
			prev = st
			s.Transiciones = append(s.Transiciones, Transicion{Estado: st, Nombre: texto(h["estado"]), At: fecha(h["created_at"], r.Zona())})
		}
	}
	if bs, err := r.Filas(sqlBuro, s.UserID); err == nil {
		for _, b := range bs {
			at := fecha(b["created_at"], r.Zona())
			if at.Before(s.Creada.Add(-5 * time.Minute)) {
				continue // de otro intento del mismo cliente
			}
			fb := FilaBuro{Central: texto(b["central"]), At: at}
			if b["score"] != nil {
				v := decimal(b["score"])
				fb.Score = &v
			}
			s.Buro = append(s.Buro, fb)
		}
	}

	s.Perfilamiento = GetPerfilamiento(r, ureq)

	s.Origen, s.OrigenDerivado = "asesor", false
	if es, err := r.Filas(sqlEsEcommerce, ureq); err == nil && len(es) > 0 && entero(es[0]["n"]) > 0 {
		s.Origen, s.OrigenDerivado = "ecommerce", true
	}
	return s, nil
}

// GetCentrales trae el catálogo completo: es lo que permite mostrar las NO consultadas.
func GetCentrales(r Runner) map[int64]string {
	out := map[int64]string{}
	fs, err := r.Filas(sqlCentrales)
	if err != nil {
		return out
	}
	for _, f := range fs {
		out[entero(f["id"])] = texto(f["name"])
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
	únicos := map[int64]bool{}
	var lista []string
	for _, id := range ids {
		if id > 0 && !únicos[id] {
			únicos[id] = true
			lista = append(lista, fmt.Sprint(id))
		}
	}
	// Interpolación directa: son enteros ya validados al parsearlos, y `IN (?)` con N placeholders no
	// existe en Redash. Se construye con dígitos, nunca con texto del usuario.
	q := fmt.Sprintf(`SELECT id, COALESCE(name,'') AS name, COALESCE(response_type,0) AS rt
	                    FROM lenders WHERE id IN (%s)`, strings.Join(lista, ","))
	fs, err := r.Filas(q)
	if err != nil {
		return out
	}
	for _, f := range fs {
		id := entero(f["id"])
		out[id] = LenderInfo{ID: id, Nombre: texto(f["name"]), RT: int(entero(f["rt"]))}
	}
	return out
}

// ─── coerción ───────────────────────────────────────────────────────────────────────────────────────
// Las dos fuentes devuelven los mismos datos con tipos distintos: el driver de MySQL da []byte/int64 y
// Redash (JSON) da string/float64. Se normaliza acá, una vez, en vez de en cada lector.

func texto(v any) string {
	if v == nil {
		return ""
	}
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return fmt.Sprint(v)
}

func entero(v any) int64 {
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
	fmt.Sscanf(texto(v), "%d", &n)
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
	fmt.Sscanf(texto(v), "%f", &f)
	return f
}

// fecha acepta los formatos de las dos fuentes. Redash devuelve ISO-8601 y el driver de MySQL un
// time.Time. Las dos vienen en UTC: la conversión a local es SOLO de presentación (ver `hhmm`).
func fecha(v any, zona *time.Location) time.Time {
	if t, ok := v.(time.Time); ok {
		return t
	}
	if zona == nil {
		zona = time.UTC
	}
	s := texto(v)
	// RFC3339 trae su propio offset, así que se respeta. Los formatos SIN zona se interpretan en la zona
	// que declaró la fuente: es ahí donde se corregía el desfase de 5 horas.
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC()
	}
	for _, f := range []string{"2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
		if t, err := time.ParseInLocation(f, s, zona); err == nil {
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
const sqlBuscar = `
	SELECT ur.id, ur.user_request_status_id AS st, COALESCE(stt.name,'') AS estado,
	       COALESCE(l.name,'') AS lender, COALESCE(a.name,'') AS comercio, ur.created_at,
	       COALESCE(ur.user_id,0) AS uid,
	       COALESCE(u.document_number,'') AS documento, COALESCE(u.cell_phone,'') AS telefono
	  FROM user_requests ur
	  LEFT JOIN user_request_statuses stt ON stt.id = ur.user_request_status_id
	  LEFT JOIN lenders l                ON l.id   = ur.lender_id
	  LEFT JOIN allied_branches ab       ON ab.id  = ur.allied_branch_id
	  LEFT JOIN allieds a                ON a.id   = ab.allied_id
	  LEFT JOIN users u                  ON u.id   = ur.user_id
	 WHERE `

// limiteBusqueda: el tope de solicitudes que trae cada sonda. Se declara como constante y no inline en el
// SQL porque la vista NECESITA saber si se alcanzó — «12 solicitudes» cuando en realidad son 228 cambia el
// diagnóstico de «el cliente reintentó» a «algo está reintentando solo».
const limiteBusqueda = 40

var sqlBuscarOrden = fmt.Sprintf(" ORDER BY ur.id DESC LIMIT %d", limiteBusqueda)

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

// Perfilamiento es el snapshot que dejó el motor: qué se mostró y qué respondió el lender.
type Perfilamiento struct {
	Recomendado         int64
	Desembolsado        int64
	ConsultoDatacredito bool
	Mostrados           []LenderMostrado
	Reglas              string // hard_rules crudo: se guarda entero porque su forma varía y recortarlo perdería el porqué
	// ML: quién ORDENÓ el listado y si hubo fallback. `ProfilingReviewController` guarda en `ML_predictions`
	// un `perfilador` (`PerfiladorNuevo`|`PerfiladorAntiguo`|`PerfiladorDesconocido`), un `fallback_triggered`
	// y, cuando el modelo no respondió, el `error` con el detalle. Es la respuesta de la BD a «¿por qué el
	// listado salió en este orden?», que hasta ahora no se leía en ninguna parte.
	Perfilador  string
	MLFallback  bool
	MLError     string
	MLPuntuadas int    // entidades que el perfilador alcanzó a puntuar
	MLRespondio bool   // contestó algo, aunque fuera vacío
	MLPrevio    string // por qué falló el perfilador PRIMARIO cuando se cayó al de respaldo
	MLCrudo     bool   // lo escribió el sistema viejo: guarda la respuesta sin transformar y no dice quién
	Creado      time.Time
	Actualizado time.Time
}

type LenderMostrado struct {
	ID           int64    `json:"id"`
	Nombre       string   `json:"name"`
	Probabilidad string   `json:"probability"`
	Score        float64  `json:"weighted_score"`
	Aprobado     *bool    `json:"is_approved"`
	Monto        *float64 `json:"available_amount"`
}

func GetPerfilamiento(r Runner, ureq int64) *Perfilamiento {
	fs, err := r.Filas(sqlProfiling, ureq)
	if err != nil || len(fs) == 0 {
		return nil
	}
	f := fs[0]
	p := &Perfilamiento{
		Recomendado:         entero(f["recommended_lender"]),
		Desembolsado:        entero(f["disbursed_lender"]),
		ConsultoDatacredito: entero(f["datacredito_query"]) == 1,
		Reglas:              texto(f["hard_rules"]),
		Creado:              fecha(f["created_at"], r.Zona()),
		Actualizado:         fecha(f["updated_at"], r.Zona()),
	}
	_ = json.Unmarshal([]byte(texto(f["displayed_lenders"])), &p.Mostrados)

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
	crudo := strings.TrimSpace(texto(f["ML_predictions"]))
	if crudo != "" && crudo != "null" {
		var arr []struct {
			Perfilador string `json:"perfilador"`
			Fallback   bool   `json:"fallback_triggered"`
		}
		var obj struct {
			Perfilador string `json:"perfilador"`
			Error      string `json:"error"`
			Fallback   bool   `json:"fallback_triggered"`
			Estado     string `json:"status"`
			Mensaje    string `json:"message"`
			Previo     *struct {
				Perfilador string `json:"perfilador"`
				Mensaje    string `json:"message"`
				Detalles   string `json:"details"`
			} `json:"previous_attempt"`
			Data []struct {
				Nombre string `json:"name"`
			} `json:"data"`
		}
		switch {
		case json.Unmarshal([]byte(crudo), &arr) == nil && len(arr) > 0:
			p.Perfilador, p.MLFallback = arr[0].Perfilador, arr[0].Fallback
			p.MLPuntuadas, p.MLRespondio = len(arr), true
		case json.Unmarshal([]byte(crudo), &obj) == nil:
			p.Perfilador, p.MLFallback, p.MLError = obj.Perfilador, obj.Fallback, obj.Error
			p.MLPuntuadas = len(obj.Data)
			if obj.Previo != nil {
				p.MLPrevio = strings.TrimSpace(obj.Previo.Detalles)
				if p.MLPrevio == "" {
					p.MLPrevio = strings.TrimSpace(obj.Previo.Mensaje)
				}
				if p.MLPrevio != "" && obj.Previo.Perfilador != "" {
					p.MLPrevio = obj.Previo.Perfilador + ": " + p.MLPrevio
				}
			}
			if obj.Estado != "" { // el sobre crudo del sistema viejo
				p.MLCrudo = true
				p.MLRespondio = obj.Estado == "success"
				if !p.MLRespondio && p.MLError == "" {
					p.MLError = obj.Mensaje
				}
			}
		}
	}
	return p
}
