package main

// PostHog: la TERCERA fuente del trazador.
//
// La BD dice QUÉ pasó (el estado ocurrió o no) y Loki dice POR QUÉ falló el BACKEND. Lo que ninguna de
// las dos sabe es qué pasó en el NAVEGADOR: hoy un «abandonado» tapa cuatro historias distintas —el
// cliente se fue, el front reventó y no llegó al backend, nunca vio la pantalla, o la vio y no lo dejó
// avanzar— y las cuatro se leen igual desde la BD. Esa es la pregunta que PostHog contesta.
//
// EL EMPALME NO ES HEURÍSTICA, y es lo que hace que esto valga la pena: el wizard identifica a la persona
// con `distinct_id = "loan_request_" + user_request_id`
// (`getLoanRequestDistinctId`, frontend-monorepo/apps/loan-request-wizard/app/utils/analytics-taxonomy.ts)
// y además manda `loan_request_id` como propiedad canónica de todo evento (`normalizePlainObject`
// unifica seis alias: loan_request_id · loanRequestId · loanRequestID · userRequestId · userRequestID ·
// user_request_id). El trazador ya tiene el `ureq`, así que el join es exacto y gratis.
//
// COBERTURA — la advertencia que va en pantalla y no en un comentario: los eventos los emite SOLO el
// wizard nuevo (`app_name = "loan-request-wizard"`, hardcodeado en la taxonomía). Una solicitud del flujo
// clásico de `legacy-application` no aparece acá, y «sin eventos» NO significa «el cliente no hizo nada».
// Mismo rigor que con un log ausente en Loki: la fuente explica, nunca dictamina.
//
// Este archivo es SOLO LECTURA (HogQL vía POST /query/, que es una consulta, no una escritura) y no
// manda un solo evento: el trazador no se instrumenta a sí mismo — renderiza PII de producción y mandarla
// a un SaaS sería exactamente lo que no queremos.

import (
	"creditop/playground/connectors/events"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// phClient es el cliente de PostHog del conector (`connectors/events`): la API, el token, el proyecto,
// el filtro de ambiente y el transporte son de ahí. Lo que es del trazador son sus modos (el censo, el
// recorrido de una solicitud) y sus consultas.
type phClient struct{ *events.Client }

func newPH(c config, timeout time.Duration) *phClient {
	return &phClient{events.New(c.posthog, timeout)}
}

// ─── el modo ────────────────────────────────────────────────────────────────────────────────────────

// postHogMode contesta dos preguntas distintas con las mismas credenciales, igual que la sonda de Loki:
// sin `-ureq`, ¿tengo acceso y qué hay adentro?; con `-ureq`, ¿qué vio esta persona?
//
// Las preguntas van SEPARADAS y cada una dice si pasó, porque «no veo eventos» tiene causas que se
// arreglan distinto: token mal emitido (se pide de nuevo), proyecto equivocado (se cambia un número),
// filtro de ambiente que no matchea (se borra una línea) o la solicitud es del flujo clásico (no hay nada
// que arreglar: esta fuente no la cubre).
func postHogMode(c config, target string, ureq int64, tel string, limitValue int) int {
	step("Configuración · PostHog (%s)", target)
	if c.posthog.Token == "" {
		bad("no hay token de PostHog para el target «%s»", target)
		detail("buscado como POSTHOG_TOKEN / POSTHOG_PERSONAL_API_KEY en connectors/.env.%s", target)
		detail("")
		detail("⚠ NO es el `phc_...` del snippet del front: ese es de ESCRITURA y no consulta nada.")
		detail("Hace falta una Personal API key (`phx_...`) con scope `query:read`:")
		detail("PostHog → avatar → Personal API keys → New key.")
		detail("Después: POSTHOG_TOKEN=phx_... en connectors/.env.%s (ver connectors/.env.example).", target)
		return 2
	}
	p := newPH(c, 60*time.Second)
	// Qué ambientes no escriben (local, dev) lo sabe el conector: con token igual se puede consultar,
	// pero lo que salga no es de este ambiente, y la sonda lo dice antes de que alguien lo lea como tal.
	if why := c.posthog.Missing(); why != "" && (target == "local" || target == "dev") {
		detail("⚠ %s", why)
	}
	detail("token    %s", mask(c.posthog.Token))
	detail("api      %s", p.Config.API)
	if p.Config.Project != "" {
		detail("proyecto %s", p.Config.Project)
	}
	if p.Config.Env != "" {
		detail("filtro   properties.environment = %q", p.Config.Env)
	} else {
		detail("filtro   (ninguno — el paso 3 muestra qué ambientes hay en el proyecto)")
	}

	// ── 1 · ¿el token sirve, y a qué proyectos da acceso?
	//
	// Igual que en Loki: los scopes se averiguan ANTES de tener el id del proyecto. Si el token es
	// estrecho este paso falla y los siguientes andan igual — por eso no corta.
	step("1 · ¿el token es válido y a qué proyecto apunta?")
	id, authenticates := p.discoverProject()
	if !authenticates {
		// 401 acá NO es un problema de scope: la key no vale nada y los pasos siguientes solo repetirían
		// el mismo error con otra cara. Un scope faltante da 403 y sí deja seguir.
		return 2
	}
	if id != "" && p.Config.Project == "" {
		p.Config.Project = id
	}
	if p.Config.Project == "" {
		bad("no hay id de proyecto y el token no pudo listarlos")
		detail("Se lee en PostHog → Settings → Project → Project ID (numérico).")
		detail("Después: POSTHOG_PROJECT=<id> en connectors/.env.%s", target)
		return 1
	}

	// ── 2 · ¿puedo consultar?
	step("2 · ¿puedo consultar el proyecto %s?", p.Config.Project)
	if _, rows, err := p.HogQL("SELECT count() FROM events WHERE timestamp > now() - INTERVAL 7 DAY"); err != nil {
		bad("la query falló: %v", err)
		detail("Un 403 acá casi siempre es scope: la Personal API key necesita `query:read`.")
		return 1
	} else {
		ok("query OK · %s eventos en los últimos 7 días (sin filtrar ambiente)", firstValue(rows))
	}

	// ── 3 · ¿son los eventos de CreditOp, y de qué ambiente?
	//
	// El censo es el chequeo de la conexión, no parte de la respuesta: cuando se pregunta por UNA
	// solicitud, cuarenta líneas de agregados antes del timeline entierran lo que se vino a ver.
	if ureq == 0 {
		step("3 · ¿qué hay adentro? (últimos 7 días)")
		p.census()
		step("4 · el empalme con una solicitud")
		detail("Pedí una: -posthog -ureq <n> [-tel <celular>]")
		detail("Un ureq del wizard de los últimos días — el flujo clásico no emite estos eventos.")
		return 0
	}
	return p.timeline(ureq, tel, limitValue)
}

// discoverProject intenta el paso que nadie hace: sacar el id del propio token. Con `project:read`
// alcanza, y ahorra el ida y vuelta de «¿cuál es el número del proyecto?».
//
// Devuelve además si el token AUTENTICA, que es una pregunta distinta de si tiene permisos: 401 = la key
// no vale (típicamente pegaron el `phc_` de ingesta), 403 = la key vale y le falta un scope. Confundirlas
// manda a pedir scopes cuando lo que hay que cambiar es la key — el mismo error que en Loki hacía leer
// «legacy auth cannot be upgraded» como una URL equivocada.
func (p *phClient) discoverProject() (string, bool) {
	status, raw, err := p.Request("GET", "/api/organizations/@current/projects/?limit=20", nil)
	if err != nil {
		bad("no se pudo hablar con %s: %v", p.Config.API, err)
		return "", false
	}
	if status == 401 || isInvalidKey(raw) {
		bad("HTTP %d — la key no autentica.", status)
		detail("PostHog dice: %s", events.Clip(raw, 200))
		detail("")
		detail("Si empieza con `phc_` es la de INGESTA del front (`posthog.init`): sirve para ESCRIBIR")
		detail("eventos y no consulta nada. La de lectura empieza con `phx_` y se crea en")
		detail("https://us.posthog.com/settings/user-api-keys  →  New personal API key")
		detail("scopes: `query:read` (obligatorio) + `project:read` (para listar proyectos/ambientes).")
		return "", false
	}
	if status != 200 {
		// No es un fracaso del modo: el token puede estar bien y solo no tener `project:read`.
		warn("no pude listar proyectos (HTTP %d) — sigo con el id del .env", status)
		detail("%s", events.Clip(raw, 240))
		return "", true
	}
	var out struct {
		Results []struct {
			ID   json.Number `json:"id"`
			Name string      `json:"name"`
		} `json:"results"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || len(out.Results) == 0 {
		warn("el token autentica pero no devolvió proyectos")
		return "", true
	}
	ok("token válido · %d proyecto(s) visibles", len(out.Results))
	// El listado completo es el dato que contesta la pregunta que sigue siempre: ¿hay un proyecto por
	// ambiente o uno solo? Se imprime aunque el .env ya traiga el id, y el `◂` marca cuál estamos usando.
	for _, pr := range out.Results {
		mark := " "
		if p.Config.Project == pr.ID.String() {
			mark = "◂"
		}
		detail("%s %-8s %s", mark, pr.ID.String(), pr.Name)
	}
	if len(out.Results) > 1 && p.Config.Project == "" {
		warn("hay más de uno y el .env no dice cuál: tomo el primero (%s)", out.Results[0].ID.String())
	}
	p.listEnvironments()
	return out.Results[0].ID.String(), true
}

// listEnvironments contesta «¿y los otros ambientes?», que es la primera pregunta al conectar y la que no
// se puede responder desde el repo: cada deploy del wizard saca su key de un secreto distinto de AWS
// (prod/loan-request-wizard · dev/loan-request-wizard-stg · dev/loan-request-wizard), así que si son un
// proyecto o tres se decide allá, no en el código.
//
// PostHog moderno mete un nivel más: un proyecto CONTIENE environments, y cada uno tiene su propio token y
// su propio id numérico — el que va en el path de la API y en POSTHOG_PROJECT. La página de Settings lo
// delata al decir «connect SDKs and APIs to this environment».
//
// Best-effort a propósito: el endpoint no existe en todas las versiones y el token puede no tener el scope.
// Un 404 acá no es un problema — el listado de arriba ya sirve.
func (p *phClient) listEnvironments() {
	status, raw, err := p.Request("GET", "/api/environments/?limit=30", nil)
	if err != nil || status != 200 {
		return
	}
	var out struct {
		Results []struct {
			ID   json.Number `json:"id"`
			Name string      `json:"name"`
		} `json:"results"`
	}
	if json.Unmarshal(raw, &out) != nil || len(out.Results) == 0 {
		return
	}
	// Sin adjetivar qué SON: en CreditOp (medido 2026-08-11) estos vienen uno por APP —Landing, Loan
	// Request, Backoffice— y NO uno por ambiente de despliegue: prod, staging y dev del wizard escriben
	// los tres al mismo proyecto y se separan por `properties.environment`. Decir «uno por target» acá
	// mandaría a buscar un proyecto de dev que no existe. Quién es quién lo contesta el paso 3, con datos.
	ok("%d visible(s) — el id es lo que va en POSTHOG_PROJECT (el paso 3 dice qué ambientes hay adentro):", len(out.Results))
	for _, e := range out.Results {
		mark := " "
		if p.Config.Project == e.ID.String() {
			mark = "◂"
		}
		detail("%s %-8s %s", mark, e.ID.String(), e.Name)
	}
}

// isInvalidKey reconoce el veredicto que PostHog manda con 403 cuando la key no es una Personal API key
// (el caso de pegar el `phc_` de ingesta). Sin esto el 403 se lee como «falta un scope» y se va a pedir el
// permiso equivocado: lo que hay que cambiar es la key, no sus scopes.
func isInvalidKey(raw []byte) bool {
	s := strings.ToLower(string(raw))
	return strings.Contains(s, "personal api key") && strings.Contains(s, "invalid")
}

// census muestra la distribución por ambiente, app y evento. Es el paso que evita la conclusión falsa más
// cara: «no hay datos» cuando en realidad el filtro de ambiente no matchea, o el proyecto es el de otro
// deploy. Se mira ANTES de creerle a un timeline vacío.
func (p *phClient) census() {
	type query struct {
		title string
		hogql string
	}
	for _, q := range []query{
		{"ambiente", `SELECT properties.environment AS k, count() AS n FROM events
		  WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY k ORDER BY n DESC LIMIT 10`},
		{"app", `SELECT properties.app_name AS k, count() AS n FROM events
		  WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY k ORDER BY n DESC LIMIT 10`},
		{"canal", `SELECT properties.channel AS k, count() AS n FROM events
		  WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY k ORDER BY n DESC LIMIT 10`},
		{"evento", `SELECT event AS k, count() AS n FROM events
		  WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY k ORDER BY n DESC LIMIT 15`},
	} {
		_, rows, err := p.HogQL(q.hogql)
		if err != nil {
			warn("censo por %s: %v", q.title, err)
			continue
		}
		if len(rows) == 0 {
			warn("censo por %s: sin filas", q.title)
			continue
		}
		ok("por %s:", q.title)
		for _, f := range rows {
			if len(f) < 2 {
				continue
			}
			detail("%-42s %s", orSi(asText(f[0]), "(vacío)"), asText(f[1]))
		}
	}
	// La pregunta de verdad: ¿los eventos traen la llave que nos deja empalmar?
	_, rows, err := p.HogQL(`SELECT
	    countIf(properties.loan_request_id IS NOT NULL) AS con_llave,
	    count() AS total
	  FROM events WHERE timestamp > now() - INTERVAL 7 DAY` + p.Config.EnvFilter())
	if err != nil || len(rows) == 0 || len(rows[0]) < 2 {
		warn("no pude medir cuántos eventos traen loan_request_id")
		return
	}
	with, total := asText(rows[0][0]), asText(rows[0][1])
	ok("con `loan_request_id`: %s de %s eventos", with, total)
	detail("es la llave del empalme con la BD; los que no la traen son de antes del login/anónimos")
}

// telE164 replica `normalizePhoneE164` del wizard, que es quien arma el `distinct_id` del teléfono. Si
// las dos normalizaciones divergen, el empalme falla en silencio y parece que la persona no hizo nada.
func telE164(tel string) string {
	var d strings.Builder
	for _, r := range tel {
		if r >= '0' && r <= '9' {
			d.WriteRune(r)
		}
	}
	digits := d.String()
	if digits == "" {
		return ""
	}
	if strings.HasPrefix(strings.TrimSpace(tel), "+") {
		return "+" + digits
	}
	if len(digits) == 10 {
		return "+57" + digits
	}
	return "+" + digits
}

// timeline es el entregable: qué vio y qué tocó esta persona, en orden. Sale plano y en texto porque el
// primer uso es pegarlo en un ticket al lado de la traza de etapas.
func (p *phClient) timeline(ureq int64, tel string, limitValue int) int {
	if limitValue <= 0 {
		limitValue = 200
	}
	distinct := fmt.Sprintf("loan_request_%d", ureq)
	step("4 · solicitud %d · qué vio el cliente en el navegador", ureq)

	// TRES llaves, no una. Medido contra producción (7 días): `phone_<e164>` identifica 47.792 eventos y
	// `loan_request_<n>` solo 24.006 — o sea que la mitad de lo que hizo el cliente pasa ANTES de que
	// exista la solicitud (la fase de auth), y con la llave del ureq sola no se ve. PostHog NO los une
	// solos: la persona dueña de `loan_request_<n>` no arrastra los eventos del teléfono.
	keySet := []string{"distinct_id = '" + events.Escape(distinct) + "'"}
	keySet = append(keySet, fmt.Sprintf("toString(properties.loan_request_id) = '%d'", ureq))
	detail("distinct_id = %s   ·   o properties.loan_request_id = '%d'", distinct, ureq)
	if e164 := telE164(tel); e164 != "" {
		keySet = append(keySet, "distinct_id = '"+events.Escape("phone_"+e164)+"'")
		detail("+ la fase de auth por teléfono: distinct_id = phone_%s", e164)
	} else {
		detail("(sin -tel: NO se ve la fase de auth, que en prod es la mitad de los eventos)")
	}

	query := fmt.Sprintf(`SELECT
	    timestamp,
	    event,
	    properties.$current_url AS url,
	    properties.screen_name AS pantalla,
	    properties.known_exception_reason AS motivo,
	    properties.success AS exito,
	    properties.$session_id AS sesion,
	    properties.service_runtime AS runtime
	  FROM events
	  WHERE (%s)%s
	  ORDER BY timestamp ASC
	  LIMIT %d`, strings.Join(keySet, " OR "), p.Config.EnvFilterTolerant(), limitValue)

	_, rows, err := p.HogQL(query)
	if err != nil {
		bad("la consulta falló: %v", err)
		return 1
	}
	if len(rows) == 0 {
		warn("sin eventos para la solicitud %d", ureq)
		detail("Y eso NO dice que el cliente no hizo nada. Cuatro causas indistinguibles desde acá:")
		detail("  · la solicitud es del flujo CLÁSICO (legacy-application) — esta fuente solo cubre el wizard")
		detail("  · el ambiente del proyecto no es el de esta solicitud (mirá el censo del paso 3)")
		detail("  · quedó fuera de la retención de PostHog")
		detail("  · el front nunca llegó a emitir (falló antes de cargar)")
		return 0
	}

	ok("%d eventos", len(rows))
	var sessions []string
	vistas := map[string]bool{}
	for _, f := range rows {
		if len(f) < 8 {
			continue
		}
		ts, ev := asText(f[0]), asText(f[1])
		if len(ts) > 19 {
			ts = ts[:19]
		}
		line := fmt.Sprintf("  %s  %-38s", ts, ev)
		// Lo que cambia el diagnóstico va en la MISMA línea; el resto es ruido a esta altura.
		if reason := asText(f[4]); reason != "" {
			line += "  " + paint("33", "✘ "+reason)
		} else if success := asText(f[5]); success == "false" {
			line += "  " + paint("33", "✘ success=false")
		}
		if screenName := asText(f[3]); screenName != "" {
			line += dim("  " + screenName)
		} else if u := asText(f[2]); u != "" {
			line += dim("  " + pathOf(u))
		}
		if asText(f[7]) == "server" {
			line += dim(" ·srv")
		}
		fmt.Println(line)
		if s := asText(f[6]); s != "" && !vistas[s] {
			vistas[s] = true
			sessions = append(sessions, s)
		}
	}

	// El link a la grabación es lo que convierte «no me dejó avanzar» en algo que se MIRA. Se imprime sin
	// prometer que existe: si el proyecto no tiene session replay prendido, la URL abre vacía.
	if len(sessions) > 0 {
		step("session replay")
		detail("si el proyecto tiene replay prendido, la sesión se ve acá:")
		for _, s := range sessions {
			fmt.Printf("  %s/project/%s/replay/%s\n", p.Config.API, p.Config.Project, s)
		}
	}
	return 0
}

// ─── ayudas ─────────────────────────────────────────────────────────────────────────────────────────

func firstValue(rows [][]any) string {
	if len(rows) > 0 && len(rows[0]) > 0 {
		return asText(rows[0][0])
	}
	return "?"
}

// pathOf deja el path y tira el host y el query. El query del wizard lleva códigos de sesión y hashes de
// comercio: en una pantalla de soporte son ruido, y en una captura son una fuga.
func pathOf(u string) string {
	if i := strings.Index(u, "://"); i >= 0 {
		if j := strings.Index(u[i+3:], "/"); j >= 0 {
			u = u[i+3+j:]
		}
	}
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		u = u[:i]
	}
	return u
}

// ── LO QUE VIO EL CLIENTE, dentro de la traza ───────────────────────────────────────────────────
//
// POR QUÉ ACÁ Y NO OTRO MAPA. La pregunta era si convenía un mapa evento→archivo del front, como el
// de logs del backend. Medido, no: los 141 eventos declarados se emiten desde ~6 rutas del wizard,
// así que un mapa contestaría siempre «una de estas seis» — y encima 2 de los 3 lugares donde
// aparece cada nombre son declaraciones (la taxonomía y el tipo TS), no emisores. El backend
// justificaba su mapa porque son miles de archivos; el front no es un pajar.
//
// Lo que PostHog SÍ tiene y no tiene nadie más es QUÉ VIO la persona. Y eso no necesita mapa: la
// llave ya existe (`loan_request_<n>` / `properties.loan_request_id`) y este archivo ya sabe
// consultarla. Era juntar, no construir.

// SeenScreen es un renglón del recorrido del cliente: la pantalla y cuándo la vio por primera vez.
type SeenScreen struct {
	When   string `json:"when"`
	What   string `json:"what"`
	Detail string `json:"detail,omitempty"`
}

// requestScreens devuelve el recorrido VISTO por el cliente, compacto: una entrada por pantalla
// distinta, en orden de primera aparición.
//
// ⚠ SIN `-tel` SE VE LA MITAD. Medido en prod sobre 7 días: `phone_<e164>` identifica 47.792 eventos
// y `loan_request_<n>` sólo 24.006 — o sea que la fase de AUTH ocurre antes de que exista la
// solicitud, y PostHog no une las dos identidades solo. Un recorrido que empieza en «monto» no es
// que el cliente haya entrado por ahí: es que no le pasamos el teléfono.
func requestScreens(c config, ureq int64, tel string) ([]SeenScreen, string) {
	if c.posthog.Token == "" {
		return nil, ""
	}
	p := newPH(c, 30*time.Second)
	if p.Config.Project == "" {
		if id, ok := p.discoverProject(); ok {
			p.Config.Project = id
		} else {
			return nil, ""
		}
	}
	keySet := []string{
		"distinct_id = '" + events.Escape(fmt.Sprintf("loan_request_%d", ureq)) + "'",
		fmt.Sprintf("toString(properties.loan_request_id) = '%d'", ureq),
	}
	notice := "⚠ sin `-tel` no se ve la fase de AUTH, que en prod es la mitad de los eventos"
	if e164 := telE164(tel); e164 != "" {
		keySet = append(keySet, "distinct_id = '"+events.Escape("phone_"+e164)+"'")
		notice = ""
	}
	q := fmt.Sprintf(`SELECT min(timestamp) AS t,
	    coalesce(properties.screen_name, event) AS que,
	    any(properties.known_exception_reason) AS motivo
	  FROM events
	  WHERE (%s)%s AND event NOT LIKE '$%%'
	  GROUP BY que ORDER BY t ASC LIMIT 40`, strings.Join(keySet, " OR "), p.Config.EnvFilterTolerant())
	_, rows, err := p.HogQL(q)
	if err != nil {
		return nil, ""
	}
	var outside []SeenScreen
	for _, f := range rows {
		if len(f) < 2 {
			continue
		}
		v := SeenScreen{When: asTextValue(f[0]), What: asTextValue(f[1])}
		// ⚠ `asTextValue` de un NULL de HogQL devuelve «<nil>», y pegarlo al lado de cada pantalla
		// llenaba la vista de ruido que además parece un error del sistema. El motivo sólo existe
		// en los eventos que fallaron: cuando no está, no se muestra.
		if len(f) > 2 {
			if d := asTextValue(f[2]); d != "" && d != "<nil>" && d != "null" {
				v.Detail = d
			}
		}
		if len(v.When) > 19 {
			v.When = v.When[11:19] // sólo la hora: la fecha ya la da la traza
		}
		outside = append(outside, v)
	}
	return outside, notice
}
