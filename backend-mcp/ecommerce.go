package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// notifyEcommerce replica processEcommerceTransaction (el webhook que el backend dispara al cerrar en
// Estado 11): arma el payload según ecommerce_id, lo POSTea al receiver y —solo si responde 2xx— marca
// ecommerce_requests.processed=1 (igual que el backend). Es un atajo SINTÉTICO del webhook: NO ejecuta
// authorize/firma de documentos (Netco/Deceval); valida el contrato de notificación + el flag processed.
// overrideURL="" ⇒ usa un receiver loopback del propio MCP (autocontenido, sin servicios externos).
func notifyEcommerce(db *sql.DB, uReqID int, overrideURL string) (map[string]any, error) {
	out := map[string]any{"user_request_id": uReqID, "synthetic_webhook": true}
	var ecomID, ecommerceID, abID int
	var processURL, orderID, orderKey string
	err := db.QueryRow(`SELECT er.id, er.ecommerce_id, er.allied_branch_id, er.process_url, COALESCE(er.order_identifier,''), COALESCE(er.order_key,'')
		FROM user_requests_by_ecommerce_request l JOIN ecommerce_requests er ON er.id = l.ecommerce_request_id
		WHERE l.user_request_id = ? ORDER BY l.id DESC LIMIT 1`, uReqID).Scan(&ecomID, &ecommerceID, &abID, &processURL, &orderID, &orderKey)
	if err != nil {
		return out, fmt.Errorf("no hay ecommerce_request vinculado al request %d: %w", uReqID, err)
	}
	out["ecommerce_request_id"], out["ecommerce_id"] = ecomID, ecommerceID

	target := overrideURL
	var rcv *loopback
	if target == "" {
		r, lerr := startLoopback()
		if lerr != nil {
			return out, fmt.Errorf("loopback: %w", lerr)
		}
		rcv = r
		defer rcv.close()
		target = rcv.url
		out["receiver"] = "loopback MCP " + target
	} else {
		out["receiver"] = target
	}

	status := "completed"
	db.QueryRow("SELECT woocommerce_status FROM woocommerce_statuses WHERE creditop_status_id = 11 LIMIT 1").Scan(&status)
	var amount float64
	db.QueryRow("SELECT COALESCE(final_amount, amount, 0) + COALESCE(initial_fee, 0) FROM user_requests WHERE id = ?", uReqID).Scan(&amount)

	var url string
	var payload map[string]any
	switch ecommerceID {
	case 1: // WooCommerce: process_url + order_identifier, body {status}
		url = target + orderID
		payload = map[string]any{"status": status}
	default: // Self Development (webhook genérico)
		url = target
		payload = map[string]any{
			"orderId": orderKey, "approvedAmount": amount, "currency": "COP",
			"status": status, "paymentType": "creditop", "transactionId": fmt.Sprintf("%d_%d", ecomID, uReqID),
		}
	}
	out["posted_url"], out["payload_sent"] = url, payload

	st, body, perr := postExternal(url, payload)
	out["http_status"], out["receiver_response"] = st, body
	if perr != nil {
		out["post_error"] = perr.Error()
	}
	if rcv != nil {
		if c := rcv.captured(); c != nil {
			out["received_by_mcp"] = map[string]any{"method": c.Method, "path": c.Path, "body": c.Body}
		}
	}
	if st >= 200 && st < 300 {
		db.Exec("UPDATE ecommerce_requests SET processed = 1, updated_at = NOW() WHERE id = ?", ecomID)
		out["processed"] = 1
		out["veredicto"] = "webhook recibido + ecommerce_requests.processed=1 (igual que el cierre real en Estado 11)"
	} else {
		out["processed"] = 0
		out["note"] = "el backend real solo marca processed=1 si el POST devuelve 2xx"
	}
	return out, nil
}

// branchToken lee el token ecommerce (texto plano en allied_ecommerce_credentials.credential).
func branchToken(db *sql.DB, hash string) (string, error) {
	var t string
	err := db.QueryRow(`SELECT aec.credential FROM allied_ecommerce_credentials aec
		JOIN allied_branches ab ON ab.id = aec.allied_branch_id WHERE ab.hash = ? LIMIT 1`, hash).Scan(&t)
	return t, err
}

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

// phpSerialize — subconjunto de serialize() de PHP que necesita el contrato del plugin ecommerce.
func phpSerialize(v any) string {
	switch x := v.(type) {
	case string:
		return fmt.Sprintf("s:%d:\"%s\";", len(x), x) // longitud en BYTES
	case int:
		return fmt.Sprintf("i:%d;", x)
	case int64:
		return fmt.Sprintf("i:%d;", x)
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var b strings.Builder
		fmt.Fprintf(&b, "a:%d:{", len(x))
		for _, k := range keys {
			b.WriteString(phpSerialize(k))
			b.WriteString(phpSerialize(x[k]))
		}
		b.WriteString("}")
		return b.String()
	default:
		panic(fmt.Sprintf("phpSerialize: tipo no soportado %T", v))
	}
}

// ecommerceContract arma los valores base64 del contrato (order/products/token/returnUrl/processUrl/
// config) — la misma estructura que usa el plugin ecommerce. La consumen tanto el handshake (POST a
// create) como la URL del checkout que abre el wizard.
func ecommerceContract(hash, token, phone, processURL string, p PersonalInfo, total int) map[string]any {
	order := map[string]any{
		"id": 5002, "order_key": "wc_mcp_" + hash, "total": fmt.Sprintf("%d", total),
		"billing": map[string]any{
			"first_name": p.Name, "last_name": p.Surname, "phone": phone,
			"email": p.Email, "document_type": p.DocType, "document_number": p.Doc,
		},
	}
	products, _ := json.Marshal([]map[string]any{
		{"product_id": 101, "name": "Producto MCP", "sku": "SKU-MCP", "price": fmt.Sprintf("%d", total)},
	})
	configJSON, _ := json.Marshal([]any{})
	return map[string]any{
		"order":      b64(phpSerialize(order)),
		"products":   b64(string(products)),
		"token":      b64(token),
		"returnUrl":  b64(phpSerialize("https://tienda-mcp.test/return")),
		"processUrl": b64(processURL),
		"config":     b64(phpSerialize(string(configJSON))),
	}
}

// createEcommerceRequest hace el HANDSHAKE ecommerce: arma el contrato base64 y POSTea a
// ecommerce-request/create/{hash}. El backend lo decodifica, valida el token y crea el ecommerce_request.
func createEcommerceRequest(apiBase, hash, token, phone, processURL string, p PersonalInfo, total int) (int, error) {
	payload := ecommerceContract(hash, token, phone, processURL, p, total)
	resp, _, err := post(apiBase, "/onboarding/ecommerce-request/create/"+hash, payload)
	if err != nil {
		return 0, err
	}
	id := findIntKey(resp, "ecommerceRequestId")
	if id == 0 {
		return 0, fmt.Errorf("create no devolvió ecommerceRequestId (resp: %v)", resp)
	}
	return id, nil
}

// opEcommerceURL (read) arma la URL del CHECKOUT que abre el wizard: /ecommerce/{hash}/checkout?o=…&t=…
// El loader del wizard (SSR) la decodifica, POSTea a create contra dev y redirige a /solicitar?erId=.
// El teléfono va en el billing (= bypass) para que el OTP del flujo pase con los últimos 4.
func opEcommerceURL(db *sql.DB, merchantQ, phone string, amount int) (map[string]any, error) {
	// Una sucursal del comercio que TENGA credencial ecommerce (no todas la tienen; ej. la branch de
	// asesor de pullman no). Reusa el listado de `ecommerce`.
	branches, err := opListEcommerce(db, merchantQ)
	if err != nil {
		return nil, err
	}
	if len(branches) == 0 {
		return nil, fmt.Errorf("no hay sucursal con credencial ecommerce para %q (mirá `go run . ecommerce %s`)", merchantQ, merchantQ)
	}
	b := branches[0]
	// preferir una branch ecommerce del MISMO allied que el comercio principal (ej. evitar "Pullman-pruebas"
	// allied 121 cuando el comercio es Amoblando Pullman allied 94, que es el que tiene lenders configurados).
	if m, merr := resolveMerchant(db, merchantQ); merr == nil {
		for _, cand := range branches {
			if cand.AlliedID == m.AlliedID {
				b = cand
				break
			}
		}
	}
	token, terr := branchToken(db, b.Hash)
	if terr != nil || token == "" {
		return nil, fmt.Errorf("sin token ecommerce para %s (%s): %v", b.Name, b.Hash, terr)
	}
	if phone == "" {
		phone = "3131010101"
	}
	if amount == 0 {
		amount = 600000
	}
	p := PersonalInfo{DocType: "CC", Doc: "", Name: "SYNTH", Surname: "ECOM", Email: "synth-ecom@creditop.com"}
	c := ecommerceContract(b.Hash, token, phone, "https://tienda-mcp.test/webhook", p, amount)
	v := url.Values{}
	v.Set("o", fmt.Sprint(c["order"]))
	v.Set("p", fmt.Sprint(c["products"]))
	v.Set("t", fmt.Sprint(c["token"]))
	v.Set("u", fmt.Sprint(c["returnUrl"]))
	v.Set("ps", fmt.Sprint(c["processUrl"]))
	v.Set("config", fmt.Sprint(c["config"]))
	return map[string]any{
		"merchant":      b.Name,
		"hash":          b.Hash,
		"amount":        amount,
		"phone":         phone,
		"checkout_path": "/ecommerce/" + b.Hash + "/checkout?" + v.Encode(),
	}, nil
}
