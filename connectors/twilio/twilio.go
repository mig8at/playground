// Package twilio es la conexión con Twilio, y sólo LEE: la cuenta, los templates de WhatsApp con su
// aprobación de Meta y qué alcanza cada credencial. No crea templates ni manda mensajes — eso cuesta
// plata y le llega a una persona, y hoy se hace a mano con la receta del README de al lado.
//
// Hasta el 2026-09-24 era `twilio/probe.py`, con su propio `.env`; se portó al conector y las
// credenciales pasaron a `connectors/.env`.
package twilio

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"creditop/playground/connectors/env"
)

// Los hosts reales. Un GET sólo sale hacia un host de Twilio: la credencial viaja en cada pedido, y un
// `pg twilio get --url` apuntado a otro lado la regalaría.
const (
	CoreAPI    = "https://api.twilio.com"
	ContentAPI = "https://content.twilio.com"
	IAM        = "https://iam.twilio.com"
	// maxBody es el tope de una respuesta: más que esto es un error, no algo que se lee a medias.
	maxBody = 5_000_000
)

// Config son las tres credenciales que puede haber. Cada una alcanza cosas distintas (README §2).
type Config struct {
	AccountSID, AuthToken  string // AC… + token: acceso completo a la subcuenta
	APIKey, APISecret      string // SK… + secret: una API Key de esa misma cuenta
	ClientID, ClientSecret string // OQ… + FK…: la app OAuth de la organización
}

// LoadConfig lee `TWILIO_*` del proceso o de `connectors/.env` (el proceso gana).
func LoadConfig() (Config, error) {
	v, err := env.LoadShared()
	if err != nil {
		return Config{}, err
	}
	return Config{
		AccountSID: v.Get("TWILIO_SID"), AuthToken: v.Get("TWILIO_TOKEN"),
		APIKey: v.Get("TWILIO_API_KEY"), APISecret: v.Get("TWILIO_API_SECRET"),
		ClientID: v.Get("TWILIO_CLIENT_ID"), ClientSecret: v.Get("TWILIO_CLIENT_SECRET"),
	}, nil
}

// Account es el cliente con la credencial de la cuenta: la que sirve para casi todo.
func (c Config) Account() (*Client, error) {
	if c.AccountSID == "" || c.AuthToken == "" {
		return nil, fmt.Errorf("faltan TWILIO_SID y TWILIO_TOKEN en el entorno o en connectors/.env")
	}
	return newClient(basic(c.AccountSID, c.AuthToken)), nil
}

// Key es el cliente con la API Key.
func (c Config) Key() (*Client, error) {
	if c.APIKey == "" {
		return nil, fmt.Errorf("falta TWILIO_API_KEY (el SID SK… de la clave)")
	}
	if c.APISecret == "" {
		return nil, fmt.Errorf("falta TWILIO_API_SECRET — el valor de «Paso 2 de 2: Copia secreta». " +
			"Twilio lo muestra UNA sola vez; si ya se cerró la pantalla, hay que crear otra key")
	}
	return newClient(basic(c.APIKey, c.APISecret)), nil
}

// OAuth canjea la app OAuth por un token y devuelve el cliente con ese bearer, más el token para leer
// su identidad (`Identity`). ⚠ Esa app autentica pero hoy no tiene permisos: sirve para ver cuáles faltan.
func (c Config) OAuth(ctx context.Context) (*Client, string, error) {
	if c.ClientID == "" || c.ClientSecret == "" {
		return nil, "", fmt.Errorf("faltan TWILIO_CLIENT_ID y TWILIO_CLIENT_SECRET en el entorno o en connectors/.env")
	}
	return oauth(ctx, newClient(""), IAM, c.ClientID, c.ClientSecret)
}

func oauth(ctx context.Context, cl *Client, iam, id, secret string) (*Client, string, error) {
	form := url.Values{"grant_type": {"client_credentials"}, "client_id": {id}, "client_secret": {secret}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, iam+"/v1/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	status, body, err := cl.do(req)
	if err != nil {
		return nil, "", err
	}
	m, _ := body.(map[string]any)
	tok, _ := m["access_token"].(string)
	if status != 200 && status != 201 || tok == "" {
		return nil, "", fmt.Errorf("el canje del token OAuth falló (HTTP %d): %s", status, Why(status, body))
	}
	out := newClient("Bearer " + tok)
	out.override = cl.override
	return out, tok, nil
}

func basic(user, pass string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
}

// Client hace GETs a Twilio con una credencial. No sigue redirecciones: una redirección es una
// respuesta, no un lugar al que mandarle la credencial.
type Client struct {
	auth string
	http *http.Client
	// override cambia un host real por otro (las pruebas lo apuntan a un servidor falso).
	override map[string]string
}

func newClient(auth string) *Client {
	return &Client{auth: auth, http: &http.Client{
		Timeout:       20 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// URL arma la dirección de `path` en `host` (uno de los hosts de arriba).
func (c *Client) URL(host, path string) string {
	if o, ok := c.override[host]; ok {
		host = o
	}
	return host + path
}

// Get pide `u` y devuelve el código y el cuerpo (un JSON decodificado, o el texto si no lo es). Un 4xx
// no es un error: es una respuesta, y la de Twilio dice qué permiso falta (`Why`).
func (c *Client) Get(ctx context.Context, u string) (int, any, error) {
	if !c.allowed(u) {
		return 0, nil, fmt.Errorf("sólo se le pide a hosts de Twilio (*.twilio.com por https): %q no lo es", u)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, nil, err
	}
	return c.do(req)
}

func (c *Client) allowed(u string) bool {
	for _, o := range c.override {
		if strings.HasPrefix(u, o+"/") {
			return true
		}
	}
	p, err := url.Parse(u)
	return err == nil && p.Scheme == "https" && (p.Host == "twilio.com" || strings.HasSuffix(p.Host, ".twilio.com"))
}

func (c *Client) do(req *http.Request) (int, any, error) {
	if c.auth != "" {
		req.Header.Set("Authorization", c.auth)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		// ⚠ El error de net/http trae la URL, nunca la cabecera: se puede mostrar.
		return 0, nil, fmt.Errorf("red: %v", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("leyendo la respuesta: %v", err)
	}
	if len(raw) > maxBody {
		return resp.StatusCode, nil, fmt.Errorf("la respuesta pasa de %d bytes", maxBody)
	}
	var body any
	if json.Unmarshal(raw, &body) != nil {
		s := string(raw)
		if len(s) > 120 {
			s = s[:120]
		}
		return resp.StatusCode, s, nil
	}
	return resp.StatusCode, body, nil
}

// Why resume una respuesta en una línea. El truco que vale la herramienta: cuando falta un permiso, el
// 401 de Twilio dice su NOMBRE exacto (`twilio/messaging/content-templates/list`), y eso es lo que se
// marca en la consola, sin adivinar.
func Why(status int, body any) string {
	if s, ok := body.(string); ok {
		return s
	}
	m, _ := body.(map[string]any)
	msg, _ := m["message"].(string)
	if i := strings.Index(msg, "required permission "); i >= 0 {
		perm := msg[i+len("required permission "):]
		if j := strings.Index(perm, " is missing"); j >= 0 {
			perm = perm[:j]
		}
		return "FALTA  " + perm
	}
	if status != 200 {
		if msg != "" {
			return msg
		}
		raw, _ := json.Marshal(body)
		if len(raw) > 150 {
			raw = raw[:150]
		}
		return string(raw)
	}
	for _, k := range []string{"accounts", "services", "contents", "incoming_phone_numbers", "messages", "usage_records", "content", "flows", "sinks", "events", "results"} {
		if list, ok := m[k].([]any); ok {
			return fmt.Sprintf("%d items", len(list))
		}
	}
	return "OK"
}

// AccountInfo es una cuenta que la credencial ve.
type AccountInfo struct {
	SID, Status, Type, FriendlyName, Owner string
}

// Accounts son las cuentas que ve la credencial: la propia, y si es una subcuenta, su padre en `Owner`.
func (c *Client) Accounts(ctx context.Context) ([]AccountInfo, error) {
	status, body, err := c.Get(ctx, c.URL(CoreAPI, "/2010-04-01/Accounts.json"))
	if err != nil {
		return nil, err
	}
	if status != 200 {
		return nil, fmt.Errorf("la credencial no autentica (HTTP %d): %s", status, Why(status, body))
	}
	m, _ := body.(map[string]any)
	list, _ := m["accounts"].([]any)
	var out []AccountInfo
	for _, a := range list {
		am, _ := a.(map[string]any)
		out = append(out, AccountInfo{SID: s(am["sid"]), Status: s(am["status"]), Type: s(am["type"]),
			FriendlyName: s(am["friendly_name"]), Owner: s(am["owner_account_sid"])})
	}
	return out, nil
}

// Template es un content template (HX…) con el estado de su aprobación de WhatsApp.
type Template struct {
	SID, Name, Language string
	Types               []string
	// Status: unsubmitted (creado, sin mandar a Meta) · received/pending (en revisión) · approved
	// (sirve para INICIAR una conversación) · rejected (mirar RejectionReason).
	Status, Category, RejectionReason string
}

// Templates son los templates de la cuenta con su aprobación. ⚠ Son POR CUENTA: los de otra no se ven.
func (c *Client) Templates(ctx context.Context) ([]Template, error) {
	status, body, err := c.Get(ctx, c.URL(ContentAPI, "/v1/ContentAndApprovals?PageSize=50"))
	if err != nil {
		return nil, err
	}
	if status != 200 {
		return nil, fmt.Errorf("HTTP %d: %s", status, Why(status, body))
	}
	m, _ := body.(map[string]any)
	list, _ := m["contents"].([]any)
	var out []Template
	for _, it := range list {
		t, _ := it.(map[string]any)
		ap, _ := t["approval_requests"].(map[string]any)
		st := s(ap["status"])
		if st == "" {
			st = "unsubmitted"
		}
		var kinds []string
		if types, ok := t["types"].(map[string]any); ok {
			for k := range types {
				kinds = append(kinds, k)
			}
		}
		sortStrings(kinds)
		out = append(out, Template{SID: s(t["sid"]), Name: s(t["friendly_name"]), Language: s(t["language"]),
			Types: kinds, Status: st, Category: s(ap["category"]), RejectionReason: s(ap["rejection_reason"])})
	}
	return out, nil
}

// Probe es un GET de inventario: qué alcanza la credencial en un producto.
type Probe struct {
	Label  string `json:"label"`
	Status int    `json:"status"`
	Result string `json:"result"`
}

// Inventory pide la lista de cada producto con la credencial del cliente. ⚠ De los mensajes sólo el
// conteo: sus cuerpos traen OTPs y teléfonos de clientes.
func (c *Client) Inventory(ctx context.Context, account string) []Probe {
	acct := "/2010-04-01/Accounts/" + account
	checks := []struct{ label, host, path string }{
		{"content templates (HX…)", ContentAPI, "/v1/Content?PageSize=50"},
		{"templates + aprobación de Meta", ContentAPI, "/v1/ContentAndApprovals?PageSize=50"},
		{"messaging services (MG…)", "https://messaging.twilio.com", "/v1/Services?PageSize=50"},
		{"números propios", CoreAPI, acct + "/IncomingPhoneNumbers.json?PageSize=50"},
		{"mensajes (sólo el conteo)", CoreAPI, acct + "/Messages.json?PageSize=5"},
		{"Verify services", "https://verify.twilio.com", "/v2/Services?PageSize=20"},
		{"consumo del mes pasado", CoreAPI, acct + "/Usage/Records/LastMonth.json?PageSize=5"},
	}
	return c.probe(ctx, checks)
}

// Products es lo que pediría cada producto con el bearer OAuth: el 401 dice el permiso que falta.
func (c *Client) Products(ctx context.Context) []Probe {
	return c.probe(ctx, []struct{ label, host, path string }{
		{"content templates (HX…)", ContentAPI, "/v1/Content"},
		{"messaging services (MG…)", "https://messaging.twilio.com", "/v1/Services"},
		// Una cuenta inventada a propósito: la pregunta es qué permiso pide, no qué hay.
		{"mensajes", CoreAPI, "/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json"},
		{"Verify", "https://verify.twilio.com", "/v2/Services"},
		{"Monitor (eventos de auditoría)", "https://monitor.twilio.com", "/v1/Events"},
		{"Studio", "https://studio.twilio.com", "/v2/Flows"},
		{"Event Streams", "https://events.twilio.com", "/v1/Sinks"},
		{"Phone Numbers (compliance)", "https://numbers.twilio.com", "/v2/RegulatoryCompliance/Bundles"},
	})
}

func (c *Client) probe(ctx context.Context, checks []struct{ label, host, path string }) []Probe {
	out := make([]Probe, 0, len(checks))
	for _, ch := range checks {
		status, body, err := c.Get(ctx, c.URL(ch.host, ch.path))
		res := Why(status, body)
		if err != nil {
			res = err.Error()
		}
		out = append(out, Probe{Label: ch.label, Status: status, Result: res})
	}
	return out
}

// Identity es lo que dice el JWT de la app OAuth, sin el token.
type Identity struct {
	App, Organization, Audience, Region, Scope string
	Expires                                    time.Time
	LifetimeSeconds                            int64
}

// IdentityOf lee el payload del JWT (no verifica la firma: sólo lo muestra).
func IdentityOf(token string) (Identity, error) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return Identity{}, fmt.Errorf("el token no es un JWT")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return Identity{}, fmt.Errorf("el payload del JWT no es base64")
	}
	var p struct {
		Sub string `json:"sub"`
		Act struct {
			Sub string `json:"sub"`
		} `json:"act"`
		Aud    any    `json:"aud"`
		Region string `json:"urn:tw:rgn"`
		Scope  string `json:"scope"`
		Exp    int64  `json:"exp"`
		Iat    int64  `json:"iat"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return Identity{}, fmt.Errorf("el payload del JWT no es JSON")
	}
	last := func(s string) string { return s[strings.LastIndex(s, ":")+1:] }
	return Identity{App: last(p.Sub), Organization: last(p.Act.Sub), Audience: fmt.Sprint(p.Aud), Region: p.Region,
		Scope: p.Scope, Expires: time.Unix(p.Exp, 0).UTC(), LifetimeSeconds: p.Exp - p.Iat}, nil
}

// IAMChecks son los GETs de identidad de la organización. ⚠ La ruta va SIN /v1, y `Scope` quiere el SID
// crudo (`OR…`), no el TRN (`trn:us1:iam:…`): con el TRN da 400.
func (c *Client) IAMChecks(ctx context.Context, org string) []Probe {
	iam := "https://preview-iam.twilio.com/Organizations/" + org
	return c.probe(ctx, []struct{ label, host, path string }{
		{"RoleAssignments?Scope=<ORG>", iam, "/RoleAssignments?Scope=" + url.QueryEscape(org)},
		{"Accounts (cuentas de la organización)", iam, "/Accounts"},
		{"api/2010-04-01/Accounts.json", CoreAPI, "/2010-04-01/Accounts.json"},
	})
}

func s(v any) string {
	str, _ := v.(string)
	return str
}

func sortStrings(a []string) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}
