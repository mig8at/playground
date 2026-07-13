package channel

import (
	"creditop-tests/merchant"
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/flow"
	"creditop-tests/pkg/mocks"
	"database/sql"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// VtexPaymentID / VtexOrderID son los PREFIJOS (por hash) con los que el harness actúa como conector
// VTEX: paymentId → order_key, orderId → order_identifier. La entrada (VtexSteps) les concatena un
// sufijo ÚNICO por corrida (vtexUnique) para que cada corrida cree un EcommerceRequest FRESCO
// (processed=0) y no reuse uno ya notificado — el id efectivo se publica en el Ctx
// (vtexPaymentId / vtexOrderId) y el settle lo lee de ahí (ya no lo recompone por hash).
func VtexPaymentID(hash string) string { return "vtex_pay_" + hash }
func VtexOrderID(hash string) string   { return "vtex_ord_" + hash }

// vtexUnique devuelve un sufijo único por corrida (nanosegundos en hex). Evita el flaky de reusar un
// EcommerceRequest ya procesado entre corridas: con el order_key determinista, el re-upsert conservaba
// processed=1 → el observer saltaba por idempotencia y el listener no recibía el POST.
func vtexUnique() string { return fmt.Sprintf("%x", time.Now().UnixNano()) }

// vtexBase es el host SIN el sufijo /api: las rutas /vtex/* viven en la raíz (webhooks.php de legacy),
// no bajo el prefijo api/onboarding del módulo.
func vtexBase(cfg config.TestConfig) string { return strings.TrimSuffix(cfg.ApiBaseURL, "/api") }

// VtexSettle hace POST /vtex/settel (paso settle del protocolo VTEX) con el paymentId/orderId EXACTOS
// que usó la entrada (el caller los lee del Ctx: vtexPaymentId / vtexOrderId). Legacy aprueba solo si
// el user_request llegó a Estado 11.
func VtexSettle(cfg config.TestConfig, paymentID, orderID string) (map[string]interface{}, error) {
	return client.Post(vtexBase(cfg)+"/vtex/settel", map[string]interface{}{
		"paymentId": paymentID,
		"orderId":   orderID,
		"requestId": "vtex_settle_" + orderID,
	})
}

// SimulateAggregatorResult hace POST al simulador de agregador: el backend cambia el estado del
// user_request VÍA ELOQUENT → dispara UserRequestObserver → notifica al comercio. Imita el webhook de
// un lender externo (Bancolombia/Sistecrédito) que el harness no puede cerrar (deciden vía API externa).
func SimulateAggregatorResult(cfg config.TestConfig, userRequestID int64, status int) (map[string]interface{}, error) {
	return client.Post(vtexBase(cfg)+"/simulator/aggregator-result", map[string]interface{}{
		"user_request_id": userRequestID,
		"status":          status,
	})
}

// VtexSteps maneja la entrada por el canal VTEX: el harness ACTÚA COMO el conector VTEX contra los
// endpoints /vtex/* de legacy. Secuencia:
//  1. POST /vtex/init → legacy genera la URL base64 (crea el EcommerceRequest con ecommerce_id de la
//     credencial, normalmente 3=VTEX).
//  2. decodifica la URL → POST /ecommerce-request/create (simula al frontend-monorepo consumiendo la
//     URL; mismo order_key → upsert sobre la MISMA fila de init, no duplica).
//  3. register → otp-validate (con ecommerce_request_id) → personal → laboral (si el comercio no lo
//     auto-inyecta).
//
// El settle (/vtex/settel) y la aserción del webhook de salida los agrega runOne tras el cierre.
func VtexSteps(db *sql.DB, cfg config.TestConfig, m merchant.Merchant, p Person) []flow.Step {
	p = p.withDefaults()
	total := cfg.TestAmount

	steps := []flow.Step{
		{
			Title: "Ecommerce init — legacy genera la URL base64 (/vtex/init)",
			Desc:  "El harness hace de conector ecommerce: POST /vtex/init {partnerKey, secretToken, value, callbackUrl}. Legacy crea el EcommerceRequest (ecommerce_id desde la credencial) y devuelve el redirectUrl base64 (contrato unificado).",
			Run: func(c *flow.Ctx) (string, error) {
				mocks.EnsureOtpBypass(db, cfg.TestPhone)
				token, err := branchToken(db, m.Hash)
				if err != nil || token == "" {
					return "", fmt.Errorf("token ecommerce no encontrado para %s (%s): %v", m.Name, m.Hash, err)
				}
				// order_key/identifier ÚNICOS por corrida → ER fresco (processed=0); el settle los lee del Ctx.
				u := vtexUnique()
				paymentID := VtexPaymentID(m.Hash) + "_" + u
				orderID := VtexOrderID(m.Hash) + "_" + u
				c.Set("vtexPaymentId", paymentID)
				c.Set("vtexOrderId", orderID)
				body := map[string]interface{}{
					"paymentId":   paymentID,
					"orderId":     orderID,
					"value":       total,
					"currency":    "COP",
					"partnerKey":  m.Hash,
					"secretToken": token,
					"callbackUrl": storeProcessURL(), // mock store → captura el webhook de salida (branch-3)
					"returnUrl":   "https://tienda-e2e.test/return",
					"products": []map[string]interface{}{
						{"product_id": 101, "name": "Producto VTEX E2E", "sku": "SKU-VTEX", "price": fmt.Sprintf("%d", total), "quantity": 1},
					},
				}
				resp, err := client.Post(vtexBase(cfg)+"/vtex/init", body)
				if err != nil {
					return "", fmt.Errorf("vtex/init: %w", err)
				}
				authID := mocks.FindKey(resp, "authorizationId")
				redirectURL, _ := resp["redirectUrl"].(string)
				if authID == 0 || redirectURL == "" {
					return "", fmt.Errorf("vtex/init no devolvió authorizationId/redirectUrl: %v", resp)
				}
				c.Set("redirectURL", redirectURL)
				return fmt.Sprintf("authorizationId=%d · redirectUrl base64 (%d chars)", authID, len(redirectURL)), nil
			},
		},
		{
			Title: "Frontend sim — decodifica la URL base64 → POST create",
			Desc:  "Simula al frontend-monorepo consumiendo la URL: extrae o/p/t/u/ps/config del redirectUrl y los reenvía a /ecommerce-request/create. Mismo order_key → upsert sobre la fila creada en init (no duplica).",
			Run: func(c *flow.Ctx) (string, error) {
				u, err := url.Parse(c.Str("redirectURL"))
				if err != nil {
					return "", fmt.Errorf("redirectUrl inválida: %w", err)
				}
				q := u.Query()
				payload := map[string]interface{}{
					"order":      q.Get("o"),
					"products":   q.Get("p"),
					"token":      q.Get("t"),
					"returnUrl":  q.Get("u"),
					"processUrl": q.Get("ps"),
					"config":     q.Get("config"),
				}
				resp, err := client.Post(cfg.ApiBaseURL+"/onboarding/ecommerce-request/create/"+m.Hash, payload)
				if err != nil {
					return "", fmt.Errorf("ecommerce-request/create: %w", err)
				}
				ecomID := mocks.FindKey(resp, "ecommerceRequestId")
				if ecomID == 0 {
					return "", fmt.Errorf("create no devolvió ecommerceRequestId: %v", resp)
				}
				c.Set("ecomID", ecomID)
				return fmt.Sprintf("ecommerce_request #%d (mismo order_key → upsert sobre la fila de init)", ecomID), nil
			},
		},
		{
			Title: "Registro + OTP (con ecommerce_request_id)",
			Desc:  "Registra el celular y valida el OTP (bypass = últimos 4) anclando la orden ecommerce → crea el user_request.",
			Run: func(c *flow.Ctx) (string, error) {
				if err := Register(cfg, m.Hash, false, !m.NeedsPersonalInfo()); err != nil {
					return "", fmt.Errorf("phone/register: %w", err)
				}
				otpResp, err := client.Post(fmt.Sprintf("%s/onboarding/loan-application/otp-validate/%s", cfg.ApiBaseURL, m.Hash),
					map[string]interface{}{
						"cell_phone": cfg.TestPhone, "otp_code": OtpCode(cfg.TestPhone, 4),
						"original_amount": total, "amount": total, "ecommerce_request_id": fmt.Sprintf("%d", c.Int("ecomID")),
					})
				if err != nil {
					return "", fmt.Errorf("otp-validate: %w", err)
				}
				uReqID := mocks.FindKey(otpResp, "user_request_id")
				if uReqID == 0 {
					return "", fmt.Errorf("otp-validate no devolvió user_request_id")
				}
				c.Set("uReqID", uReqID)
				return fmt.Sprintf("user_request #%d", uReqID), nil
			},
		},
		{
			Title: "Perfilamiento personal (AML)",
			Desc:  "Guarda identidad/ubicación y dispara la validación de identidad.",
			Run: func(c *flow.Ctx) (string, error) {
				if err := PersonalInfo(cfg, m.Hash, c.Int64("uReqID"), p); err != nil {
					return "", fmt.Errorf("personal-info: %w", err)
				}
				return "personal-info OK", nil
			},
		},
	}

	if m.SkipLaboral() {
		steps = append(steps, flow.Step{
			Title: "Capacidad de pago (laboral) — auto-inyectada",
			Desc:  fmt.Sprintf("Comercio %s: el backend auto-inyecta el ingreso durante personal-info; se omite el formulario laboral.", m.Kind),
			Run:   func(c *flow.Ctx) (string, error) { return "ingreso inyectado por el backend (no se envía formulario)", nil },
		})
	} else {
		steps = append(steps, flow.Step{
			Title: "Capacidad de pago (laboral)",
			Desc:  "Envía situación laboral + ingresos.",
			Run: func(c *flow.Ctx) (string, error) {
				if err := LaboralInfo(cfg, m.Hash, c.Int64("uReqID"), p); err != nil {
					return "", fmt.Errorf("laboral-info: %w", err)
				}
				return "laboral-info OK", nil
			},
		})
	}

	return steps
}
