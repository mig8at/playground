package main

import (
	"creditop-tests/channel"
	"creditop-tests/lender"
	"creditop-tests/merchant"
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"creditop-tests/pkg/flow"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// ── comando unificado: flow <ecommerce> <merchant> <lender> [state] ──────────────────────────────
//
// Una sola entrada para la matriz de pruebas ecommerce, parametrizada por las dimensiones reales:
//   environment (--target=local|dev) · ecommerce (notificador) · merchant · lender (elige el flujo) · state
//
// La ENTRADA es siempre el contrato base64 UNIFICADO (legacy genera la URL vía /vtex/init), sea cual
// sea el notificador. Lo que cambia por dimensión:
//   · ecommerce → flipea ecommerce_type_id de la credencial → elige el notificador del cierre/observer.
//   · lender (response_type) → ELIGE el flujo: in-platform (rt 2/3) + approved → cierre REAL (+settle si
//     es VTEX); el resto (agregadores externos rt 0/1, o state=rechazo) → SIMULADOR (cambia el estado
//     vía Eloquent → UserRequestObserver notifica), porque el harness no puede cerrar a esos lenders.
//   · state → approved (default) = Estado 11 · rejected/6/7/8 = estado de rechazo (vía simulador).

// ecommerceType mapea la plataforma al ecommerce_type_id de la credencial — el que legacy usa para
// resolver el notificador (1=WooCommerce, 2=self/desarrollo propio, 3=VTEX). ok=false si no la reconoce.
func ecommerceType(name string) (int, bool) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "vtex":
		return 3, true
	case "woocommerce", "woo", "wordpress":
		return 1, true
	case "self", "selfdevelopment", "self-development", "propio":
		return 2, true
	}
	return 0, false
}

// notifierName nombra el notificador que dispara un ecommerce_type_id (para el output).
func notifierName(etype int) string {
	switch etype {
	case 1:
		return "WooCommerceNotifier"
	case 2:
		return "SelfDevelopmentNotifier"
	case 3:
		return "VtexNotifier"
	}
	return fmt.Sprintf("ecommerce_type_id=%d", etype)
}

// parseState normaliza el state: approved/aprobado/11 → (11,true) · rejected/denied/6 → (6,false) ·
// 7/8 → (n,false). Default approved.
func parseState(state string) (status int, approved bool) {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "", "approved", "aprobado", "ok", "11":
		return 11, true
	case "rejected", "rechazado", "denied", "negada", "6":
		return 6, false
	case "7":
		return 7, false
	case "8":
		return 8, false
	}
	if n, err := strconv.Atoi(state); err == nil {
		return n, n == 11
	}
	return 11, true
}

func stateLabel(status int, approved bool) string {
	if approved {
		return "aprobado (E11)"
	}
	return fmt.Sprintf("rechazo (E%d)", status)
}

// setEcommerceType flipea el ecommerce_type_id de la credencial ecommerce del comercio para la corrida
// y devuelve un closure de REVERT (defer-éalo) + una línea informativa. Así el notificador que dispara
// el cierre/observer es el de la plataforma pedida, sin dejar la credencial cambiada (el bug del flip
// manual que quedaba pegado). En dev es un WRITE a shared dev — va gateado por I_KNOW upstream y se
// revierte al salir.
func setEcommerceType(db *sql.DB, m merchant.Merchant, etype int) (revert func(), info string) {
	noop := func() {}
	var credID int64
	var prev sql.NullInt64
	err := db.QueryRow("SELECT id, ecommerce_type_id FROM allied_ecommerce_credentials WHERE allied_branch_id = ? LIMIT 1", m.BranchID).Scan(&credID, &prev)
	if err != nil {
		return noop, fmt.Sprintf("⚠ %s (%s) no tiene credencial ecommerce — no se setea el tipo (el init fallará)", m.Name, m.Hash)
	}
	prevTxt := "NULL"
	if prev.Valid {
		prevTxt = fmt.Sprint(prev.Int64)
	}
	if prev.Valid && int(prev.Int64) == etype {
		return noop, fmt.Sprintf("credencial #%d ya en ecommerce_type_id=%d (%s) — sin cambio", credID, etype, notifierName(etype))
	}
	if _, err := db.Exec("UPDATE allied_ecommerce_credentials SET ecommerce_type_id = ? WHERE id = ?", etype, credID); err != nil {
		return noop, fmt.Sprintf("⚠ no pude setear ecommerce_type_id en la credencial #%d: %v", credID, err)
	}
	revert = func() {
		if prev.Valid {
			db.Exec("UPDATE allied_ecommerce_credentials SET ecommerce_type_id = ? WHERE id = ?", prev.Int64, credID)
		} else {
			db.Exec("UPDATE allied_ecommerce_credentials SET ecommerce_type_id = NULL WHERE id = ?", credID)
		}
	}
	return revert, fmt.Sprintf("credencial #%d ecommerce_type_id %s → %d (%s) · se revierte al salir", credID, prevTxt, etype, notifierName(etype))
}

// runFlow ejecuta el comando unificado. Compone el flujo como una secuencia numerada: entrada
// ecommerce unificada → [cierre real | simulador] → notificación al comercio → [settle VTEX].
func runFlow(ecommerceArg, merchantArg, lenderArg, state string) {
	etype, ok := ecommerceType(ecommerceArg)
	if !ok {
		client.FatalError(fmt.Sprintf("ecommerce %q inválido (usa vtex|woocommerce|self)", ecommerceArg), nil, nil)
	}
	status, approved := parseState(state)

	base := config.GetConfig(target)
	// presets.json (best-effort): defaults + alias de merchant por entorno. No cachea la BD — la
	// resolución real sigue en merchant.Resolve (abajo); el alias solo mapea el nombre lógico al del entorno.
	presets := loadPresets()
	if presets.Defaults.Amount > 0 {
		base.TestAmount = presets.Defaults.Amount
	}
	aliasInfo := ""
	if aliased, ok := presets.merchantAlias(merchantArg, target); ok && aliased != merchantArg {
		aliasInfo = fmt.Sprintf("alias merchant: %q → %q (entorno %s)", merchantArg, aliased, target)
		merchantArg = aliased
	}
	// webhook default para dev (no toca local: ahí E2E_STORE_WEBHOOK_URL vacío usa el mock listener).
	if target != "local" && os.Getenv("E2E_STORE_WEBHOOK_URL") == "" && presets.Defaults.Webhook != "" {
		os.Setenv("E2E_STORE_WEBHOOK_URL", presets.Defaults.Webhook)
	}

	db := database.Connect(base)
	defer db.Close()
	m, err := merchant.Resolve(db, merchantArg)
	if err != nil {
		client.FatalError("resolviendo comercio", err, nil)
	}
	l, err := lender.Resolve(db, lenderArg)
	if err != nil {
		client.FatalError("resolviendo lender", err, nil)
	}
	base.PartnerHash = m.Hash
	cfg := l.ApplyOverrides(base)

	// in-platform (rt 2/3) + approved → cierre real; el resto (externos rt 0/1, o rechazo) → simulador.
	realClose := (l.ResponseType == 2 || l.ResponseType == 3) && approved

	publicStore := os.Getenv("E2E_STORE_WEBHOOK_URL")
	var store *channel.StoreWebhook
	if !explain {
		if aliasInfo != "" {
			client.PrintRule(aliasInfo)
		}
		// receptor del webhook: público (E2E_STORE_WEBHOOK_URL, p.ej. dev/webhook.site) o mock local.
		if publicStore != "" {
			client.PrintRule(fmt.Sprintf("webhook de tienda → %s (URL pública)", publicStore))
		} else if sw, e := channel.StartStoreWebhook(); e == nil {
			store = sw
			channel.StoreWebhookURL = sw.URL()
			defer func() { channel.StoreWebhookURL = ""; sw.Close() }()
		} else {
			client.PrintRule(fmt.Sprintf("⚠ listener de tienda no disponible en :9099 (%v) — webhook no se verificará", e))
		}
		// flip de la credencial → notificador (revert al salir).
		revert, info := setEcommerceType(db, m, etype)
		defer revert()
		client.PrintRule(info)
	}

	pathDesc := "cierre REAL in-platform (rt 2/3) → Estado 11"
	if !realClose {
		pathDesc = fmt.Sprintf("SIMULADOR de agregador → Estado %d (rt=%d no se cierra in-platform, o state=rechazo)", status, l.ResponseType)
	}
	f := flow.New(
		fmt.Sprintf("flow[%s] → %s (%s) → %s #%d (rt=%d) → %s", ecommerceArg, m.Name, m.Hash, l.Name, l.ID, l.ResponseType, stateLabel(status, approved)),
		fmt.Sprintf("Notificador %s · %s", notifierName(etype), pathDesc),
	)

	// entrada unificada: legacy genera el base64 (/vtex/init) → create → registro/OTP → personal/laboral.
	f.Add(channel.VtexSteps(db, cfg, m, channel.Person{})...)

	if realClose {
		f.Step(
			fmt.Sprintf("Verificación de comercio (%s)", m.Kind),
			"Diagnóstico del comportamiento que el comercio dispara en el backend. No bloquea el cierre.",
			func(c *flow.Ctx) (string, error) {
				if err := m.Verify(db, c.Int64("uReqID")); err != nil {
					return fmt.Sprintf("diagnóstico %s: %v (no bloquea)", m.Kind, err), nil
				}
				if m.Kind == merchant.Standard {
					return "comercio estándar (sin comportamiento especial)", nil
				}
				return fmt.Sprintf("comportamiento %s verificado", m.Kind), nil
			},
		)
		f.Add(lender.CloseSteps(db, cfg, l)...)
	} else {
		f.Step(
			"Simular resultado del agregador (cambio de estado)",
			fmt.Sprintf("POST al simulador → cambia el user_request a estado %d vía Eloquent (como el webhook de Bancolombia/Sistecrédito). Dispara UserRequestObserver.", status),
			func(c *flow.Ctx) (string, error) {
				uReqID := c.Int64("uReqID")
				resp, err := channel.SimulateAggregatorResult(cfg, uReqID, status)
				if err != nil {
					return "", fmt.Errorf("simulador: %w", err)
				}
				if okSim, _ := resp["simulated"].(bool); !okSim {
					return "", fmt.Errorf("el simulador no confirmó (¿prod? ¿estado no final?): %v", resp)
				}
				return fmt.Sprintf("user_request #%d → estado %d (simulado como agregador)", uReqID, status), nil
			},
		)
	}

	// notificación al comercio — común a ambos caminos.
	notifyTitle := "Notificación al comercio (webhook de cierre)"
	if !realClose {
		notifyTitle = "Notificación al comercio (UserRequestObserver)"
	}
	f.Step(notifyTitle,
		"Al llegar al estado final el backend notifica al process_url (processEcommerceTransaction) y marca ecommerce_requests.processed=1.",
		func(c *flow.Ctx) (string, error) {
			return storeNotifyAssert(db, store, publicStore, c.Int64("uReqID"))
		},
	)

	// settle solo en el cierre real de VTEX (protocolo VTEX): confirma Estado 11.
	if realClose && etype == 3 {
		f.Step(
			"VTEX settle (/vtex/settel) — verifica Estado 11",
			"El harness (como conector VTEX) confirma el settle: POST /vtex/settel. Legacy responde success:true solo si el user_request llegó a Estado 11.",
			func(c *flow.Ctx) (string, error) {
				resp, err := channel.VtexSettle(cfg, c.Str("vtexPaymentId"), c.Str("vtexOrderId"))
				if err != nil {
					return "", fmt.Errorf("vtex/settel: %w", err)
				}
				if okS, _ := resp["success"].(bool); !okS {
					return "", fmt.Errorf("settel no aprobó (¿Estado != 11?): %v", resp)
				}
				settleID, _ := resp["settleId"].(string)
				return fmt.Sprintf("settle aprobado · settleId=%s", settleID), nil
			},
		)
	}

	if explain {
		f.Explain()
		return
	}
	database.Clean(db, cfg.TestPhone, cfg.TestDoc, cfg.TestEmail)
	runErr := f.Run()

	// dev/público: best-effort, mostrar inline el último payload capturado por webhook.site.
	if runErr == nil && store == nil && publicStore != "" {
		if line := fetchWebhookSiteStatus(publicStore); line != "" {
			fmt.Printf("   ↳ webhook.site: %s\n", line)
		}
	}
	if runErr != nil {
		os.Exit(1)
	}
}

// ── salida del webhook (compartida por runOne / runAggregatorSim / runFlow) ───────────────────────

// storeNotifyAssert verifica que la notificación al comercio disparó: processed=1 y, con listener
// local, que el POST llegó — parseando el body para DESTACAR el `status` (approved/denied) en vez de
// truncarlo. Con receptor público (dev/webhook.site) verifica processed=1 (el payload se ve allá).
func storeNotifyAssert(db *sql.DB, store *channel.StoreWebhook, publicStore string, uReqID int64) (string, error) {
	if !database.AssertRowExists(db, "ecommerce_requests", "user_request_id = ? AND processed = 1", uReqID) {
		return "", fmt.Errorf("ecommerce_requests.processed != 1 para user_request %d (la tienda no fue notificada)", uReqID)
	}
	if store == nil {
		return fmt.Sprintf("tienda notificada · processed=1 · POST → %s (revisá el payload allá)", publicStore), nil
	}
	if store.Count() == 0 {
		return "", fmt.Errorf("processed=1 pero el listener no recibió el POST (¿process_url mal apuntado?)")
	}
	hit, _ := store.Last()
	return "tienda notificada · processed=1 · " + summarizeWebhook(hit.Path, hit.Body), nil
}

// summarizeWebhook destaca el `status` del body y muestra el cuerpo (hasta 220 chars) sin cortar justo
// en el dato clave (antes se truncaba a 90, comiéndose status/value).
func summarizeWebhook(path, body string) string {
	out := "POST " + path
	if s := webhookStatus(body); s != "" {
		out += " · status=" + s
	}
	b := strings.TrimSpace(body)
	if len(b) > 220 {
		b = b[:220] + "…"
	}
	if b != "" {
		out += " · body=" + b
	}
	return out
}

// webhookStatus extrae el campo "status" de un body JSON (vacío si no es JSON o no lo trae).
func webhookStatus(body string) string {
	var m map[string]interface{}
	if json.Unmarshal([]byte(body), &m) != nil {
		return ""
	}
	if s, ok := m["status"].(string); ok {
		return s
	}
	return ""
}

// fetchWebhookSiteStatus hace un GET best-effort a la API de webhook.site para mostrar inline el último
// payload capturado (status + paymentId), sin abrir el navegador. Solo para URLs webhook.site; cualquier
// fallo devuelve "" (nunca corta el flujo). Reintenta una vez (la ingesta puede tener un pequeño lag).
func fetchWebhookSiteStatus(publicURL string) string {
	if !strings.Contains(publicURL, "webhook.site") {
		return ""
	}
	u, err := url.Parse(publicURL)
	if err != nil {
		return ""
	}
	token := strings.Trim(u.Path, "/")
	if token == "" {
		return ""
	}
	api := "https://webhook.site/token/" + token + "/requests?sorting=newest&per_page=1"
	hc := &http.Client{Timeout: 5 * time.Second}
	for try := 0; try < 2; try++ {
		if try > 0 {
			time.Sleep(1500 * time.Millisecond)
		}
		resp, err := hc.Get(api)
		if err != nil {
			continue
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		var parsed struct {
			Data []struct {
				Content   string `json:"content"`
				CreatedAt string `json:"created_at"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &parsed) != nil || len(parsed.Data) == 0 {
			continue
		}
		d := parsed.Data[0]
		var content map[string]interface{}
		json.Unmarshal([]byte(d.Content), &content)
		status, _ := content["status"].(string)
		pid, _ := content["paymentId"].(string)
		when := d.CreatedAt
		if len(when) > 19 {
			when = when[:19]
		}
		if status == "" && pid == "" {
			return fmt.Sprintf("último request %s capturado (sin status legible)", when)
		}
		return fmt.Sprintf("último %s · status=%s · paymentId=%s", when, status, pid)
	}
	return ""
}
