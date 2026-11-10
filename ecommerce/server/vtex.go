package main

/* EL LADO DE VTEX de una compra: lo que pasó con el pedido y su transacción en la cuenta `creditop`, puesto al lado de lo
 * que dice Creditop, y lo que no cuadra dicho en palabras de negocio. Sirve para ver solo, sin la consola de vtex, las
 * incidencias que ya costaron: el conector que no contesta a tiempo, la cancelación que el conector niega y deja la
 * transacción trabada, y los dos lados con estados distintos.
 *
 * Sólo LEE de VTEX (OMS y la API de pagos) con la llave de la cuenta: `VTEX_ACCOUNT`, `VTEX_APP_KEY` y `VTEX_APP_TOKEN`
 * del `.env`. Sólo en local y qa: la cuenta `creditop` es de pruebas y prod no tiene nada que buscar ahí.
 *
 * Los mensajes de VTEX traen el cuerpo entero de cada llamada (el pedido, el comprador): se recortan en el servidor
 * antes de salir (shortMessage), así no llegan al navegador. */

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// VtexEcommerceID es el id de VTEX en `ecommerces`.
const VtexEcommerceID = 3

// SlowAuthorize es la latencia de authorize desde la que se avisa: VTEX corta a los ~2 s (medido el 2026-11-04).
const SlowAuthorize = 1.5

// VtexEvent es una línea del historial de la transacción, ya recortada.
type VtexEvent struct {
	Date    string `json:"date"`
	Message string `json:"message"`
}

// Finding es una incidencia: `fail` rompe la compra o deja los dos lados distintos, `warn` es riesgo, `info` contexto.
type Finding struct {
	Code  string `json:"code"`
	Level string `json:"level"`
	Text  string `json:"text"`
}

// CreditopSide es lo que dice Creditop del pedido.
type CreditopSide struct {
	HasRequest bool // el comprador llegó al wizard y hay solicitud
	StatusID   int  // user_request_status_id; 0 sin solicitud
}

// Diagnosis es el resultado de mirar el historial de una transacción.
type Diagnosis struct {
	AuthLatency  *float64  `json:"authLatency"`  // segundos del primer authorize; nil si no hubo respuesta
	AuthResponse string    `json:"authResponse"` // «200 OK», «504 GatewayTimeout»
	Findings     []Finding `json:"findings"`
}

var finalStatuses = map[int]bool{6: true, 7: true, 8: true, 11: true}

const vtexDateLayout = "2006-01-02T15:04:05.9999999"

func parseVtexDate(s string) (time.Time, bool) {
	t, err := time.Parse(vtexDateLayout, strings.TrimSuffix(s, "Z"))
	return t, err == nil
}

var reResponseCode = regexp.MustCompile(`received: \[([^\]]+)\]`)

// Diagnose es puro: el historial y el estado de la transacción, contra lo que dice Creditop. Lo usan la vista de un
// pedido y la lista de incidencias, y se prueba con los casos reales (vtex_test.go).
func Diagnose(events []VtexEvent, txStatus string, side CreditopSide) Diagnosis {
	sorted := append([]VtexEvent{}, events...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Date < sorted[j].Date })

	var d Diagnosis
	var sent time.Time
	// attempt cuenta los authorize: el 1 es el del checkout (el comprador espera); los demás son los reintentos de VTEX
	// (tras el aviso de Creditop o cada hora), con el pago pendiente. Un timeout en el 1 manda al comprador de vuelta al
	// checkout; en un reintento, VTEX sólo espera al siguiente.
	var attempt, retryTimeouts int
	var timeout, cancelDenied, ignored bool
	lastTimeoutAttempt := 0
	for _, e := range sorted {
		m := e.Message
		if strings.HasPrefix(m, "Sending authorization request") {
			attempt++
			if attempt == 1 {
				sent, _ = parseVtexDate(e.Date)
			}
		}
		if attempt == 1 && d.AuthResponse == "" && strings.HasPrefix(m, "Authorization response received") {
			if mm := reResponseCode.FindStringSubmatch(m); mm != nil {
				d.AuthResponse = mm[1]
			}
			if at, ok := parseVtexDate(e.Date); ok && !sent.IsZero() {
				secs := at.Sub(sent).Seconds()
				d.AuthLatency = &secs
			}
		}
		// La respuesta 504 y el «Connector Code: ProxyTimeout» son el mismo corte: se cuenta una vez por authorize.
		if (strings.Contains(m, "ProxyTimeout") || strings.Contains(m, "[504")) && attempt > 0 && lastTimeoutAttempt != attempt {
			lastTimeoutAttempt = attempt
			if attempt == 1 {
				timeout = true
			} else {
				retryTimeouts++
			}
		}
		if strings.Contains(m, "cancellation-not-supported") {
			cancelDenied = true
		}
		if strings.Contains(m, "cannot advance from Cancelled") {
			ignored = true
		}
	}

	add := func(code, level, text string) { d.Findings = append(d.Findings, Finding{code, level, text}) }
	alive := side.HasRequest && !finalStatuses[side.StatusID]

	if timeout {
		lat := ""
		if d.AuthLatency != nil {
			lat = fmt.Sprintf(" (%.1f s)", *d.AuthLatency)
		}
		add("timeout", "fail", "El conector no contestó a tiempo"+lat+": VTEX negó el pago y el comprador volvió al checkout sin aviso.")
	} else if d.AuthLatency != nil && *d.AuthLatency > SlowAuthorize {
		add("slow", "warn", fmt.Sprintf("El conector tardó %.1f s en contestar el authorize del checkout: el comprador esperó, y VTEX a veces corta a los ~2 s.", *d.AuthLatency))
	}
	if retryTimeouts > 0 {
		add("retry_timeout", "warn", fmt.Sprintf("%d reintento(s) de authorize no contestaron a tiempo: VTEX dejó el pago pendiente y volvió a preguntar más tarde (cada hora), así que el resultado llegó tarde a la tienda.", retryTimeouts))
	}

	switch {
	case cancelDenied && txStatus == "Cancelling":
		text := "VTEX quiso cancelar y el conector lo negó: la transacción quedó trabada en Cancelling."
		if alive {
			text += " La solicitud sigue viva en Creditop: si el comprador termina, se aprobaría un crédito sin venta."
		}
		add("cancel_stuck", "fail", text)
	case cancelDenied:
		add("cancel_denied", "warn", "VTEX pidió cancelar y el conector lo negó (cancellation-not-supported).")
	}

	if ignored {
		add("second_result", "warn", "Creditop mandó otro resultado después de que VTEX canceló el pago: VTEX lo ignoró.")
	}

	approved := txStatus == "Approved" || txStatus == "Finished" || txStatus == "Settling"
	switch {
	case side.StatusID == 11 && !approved:
		add("mismatch", "fail", fmt.Sprintf("Creditop autorizó la solicitud (11) y en VTEX la transacción está %s: la tienda no tiene el pago aprobado.", orDash(txStatus)))
	case side.HasRequest && (side.StatusID == 6 || side.StatusID == 7 || side.StatusID == 8) && approved:
		add("mismatch", "fail", fmt.Sprintf("Creditop cerró la solicitud en %d y en VTEX la transacción está %s: la tienda va a cobrar un crédito que no existe.", side.StatusID, txStatus))
	case txStatus == "Cancelled" && alive:
		add("mismatch", "fail", "VTEX canceló el pago y la solicitud sigue viva en Creditop: si el comprador termina, se aprobaría un crédito sin venta.")
	}

	if !side.HasRequest {
		text := "El comprador nunca llegó al wizard: el pedido de Creditop no tiene solicitud."
		level := "warn"
		if timeout {
			text = "El comprador nunca llegó al wizard porque el conector no contestó a tiempo: el pedido de Creditop quedó sin solicitud."
		} else if txStatus == "Cancelled" || txStatus == "Cancelling" {
			level = "info"
			text += " VTEX ya canceló el pago (abandonó o venció)."
		}
		add("no_request", level, text)
	}
	return d
}

// ─── la API de VTEX ────────────────────────────────────────────────────────────────────────────────────

type vtexClient struct {
	account, key, token string
	http                *http.Client
}

// VtexMissing dice qué falta en el .env para mirar VTEX, o "".
func VtexMissing() string {
	var miss []string
	for _, k := range []string{"VTEX_ACCOUNT", "VTEX_APP_KEY", "VTEX_APP_TOKEN"} {
		if env(k) == "" {
			miss = append(miss, k)
		}
	}
	if len(miss) == 0 {
		return ""
	}
	return "falta " + strings.Join(miss, ", ") + " en .env (la llave de la cuenta VTEX de pruebas)"
}

func newVtexClient() (*vtexClient, error) {
	if miss := VtexMissing(); miss != "" {
		return nil, fmt.Errorf("%s", miss)
	}
	return &vtexClient{account: env("VTEX_ACCOUNT"), key: env("VTEX_APP_KEY"), token: env("VTEX_APP_TOKEN"),
		http: &http.Client{Timeout: 20 * time.Second}}, nil
}

// errNotFound distingue el 404 de VTEX (pedido que no existe en la cuenta) de una falla.
type errNotFound struct{ what string }

func (e errNotFound) Error() string { return e.what + " no existe en VTEX" }

func (c *vtexClient) get(u string, out any) error {
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-VTEX-API-AppKey", c.key)
	req.Header.Set("X-VTEX-API-AppToken", c.token)
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("no se llegó a VTEX: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode == http.StatusNotFound {
		return errNotFound{"el recurso"}
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("VTEX contestó %d", res.StatusCode)
	}
	return json.Unmarshal(raw, out)
}

var (
	reMessageBody = regexp.MustCompile(`\s+`)
	reRef         = regexp.MustCompile(`\?ref=\S+`)
)

// shortMessage deja la frase de VTEX y saca el cuerpo JSON (el pedido, el comprador) y la referencia del checkout.
func shortMessage(m string) string {
	m = strings.TrimSpace(reMessageBody.ReplaceAllString(m, " "))
	if i := strings.Index(m, "{"); i >= 0 {
		m = m[:i] + "{…}"
	}
	m = reRef.ReplaceAllString(m, "?ref=…")
	if r := []rune(m); len(r) > 240 {
		m = string(r[:240]) + "…"
	}
	return m
}

// VtexOrder es el lado de VTEX de un pedido.
type VtexOrder struct {
	OrderID       string      `json:"orderId"`
	OrderStatus   string      `json:"orderStatus"`
	TransactionID string      `json:"transactionId"`
	TxStatus      string      `json:"txStatus"`
	Events        []VtexEvent `json:"events"`
}

var reVtexOrder = regexp.MustCompile(`^\d{10,16}(-\d{2})?$`)

// VtexOrderID arma el id del pedido de VTEX con lo que guardó Creditop (`data.id`, sin el `-01` del vendedor). Los
// pedidos viejos de la tienda simulada (`v1792…`, `io1792…`) no son de VTEX: devuelve "".
func VtexOrderID(raw string) string {
	raw = strings.TrimSpace(raw)
	if !reVtexOrder.MatchString(raw) {
		return ""
	}
	if !strings.Contains(raw, "-") {
		raw += "-01"
	}
	return raw
}

// caché corta: la lista de incidencias y la vista de un pedido piden lo mismo, y VTEX cobra cada llamada en tiempo.
var (
	vtexCacheMu sync.Mutex
	vtexCache   = map[string]vtexCached{}
)

type vtexCached struct {
	at    time.Time
	order *VtexOrder
}

func (c *vtexClient) order(orderID string) (*VtexOrder, error) {
	vtexCacheMu.Lock()
	if hit, ok := vtexCache[orderID]; ok && time.Since(hit.at) < 45*time.Second {
		vtexCacheMu.Unlock()
		return hit.order, nil
	}
	vtexCacheMu.Unlock()

	var oms struct {
		Status      string `json:"status"`
		PaymentData struct {
			Transactions []struct {
				TransactionID string `json:"transactionId"`
			} `json:"transactions"`
		} `json:"paymentData"`
	}
	base := "https://" + c.account
	if err := c.get(base+".vtexcommercestable.com.br/api/oms/pvt/orders/"+url.PathEscape(orderID), &oms); err != nil {
		if _, ok := err.(errNotFound); ok {
			return nil, errNotFound{"el pedido " + orderID}
		}
		return nil, fmt.Errorf("pedido %s: %w", orderID, err)
	}
	out := &VtexOrder{OrderID: orderID, OrderStatus: oms.Status}
	if len(oms.PaymentData.Transactions) == 0 {
		return out, nil
	}
	out.TransactionID = oms.PaymentData.Transactions[0].TransactionID
	pay := base + ".vtexpayments.com.br/api/pvt/transactions/" + url.PathEscape(out.TransactionID)

	var tx struct {
		Status string `json:"status"`
	}
	var events []struct {
		Date    string `json:"Date"`
		Message string `json:"Message"`
	}
	var wg sync.WaitGroup
	var txErr, evErr error
	wg.Add(2)
	go func() { defer wg.Done(); txErr = c.get(pay, &tx) }()
	go func() { defer wg.Done(); evErr = c.get(pay+"/interactions", &events) }()
	wg.Wait()
	if txErr != nil {
		return nil, fmt.Errorf("transacción %s: %w", out.TransactionID, txErr)
	}
	if evErr != nil {
		return nil, fmt.Errorf("historial de %s: %w", out.TransactionID, evErr)
	}
	out.TxStatus = tx.Status
	for _, e := range events {
		out.Events = append(out.Events, VtexEvent{Date: e.Date, Message: shortMessage(e.Message)})
	}
	sort.SliceStable(out.Events, func(i, j int) bool { return out.Events[i].Date < out.Events[j].Date })

	vtexCacheMu.Lock()
	vtexCache[orderID] = vtexCached{time.Now(), out}
	vtexCacheMu.Unlock()
	return out, nil
}

// ─── lo que pide la interfaz ───────────────────────────────────────────────────────────────────────────────

// VtexReport es un pedido VTEX visto de los dos lados.
type VtexReport struct {
	Target      string     `json:"target"`
	EcommerceID int        `json:"ecommerceRequest"`
	Request     int        `json:"request,omitempty"` // la solicitud, si el comprador llegó al wizard
	StatusID    int        `json:"statusId,omitempty"`
	Status      string     `json:"status,omitempty"`
	BranchHash  string     `json:"branchHash"`
	CreatedAt   string     `json:"createdAt"`
	Processed   bool       `json:"processed"` // Creditop ya le avisó a la tienda
	Vtex        *VtexOrder `json:"vtex,omitempty"`
	VtexError   string     `json:"vtexError,omitempty"`
	*Diagnosis
}

const vtexOrderColumns = `SELECT er.id, er.ecommerce_id, b.hash AS branch_hash, er.processed, er.created_at,
		JSON_UNQUOTE(JSON_EXTRACT(er.data, '$.id')) AS vtex_order,
		(SELECT MAX(l.user_request_id) FROM user_requests_by_ecommerce_request l WHERE l.ecommerce_request_id = er.id) AS request,
		(SELECT q.user_request_status_id FROM user_requests q WHERE q.id = (SELECT MAX(l.user_request_id) FROM user_requests_by_ecommerce_request l WHERE l.ecommerce_request_id = er.id)) AS status_id,
		(SELECT s.name FROM user_requests q JOIN user_request_statuses s ON s.id = q.user_request_status_id WHERE q.id = (SELECT MAX(l.user_request_id) FROM user_requests_by_ecommerce_request l WHERE l.ecommerce_request_id = er.id)) AS status
	FROM ecommerce_requests er LEFT JOIN allied_branches b ON b.id = er.allied_branch_id`

func vtexTarget(target string) error {
	if !validTarget(target) {
		return fmt.Errorf("VTEX se mira sólo en %s: la cuenta creditop es de pruebas", strings.Join(Targets, " o "))
	}
	return nil
}

// report arma el lado de Creditop de una fila y le suma el de VTEX.
func report(target string, c *vtexClient, row Row) VtexReport {
	atoi := func(k string) int { n, _ := strconv.Atoi(cell(row, k)); return n }
	rep := VtexReport{Target: target, EcommerceID: atoi("id"), Request: atoi("request"), StatusID: atoi("status_id"),
		Status: cell(row, "status"), BranchHash: cell(row, "branch_hash"), CreatedAt: cell(row, "created_at"),
		Processed: cell(row, "processed") == "1"}
	side := CreditopSide{HasRequest: rep.Request > 0, StatusID: rep.StatusID}
	orderID := VtexOrderID(cell(row, "vtex_order"))
	switch {
	case atoi("ecommerce_id") != VtexEcommerceID:
		rep.VtexError = "este pedido no es de VTEX"
	case orderID == "":
		rep.VtexError = fmt.Sprintf("el pedido guardó %q, que no es un id de VTEX (tienda simulada)", cell(row, "vtex_order"))
	case c == nil:
		rep.VtexError = VtexMissing()
	default:
		o, err := c.order(orderID)
		if err != nil {
			rep.VtexError = err.Error()
			break
		}
		rep.Vtex = o
		d := Diagnose(o.Events, o.TxStatus, side)
		rep.Diagnosis = &d
	}
	if rep.Diagnosis == nil && !side.HasRequest {
		// Sin VTEX igual se sabe que el comprador no llegó.
		d := Diagnose(nil, "", side)
		rep.Diagnosis = &d
	}
	return rep
}

// VtexForRequest es el pedido VTEX de una solicitud o, con order > 0, el de ese ecommerce_request.
func VtexForRequest(target string, request, order int) (*VtexReport, error) {
	if err := vtexTarget(target); err != nil {
		return nil, err
	}
	src, err := source(target)
	if err != nil {
		return nil, err
	}
	var row Row
	if order > 0 {
		row, err = first(src, vtexOrderColumns+` WHERE er.id = ?`, order)
	} else {
		row, err = first(src, vtexOrderColumns+` WHERE er.id = (SELECT MAX(ecommerce_request_id) FROM user_requests_by_ecommerce_request WHERE user_request_id = ?)`, request)
	}
	if err != nil {
		forget(target)
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("no hay pedido de tienda para %d", max(order, request))
	}
	c, _ := newVtexClient()
	rep := report(target, c, row)
	return &rep, nil
}

// VtexIncidents son los pedidos VTEX de los últimos días con alguna incidencia, del más nuevo al más viejo.
type VtexIncidents struct {
	Target  string       `json:"target"`
	Days    int          `json:"days"`
	Checked int          `json:"checked"`
	Missing string       `json:"missing,omitempty"`
	Orders  []VtexReport `json:"orders"`
}

func ListVtexIncidents(target string, days int) (*VtexIncidents, error) {
	if err := vtexTarget(target); err != nil {
		return nil, err
	}
	if days < 1 || days > 30 {
		days = 7
	}
	src, err := source(target)
	if err != nil {
		return nil, err
	}
	rowsOut, err := rows(src, vtexOrderColumns+` WHERE er.ecommerce_id = ? AND er.created_at >= NOW() - INTERVAL ? DAY ORDER BY er.id DESC LIMIT 200`,
		VtexEcommerceID, days)
	if err != nil {
		forget(target)
		return nil, err
	}
	c, cerr := newVtexClient()
	out := &VtexIncidents{Target: target, Days: days, Checked: len(rowsOut), Orders: []VtexReport{}}
	if cerr != nil {
		out.Missing = cerr.Error()
	}
	reports := make([]VtexReport, len(rowsOut))
	sem := make(chan struct{}, 6) // VTEX: pocas llamadas a la vez
	var wg sync.WaitGroup
	for i, r := range rowsOut {
		wg.Add(1)
		go func(i int, r Row) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			reports[i] = report(target, c, r)
		}(i, r)
	}
	wg.Wait()
	for _, rep := range reports {
		// Entra con alguna incidencia, o si VTEX no se pudo leer (con llave): eso también hay que verlo.
		unreadable := c != nil && rep.Vtex == nil && rep.VtexError != ""
		if (rep.Diagnosis != nil && hasIncident(rep.Findings)) || unreadable {
			out.Orders = append(out.Orders, rep)
		}
	}
	return out, nil
}

func hasIncident(fs []Finding) bool {
	for _, f := range fs {
		if f.Level == "fail" || f.Level == "warn" || f.Code == "no_request" {
			return true
		}
	}
	return false
}

func registerVtex(mux *http.ServeMux) {
	// GET /api/vtex/order?target=qa&request=504527 · &order=8083 — el pedido VTEX de una solicitud o de un ecommerce_request.
	mux.HandleFunc("/api/vtex/order", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		request, _ := strconv.Atoi(q.Get("request"))
		order, _ := strconv.Atoi(q.Get("order"))
		rep, err := VtexForRequest(q.Get("target"), request, order)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rep)
	})
	// GET /api/vtex/connector?target=qa — qué versión del conector tiene cada workspace (vtex_apps.go).
	mux.HandleFunc("/api/vtex/connector", func(w http.ResponseWriter, r *http.Request) {
		out, err := ReadConnectorVersions(r.URL.Query().Get("target"))
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, out)
	})
	// GET /api/vtex/incidents?target=qa&days=7 — los pedidos VTEX con alguna incidencia.
	mux.HandleFunc("/api/vtex/incidents", func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		out, err := ListVtexIncidents(r.URL.Query().Get("target"), days)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, out)
	})
}
