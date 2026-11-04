package main

/* SHOPIFY DEMO: una tienda Shopify de mentira que usa la app de pagos de Creditop (el host de temp-shopify) como si
 * fuera Shopify, para probar el círculo entero sin una tienda real:
 *
 *   la tienda demo ──POST /payments/session──► el host de la app ──payment-link──► Creditop ──► el wizard
 *   «Avisar como Creditop» ──POST <webhook_url firmado>──► el host ──paymentSessionResolve──► el Shopify falso
 *                                                                       (acá: el pedido queda Pagado)
 *
 * El host no tiene por qué estar en esta máquina: SHOPIFY_DEMO_HOST_URL es su dirección, un servicio con nombre del
 * playground (`https://…/s/shopify.ecommerce.miguel.com`) que su dueño sirve desde la suya con `playground serve`. Y para
 * que el host le avise a ESTE Shopify falso, esta máquina publica el suyo con otro nombre (SHOPIFY_DEMO_CHANNEL_URL), que
 * el dueño del host pone en su SHOPIFY_PAYMENTS_API_URL. En ~/playground/team/services.json, y `playground serve`:
 *
 *   [{ "alias": "shopify-falso.ecommerce", "to": "http://127.0.0.1:5187" }]
 *
 * «Avisar como Creditop» hace lo que hace Creditop cuando la solicitud termina: le manda al `webhook_url` firmado del
 * pedido (lo lee de la base del ambiente, SHOPIFY_DEMO_TARGET) el estado elegido. Cuando el host tenga un dominio que el
 * backend alcance, ese aviso llega solo y el botón sobra.
 *
 * Los pedidos de la demo viven en `.data/shopify-demo.json` (fuera de git): lo que Shopify guardaría. */

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type demoEvent struct {
	At     string `json:"at"`
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

type demoItem struct {
	Title string `json:"title"`
	Qty   int    `json:"qty"`
	Price int    `json:"price"`
}

// demoExchange es una petición HTTP de la demo, en cualquier sentido: lo que se ve en el panel derecho.
type demoExchange struct {
	At       string          `json:"at"`
	Dir      string          `json:"dir"` // out: la demo llama · in: le llaman a la demo
	Kind     string          `json:"kind"`
	Method   string          `json:"method"`
	URL      string          `json:"url"`
	Status   int             `json:"status"`
	Ms       int64           `json:"ms"`
	Order    string          `json:"order,omitempty"`
	Request  json.RawMessage `json:"request,omitempty"`
	Response json.RawMessage `json:"response,omitempty"`
	Text     string          `json:"text,omitempty"`
	Error    string          `json:"error,omitempty"`
}

var (
	demoLogMu sync.Mutex
	demoLog   []demoExchange
)

// demoRecord guarda un intercambio (los últimos 200, en memoria).
func demoRecord(e demoExchange) {
	e.At = time.Now().Format(time.RFC3339Nano)
	demoLogMu.Lock()
	defer demoLogMu.Unlock()
	demoLog = append(demoLog, e)
	if len(demoLog) > 200 {
		demoLog = demoLog[len(demoLog)-200:]
	}
}

func rawJSON(v any) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return data
}

type demoOrder struct {
	ID          string      `json:"id"`
	Items       []demoItem  `json:"items,omitempty"`
	GID         string      `json:"gid"`
	Amount      string      `json:"amount"`
	Email       string      `json:"email"`
	Phone       string      `json:"phone"`
	FirstName   string      `json:"firstName"`
	LastName    string      `json:"lastName"`
	Status      string      `json:"status"`
	RedirectURL string      `json:"redirectUrl"`
	CreatedAt   string      `json:"createdAt"`
	Events      []demoEvent `json:"events"`
}

type demoConfig struct {
	Playground string `json:"playground"`
	HostURL    string `json:"hostUrl"`
	ChannelURL string `json:"channelUrl"`
	Shop       string `json:"shop"`
	Target     string `json:"target"`
	PublicURL  string `json:"publicUrl"`
	// SÓLO LOCAL: la dirección con que el host se ANUNCIA (su SHOPIFY_APP_URL), si no es la misma por la que se llega.
	// Pasa con un playground local en http: payment-link exige https, así que el host se anuncia con https y se le
	// llega por http. Los enlaces que el host devuelve se traducen a HostURL. En producción son la misma y sobra.
	HostAnnounced string `json:"hostAnnounced,omitempty"`
}

// sharedURL es la dirección con que `npm run dev` publicó este Shopify falso, si lo está sirviendo. El .env gana.
func sharedURL() string {
	if s := readDemoShare(); s != nil && s.State == "serving" {
		return s.URL
	}
	return ""
}

// reachable traduce un enlace del host (anunciado) a la dirección por la que de verdad se le llega.
func (c demoConfig) reachable(link string) string {
	if c.HostAnnounced != "" && c.HostURL != "" && strings.HasPrefix(link, c.HostAnnounced) {
		return c.HostURL + strings.TrimPrefix(link, c.HostAnnounced)
	}
	return link
}

// demoShare es lo que dejó `npm run dev` al publicar este Shopify falso en el playground (scripts/share.mjs):
// { state, name, url, hint }. Sin archivo, nada.
type demoShare struct {
	State      string `json:"state"`
	Name       string `json:"name,omitempty"`
	URL        string `json:"url,omitempty"`
	Hint       string `json:"hint,omitempty"`
	Email      string `json:"email,omitempty"`
	Playground string `json:"playground,omitempty"`
	At         string `json:"at,omitempty"`
}

func readDemoShare() *demoShare {
	data, err := os.ReadFile(filepath.Join(appRoot(), ".data", "shopify-share.json"))
	if err != nil {
		return nil
	}
	var s demoShare
	if json.Unmarshal(data, &s) != nil {
		return nil
	}
	return &s
}

func shopifyDemoConfig() demoConfig {
	or := func(v, d string) string {
		if v == "" {
			return d
		}
		return v
	}
	return demoConfig{
		Playground:    strings.TrimRight(or(env("SHOPIFY_DEMO_PLAYGROUND"), "https://playground.creditop.com"), "/"),
		HostURL:       strings.TrimRight(env("SHOPIFY_DEMO_HOST_URL"), "/"),
		ChannelURL:    strings.TrimRight(or(env("SHOPIFY_DEMO_CHANNEL_URL"), sharedURL()), "/"),
		Shop:          or(env("SHOPIFY_DEMO_SHOP"), "creditop-demo.myshopify.com"),
		Target:        or(env("SHOPIFY_DEMO_TARGET"), "qa"),
		PublicURL:     strings.TrimRight(or(env("SHOPIFY_DEMO_PUBLIC_URL"), "http://localhost:5186"), "/"),
		HostAnnounced: strings.TrimRight(env("SHOPIFY_DEMO_HOST_ANNOUNCED_URL"), "/"),
	}
}

// ── los pedidos, en un archivo ─────────────────────────────────────────────────────────────────────────

var demoMu sync.Mutex

func demoFile() string { return filepath.Join(appRoot(), ".data", "shopify-demo.json") }

func demoLoad() []*demoOrder {
	var orders []*demoOrder
	if data, err := os.ReadFile(demoFile()); err == nil {
		_ = json.Unmarshal(data, &orders)
	}
	return orders
}

func demoSave(orders []*demoOrder) error {
	if err := os.MkdirAll(filepath.Dir(demoFile()), 0o700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(orders, "", "  ")
	tmp := demoFile() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, demoFile())
}

// demoUpdate aplica `fn` al pedido `id` (o al de `gid`) y lo guarda. Devuelve el pedido, o nil si no existe.
func demoUpdate(match func(*demoOrder) bool, fn func(*demoOrder)) *demoOrder {
	demoMu.Lock()
	defer demoMu.Unlock()
	orders := demoLoad()
	for _, o := range orders {
		if match(o) {
			fn(o)
			_ = demoSave(orders)
			return o
		}
	}
	return nil
}

func (o *demoOrder) log(kind, detail string) {
	o.Events = append(o.Events, demoEvent{At: time.Now().Format(time.RFC3339), Kind: kind, Detail: detail})
}

// El id de una sesión de pago de la demo: dígitos, porque la base sólo se consulta con argumentos numéricos.
func demoID() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000_000))
	return fmt.Sprintf("%d%09d", time.Now().Unix(), n.Int64())
}

// ── las llamadas afuera ────────────────────────────────────────────────────────────────────────────────

var demoClient = &http.Client{
	Timeout: 55 * time.Second,
	// Una redirección se devuelve, no se sigue: la vuelta del comprador es justamente una redirección.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

type demoReply struct {
	Status   int             `json:"status"`
	Body     json.RawMessage `json:"body,omitempty"`
	Text     string          `json:"text,omitempty"`
	Location string          `json:"location,omitempty"`
	Ms       int64           `json:"ms"`
	Error    string          `json:"error,omitempty"`
}

func demoCall(method, rawURL string, headers map[string]string, body any) demoReply {
	started := time.Now()
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, rawURL, reader)
	if err != nil {
		return demoReply{Error: err.Error()}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := demoClient.Do(req)
	if err != nil {
		return demoReply{Error: err.Error(), Ms: time.Since(started).Milliseconds()}
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 256*1024))
	r := demoReply{Status: res.StatusCode, Location: res.Header.Get("Location"), Ms: time.Since(started).Milliseconds()}
	if json.Valid(data) && len(data) > 0 {
		r.Body = data
	} else if len(data) > 0 {
		r.Text = string(data[:min(len(data), 300)])
	}
	return r
}

// ── el estado: ¿llego a todo? ──────────────────────────────────────────────────────────────────────────

type demoCheck struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

var demoNonce = demoID()

func demoChecks(c demoConfig) []demoCheck {
	checks := []demoCheck{}
	r := demoCall("GET", c.Playground+"/health", nil, nil)
	checks = append(checks, demoCheck{Name: "playground", URL: c.Playground, OK: r.Status == 200,
		Detail: map[bool]string{true: fmt.Sprintf("prendido (%d ms)", r.Ms), false: "no contesta: " + or2(r.Error, fmt.Sprint(r.Status))}[r.Status == 200]})

	if c.HostURL == "" {
		checks = append(checks, demoCheck{Name: "host de la app", OK: false, Detail: "falta SHOPIFY_DEMO_HOST_URL en el .env: la dirección del host (su canal en modo servicio)"})
	} else {
		r := demoCall("GET", c.HostURL+"/", nil, nil)
		detail := fmt.Sprintf("contesta (%d ms)", r.Ms)
		switch {
		case r.Error != "":
			detail = "no se llega: " + r.Error
		case r.Status == 503:
			detail = "el canal existe pero nadie lo sirve: su dueño tiene que correr `playground hooks listen`"
		case r.Status == 404:
			detail = "el canal no existe o venció: hay que abrir otro (`playground hooks new … --serve`)"
		case r.Status != 200:
			detail = fmt.Sprintf("contestó %d", r.Status)
		}
		checks = append(checks, demoCheck{Name: "host de la app", URL: c.HostURL, OK: r.Status == 200, Detail: detail})
	}

	if c.ChannelURL == "" {
		detail := "todavía no está publicado en el playground: lo publica `npm run dev` solo"
		if s := readDemoShare(); s != nil && s.Hint != "" {
			detail = "no está publicado: " + s.Hint
		}
		checks = append(checks, demoCheck{Name: "este Shopify falso", OK: false, Detail: detail})
	} else {
		r := demoCall("GET", c.ChannelURL+"/api/shopify-demo/ping", nil, nil)
		var pong struct {
			Nonce string `json:"nonce"`
		}
		_ = json.Unmarshal(r.Body, &pong)
		ok := r.Status == 200 && pong.Nonce == demoNonce
		detail := fmt.Sprintf("el playground llega a este servidor (%d ms)", r.Ms)
		switch {
		case r.Error != "":
			detail = "no se llega: " + r.Error
		case r.Status == 503:
			detail = "nadie sirve el canal: corré `playground hooks listen <canal> --to http://127.0.0.1:5187`"
		case r.Status == 404:
			detail = "el canal no existe o venció"
		case !ok:
			detail = fmt.Sprintf("contestó %d, pero no este servidor: ¿el listen apunta a otro puerto?", r.Status)
		}
		checks = append(checks, demoCheck{Name: "este Shopify falso", URL: c.ChannelURL, OK: ok, Detail: detail})
	}
	return checks
}

func or2(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// ── el Shopify falso: la Payments Apps API ─────────────────────────────────────────────────────────────

var demoMutation = regexp.MustCompile(`\b(paymentSessionResolve|paymentSessionReject|paymentSessionPending|refundSessionReject)\b`)

func demoPaymentsAPI(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errors": []map[string]string{{"message": "el cuerpo no es JSON"}}})
		return
	}
	m := demoMutation.FindString(in.Query)
	gid, _ := in.Variables["id"].(string)
	shop := r.Header.Get("X-Shopify-Shop-Domain")
	if m == "" {
		writeJSON(w, http.StatusOK, map[string]any{"errors": []map[string]string{{"message": "este Shopify falso sólo atiende resolve, reject y pending"}}})
		return
	}
	next := map[string]string{"paymentSessionResolve": "paid", "paymentSessionReject": "failed", "paymentSessionPending": "pending_payment"}[m]
	c := shopifyDemoConfig()
	o := demoUpdate(func(o *demoOrder) bool { return o.GID == gid }, func(o *demoOrder) {
		detail := fmt.Sprintf("%s desde %s", m, or2(shop, "?"))
		if reason, ok := in.Variables["reason"].(map[string]any); ok {
			detail += fmt.Sprintf(" · %v: %v", reason["code"], reason["merchantMessage"])
		}
		o.log("shopify", detail)
		if next != "" {
			o.Status = next
		}
	})
	var answer map[string]any
	order := ""
	if o == nil {
		answer = map[string]any{"data": map[string]any{m: map[string]any{
			"paymentSession": nil, "userErrors": []map[string]string{{"field": "id", "message": "esa sesión de pago no es de esta tienda demo"}}}}}
	} else {
		order = o.ID
		// A dónde manda Shopify al comprador: la confirmación del pedido (pagado) o el checkout (rechazado).
		redirect := fmt.Sprintf("%s/#/shopify-demo?order=%s", c.PublicURL, url.QueryEscape(o.ID))
		answer = map[string]any{"data": map[string]any{m: map[string]any{
			"paymentSession": map[string]any{"id": gid, "nextAction": map[string]any{"action": "REDIRECT", "context": map[string]any{"redirectUrl": redirect}}},
			"userErrors":     []any{},
		}}}
	}
	demoRecord(demoExchange{Dir: "in", Kind: m + " (app → Shopify)", Method: r.Method, URL: r.URL.Path, Status: http.StatusOK, Order: order,
		Request: rawJSON(map[string]any{"shop": shop, "query": in.Query, "variables": in.Variables}), Response: rawJSON(answer)})
	writeJSON(w, http.StatusOK, answer)
}

// ── la tienda demo ─────────────────────────────────────────────────────────────────────────────────────

func demoCheckout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Amount, Email, Phone, FirstName, LastName string
		Items                                     []demoItem
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "el cuerpo no es JSON"})
		return
	}
	c := shopifyDemoConfig()
	if c.HostURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "falta SHOPIFY_DEMO_HOST_URL en el .env"})
		return
	}
	id := demoID()
	o := &demoOrder{ID: id, GID: "gid://shopify/PaymentSession/" + id, Amount: or2(in.Amount, "100000"), Email: in.Email, Phone: in.Phone,
		FirstName: in.FirstName, LastName: in.LastName, Items: in.Items, Status: "pending", CreatedAt: time.Now().Format(time.RFC3339)}
	// La sesión de pago con la forma que la manda Shopify a `payment_session_url`.
	session := map[string]any{
		"id": o.ID, "gid": o.GID, "group": "grp_" + o.ID, "amount": o.Amount + ".00", "currency": "COP", "test": true,
		"payment_method": map[string]any{"type": "offsite", "data": map[string]any{"cancel_url": fmt.Sprintf("%s/#/shopify-demo?order=%s", c.PublicURL, o.ID)}},
		"customer": map[string]any{"email": o.Email, "phone_number": o.Phone,
			"billing_address": map[string]any{"given_name": o.FirstName, "family_name": o.LastName, "phone_number": o.Phone}},
	}
	reply := demoCall("POST", c.HostURL+"/payments/session", map[string]string{"Shopify-Shop-Domain": c.Shop}, session)
	demoRecord(demoExchange{Dir: "out", Kind: "Sesión de pago (Shopify → app)", Method: "POST", URL: c.HostURL + "/payments/session", Status: reply.Status,
		Ms: reply.Ms, Order: o.ID, Request: rawJSON(session), Response: reply.Body, Text: reply.Text, Error: reply.Error})
	var got struct {
		RedirectURL string `json:"redirect_url"`
		Error       string `json:"error"`
	}
	_ = json.Unmarshal(reply.Body, &got)
	o.RedirectURL = c.reachable(got.RedirectURL)
	o.log("checkout", fmt.Sprintf("POST /payments/session → %s en %d ms", or2(reply.Error, fmt.Sprint(reply.Status)), reply.Ms))
	if got.RedirectURL == "" {
		o.Status = "error"
		o.log("checkout", "el host no dio redirect_url: "+or2(got.Error, or2(reply.Text, reply.Error)))
	} else {
		o.Status = "redirected"
	}
	demoMu.Lock()
	orders := append(demoLoad(), o)
	err := demoSave(orders)
	demoMu.Unlock()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"order": o, "host": reply})
}

// «Avisar como Creditop»: el aviso de fin de solicitud, mandado al webhook_url firmado del pedido.
func demoNotify(w http.ResponseWriter, r *http.Request, id string) {
	var in struct{ Status string }
	_ = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in)
	status := map[string]string{"completed": "completed", "failed": "failed", "cancelled": "cancelled", "pending": "pending payment"}[in.Status]
	if status == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status: completed, failed, cancelled o pending"})
		return
	}
	c := shopifyDemoConfig()
	src, err := openSource(c.Target, 1)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "no abre la base de " + c.Target + ": " + err.Error()})
		return
	}
	defer src.Close()
	rows, err := src.Rows("SELECT id, process_url FROM ecommerce_requests WHERE order_key = ? ORDER BY id DESC LIMIT 1", id)
	if err != nil || len(rows) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Creditop no tiene el pedido %s en %s (¿el host apunta a otro ambiente?)", id, c.Target)})
		return
	}
	webhook := fmt.Sprint(rows[0]["process_url"])
	// El webhook_url es la dirección pública del host + /webhooks/creditop?s=…&sig=…: se manda a esa misma ruta del host.
	u, err := url.Parse(webhook)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "process_url inválida: " + webhook})
		return
	}
	path := u.Path
	if i := strings.Index(path, "/webhooks/"); i >= 0 {
		path = path[i:]
	}
	target := c.HostURL + path + "?" + u.RawQuery
	notice := map[string]any{"orderId": id, "status": status}
	reply := demoCall("POST", target, nil, notice)
	demoRecord(demoExchange{Dir: "out", Kind: "Aviso de Creditop (webhook → app)", Method: "POST", URL: target, Status: reply.Status,
		Ms: reply.Ms, Order: id, Request: rawJSON(notice), Response: reply.Body, Text: reply.Text, Error: reply.Error})
	o := demoUpdate(func(o *demoOrder) bool { return o.ID == id }, func(o *demoOrder) {
		o.log("creditop", fmt.Sprintf("aviso «%s» (pedido %v de Creditop) → host %s en %d ms", status, rows[0]["id"], or2(reply.Error, fmt.Sprint(reply.Status)), reply.Ms))
	})
	writeJSON(w, http.StatusOK, map[string]any{"order": o, "host": reply, "ecommerceRequest": rows[0]["id"]})
}

func registerShopifyDemo(mux *http.ServeMux) {
	mux.HandleFunc("/api/shopify-demo/ping", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"pong": "shopify-demo", "nonce": demoNonce})
	})
	mux.HandleFunc("/api/shopify-demo/status", func(w http.ResponseWriter, r *http.Request) {
		c := shopifyDemoConfig()
		writeJSON(w, http.StatusOK, map[string]any{"config": c, "checks": demoChecks(c), "share": readDemoShare()})
	})
	// Las peticiones de la demo, las que hace y las que le hacen: lo que muestra el panel derecho.
	mux.HandleFunc("/api/shopify-demo/log", func(w http.ResponseWriter, r *http.Request) {
		demoLogMu.Lock()
		out := append([]demoExchange{}, demoLog...)
		demoLogMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"exchanges": out})
	})
	mux.HandleFunc("/api/shopify-demo/orders", func(w http.ResponseWriter, r *http.Request) {
		demoMu.Lock()
		orders := demoLoad()
		demoMu.Unlock()
		if orders == nil {
			orders = []*demoOrder{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
	})
	mux.HandleFunc("/api/shopify-demo/checkout", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST"})
			return
		}
		demoCheckout(w, r)
	})
	// POST /api/shopify-demo/orders/<id>/notify { status }
	mux.HandleFunc("/api/shopify-demo/orders/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/shopify-demo/orders/"), "/")
		if len(parts) == 2 && parts[1] == "notify" && r.Method == http.MethodPost {
			demoNotify(w, r, parts[0])
			return
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no existe"})
	})
	// La Payments Apps API de Shopify, falsa: aquí llegan resolve, reject y pending del host.
	mux.HandleFunc("/payments_apps/", demoPaymentsAPI)
}
