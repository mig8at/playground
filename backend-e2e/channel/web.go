package channel

import (
	"creditop-tests/merchant"
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/flow"
	"creditop-tests/pkg/mocks"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// WebSteps son los pasos de la entrada por el canal WEB (ecommerce/headless): el handshake
// ecommerce-request/create con el contrato base64 (decode PHP-serializado) ancla la orden, luego
// register → otp-validate (con ecommerce_request_id) → personal → laboral. Publica el
// user_request_id en el Ctx ("uReqID"). El contrato base64 se arma con phpSerialize (ver abajo).
func WebSteps(db *sql.DB, cfg config.TestConfig, m merchant.Merchant, p Person) []flow.Step {
	p = p.withDefaults()
	total := cfg.TestAmount
	return []flow.Step{
		{
			Title: "Handshake ecommerce — create (contrato base64 → decode en PHP)",
			Desc:  "La tienda envía el contrato (order/products/token/return/process/config en base64 PHP-serializado); el backend lo decodifica y crea el ecommerce_request anclado a la orden.",
			Run: func(c *flow.Ctx) (string, error) {
				mocks.EnsureOtpBypass(db, cfg.TestPhone)
				token, err := branchToken(db, m.Hash)
				if err != nil || token == "" {
					return "", fmt.Errorf("token ecommerce no encontrado para comercio %s (%s): %v", m.Name, m.Hash, err)
				}
				order := map[string]any{
					"id": 5002, "order_key": "wc_e2e_" + m.Hash, "total": fmt.Sprintf("%d", total),
					"billing": map[string]any{
						"first_name": p.Name, "last_name": p.Surname, "phone": cfg.TestPhone,
						"email": cfg.TestEmail, "document_type": "CC", "document_number": cfg.TestDoc,
					},
				}
				products, _ := json.Marshal([]map[string]any{
					{"product_id": 101, "name": "Producto E2E", "sku": "SKU-E2E", "price": fmt.Sprintf("%d", total)},
				})
				configJSON, _ := json.Marshal([]any{})
				payload := map[string]interface{}{
					"order":      b64(phpSerialize(order)),
					"products":   b64(string(products)),
					"token":      b64(token),
					"returnUrl":  b64(phpSerialize("https://tienda-e2e.test/return")),
					"processUrl": b64(storeProcessURL()), // mock store when the listener is up (see storewebhook.go)
					"config":     b64(phpSerialize(string(configJSON))),
				}
				resp, err := client.Post(cfg.ApiBaseURL+"/onboarding/ecommerce-request/create/"+m.Hash, payload)
				if err != nil {
					return "", fmt.Errorf("ecommerce-request/create: %w", err)
				}
				ecomID := mocks.FindKey(resp, "ecommerceRequestId")
				if ecomID == 0 {
					return "", fmt.Errorf("create no devolvió ecommerceRequestId")
				}
				c.Set("ecomID", ecomID)
				return fmt.Sprintf("ecommerce_request #%d (orden anclada)", ecomID), nil
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
		{
			Title: "Capacidad de pago (laboral)",
			Desc:  "Envía situación laboral + ingresos.",
			Run: func(c *flow.Ctx) (string, error) {
				if err := LaboralInfo(cfg, m.Hash, c.Int64("uReqID"), p); err != nil {
					return "", fmt.Errorf("laboral-info: %w", err)
				}
				return "laboral-info OK", nil
			},
		},
	}
}

// branchToken lee el token ecommerce (texto plano en allied_ecommerce_credentials.credential).
func branchToken(db *sql.DB, hash string) (string, error) {
	var t string
	err := db.QueryRow(`SELECT aec.credential FROM allied_ecommerce_credentials aec
		JOIN allied_branches ab ON ab.id = aec.allied_branch_id WHERE ab.hash = ? LIMIT 1`, hash).Scan(&t)
	return t, err
}

// --- subconjunto de serialize() de PHP que necesita el contrato del plugin ecommerce ---

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

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
