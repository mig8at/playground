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
	base   string // https://logs-prod3.grafana.net (sin el path de la API)
	user   string // ID numérico de la instancia de logs (usuario del basic auth)
	token  string // glc_...
	tenant string // X-Scope-OrgID; solo Loki self-hosted detrás de gateway lo necesita
	source string // de dónde salió cada cosa, para poder decirlo en pantalla
}

// alias mapea cada campo a los nombres de variable que aceptamos. Los `GRAFANA_LOKI_*` son los que usa
// legacy-backend en su propio .env: aceptarlos permite pegar las vars del deploy tal como están.
var alias = map[string][]string{
	"token":  {"LOKI_TOKEN", "GRAFANA_LOKI_PASSWORD", "GRAFANA_LOKI_TOKEN"},
	"base":   {"LOKI_URL", "GRAFANA_LOKI_ENDPOINT", "GRAFANA_CLOUD_ENDPOINT"},
	"user":   {"LOKI_USER", "GRAFANA_LOKI_USERNAME"},
	"tenant": {"LOKI_TENANT", "GRAFANA_LOKI_TENANT_ID"},
}

// loadConfig busca los valores en `process.env` y en el `.env.<target>` de la propia herramienta, en ese
// orden. NO hay capa compartida (un `playground/.env` común): cada herramienta del playground es
// autosuficiente por target, que es la convención de la casa desde que se eliminó `env/` el 2026-07-22.
// La segunda ruta cubre la invocación desde la raíz (`make`) además de desde `sonda/`.
func loadConfig(target string) (config, []string) {
	files := []string{
		".env." + target,
		filepath.Join("sonda", ".env."+target),
	}

	var checked []string
	fromFile := map[string]string{}
	seen := map[string]bool{}
	for _, f := range files {
		abs, err := filepath.Abs(f)
		if err != nil || seen[abs] {
			continue
		}
		seen[abs] = true
		kv, err := parseEnvFile(f)
		if err != nil {
			continue
		}
		checked = append(checked, f)
		for k, v := range kv {
			if _, ok := fromFile[k]; !ok {
				fromFile[k] = v
			}
		}
	}

	pick := func(field string) (string, string) {
		for _, k := range alias[field] {
			if v := strings.TrimSpace(os.Getenv(k)); v != "" {
				return v, "entorno:" + k
			}
		}
		for _, k := range alias[field] {
			if v := strings.TrimSpace(fromFile[k]); v != "" {
				return v, "archivo:" + k
			}
		}
		return "", ""
	}

	var c config
	var origins []string
	for _, field := range []string{"token", "base", "user", "tenant"} {
		v, from := pick(field)
		switch field {
		case "token":
			c.token = v
		case "base":
			c.base = normalizeBase(v)
		case "user":
			c.user = v
		case "tenant":
			c.tenant = v
		}
		if from != "" {
			origins = append(origins, field+" <- "+from)
		}
	}
	c.source = strings.Join(origins, ", ")
	return c, checked
}

// parseEnvFile lee un KEY=VALUE por línea. Suficiente a propósito: no hay interpolación ni multilínea en
// los .env del playground, y un parser que inventa features es un parser que sorprende.
func parseEnvFile(path string) (map[string]string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		out[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
	}
	return out, nil
}

// normalizeBase deja solo el origen. La URL que reparte Grafana Cloud suele venir con el path de la API
// pegado (`.../loki/api/v1/query_range`); si no se recorta, cada request pide una ruta que no existe.
func normalizeBase(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if i := strings.Index(s, "/loki/api/"); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimRight(s, "/")
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		s = "https://" + s
	}
	return s
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
	if c.base != "" {
		return []string{c.base}
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

type client struct {
	http    *http.Client
	cfg     config
	current attempt
}

// get pega a un path de la API de Loki y devuelve status + cuerpo. El cuerpo se lee siempre: los errores
// de Loki vienen con texto y son la mitad del diagnóstico.
func (cl *client) get(path string, params url.Values) (int, []byte, error) {
	u := cl.current.base + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return 0, nil, err
	}
	if user, ok := strings.CutPrefix(cl.current.auth, "basic:"); ok {
		req.SetBasicAuth(user, cl.cfg.token)
	} else {
		req.Header.Set("Authorization", "Bearer "+cl.cfg.token)
	}
	if cl.cfg.tenant != "" {
		req.Header.Set("X-Scope-OrgID", cl.cfg.tenant)
	}
	resp, err := cl.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, body, nil
}

// needsInstanceID reconoce el mensaje con el que Grafana Cloud rechaza un Bearer pelado. Está aparte
// porque es la pista más valiosa y la más engañosa: dice "host is not found" pero el host está bien.
func needsInstanceID(body []byte) bool {
	return strings.Contains(string(body), "legacy auth cannot be upgraded")
}

// explain traduce un status a qué hay que hacer al respecto. Es la parte que ahorra el viaje a la
// documentación: cada código apunta a un dato distinto mal puesto.
func explain(status int, body []byte) string {
	snippet := trim(string(body), 180)
	switch {
	case needsInstanceID(body):
		return "401 — el token es válido pero le falta con quién ir emparejado: Grafana Cloud no acepta " +
			"un Bearer pelado, necesita `<ID de instancia>:<token>`. Falta LOKI_USER."
	case status == http.StatusUnauthorized:
		return "401 — el par usuario/token no sirve. El usuario del basic-auth es el ID NUMÉRICO de la " +
			"instancia de logs (no el org, no el slug del stack, no un email). " + snippet
	case status == http.StatusForbidden:
		return "403 — autentica, pero la access policy no alcanza: falta el scope `logs:read`, o su " +
			"realm no cubre este stack. Esto se pide, no se arregla acá. " + snippet
	case status == http.StatusNotFound:
		return "404 — esa base no es la de Loki (¿es la de Prometheus/Tempo, o la URL del stack?). " + snippet
	case status == 530 || strings.Contains(snippet, "error code: 1016"):
		return "530/1016 — Cloudflare sin origin: el hostname no existe (lo disfraza el comodín de DNS). " +
			"No es una caída de Grafana."
	case status == http.StatusTooManyRequests:
		return "429 — rate limit del tenant; reintentá en un rato. " + snippet
	case status >= 500:
		return fmt.Sprintf("%d — falla del lado de Grafana, no de las credenciales. %s", status, snippet)
	case status != http.StatusOK:
		return fmt.Sprintf("%d inesperado. %s", status, snippet)
	}
	return "OK"
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
	target := flag.String("target", "prod", "qué .env.<target> leer (prod = creditop · dev = creditopdev)")
	query := flag.String("query", "", "selector LogQL a leer (si se omite, se descubre desde las etiquetas)")
	since := flag.Duration("since", time.Hour, "ventana hacia atrás para la lectura corta")
	limit := flag.Int("limit", 20, "máximo de líneas a pedir")
	flag.Parse()

	c, checked := loadConfig(*target)
	if c.token == "" {
		buscado := strings.Join(alias["token"], " / ")
		donde := strings.Join(checked, ", ")
		if donde == "" {
			donde = "(ningún .env." + *target + " existe todavía)"
		}
		fmt.Fprintf(os.Stderr, "%s no hay token para el target «%s».\n\nBuscado como %s en: %s\n\n"+
			"Copiá sonda/.env.prod.example a sonda/.env.%s y completalo, o exportá LOKI_TOKEN.\n",
			paint("31", "✘"), *target, buscado, donde, *target)
		os.Exit(2)
	}
	info := decodeToken(c.token)
	// Se anota ANTES de que el paso 1 pueda completarlos desde grafana.com: si ya venían del .env, el
	// consejo final de "pegá esto en tu .env" sobra y sería ruido en cada corrida.
	knewBase, knewUser := c.base != "", c.user != ""

	step("Configuración")
	detail("token    %s", mask(c.token))
	if info.ok {
		detail("del token: org %s · región %s%s", orDash(info.org), orDash(info.region), namePart(info.name))
	} else {
		warn("el token no tiene el formato glc_<base64>: no puedo deducir región ni org de ahí")
	}
	detail("base     %s", orDash(c.base))
	detail("usuario  %s", orDash(c.user))
	detail("tenant   %s", orDash(c.tenant))
	if c.source != "" {
		detail("origen   %s", c.source)
	}
	if len(checked) > 0 {
		detail("archivos %s", strings.Join(checked, ", "))
	}

	// ── 1. ¿qué dice grafana.com del token? ──────────────────────────────────────────────────────
	step("1/4  ¿El token es válido y qué permisos trae?   grafana.com/api")
	scopes, stacks, valid := askGrafanaCom(c.token, info.region)
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
			if c.user == "" && s.HlInstanceID > 0 {
				c.user = fmt.Sprint(s.HlInstanceID)
			}
			if c.base == "" && s.HlInstanceURL != "" {
				c.base = normalizeBase(s.HlInstanceURL)
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
	step("2/4  ¿Autentica contra Loki?   GET /loki/api/v1/labels")

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
		if c.user != "" {
			tries = append(tries, attempt{b, "basic:" + c.user, "el ID de instancia configurado"})
		}
		tries = append(tries, attempt{b, "bearer", "diagnóstico: distingue token inválido de ID faltante"})
		if info.org != "" && info.org != c.user {
			tries = append(tries, attempt{b, "basic:" + info.org, "por si el org del token fuera el ID (rara vez lo es)"})
		}
	}

	cl := &client{http: &http.Client{Timeout: 30 * time.Second}, cfg: c}
	now := time.Now()
	nano := func(t time.Time) string { return fmt.Sprint(t.UnixNano()) }

	var labels []string
	var winner *attempt
	missingID := false
	for i := range tries {
		cl.current = tries[i]
		status, body, err := cl.get("/loki/api/v1/labels", url.Values{
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
			if needsInstanceID(body) {
				missingID = true
			}
			detail("%s · %s → %s", tries[i].base, tries[i].label(), explain(status, body))
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
	cl.current = *winner
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
		status, body, err := cl.get("/loki/api/v1/label/"+url.PathEscape(l)+"/values", url.Values{
			"start": {nano(now.Add(-24 * time.Hour))}, "end": {nano(now)},
		})
		if err != nil || status != http.StatusOK {
			warn("%s → %s", l, explain(status, body))
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
		status, body, err := cl.get("/loki/api/v1/query_range", url.Values{
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
			bad("%s", explain(status, body))
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
	if got {
		fmt.Printf("%s acceso de LECTURA CONFIRMADO contra %s.\n", paint("32", "VEREDICTO:"), winner.base)
		fmt.Printf("Autentica con %s, resuelve etiquetas y devuelve líneas. Se puede construir encima.\n", winner.label())
		if !knewBase || !knewUser {
			fmt.Printf("\nPara que la próxima corrida no adivine nada, dejá esto en sonda/.env.%s:\n", *target)
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
	if c.base != "" {
		fmt.Printf("(la URL que probé fue %s)\n", c.base)
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
