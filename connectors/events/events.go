// Package events contesta «qué VIO el cliente en el navegador, en este ambiente»: los eventos de PostHog.
// Es el único lugar del playground que sabe qué proyecto y qué filtro atienden cada ambiente, y cuáles
// no escriben nada.
//
//	local            → no escribe: `getServerPostHog()` devuelve null con APP_ENV=local
//	dev              → no escribe: el target sirve el front LOCAL contra el backend de dev (medido el
//	                   2026-09-02: ni un evento con ambiente `dev` en 7 días)
//	qa · staging     → `properties.environment = staging` (los dos deploys escriben lo mismo)
//	prod             → `properties.environment = production`
//
// UN SOLO PROYECTO para todos (238530 «Loan Request»), separados por esa propiedad. Hasta el 2026-09-24
// el trazador y el harness tenían cada uno su cliente, sus claves y sus reglas: las de qué ambiente no
// escribe sólo las sabía el harness.
//
// ⚠ EL FILTRO DE AMBIENTE NO ALCANZA, y es una trampa del sistema, no de esta herramienta: prod y qa
// COMPARTEN EL RANGO DE IDS y el `distinct_id` (`loan_request_<ureq>`) no lleva ambiente, así que una
// solicitud de qa y su homónima de prod son para PostHog la misma persona. Quien pregunta por una
// solicitud tiene que acotar además por HORA.
//
// SÓLO LECTURA: HogQL por `POST /query/`, que es una consulta, no una escritura. No se manda un evento.
package events

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// DefaultAPI: la API de LECTURA. La de ingesta vive en otro subdominio (`us.i.posthog.com`), y
// confundirlas da un 404 que parece «no tengo permiso».
const DefaultAPI = "https://us.posthog.com"

// Config es a qué PostHog preguntarle en un ambiente.
type Config struct {
	Target string
	API    string
	// Token es una Personal API key (`phx_`) con lectura de queries. ⚠ NO el `phc_` del snippet del
	// front: ése es de ESCRITURA y da 401.
	Token string
	// Project es el id NUMÉRICO del proyecto.
	Project string
	// Env es el valor de `properties.environment` de este ambiente.
	Env string
}

// LoadConfig arma la configuración de un ambiente desde `connectors/.env.<target>`. Se acepta el host
// que usa el wizard (`VITE_PUBLIC_POSTHOG_HOST`), que es el de ingesta: NormalizeAPI lo corrige.
func LoadConfig(target string) (Config, string, error) {
	if !ValidTarget(target) {
		return Config{}, "", fmt.Errorf("ambiente %q no permitido (%s)", target, strings.Join(Targets, " · "))
	}
	v, err := env.Load(target)
	if err != nil {
		return Config{}, "", err
	}
	api := NormalizeAPI(v.Get("POSTHOG_API", "POSTHOG_HOST", "VITE_PUBLIC_POSTHOG_HOST"))
	if api == "" {
		api = DefaultAPI
	}
	return Config{
		Target: target, API: api,
		Token:   v.Get("POSTHOG_TOKEN", "POSTHOG_PERSONAL_API_KEY"),
		Project: v.Get("POSTHOG_PROJECT", "POSTHOG_PROJECT_ID"),
		Env:     v.Get("POSTHOG_ENV"),
	}, v.File, nil
}

// NormalizeAPI acepta lo que uno tenga a mano —el host de ingesta del deploy del wizard, una URL con path,
// o nada— y devuelve el origen de la API de lectura. Sin esto, pegar `VITE_PUBLIC_POSTHOG_HOST` tal cual
// (que es lo natural) falla con 404 en todos los pasos.
func NormalizeAPI(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if !strings.Contains(v, "://") {
		v = "https://" + v
	}
	v = strings.TrimRight(v, "/")
	if i := strings.Index(v[strings.Index(v, "://")+3:], "/"); i >= 0 {
		v = v[:strings.Index(v, "://")+3+i]
	}
	v = strings.Replace(v, "://us.i.posthog.com", "://us.posthog.com", 1)
	v = strings.Replace(v, "://eu.i.posthog.com", "://eu.posthog.com", 1)
	return v
}

// Missing dice por qué no se puede consultar este ambiente, o vacío. Un silencio se lee como «no pasó
// nada», así que cada motivo dice cuál es.
func (c Config) Missing() string {
	switch c.Target {
	case "local":
		return "el front local no escribe en PostHog (APP_ENV=local apaga getServerPostHog)"
	case "dev":
		return "el target dev sirve el front LOCAL, que no escribe en PostHog — los ambientes que escriben son staging (qa y staging) y production"
	}
	switch {
	case c.Token == "":
		return "falta POSTHOG_TOKEN (una PERSONAL API KEY phx_, no el phc_ del front)"
	case !strings.HasPrefix(c.Token, "phx_"):
		return "POSTHOG_TOKEN no es una personal API key (phx_): el phc_ del front es de escritura y da 401"
	case c.Env == "":
		return "falta POSTHOG_ENV: sin ambiente, una solicitud homónima de prod contamina la respuesta"
	}
	return ""
}

// Client habla con la API de lectura de PostHog.
type Client struct {
	HTTP   *http.Client
	Config Config
}

// New arma el cliente de un ambiente.
func New(c Config, timeout time.Duration) *Client {
	return &Client{HTTP: &http.Client{Timeout: timeout}, Config: c}
}

// Request hace UNA llamada y devuelve el cuerpo crudo junto al status. Devolver el cuerpo incluso en error
// es deliberado: los 403 de PostHog traen adentro los scopes que al token le faltan.
func (cl *Client) Request(method, path string, body []byte) (int, []byte, error) {
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, cl.Config.API+path, r)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cl.Config.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := cl.HTTP.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, raw, err
}

// Clip recorta un cuerpo para un mensaje de error.
func Clip(b []byte, n int) string {
	s := strings.Join(strings.Fields(string(b)), " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// HogQL corre una consulta y devuelve columnas + filas. La respuesta trae los valores como arrays
// posicionales, así que las columnas son la única forma de saber qué es cada cosa.
func (cl *Client) HogQL(query string) ([]string, [][]any, error) {
	body, _ := json.Marshal(map[string]any{"query": map[string]any{"kind": "HogQLQuery", "query": query}})
	status, raw, err := cl.Request("POST", "/api/projects/"+cl.Config.Project+"/query/", body)
	if err != nil {
		return nil, nil, err
	}
	if status != 200 {
		return nil, nil, fmt.Errorf("HTTP %d · %s", status, Clip(raw, 300))
	}
	var out struct {
		Columns []string `json:"columns"`
		Results [][]any  `json:"results"`
		Error   string   `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, nil, fmt.Errorf("respuesta ilegible: %v · %s", err, Clip(raw, 200))
	}
	if out.Error != "" {
		return nil, nil, fmt.Errorf("%s", out.Error)
	}
	return out.Columns, out.Results, nil
}

// Escape escapa un texto para una cadena de HogQL.
func Escape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s)
}

// EnvFilter es el `AND` de ambiente, o vacío. Se decide en UN lugar porque un filtro que se aplica en
// unas consultas y no en otras produce números que no cuadran entre pasos.
func (c Config) EnvFilter() string {
	if c.Env == "" {
		return ""
	}
	return fmt.Sprintf(" AND properties.environment = '%s'", Escape(c.Env))
}

// EnvFilterTolerant es el MISMO filtro tolerando los eventos que no traen la propiedad. No es cosmético:
// los automáticos de posthog-js ($pageview, $autocapture, $identify) no llevan `environment` —en prod
// son 256.821 de 353.134—, y con el estricto el recorrido de una solicitud perdía justo lo que uno viene a
// ver. Se puede aflojar porque ahí lo que fija a la persona es el `distinct_id` (más la hora).
func (c Config) EnvFilterTolerant() string {
	if c.Env == "" {
		return ""
	}
	return fmt.Sprintf(" AND (properties.environment = '%s' OR properties.environment IS NULL)", Escape(c.Env))
}
