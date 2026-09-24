// Package logs contesta «estas líneas de log, en este ambiente», y es el ÚNICO lugar del playground que
// sabe qué Loki atiende cada ambiente, cómo se autentica y con qué etiquetas se separa cada backend.
//
//	local                 → el Loki de esta máquina (`harness/bin/loki-local`): no pide credenciales
//	dev · qa · staging    → el stack `creditopdev` de Grafana Cloud
//	prod                  → el stack `creditop`
//
// Hasta el 2026-09-24 cada herramienta tenía su cliente —el trazador en Go, el harness en TypeScript,
// workers en Python— con sus propias claves (`LOKI_*`, `E2E_LOKI_*`), y ya no decían lo mismo: para
// `qa`, el trazador filtraba `environment` por `development|develop` (medido) y el harness por `qa`, un
// valor que ese stack no tiene.
//
// ⚠ LO QUE SEPARA UN AMBIENTE DE OTRO NO ES LO QUE PARECE, y por eso vive acá, escrito una vez:
//   - dev, qa y staging comparten el stack `creditopdev`, y los PHP de dev y de qa loguean los dos
//     `environment=development`. Lo que los distingue es `service_name` (dev → `legacy-backend`,
//     qa → `CreditopDev`; medido el 2026-09-23), que lo pone un secreto del despliegue y no el repo.
//     Por eso `Service` NO filtra: una solicitud pasa por los dos backends, y lo que hace quien lee es
//     decir cuántas líneas sirvió cada uno.
//   - `Env` SÍ filtra, y lo que deja afuera son las máquinas de desarrollo (`local`, `testing`), que
//     pueden correr contra su propia base y repetir ids de la compartida.
package logs

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"creditop/playground/connectors/env"
)

// Targets son los ambientes que existen.
var Targets = []string{"local", "dev", "qa", "staging", "prod"}

// ValidTarget: ¿es uno de los cinco?
func ValidTarget(target string) bool {
	for _, t := range Targets {
		if t == target {
			return true
		}
	}
	return false
}

// Config es a qué Loki preguntarle en un ambiente.
type Config struct {
	Target string
	// URL es el ORIGEN, sin el path de la API (ver NormalizeURL).
	URL string
	// User es el ID NUMÉRICO de la instancia de logs de Grafana Cloud (no el org, no el slug del stack).
	User, Token, Tenant string
	// Env es el filtro de la etiqueta `environment` (una alternativa de regex: `development|develop`).
	Env string
	// Service es el `service_name` del backend de ESTE ambiente. No filtra: sirve para decir qué backend
	// sirvió cada línea.
	Service string
}

// LoadConfig arma la configuración de un ambiente desde `connectors/.env.<target>`. Se aceptan los
// nombres de `legacy-backend` (`GRAFANA_LOKI_*`) para poder pegar las variables del despliegue tal cual.
func LoadConfig(target string) (Config, string, error) {
	if !ValidTarget(target) {
		return Config{}, "", fmt.Errorf("ambiente %q no permitido (%s)", target, strings.Join(Targets, " · "))
	}
	v, err := env.Load(target)
	if err != nil {
		return Config{}, "", err
	}
	return Config{
		Target:  target,
		URL:     NormalizeURL(v.Get("LOKI_URL", "GRAFANA_LOKI_ENDPOINT", "GRAFANA_CLOUD_ENDPOINT")),
		User:    v.Get("LOKI_USER", "GRAFANA_LOKI_USERNAME"),
		Token:   v.Get("LOKI_TOKEN", "GRAFANA_LOKI_PASSWORD", "GRAFANA_LOKI_TOKEN"),
		Tenant:  v.Get("LOKI_TENANT", "GRAFANA_LOKI_TENANT_ID"),
		Env:     v.Get("LOKI_ENV"),
		Service: v.Get("LOKI_SERVICE"),
	}, v.File, nil
}

// NormalizeURL deja sólo el origen. La URL que reparte Grafana Cloud suele venir con el path de la API
// pegado (`.../loki/api/v1/query_range`); si no se recorta, cada pedido va a una ruta que no existe.
func NormalizeURL(s string) string {
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

var localHost = regexp.MustCompile(`(^|//)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:|/|$)`)

// IsLocal: un Loki de esta máquina no pide credenciales.
func IsLocal(u string) bool { return localHost.MatchString(strings.TrimSpace(u)) }

// Missing dice por qué no se puede leer, o vacío si se puede.
//
// ⚠ LA TERCERA GUARDA ES LA IMPORTANTE, y venía del harness: el ambiente `local` leyendo un Loki REMOTO
// es peor que no tener logs. Contra la base local leés lo que TU corrida escribió; contra un Loki remoto
// tu corrida local no escribió nada, así que leerías la de otra persona cuyo id de solicitud coincide. Y
// coincide, porque la base local es un dump de dev y las dos secuencias avanzan juntas (medido el
// 2026-08-04: local en 464664, dev en 464620). Un forense que muestra con seguridad la solicitud de otro
// es un diagnóstico falso, no un dato incompleto.
func (c Config) Missing() string {
	if c.URL == "" {
		return "falta LOKI_URL"
	}
	if !IsLocal(c.URL) && (c.User == "" || c.Token == "") {
		return "faltan LOKI_USER/LOKI_TOKEN"
	}
	if c.Target == "local" && !IsLocal(c.URL) {
		return "el ambiente local está apuntando a un Loki REMOTO (" + c.URL + "): tu corrida local no escribió ahí, " +
			"y los ids de solicitud se solapan con dev (la base local es su dump), así que mostraría la de otro. " +
			"Levantá el Loki local: harness/bin/loki-local start"
	}
	return ""
}

// Auth es la forma de autenticar: `basic:<user>` para Grafana Cloud, que exige el par `<ID de
// instancia>:<token>` (un Bearer pelado lo rechaza con `legacy auth cannot be upgraded`), o `bearer`.
func (c Config) Auth() string {
	if c.User != "" {
		return "basic:" + c.User
	}
	return "bearer"
}

// Client habla con un Loki. `Base` y `AuthMode` salen de la configuración, y se pueden cambiar para
// probar combinaciones (lo hace la sonda de acceso del trazador).
type Client struct {
	HTTP     *http.Client
	Config   Config
	Base     string
	AuthMode string
}

// New arma el cliente de un ambiente.
func New(c Config, timeout time.Duration) *Client {
	return &Client{HTTP: &http.Client{Timeout: timeout}, Config: c, Base: c.URL, AuthMode: c.Auth()}
}

// Get pega a un path de la API de Loki y devuelve status + cuerpo. El cuerpo se lee siempre: los errores
// de Loki vienen con texto y son la mitad del diagnóstico.
func (cl *Client) Get(path string, params url.Values) (int, []byte, error) {
	u := cl.Base + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return 0, nil, err
	}
	// Sin token no se manda cabecera: un Loki local rechaza una autorización vacía en vez de ignorarla
	// (lo aprendió el harness).
	switch user, basic := strings.CutPrefix(cl.AuthMode, "basic:"); {
	case cl.Config.Token == "":
	case basic:
		req.SetBasicAuth(user, cl.Config.Token)
	default:
		req.Header.Set("Authorization", "Bearer "+cl.Config.Token)
	}
	if cl.Config.Tenant != "" {
		req.Header.Set("X-Scope-OrgID", cl.Config.Tenant)
	}
	resp, err := cl.HTTP.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, body, nil
}

// API pega a un endpoint de lectura de la API de Loki (`query_range`, `labels`, `label/<x>/values`…), sin
// el prefijo: la ruta de la API se escribe una sola vez, acá.
func (cl *Client) API(endpoint string, params url.Values) (int, []byte, error) {
	return cl.Get(apiPrefix+endpoint, params)
}

const apiPrefix = "/loki/api/v1/"

// Stream es un flujo de líneas con sus etiquetas; cada valor es (timestamp en ns, línea).
type Stream struct {
	Labels map[string]string `json:"stream"`
	Values [][2]string       `json:"values"`
}

// Range corre un `query_range` de líneas. `direction` es `forward` o `backward`.
func (cl *Client) Range(logql string, start, end time.Time, limit int, direction string) ([]Stream, error) {
	status, body, err := cl.API("query_range", url.Values{
		"query": {logql}, "start": {fmt.Sprint(start.UnixNano())}, "end": {fmt.Sprint(end.UnixNano())},
		"limit": {fmt.Sprint(limit)}, "direction": {direction},
	})
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("%s", Explain(status, body))
	}
	var r struct {
		Data struct {
			ResultType string   `json:"resultType"`
			Result     []Stream `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("la respuesta de query_range no se pudo leer: %w", err)
	}
	return r.Data.Result, nil
}

// LabelValues trae los valores de una etiqueta en la ventana, o nada si no se pudo pedir. Nada NO
// significa que la etiqueta no tenga valores: quien la use para comprobar un filtro tiene que tratar la
// lista vacía como «no hay contra qué comprobar».
func (cl *Client) LabelValues(label string, start, end time.Time) []string {
	status, body, err := cl.API("label/"+url.PathEscape(label)+"/values", url.Values{
		"start": {fmt.Sprint(start.UnixNano())}, "end": {fmt.Sprint(end.UnixNano())},
	})
	if err != nil || status != http.StatusOK {
		return nil
	}
	var r struct {
		Data []string `json:"data"`
	}
	if json.Unmarshal(body, &r) != nil {
		return nil
	}
	return r.Data
}

// NeedsInstanceID reconoce el mensaje con el que Grafana Cloud rechaza un Bearer pelado. Es la pista más
// valiosa y la más engañosa: dice "host is not found" pero el host está bien.
func NeedsInstanceID(body []byte) bool {
	return strings.Contains(string(body), "legacy auth cannot be upgraded")
}

func trim(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) > n {
		return string([]rune(s)[:n]) + "…"
	}
	return s
}

// Explain traduce un status a qué hay que hacer al respecto: cada código apunta a un dato distinto mal
// puesto, y es la parte que ahorra el viaje a la documentación.
func Explain(status int, body []byte) string {
	snippet := trim(string(body), 180)
	switch {
	case NeedsInstanceID(body):
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
