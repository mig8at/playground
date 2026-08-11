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
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// La API de lectura y la de ingesta viven en subdominios DISTINTOS y confundirlas da un 404 que parece
// «no tengo permiso». El front usa `us.i.posthog.com` (ingesta + assets); las queries van a `us.posthog.com`.
const posthogAPIDefault = "https://us.posthog.com"

// normalizePostHogAPI acepta lo que uno tenga a mano —el host de ingesta del deploy del wizard, una URL
// con path, o nada— y devuelve el origen de la API. Sin esto, pegar `VITE_PUBLIC_POSTHOG_HOST` tal cual
// (que es lo natural) falla con 404 en todos los pasos.
func normalizePostHogAPI(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if !strings.Contains(v, "://") {
		v = "https://" + v
	}
	v = strings.TrimRight(v, "/")
	// Recorta cualquier path (`/api/...`, `/decide`) y deja el origen.
	if i := strings.Index(v[strings.Index(v, "://")+3:], "/"); i >= 0 {
		v = v[:strings.Index(v, "://")+3+i]
	}
	// El host de ingesta NO sirve para consultar: `us.i.posthog.com` → `us.posthog.com`.
	v = strings.Replace(v, "://us.i.posthog.com", "://us.posthog.com", 1)
	v = strings.Replace(v, "://eu.i.posthog.com", "://eu.posthog.com", 1)
	return v
}

type phCliente struct {
	base    string
	token   string
	project string
	env     string
	http    *http.Client
}

// pedir hace UNA llamada y devuelve el cuerpo crudo junto al status. Devolver el cuerpo incluso en error
// es deliberado: los 403 de PostHog traen adentro los scopes que al token le faltan, que es justo el dato
// que uno fue a buscar — el mismo truco que ya rinde en el paso 1 de la sonda de Loki.
func (p *phCliente) pedir(metodo, ruta string, cuerpo []byte) (int, []byte, error) {
	var body io.Reader
	if cuerpo != nil {
		body = bytes.NewReader(cuerpo)
	}
	req, err := http.NewRequest(metodo, p.base+ruta, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, raw, err
}

// hogql corre una consulta y devuelve columnas + filas. La respuesta de PostHog trae los valores como
// arrays posicionales, así que las columnas son la única forma de saber qué es cada cosa.
func (p *phCliente) hogql(consulta string) ([]string, [][]any, error) {
	cuerpo, _ := json.Marshal(map[string]any{
		"query": map[string]any{"kind": "HogQLQuery", "query": consulta},
	})
	status, raw, err := p.pedir("POST", "/api/projects/"+p.project+"/query/", cuerpo)
	if err != nil {
		return nil, nil, err
	}
	if status != 200 {
		return nil, nil, fmt.Errorf("HTTP %d · %s", status, recorte(raw, 300))
	}
	var out struct {
		Columns []string `json:"columns"`
		Results [][]any  `json:"results"`
		Error   string   `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, nil, fmt.Errorf("respuesta ilegible: %v · %s", err, recorte(raw, 200))
	}
	if out.Error != "" {
		return nil, nil, fmt.Errorf("%s", out.Error)
	}
	return out.Columns, out.Results, nil
}

// filtroEnv devuelve el `AND` de ambiente, o vacío. Se decide en UN lugar porque un filtro que se aplica
// en unas consultas y no en otras produce números que no cuadran entre pasos.
func (p *phCliente) filtroEnv() string {
	if p.env == "" {
		return ""
	}
	return fmt.Sprintf(" AND properties.environment = '%s'", escapaHogQL(p.env))
}

// ─── el modo ────────────────────────────────────────────────────────────────────────────────────────

// modoPostHog contesta dos preguntas distintas con las mismas credenciales, igual que la sonda de Loki:
// sin `-ureq`, ¿tengo acceso y qué hay adentro?; con `-ureq`, ¿qué vio esta persona?
//
// Las preguntas van SEPARADAS y cada una dice si pasó, porque «no veo eventos» tiene causas que se
// arreglan distinto: token mal emitido (se pide de nuevo), proyecto equivocado (se cambia un número),
// filtro de ambiente que no matchea (se borra una línea) o la solicitud es del flujo clásico (no hay nada
// que arreglar: esta fuente no la cubre).
func modoPostHog(c config, target string, ureq int64, limite int) int {
	step("Configuración · PostHog (%s)", target)
	if c.posthogToken == "" {
		bad("no hay token de PostHog para el target «%s»", target)
		detail("buscado como %s", strings.Join(alias["posthogToken"], " / "))
		detail("")
		detail("⚠ NO es el `phc_...` del snippet del front: ese es de ESCRITURA y no consulta nada.")
		detail("Hace falta una Personal API key (`phx_...`) con scope `query:read`:")
		detail("PostHog → avatar → Personal API keys → New key.")
		detail("Después: POSTHOG_TOKEN=phx_... en trazador/.env.%s (ver .env.prod.example).", target)
		return 2
	}
	base := c.posthogAPI
	if base == "" {
		base = posthogAPIDefault
	}
	p := &phCliente{
		base: base, token: c.posthogToken, project: c.posthogProject, env: c.posthogEnv,
		http: &http.Client{Timeout: 60 * time.Second},
	}
	detail("token    %s", mask(c.posthogToken))
	detail("api      %s", p.base)
	if p.project != "" {
		detail("proyecto %s", p.project)
	}
	if p.env != "" {
		detail("filtro   properties.environment = %q", p.env)
	} else {
		detail("filtro   (ninguno — el paso 3 muestra qué ambientes hay en el proyecto)")
	}

	// ── 1 · ¿el token sirve, y a qué proyectos da acceso?
	//
	// Igual que en Loki: los scopes se averiguan ANTES de tener el id del proyecto. Si el token es
	// estrecho este paso falla y los siguientes andan igual — por eso no corta.
	step("1 · ¿el token es válido y a qué proyecto apunta?")
	if id := p.descubrirProyecto(); id != "" && p.project == "" {
		p.project = id
	}
	if p.project == "" {
		bad("no hay id de proyecto y el token no pudo listarlos")
		detail("Se lee en PostHog → Settings → Project → Project ID (numérico).")
		detail("Después: POSTHOG_PROJECT=<id> en trazador/.env.%s", target)
		return 1
	}

	// ── 2 · ¿puedo consultar?
	step("2 · ¿puedo consultar el proyecto %s?", p.project)
	if _, filas, err := p.hogql("SELECT count() FROM events WHERE timestamp > now() - INTERVAL 7 DAY"); err != nil {
		bad("la query falló: %v", err)
		detail("Un 403 acá casi siempre es scope: la Personal API key necesita `query:read`.")
		return 1
	} else {
		ok("query OK · %s eventos en los últimos 7 días (sin filtrar ambiente)", primerValor(filas))
	}

	// ── 3 · ¿son los eventos de CreditOp, y de qué ambiente?
	step("3 · ¿qué hay adentro? (últimos 7 días)")
	p.censo()

	// ── 4 · el empalme con una solicitud
	if ureq == 0 {
		step("4 · el empalme con una solicitud")
		detail("Pedí una: -posthog -ureq <n>   (el distinct_id es loan_request_<n>)")
		detail("Un ureq del wizard de los últimos días — el flujo clásico no emite estos eventos.")
		return 0
	}
	return p.timeline(ureq, limite)
}

// descubrirProyecto intenta el paso que nadie hace: sacar el id del propio token. Con `project:read`
// alcanza, y ahorra el ida y vuelta de «¿cuál es el número del proyecto?».
func (p *phCliente) descubrirProyecto() string {
	status, raw, err := p.pedir("GET", "/api/organizations/@current/projects/?limit=20", nil)
	if err != nil {
		bad("no se pudo hablar con %s: %v", p.base, err)
		return ""
	}
	if status == 401 {
		bad("HTTP 401 — el token no autentica. ¿Es una Personal API key (`phx_`) y no el `phc_` del front?")
		return ""
	}
	if status != 200 {
		// No es un fracaso del modo: el token puede estar bien y solo no tener `project:read`.
		warn("no pude listar proyectos (HTTP %d) — sigo con el id del .env", status)
		detail("%s", recorte(raw, 240))
		return ""
	}
	var out struct {
		Results []struct {
			ID   json.Number `json:"id"`
			Name string      `json:"name"`
		} `json:"results"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || len(out.Results) == 0 {
		warn("el token autentica pero no devolvió proyectos")
		return ""
	}
	ok("token válido · %d proyecto(s) visibles", len(out.Results))
	for _, pr := range out.Results {
		marca := " "
		if p.project == pr.ID.String() {
			marca = "◂"
		}
		detail("%s %-8s %s", marca, pr.ID.String(), pr.Name)
	}
	if len(out.Results) > 1 && p.project == "" {
		warn("hay más de uno y el .env no dice cuál: tomo el primero (%s)", out.Results[0].ID.String())
	}
	return out.Results[0].ID.String()
}

// censo muestra la distribución por ambiente, app y evento. Es el paso que evita la conclusión falsa más
// cara: «no hay datos» cuando en realidad el filtro de ambiente no matchea, o el proyecto es el de otro
// deploy. Se mira ANTES de creerle a un timeline vacío.
func (p *phCliente) censo() {
	type consulta struct {
		titulo string
		hogql  string
	}
	for _, q := range []consulta{
		{"ambiente", `SELECT properties.environment AS k, count() AS n FROM events
		  WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY k ORDER BY n DESC LIMIT 10`},
		{"app", `SELECT properties.app_name AS k, count() AS n FROM events
		  WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY k ORDER BY n DESC LIMIT 10`},
		{"canal", `SELECT properties.channel AS k, count() AS n FROM events
		  WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY k ORDER BY n DESC LIMIT 10`},
		{"evento", `SELECT event AS k, count() AS n FROM events
		  WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY k ORDER BY n DESC LIMIT 15`},
	} {
		_, filas, err := p.hogql(q.hogql)
		if err != nil {
			warn("censo por %s: %v", q.titulo, err)
			continue
		}
		if len(filas) == 0 {
			warn("censo por %s: sin filas", q.titulo)
			continue
		}
		ok("por %s:", q.titulo)
		for _, f := range filas {
			if len(f) < 2 {
				continue
			}
			detail("%-42s %s", orSi(texto(f[0]), "(vacío)"), texto(f[1]))
		}
	}
	// La pregunta de verdad: ¿los eventos traen la llave que nos deja empalmar?
	_, filas, err := p.hogql(`SELECT
	    countIf(properties.loan_request_id IS NOT NULL) AS con_llave,
	    count() AS total
	  FROM events WHERE timestamp > now() - INTERVAL 7 DAY` + p.filtroEnv())
	if err != nil || len(filas) == 0 || len(filas[0]) < 2 {
		warn("no pude medir cuántos eventos traen loan_request_id")
		return
	}
	con, total := texto(filas[0][0]), texto(filas[0][1])
	ok("con `loan_request_id`: %s de %s eventos", con, total)
	detail("es la llave del empalme con la BD; los que no la traen son de antes del login/anónimos")
}

// timeline es el entregable: qué vio y qué tocó esta persona, en orden. Sale plano y en texto porque el
// primer uso es pegarlo en un ticket al lado de la traza de etapas.
func (p *phCliente) timeline(ureq int64, limite int) int {
	if limite <= 0 {
		limite = 200
	}
	distinct := fmt.Sprintf("loan_request_%d", ureq)
	step("4 · solicitud %d · qué vio el cliente en el navegador", ureq)
	detail("distinct_id = %s   ·   o properties.loan_request_id = '%d'", distinct, ureq)

	// Los DOS caminos en un OR: el `distinct_id` cubre lo identificado y la propiedad cubre los eventos
	// que se emitieron antes de que el wizard supiera a quién atribuirlos.
	consulta := fmt.Sprintf(`SELECT
	    timestamp,
	    event,
	    properties.$current_url AS url,
	    properties.screen_name AS pantalla,
	    properties.known_exception_reason AS motivo,
	    properties.success AS exito,
	    properties.$session_id AS sesion,
	    properties.service_runtime AS runtime
	  FROM events
	  WHERE (distinct_id = '%s' OR toString(properties.loan_request_id) = '%d')%s
	  ORDER BY timestamp ASC
	  LIMIT %d`, escapaHogQL(distinct), ureq, p.filtroEnv(), limite)

	_, filas, err := p.hogql(consulta)
	if err != nil {
		bad("la consulta falló: %v", err)
		return 1
	}
	if len(filas) == 0 {
		warn("sin eventos para la solicitud %d", ureq)
		detail("Y eso NO dice que el cliente no hizo nada. Cuatro causas indistinguibles desde acá:")
		detail("  · la solicitud es del flujo CLÁSICO (legacy-application) — esta fuente solo cubre el wizard")
		detail("  · el ambiente del proyecto no es el de esta solicitud (mirá el censo del paso 3)")
		detail("  · quedó fuera de la retención de PostHog")
		detail("  · el front nunca llegó a emitir (falló antes de cargar)")
		return 0
	}

	ok("%d eventos", len(filas))
	var sesiones []string
	vistas := map[string]bool{}
	for _, f := range filas {
		if len(f) < 8 {
			continue
		}
		ts, ev := texto(f[0]), texto(f[1])
		if len(ts) > 19 {
			ts = ts[:19]
		}
		linea := fmt.Sprintf("  %s  %-38s", ts, ev)
		// Lo que cambia el diagnóstico va en la MISMA línea; el resto es ruido a esta altura.
		if motivo := texto(f[4]); motivo != "" {
			linea += "  " + paint("33", "✘ "+motivo)
		} else if exito := texto(f[5]); exito == "false" {
			linea += "  " + paint("33", "✘ success=false")
		}
		if pant := texto(f[3]); pant != "" {
			linea += dim("  " + pant)
		} else if u := texto(f[2]); u != "" {
			linea += dim("  " + rutaDe(u))
		}
		if texto(f[7]) == "server" {
			linea += dim(" ·srv")
		}
		fmt.Println(linea)
		if s := texto(f[6]); s != "" && !vistas[s] {
			vistas[s] = true
			sesiones = append(sesiones, s)
		}
	}

	// El link a la grabación es lo que convierte «no me dejó avanzar» en algo que se MIRA. Se imprime sin
	// prometer que existe: si el proyecto no tiene session replay prendido, la URL abre vacía.
	if len(sesiones) > 0 {
		step("session replay")
		detail("si el proyecto tiene replay prendido, la sesión se ve acá:")
		for _, s := range sesiones {
			fmt.Printf("  %s/project/%s/replay/%s\n", p.base, p.project, s)
		}
	}
	return 0
}

// ─── ayudas ─────────────────────────────────────────────────────────────────────────────────────────

// escapaHogQL protege el literal. Los valores que llegan acá son numéricos (un ureq) o derivados, pero
// una comilla suelta rompería la consulta y no queremos aprenderlo con el target en prod.
func escapaHogQL(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `'`, `\'`)
}

func recorte(b []byte, n int) string {
	s := strings.Join(strings.Fields(string(b)), " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func primerValor(filas [][]any) string {
	if len(filas) > 0 && len(filas[0]) > 0 {
		return texto(filas[0][0])
	}
	return "?"
}

// rutaDe deja el path y tira el host y el query. El query del wizard lleva códigos de sesión y hashes de
// comercio: en una pantalla de soporte son ruido, y en una captura son una fuga.
func rutaDe(u string) string {
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
