// Command sonda contesta, sin escribir nada en ningún lado, si desde acá se pueden LEER los logs que
// CreditOp empuja a Loki — y de paso los muestra.
//
// POR QUÉ NO ALCANZA UN 200. Un token de Grafana Cloud puede autenticar y aun así no servir: si la
// access policy quedó en el realm equivocado, `/labels` responde 200 con la lista vacía y `query_range`
// devuelve cero streams. Los dos casos se leen igual desde afuera ("no hay logs") y son problemas
// distintos: uno se pide, el otro se arregla mirando otra ventana. Por eso la sonda separa las preguntas
// y dice en cuál se cayó:
//
//  1. ¿el token es válido y qué permisos trae?    grafana.com/api  (no necesita URL ni ID de instancia)
//  2. ¿autentica contra Loki?                     GET /loki/api/v1/labels
//  3. ¿aparecen las etiquetas de CreditOp?        GET /loki/api/v1/label/<x>/values
//  4. ¿puedo leer líneas de verdad?               GET /loki/api/v1/query_range
//
// EL PASO 1 ES EL QUE MÁS RINDE Y EL QUE NADIE HACE. Los scopes del token se pueden averiguar sin tener
// la URL de Loki ni el ID de instancia: se pide un endpoint de grafana.com que exige
// `accesspolicies:read` y, si el token no lo tiene, el 401 llega con la lista de lo que SÍ tiene
// (`received [logs:read]`). Un error que trae adentro el dato que uno estaba buscando. Eso separa de
// entrada "el token está mal emitido" de "el token está bien y me falta un dato de conexión".
//
// TRES TRAMPAS QUE ESTA SONDA YA PAGÓ (2026-08-04, validando el token de Daniel):
//
//   - Un Bearer PELADO nunca funciona contra Grafana Cloud Loki. Devuelve
//     `legacy auth cannot be upgraded because the host is not found`, que suena a "URL equivocada" y no
//     lo es: el mensaje es idéntico en los 25 hosts reales de Loki. Es el gateway diciendo que necesita
//     el par `<ID de instancia>:<token>`. Con basic-auth el error cambia a `invalid authentication
//     credentials` — o sea que ahí SÍ parseó el par. Esa diferencia de mensajes es el diagnóstico.
//   - `*.grafana.net` tiene un CNAME COMODÍN. Un hostname inventado resuelve igual que uno real y
//     después devuelve 530/error 1016, que se lee como "Grafana está caída". Los hosts reales tienen
//     registro A propio; los inventados heredan el comodín. Por eso acá el DNS se chequea ANTES de
//     pegarle.
//   - La región del token NO es el hostname. `prod-us-east-0` es una región legacy y su Loki es
//     `logs-prod3.grafana.net`, no `logs-prod-us-east-0` ni `logs-prod-006`.
//
// QUÉ ETIQUETAS BUSCA. Las que de verdad escribe el backend (`config/grafana.php` +
// `app/Logging/LokiHandler.php` en legacy-backend): `app` (default `creditop-api`), `environment`
// (`APP_ENV`), `level`, `channel`, y opcionalmente `lender` / `provider` / `trace_id` / `span_id`. Si no
// encuentra ninguna con pinta de CreditOp, cae a la primera etiqueta de baja cardinalidad para al menos
// probar que la lectura funciona.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español (como el resto del
// playground).
package main

import (
	"creditop/playground/connectors/events"
	"creditop/playground/connectors/logs"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ─── configuración ──────────────────────────────────────────────────────────────────────────────────

// config es lo mínimo para hablarle a Loki. `base` y `user` pueden venir vacíos: `base` se deduce de la
// región del token; `user` no se puede deducir de ningún lado y es justo el que suele faltar.
type config struct {
	// loki es a qué Loki preguntarle en este ambiente, tal como lo resuelve `connectors/logs`: la URL, las
	// credenciales, el filtro de `environment` y el `service_name` del monolito. Ya no los lee el trazador
	// de su `.env`: dev, qa y staging comparten el stack `creditopdev`, y lo que separa a dev de qa es el
	// `service_name` (que NO filtra: `splitByBackend` dice cuántas líneas sirvió cada backend). El
	// porqué de cada etiqueta vive en el conector, escrito una vez.
	loki   logs.Config
	source string // de dónde salió cada cosa, para poder decirlo en pantalla

	// El ambiente. Es lo que le pide al conector de SQL la base de ESTE ambiente (ver `openSource`): qué
	// base es, sus credenciales y si va por MySQL directo o por Redash ya no los sabe el trazador.
	target string

	// posthog es a qué PostHog preguntarle en este ambiente, tal como lo resuelve `connectors/events`: la
	// API de lectura, el token (una Personal API key `phx_`, no el `phc_` del front), el proyecto y el
	// valor de `properties.environment`. Qué ambientes no escriben (local, dev) también lo sabe el conector.
	posthog events.Config
}

// alias mapea cada campo a los nombres de variable que aceptamos. Los `GRAFANA_LOKI_*` son los que usa
// legacy-backend en su propio .env: aceptarlos permite pegar las vars del deploy tal como están.

// loadConfig arma la configuración de Loki y PostHog de un ambiente desde los conectores
// (`connectors/.env.<target>`; el proceso gana).
func loadConfig(target string) (config, []string) {
	// Todo lo que el trazador lee de afuera —la base, Loki, PostHog— lo resuelven los conectores con
	// `connectors/.env.<target>`: el trazador ya no guarda credenciales propias (desde el 2026-09-24).
	c := config{target: target}
	var origins, checked []string
	note := func(what, file string) {
		from := "entorno"
		if file != "" {
			from = "connectors/" + filepath.Base(file)
			if !contains(checked, from) {
				checked = append(checked, from)
			}
		}
		origins = append(origins, what+" <- "+from)
	}
	var lokiFile, posthogFile string
	c.loki, lokiFile, _ = logs.LoadConfig(target)
	if c.loki.URL != "" {
		note("loki", lokiFile)
	}
	c.posthog, posthogFile, _ = events.LoadConfig(target)
	if c.posthog.Token != "" {
		note("posthog", posthogFile)
	}
	c.source = strings.Join(origins, ", ")
	return c, checked
}

// ─── el token dice dónde vive ───────────────────────────────────────────────────────────────────────

// tokenInfo es lo que se puede saber de un `glc_` sin preguntarle a nadie.
type tokenInfo struct {
	org    string // "o": el org de Grafana Cloud
	name   string // "n": el nombre que le pusieron al token
	region string // "m"."r": ej. prod-us-east-0
	ok     bool
}

// decodeToken abre el sobre del token. NO valida nada criptográficamente: solo lee los metadatos que
// Grafana pone en claro para que un cliente sepa a qué región hablarle.
func decodeToken(tok string) tokenInfo {
	payload := strings.TrimPrefix(tok, "glc_")
	if payload == tok || payload == "" {
		return tokenInfo{}
	}
	var raw []byte
	for _, enc := range []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding,
	} {
		if b, err := enc.DecodeString(payload); err == nil && len(b) > 0 {
			raw = b
			break
		}
	}
	if raw == nil {
		return tokenInfo{}
	}
	var body struct {
		O json.RawMessage `json:"o"`
		N string          `json:"n"`
		M struct {
			R string `json:"r"`
		} `json:"m"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return tokenInfo{}
	}
	return tokenInfo{
		org:    strings.Trim(string(body.O), `"`),
		name:   body.N,
		region: body.M.R,
		ok:     true,
	}
}

// legacyRegionHosts: las regiones "legacy" de Grafana Cloud NO siguen el patrón `logs-<región>`, usan el
// formato flat `logs-prodN`. Verificado para prod-us-east-0 contra la doc de region-url-formats, y además
// es el único `logs-prodN.grafana.net` con registro A propio. Sin esta tabla la sonda deriva un hostname
// que no existe y el comodín de DNS lo disfraza de "Grafana caída" (ver el comentario del paquete).
var legacyRegionHosts = map[string]string{
	"prod-us-east-0": "logs-prod3.grafana.net",
}

// candidateBases arma las URLs a probar. Si el .env trae una, es la única: pedirla explícita y después
// ignorarla sería peor que no aceptarla.
func candidateBases(c config, t tokenInfo) []string {
	if c.loki.URL != "" {
		return []string{c.loki.URL}
	}
	if t.region == "" {
		return nil
	}
	if h, ok := legacyRegionHosts[t.region]; ok {
		return []string{"https://" + h}
	}
	return []string{"https://logs-" + t.region + ".grafana.net"}
}

// bogusHost es un nombre que con certeza no existe: sirve de patrón para reconocer el comodín de DNS.
const bogusHost = "logs-prod-zzz999.grafana.net"

// hostIsReal distingue un hostname de grafana.net que existe de uno que solo lo parece. `*.grafana.net`
// tiene un CNAME comodín, así que hasta un nombre inventado resuelve; lo que los diferencia es que el
// real tiene registro propio y el falso hereda el destino del comodín.
//
// ⚠ SOLO VALE PARA LOS HOSTS DE DATOS (`logs-*`). Los hostnames de una INSTANCIA de Grafana
// (`creditop.grafana.net`, `creditopdev.grafana.net`) pasan por ese mismo gateway comodín y existen
// perfectamente: aplicarles la regla los declararía falsos. Verificado el 2026-08-04 contra los dos
// stacks de CreditOp, que responden `/api/health` con database ok.
func hostIsReal(host string) (bool, string) {
	if !strings.HasPrefix(host, "logs-") {
		return true, "" // no es un host de datos: la heurística del comodín no aplica
	}
	wildcard, err := net.LookupCNAME(bogusHost)
	if err != nil {
		return true, "" // sin DNS no se puede descartar: seguí y que conteste el HTTP
	}
	cname, err := net.LookupCNAME(host)
	if err != nil {
		return false, "no resuelve"
	}
	if cname == wildcard {
		return false, "cae en el comodín *.grafana.net (" + strings.TrimSuffix(wildcard, ".") + "): ese host no existe"
	}
	return true, ""
}

// ─── transporte ─────────────────────────────────────────────────────────────────────────────────────

type attempt struct {
	base string
	auth string // basic:<user> | bearer
	note string // por qué se prueba esta combinación
}

func (a attempt) label() string {
	if u, ok := strings.CutPrefix(a.auth, "basic:"); ok {
		return "basic-auth (usuario " + u + ")"
	}
	return "Bearer pelado"
}

// ─── paso 1: qué dice grafana.com del token ─────────────────────────────────────────────────────────

// scopeRe saca la lista de permisos del propio mensaje de error. Grafana devuelve
// `missing required scope [accesspolicies:read], received [logs:read]`: el "received" es el inventario.
var scopeRe = regexp.MustCompile(`received \[([^\]]*)\]`)

// stack es lo que grafana.com devuelve por cada stack del org, si el token puede verlos.
type stack struct {
	Slug          string `json:"slug"`
	HlInstanceID  int    `json:"hlInstanceId"`  // el ID numérico de Loki: justo el que falta
	HlInstanceURL string `json:"hlInstanceUrl"` // y su endpoint
}

// askGrafanaCom averigua validez, permisos y (si el token alcanza) el stack — todo SIN necesitar la URL
// de Loki ni el ID de instancia. Es el paso que dice si el problema es el token o los datos de conexión.
func askGrafanaCom(token, region string) (scopes []string, stacks []stack, valid bool) {
	hc := &http.Client{Timeout: 20 * time.Second}
	call := func(u string) (int, []byte) {
		req, err := http.NewRequest(http.MethodGet, u, nil)
		if err != nil {
			return 0, nil
		}
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := hc.Do(req)
		if err != nil {
			return 0, nil
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return resp.StatusCode, b
	}

	// El endpoint se elige por lo que devuelve al FALLAR: exige `accesspolicies:read` y en el 401 enumera
	// los permisos que el token sí tiene.
	if region != "" {
		status, body := call("https://grafana.com/api/v1/accesspolicies?region=" + url.QueryEscape(region))
		if m := scopeRe.FindSubmatch(body); m != nil {
			valid = true
			for _, s := range strings.Split(string(m[1]), ",") {
				if s = strings.TrimSpace(s); s != "" {
					scopes = append(scopes, s)
				}
			}
		} else if status == http.StatusOK {
			valid = true
			scopes = append(scopes, "accesspolicies:read")
		}
	}

	// Si además tiene `stacks:read`, esto cierra el círculo solo: trae ID de instancia y endpoint.
	if status, body := call("https://grafana.com/api/instances"); status == http.StatusOK {
		valid = true
		var r struct{ Items []stack }
		if json.Unmarshal(body, &r) == nil {
			stacks = r.Items
		}
	}
	return scopes, stacks, valid
}

// ─── respuestas de Loki ─────────────────────────────────────────────────────────────────────────────

type valuesResp struct {
	Data []string `json:"data"`
}

type queryResp struct {
	Data struct {
		Result []struct {
			Stream map[string]string `json:"stream"`
			Values [][2]string       `json:"values"`
		} `json:"result"`
	} `json:"data"`
}

func (q queryResp) lines() int {
	n := 0
	for _, r := range q.Data.Result {
		n += len(r.Values)
	}
	return n
}

// isMatrix dice si la respuesta es de una consulta MÉTRICA (`sum(count_over_time(…))`) en vez de una
// lectura de líneas. Es una respuesta legítima de query_range y aun así no encaja en `queryResp`: su
// `resultType` es `matrix` y los timestamps vienen como NÚMERO, no como string, así que el Unmarshal
// de allá falla entero y el modo `-query` contestaba «el cuerpo no es una respuesta de query_range»,
// sugiriendo que el servicio no existía, con el número pedido adentro del cuerpo.
//
// ⚠ Por qué contar merece su propia rama: leer y contar son preguntas distintas, y este modo sólo
// sabía leer. Las líneas que imprime son una MUESTRA (cuatro, aunque haya traído 200), así que
// contarlas miente — medido el 2026-08-16: un agente contó sobre la muestra y reportó 46% donde el
// número real era 9,2%.
func isMatrix(body []byte) bool {
	var m struct {
		Data struct {
			ResultType string `json:"resultType"`
		} `json:"data"`
	}
	return json.Unmarshal(body, &m) == nil && m.Data.ResultType == "matrix"
}

// instantValue lee el número de una consulta métrica hecha contra `/query` (instantánea).
//
// ⚠ Tiene que ser instantánea y NO `query_range`: un range de `count_over_time([24h])` devuelve una
// SERIE de ventanas de 24h SOLAPADAS —una por cada `step`, alineadas a límites absolutos de tiempo—,
// no un total. Quedarse con el último punto, o con el máximo, da un número plausible y equivocado:
// medido, la serie daba 35.036 y 3.488 para una ventana cuyo total real era 3.343.
func instantValue(body []byte) (string, bool) {
	var m struct {
		Data struct {
			Result []struct {
				Value [2]json.RawMessage `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &m) != nil || len(m.Data.Result) == 0 {
		return "", false
	}
	var v string
	if json.Unmarshal(m.Data.Result[0].Value[1], &v) != nil || v == "" {
		return "", false
	}
	return v, true
}

// ─── salida ─────────────────────────────────────────────────────────────────────────────────────────

var color = func() bool {
	fi, err := os.Stdout.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}()

func paint(code, s string) string {
	if !color {
		return s
	}
	return "\033[" + code + "m" + s + "\033[0m"
}

func bold(s string) string { return paint("1", s) }
func dim(s string) string  { return paint("2", s) }

func step(format string, a ...any) { fmt.Println("\n" + bold(fmt.Sprintf(format, a...))) }
func ok(format string, a ...any) {
	fmt.Println("     " + paint("32", "✔") + " " + fmt.Sprintf(format, a...))
}
func bad(format string, a ...any) {
	fmt.Println("     " + paint("31", "✘") + " " + fmt.Sprintf(format, a...))
}
func warn(format string, a ...any) {
	fmt.Println("     " + paint("33", "!") + " " + fmt.Sprintf(format, a...))
}
func detail(format string, a ...any) { fmt.Println("       " + dim(fmt.Sprintf(format, a...))) }

// mask muestra lo justo para reconocer un token sin exponerlo: un token en pantalla termina en una
// captura, y una captura termina en Slack.
func mask(s string) string {
	if len(s) <= 14 {
		return strings.Repeat("•", len(s))
	}
	return fmt.Sprintf("%s…%s (%d chars)", s[:10], s[len(s)-4:], len(s))
}

// ─── main ───────────────────────────────────────────────────────────────────────────────────────────

func main() {
	// Default `prod` porque es el único stack con acceso confirmado hoy. Es seguro como default: la sonda
	// solo hace GET. Cuando exista `.env.dev` (creditopdev), se pide con -target dev.
	target := flag.String("target", "prod", "qué .env.<target> leer (prod = creditop · dev, qa y staging = creditopdev)")
	query := flag.String("query", "", "selector LogQL a leer (si se omite, se descubre desde las etiquetas)")
	since := flag.Duration("since", time.Hour, "ventana hacia atrás para la lectura corta")
	limit := flag.Int("limit", 20, "máximo de líneas a pedir")
	ureq := flag.Int64("ureq", 0, "número de solicitud: arma la TRAZA por etapas (BD + logs) en vez de probar el acceso")
	slackDays := flag.Int("slack", 0, "lee #tech-ops de los últimos N días y clasifica los reportes (solo lectura)")
	slackUnclassified := flag.Bool("slack-sin", false, "con -slack: lista los reportes que ninguna regex reconoció (texto real del canal)")
	serve := flag.String("serve", "", "levanta la API para la Vue (ej. 127.0.0.1:5199)")
	incidents := flag.Int("incidencias", 0, "vuelca los reportes de #tech-ops CON SU HILO de respuestas, para contrastar (solo lectura)")
	fields := flag.Bool("campos", false, "con -ureq: censo de los campos del contexto de log, para ver qué llave estructural existe")
	anchors := flag.Bool("anclas", false, "con -ureq: mide cuánto se puede AFIRMAR de cada línea (cierta · probable · por traza · contaminada)")
	spans := flag.Bool("spans", false, "con -ureq: mide si el `span_id` alcanza para ubicar las líneas que el texto no reclama")
	validate := flag.String("validar", "", "ruta a un corpus de líneas CRUDAS (el TSV del censo o un timeline.ndjson): audita el mapa")
	indexLogs := flag.Bool("indexar-logs", false, "construye ../logs.json, el índice mensaje de log → archivo:línea, leyendo el código de los repos (ver log_index.go)")
	noFetch := flag.Bool("sin-fetch", false, "con -indexar-logs: no actualiza las refs remotas antes de leer")
	check := flag.Bool("chequeo", false, "valida el mapa SIN corpus: coherencia interna, el vocabulario de ramales que comparte con el harness y (con -target) las tablas declaradas — ver check.go")
	search := flag.String("buscar", "", "teléfono, cédula o número de solicitud: lista los intentos que coincidan")
	jsonOut := flag.Bool("json", false, "con -ureq o -buscar: salida estructurada, para encadenar o para un modelo")
	htmlOut := flag.String("html", "", "con -ureq: además escribe la vista de checks en este archivo")
	sqlQuery := flag.String("sql", "", "UNA consulta de solo lectura (SELECT/WITH) contra la fuente del target — ver sql.go")
	sqlCSV := flag.Bool("csv", false, "con -sql: salida en CSV en vez de tabla")
	posthog := flag.Bool("posthog", false, "sonda de acceso a PostHog (qué VIO el cliente); con -ureq, los eventos de esa solicitud")
	tel := flag.String("tel", "", "con -posthog -ureq: el celular del cliente, para ver además la fase de AUTH (distinct_id phone_<e164>)")
	mdOut := flag.Bool("md", false, "con -ureq, -buscar o -sql: la salida como ANOTACIÓN fechada para pegar en una tarea del tablero (ver reproduce.go)")
	block := flag.String("bloque", "", "con -ureq, -buscar o -sql: agrega la salida como BLOQUE a la pila de esa tarea del tablero (id o slug)")
	flag.Parse()

	c, checked := loadConfig(*target)
	// Dos modos en un binario: con `-ureq` es el TRAZADOR (etapas de una solicitud); sin él, la sonda de
	// acceso (¿puedo leer los logs de este ambiente?) — que es el chequeo previo del primero.
	//
	// Va ANTES de exigir el token a propósito: en modo traza el token es OPCIONAL. La fuente primaria es
	// la BD (el esqueleto), un Loki local no pide credenciales, y si no hay logs la traza sale igual —
	// solo sin el porqué. Exigirlo acá bloquearía el caso que más sirve.
	if *slackDays > 0 {
		os.Exit(slackMode(*slackDays, *slackUnclassified))
	}
	if *serve != "" {
		if err := runServer(*serve); err != nil {
			fmt.Fprintf(os.Stderr, "  %s el server murió: %v\n", paint("31", "✘"), err)
			os.Exit(1)
		}
		return
	}
	if *incidents > 0 {
		os.Exit(incidentsMode(*incidents))
	}
	if *fields && *ureq > 0 {
		os.Exit(fieldsMode(*target, *ureq))
	}
	if *anchors && *ureq > 0 {
		os.Exit(anchorsMode(*target, *ureq))
	}
	if *spans && *ureq > 0 {
		os.Exit(spansMode(*target, *ureq))
	}
	// Va ANTES del despacho de `-ureq`: `-posthog -ureq N` pregunta por los eventos del NAVEGADOR de esa
	// solicitud, no por la traza de etapas.
	if *posthog {
		code := postHogMode(c, *target, *ureq, *tel, *limit)
		// El pie va aunque el modo haya fallado, y a propósito: casi todas sus salidas de error son
		// «falta un dato de configuración», y lo que uno quiere después de arreglarlo es volver a correr
		// exactamente lo mismo. La anotación, en cambio, sale de la traza: `-md` con -ureq la trae con
		// las pantallas adentro, así que acá sólo se dice dónde está en vez de escribir una a medias.
		if *mdOut {
			fmt.Printf("\n     %s\n", gray("para la anotación con el timeline adentro: "+
				cmdMake("trazador-ureq", *target, "UREQ", ifAny(*ureq), "TEL", *tel, "MD", "1")))
		}
		pie(cmdMake("trazador-posthog", *target, "UREQ", ifAny(*ureq), "TEL", *tel))
		os.Exit(code)
	}
	if *indexLogs {
		os.Exit(buildLogIndex(!*noFetch))
	}
	if *check {
		// Las tablas sólo se pueden comprobar si hay una fuente a mano. Cuando no la hay, se pasa nil y
		// el chequeo DECLARA que quedaron sin mirar — omitirlo en silencio sería el falso verde que esta
		// herramienta existe para no dar.
		//
		// ⚠ Y NO SE ABRE LA FUENTE POR DEFECTO. El default de `-target` es `prod`, así que un `-chequeo`
		// pelado salía a consultar PRODUCCIÓN para mirar el `information_schema` — lectura inocua, pero
		// sigue siendo prod, y la regla de la casa es elegir el ambiente más chico que conteste la
		// pregunta: el esquema es el mismo en todos. Se mira sólo si el target se pidió A MANO, que es lo
		// que `flag.Visit` sabe distinguir del valor por omisión.
		askedTarget := false
		flag.Visit(func(f *flag.Flag) {
			if f.Name == "target" {
				askedTarget = true
			}
		})
		var tables map[string]bool
		if source, err := openSource(c); askedTarget && err == nil {
			defer source.Close()
			if rows, err := source.Rows("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"); err == nil {
				tables = map[string]bool{}
				for _, f := range rows {
					for _, v := range f {
						if s, ok := v.(string); ok {
							tables[strings.ToLower(s)] = true
						}
					}
				}
			}
		}
		code := Check(tables)
		reproduce := ""
		if askedTarget {
			reproduce = *target
		}
		pie(cmdMake("trazador-chequeo", reproduce))
		os.Exit(code)
	}
	if *validate != "" {
		code := ValidateAgainst(*validate)
		pie(cmdMake("trazador-validar", "", "CORPUS", *validate))
		os.Exit(code)
	}
	if *sqlQuery != "" {
		os.Exit(sqlMode(c, *target, *sqlQuery, *sqlCSV, *mdOut, *block))
	}
	if *search != "" {
		os.Exit(searchMode(c, *target, *search, *jsonOut, *mdOut, *block))
	}
	if *ureq > 0 {
		os.Exit(traceMode(c, *target, *ureq, *tel, *jsonOut, *htmlOut, *mdOut, *block))
	}

	if c.loki.Token == "" {
		searched := "LOKI_TOKEN / GRAFANA_LOKI_PASSWORD / GRAFANA_LOKI_TOKEN"
		where := strings.Join(checked, ", ")
		if where == "" {
			where = "(no existe connectors/.env." + *target + ")"
		}
		fmt.Fprintf(os.Stderr, "%s no hay token para el target «%s».\n\nBuscado como %s en: %s\n\n"+
			"Copiá connectors/.env.example a connectors/.env.%s y completalo, o exportá LOKI_TOKEN.\n",
			paint("31", "✘"), *target, searched, where, *target)
		os.Exit(2)
	}
	info := decodeToken(c.loki.Token)
	// Se anota ANTES de que el paso 1 pueda completarlos desde grafana.com: si ya venían del .env, el
	// consejo final de "pegá esto en tu .env" sobra y sería ruido en cada corrida.
	knewBase, knewUser := c.loki.URL != "", c.loki.User != ""

	step("Configuración")
	detail("token    %s", mask(c.loki.Token))
	if info.ok {
		detail("del token: org %s · región %s%s", orDash(info.org), orDash(info.region), namePart(info.name))
	} else {
		warn("el token no tiene el formato glc_<base64>: no puedo deducir región ni org de ahí")
	}
	detail("base     %s", orDash(c.loki.URL))
	detail("usuario  %s", orDash(c.loki.User))
	detail("tenant   %s", orDash(c.loki.Tenant))
	if c.source != "" {
		detail("origen   %s", c.source)
	}
	if len(checked) > 0 {
		detail("archivos %s", strings.Join(checked, ", "))
	}

	// ── 1. ¿qué dice grafana.com del token? ──────────────────────────────────────────────────────
	step("1/4  ¿El token es válido y qué permisos trae?   grafana.com/api")
	scopes, stacks, valid := askGrafanaCom(c.loki.Token, info.region)
	switch {
	case !valid:
		bad("grafana.com no reconoció el token (ni para decirme qué permisos tiene).")
		detail("revocado, mal copiado, o de otra región")
	case len(scopes) > 0:
		ok("token válido. Permisos: %s", strings.Join(scopes, ", "))
		if !hasScope(scopes, "logs:read") {
			warn("NO trae `logs:read` — sin ese scope no hay lectura de logs por más URL que se acierte")
		}
	default:
		ok("token válido (grafana.com respondió), permisos no enumerables desde acá")
	}
	// Si el token puede ver los stacks, el ID de instancia y el endpoint salen de acá y no hay que
	// pedirle nada a nadie.
	if len(stacks) > 0 {
		for _, s := range stacks {
			ok("stack «%s» → LOKI_USER=%d · LOKI_URL=%s", s.Slug, s.HlInstanceID, s.HlInstanceURL)
			if c.loki.User == "" && s.HlInstanceID > 0 {
				c.loki.User = fmt.Sprint(s.HlInstanceID)
			}
			if c.loki.URL == "" && s.HlInstanceURL != "" {
				c.loki.URL = logs.NormalizeURL(s.HlInstanceURL)
			}
		}
	} else if valid {
		detail("no puedo listar stacks (eso pide `stacks:read`): el ID de instancia no sale de la API")
	}

	// ── 2. ¿autentica contra Loki? ───────────────────────────────────────────────────────────────
	bases := candidateBases(c, info)
	if len(bases) == 0 {
		bad("sin URL: el .env no trae una y el token no dice la región.")
		verdictMissing(c, "la URL de consulta de Loki y el ID numérico de la instancia")
		os.Exit(1)
	}
	step("2/4  ¿Autentica contra Loki?   GET labels")

	// El DNS se chequea antes de pegarle: un hostname inexistente responde 530/1016 y ese error se lee
	// como una caída de Grafana. Mejor decir "ese nombre no existe" que traducir un código de Cloudflare.
	for _, b := range bases {
		host := strings.TrimPrefix(strings.TrimPrefix(b, "https://"), "http://")
		if real, why := hostIsReal(host); !real {
			warn("%s → %s", host, why)
		}
	}

	// Orden: basic-auth con el ID de instancia es LA forma que funciona. El Bearer pelado se prueba
	// igual porque su mensaje de error es el que identifica que falta ese ID. El org del token va al
	// final: casi nunca coincide con el ID de instancia, pero probarlo es gratis y descarta la confusión.
	var tries []attempt
	for _, b := range bases {
		if c.loki.User != "" {
			tries = append(tries, attempt{b, "basic:" + c.loki.User, "el ID de instancia configurado"})
		}
		tries = append(tries, attempt{b, "bearer", "diagnóstico: distingue token inválido de ID faltante"})
		if info.org != "" && info.org != c.loki.User {
			tries = append(tries, attempt{b, "basic:" + info.org, "por si el org del token fuera el ID (rara vez lo es)"})
		}
	}

	cl := logs.New(c.loki, 30*time.Second)
	now := time.Now()
	nano := func(t time.Time) string { return fmt.Sprint(t.UnixNano()) }

	var labels []string
	var winner *attempt
	missingID := false
	for i := range tries {
		cl.Base, cl.AuthMode = tries[i].base, tries[i].auth
		status, body, err := cl.API("labels", url.Values{
			"start": {nano(now.Add(-*since))}, "end": {nano(now)},
		})
		switch {
		case err != nil:
			bad("%s · %s → sin respuesta HTTP: %v", tries[i].base, tries[i].label(), err)
		case status == http.StatusOK:
			var vr valuesResp
			if json.Unmarshal(body, &vr) != nil {
				bad("%s · %s → 200 pero el cuerpo no es JSON de Loki: %s",
					tries[i].base, tries[i].label(), trim(string(body), 160))
				continue
			}
			labels = vr.Data
			sort.Strings(labels)
			winner = &tries[i]
		default:
			if logs.NeedsInstanceID(body) {
				missingID = true
			}
			detail("%s · %s → %s", tries[i].base, tries[i].label(), logs.Explain(status, body))
		}
		if winner != nil {
			break
		}
	}

	if winner == nil {
		if missingID && hasScope(scopes, "logs:read") {
			verdictMissing(c, "el ID numérico de la instancia de logs (LOKI_USER)")
		} else {
			fmt.Printf("\n%s NO hay acceso de lectura todavía.\n", paint("31", "VEREDICTO:"))
			fmt.Println("Ningún par (endpoint, auth) devolvió 200. El detalle de arriba dice qué falta.")
		}
		os.Exit(1)
	}
	cl.Base, cl.AuthMode = winner.base, winner.auth
	ok("200 contra %s con %s", winner.base, winner.label())
	if len(labels) == 0 {
		warn("…pero la lista de etiquetas vino VACÍA: autenticaste contra un tenant sin logs (realm " +
			"equivocado en la access policy), o no hay nada en la ventana pedida")
	} else {
		detail("%d etiquetas: %s", len(labels), strings.Join(labels, " "))
	}

	// ── 3. ¿aparece CreditOp? ────────────────────────────────────────────────────────────────────
	step("3/4  ¿Se ven las etiquetas que empuja CreditOp?")
	// Orden deliberado: primero las que escribe LokiHandler, después las de un scrape de k8s
	// (promtail/alloy), por si los logs llegan por el stdout del pod y no por el handler de Laravel.
	// `service_name` va PRIMERO porque es la única etiqueta que cubre la flota entera (los 15 servicios).
	// `app` solo existe en los monolitos Laravel, y `environment` / `deployment_environment` son dos
	// convenciones EXCLUYENTES —Laravel vs OTel— que parten la flota en dos: filtrar por una descarta la
	// otra mitad en silencio. Medido el 2026-08-04: {environment="production"} devuelve 2 servicios,
	// {deployment_environment="production"} devuelve 13.
	interesting := []string{"service_name", "app", "service", "environment", "deployment_environment",
		"namespace", "job", "container", "pod", "level", "channel"}
	have := map[string]bool{}
	for _, l := range labels {
		have[l] = true
	}
	selector, found, fallback := *query, "", ""
	for _, l := range interesting {
		if !have[l] {
			continue
		}
		status, body, err := cl.API("label/"+url.PathEscape(l)+"/values", url.Values{
			"start": {nano(now.Add(-24 * time.Hour))}, "end": {nano(now)},
		})
		if err != nil || status != http.StatusOK {
			warn("%s → %s", l, logs.Explain(status, body))
			continue
		}
		var vr valuesResp
		if json.Unmarshal(body, &vr) != nil {
			continue
		}
		sort.Strings(vr.Data)
		fmt.Printf("     %-14s %s\n", l, dim(trim(strings.Join(vr.Data, " "), 150)))
		if found == "" {
			for _, v := range vr.Data {
				lv := strings.ToLower(v)
				if strings.Contains(lv, "creditop") || strings.Contains(lv, "legacy") ||
					strings.Contains(lv, "preapprov") || strings.Contains(lv, "form-service") {
					found = fmt.Sprintf("{%s=%q}", l, v)
					break
				}
			}
		}
		if fallback == "" && len(vr.Data) > 0 && len(vr.Data) <= 40 {
			fallback = fmt.Sprintf("{%s=%q}", l, vr.Data[0])
		}
	}
	switch {
	case selector != "":
		detail("selector fijado por -query, no descubro: %s", selector)
	case found != "":
		ok("hay streams de CreditOp → %s", found)
		selector = found
	case fallback != "":
		warn("ningún valor dice «creditop»; pruebo la lectura con %s", fallback)
		selector = fallback
	default:
		warn("no hay etiquetas con valores: no tengo con qué construir una consulta")
		selector = `{app="creditop-api"}`
	}

	// ── 4. leer líneas de verdad ─────────────────────────────────────────────────────────────────
	read := func(window time.Duration, human string) bool {
		status, body, err := cl.API("query_range", url.Values{
			"query":     {selector},
			"start":     {nano(now.Add(-window))},
			"end":       {nano(now)},
			"limit":     {fmt.Sprint(*limit)},
			"direction": {"backward"},
		})
		if err != nil {
			bad("sin respuesta: %v", err)
			return false
		}
		if status != http.StatusOK {
			bad("%s", logs.Explain(status, body))
			return false
		}
		// Antes de intentar leerlo como líneas: si es una consulta MÉTRICA la respuesta es un número,
		// y hay que volver a pedirlo como INSTANTÁNEA — el range da ventanas solapadas, no un total.
		if isMatrix(body) {
			st, reqBody, err := cl.API("query", url.Values{
				"query": {selector},
				"time":  {nano(now)},
			})
			if err != nil || st != http.StatusOK {
				bad("la consulta métrica no se pudo resolver como instantánea: %v", err)
				return false
			}
			if v, there := instantValue(reqBody); there {
				ok("%s = %s  ·  contado por Loki sobre la ventana de la expresión, NO es una muestra", selector, v)
				return true
			}
			warn("la consulta métrica no devolvió valor — ¿la expresión matchea algo?")
			return false
		}
		var qr queryResp
		if json.Unmarshal(body, &qr) != nil {
			bad("200 pero el cuerpo no es una respuesta de query_range: %s", trim(string(body), 160))
			return false
		}
		if n := qr.lines(); n > 0 {
			ok("%d líneas en %d streams, en %s", n, len(qr.Data.Result), human)
			printLines(qr)
			return true
		}
		warn("0 líneas en %s — el 200 prueba que el permiso está; el vacío es que no hay logs ahí", human)
		return false
	}

	step("4/4  ¿Puedo leer líneas?   query_range %s · %s", selector, *since)
	got := read(*since, "la última "+since.String())
	if !got {
		detail("reintento con ventana ancha de 24h")
		got = read(24*time.Hour, "las últimas 24h")
	}

	fmt.Println()
	// La sonda también se pega en una tarea —«¿se puede leer prod desde acá?» es una medición— así que
	// cierra igual que los demás modos: con el comando que la repite, selector y ventana incluidos.
	defer pie(cmdMake("trazador-acceso", *target, "QUERY", selector, "SINCE", since.String()))
	if got {
		fmt.Printf("%s acceso de LECTURA CONFIRMADO contra %s.\n", paint("32", "VEREDICTO:"), winner.base)
		fmt.Printf("Autentica con %s, resuelve etiquetas y devuelve líneas. Se puede construir encima.\n", winner.label())
		if !knewBase || !knewUser {
			fmt.Printf("\nPara que la próxima corrida no adivine nada, dejá esto en connectors/.env.%s:\n", *target)
			fmt.Printf("  LOKI_URL=%s\n", winner.base)
			if u, isBasic := strings.CutPrefix(winner.auth, "basic:"); isBasic {
				fmt.Printf("  LOKI_USER=%s\n", u)
			}
		}
		return
	}
	fmt.Printf("%s el token autentica y tiene permiso de lectura (los 200 lo prueban), pero no llegaron\n",
		paint("33", "VEREDICTO:"))
	fmt.Printf("líneas para %s. Eso ya NO es un problema de acceso: o el selector no es el correcto\n", selector)
	fmt.Println("(mirá los valores del paso 3 y volvé a correr con -query), o ese servicio no está")
	fmt.Println("empujando logs en esta ventana.")
	pie(cmdMake("trazador-acceso", *target, "QUERY", selector, "SINCE", since.String()))
	os.Exit(1)
}

// verdictMissing cierra nombrando el único dato que falta. Vale la pena que sea su propia función: el
// valor de la sonda no es el diagnóstico, es poder pedir UNA cosa concreta en vez de "no me funciona".
func verdictMissing(c config, what string) {
	fmt.Printf("\n%s falta UN dato: %s.\n", paint("33", "VEREDICTO:"), what)
	fmt.Println("El token está bien emitido y tiene `logs:read` — eso ya está verificado, no hay que")
	fmt.Println("volver a tocarlo. Lo que falta se lee en el portal de Grafana Cloud, en el stack:")
	fmt.Println("  Home → Stacks → <stack> → Loki → «Details» / «Send Logs»")
	fmt.Println("Ahí figuran juntos el `User` (un número de 6-7 dígitos) y el `URL`.")
	fmt.Println("\nCuando los tengas:")
	fmt.Println("  LOKI_USER=<número>")
	fmt.Println("  LOKI_URL=<url>")
	if c.loki.URL != "" {
		fmt.Printf("(la URL que probé fue %s)\n", c.loki.URL)
	}
}

func hasScope(scopes []string, want string) bool {
	for _, s := range scopes {
		if s == want {
			return true
		}
	}
	return false
}

// printLines muestra las primeras líneas con su hora y sus etiquetas. La línea que escribe LokiHandler
// es un JSON {message,context,extra}; se saca `message` para que se lea, y si no es JSON se muestra cruda.
func printLines(qr queryResp) {
	shown := 0
	for _, r := range qr.Data.Result {
		keys := make([]string, 0, len(r.Stream))
		for k := range r.Stream {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, k+"="+r.Stream[k])
		}
		for _, v := range r.Values {
			if shown >= 4 {
				return
			}
			shown++
			var ns int64
			fmt.Sscanf(v[0], "%d", &ns)
			detail("%s  {%s}", time.Unix(0, ns).Format("2006-01-02 15:04:05"), strings.Join(parts, ", "))
			fmt.Println("         " + trim(message(v[1]), 150))
		}
	}
}

// message saca el campo legible de una línea de Loki, si la línea es el JSON que escribe LokiHandler.
func message(line string) string {
	var obj map[string]any
	if json.Unmarshal([]byte(line), &obj) != nil {
		return line
	}
	for _, k := range []string{"message", "msg", "log", "event"} {
		if s, ok := obj[k].(string); ok && s != "" {
			return s
		}
	}
	return line
}

func trim(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func orDash(s string) string {
	if s == "" {
		return dim("(no está)")
	}
	return s
}

func namePart(n string) string {
	if n == "" {
		return ""
	}
	return " · token «" + n + "»"
}
