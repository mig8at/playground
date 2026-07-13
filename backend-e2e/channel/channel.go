// Package channel es el eje CANAL del modelo [channel] → [merchant] → [lender]: cómo ENTRA el flujo.
//   - asesor: originación en tienda (register → otp → personal → laboral).
//   - web:    ecommerce/headless (entrada base64, ver web.go).
// El comportamiento de entrada se adapta al merchant (Motai pone isMotaiRenting; Corbeta/Pullman
// omiten el laboral porque el backend lo auto-inyecta).
package channel

import (
	"creditop-tests/merchant"
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/flow"
	"creditop-tests/pkg/mocks"
	"database/sql"
	"fmt"
)

// Channel es el punto de entrada del flujo.
type Channel string

const (
	Web    Channel = "web"
	Asesor Channel = "asesor"
	Vtex   Channel = "vtex"
)

// Valid indica si el canal es conocido.
func (c Channel) Valid() bool { return c == Web || c == Asesor || c == Vtex }

// Person son los datos demográficos de la entrada; los ceros caen a defaults.
type Person struct {
	Name, Surname, Gender, DocumentType string
	Income                              int
}

func (p Person) withDefaults() Person {
	if p.Name == "" {
		p.Name = "TEST"
	}
	if p.Surname == "" {
		p.Surname = "CREDITOP"
	}
	if p.Gender == "" {
		p.Gender = "M"
	}
	if p.DocumentType == "" {
		p.DocumentType = "CC"
	}
	if p.Income == 0 {
		p.Income = 2500000
	}
	return p
}

// OtpCode deriva el código de bypass (últimos n dígitos del teléfono).
func OtpCode(phone string, n int) string {
	if len(phone) < n {
		return phone
	}
	return phone[len(phone)-n:]
}

// Entry corre la entrada del canal para el comercio dado y devuelve el user_request_id.
// Internamente arma los pasos del canal (AsesorSteps/WebSteps) y los ejecuta inline (sin cabecera):
// así los comandos que solo necesitan la entrada (perfilador/offer/random) reusan los mismos pasos.
func Entry(db *sql.DB, cfg config.TestConfig, ch Channel, m merchant.Merchant, p Person) (int64, error) {
	var steps []flow.Step
	switch ch {
	case Web:
		steps = WebSteps(db, cfg, m, p)
	case Vtex:
		steps = VtexSteps(db, cfg, m, p)
	case Asesor:
		steps = AsesorSteps(db, cfg, m, p)
	default:
		return 0, fmt.Errorf("canal desconocido: %q (usa web|asesor|vtex)", ch)
	}
	c := flow.NewCtx()
	err := flow.New("", "").Add(steps...).RunInline(c)
	return c.Int64("uReqID"), err
}

// AsesorSteps son los pasos de la entrada por ASESOR (originación en tienda): registro → OTP →
// perfilamiento → laboral (omitido si el comercio lo auto-inyecta). Cada paso publica el
// user_request_id en el Ctx ("uReqID") para que el cierre lo use.
func AsesorSteps(db *sql.DB, cfg config.TestConfig, m merchant.Merchant, p Person) []flow.Step {
	motai := m.IsMotai()
	steps := []flow.Step{
		{
			Title: "Registro + políticas de datos",
			Desc:  "Entra por el asesor: registra el celular y acepta términos/tratamiento de datos. (Pullman: se OMITE el documento aquí para que personal-info lo fije por primera vez y dispare Quanto; si no, ONB005 DOCUMENT_DUPLICATE.)",
			Run: func(c *flow.Ctx) (string, error) {
				mocks.EnsureOtpBypass(db, cfg.TestPhone)
				if err := Register(cfg, m.Hash, motai, !m.NeedsPersonalInfo()); err != nil {
					return "", fmt.Errorf("phone/register: %w", err)
				}
				return "celular registrado · OTP en modo bypass (últimos 4 dígitos)", nil
			},
		},
		{
			Title: "Autenticación de identidad (OTP)",
			Desc:  "Valida el OTP (en local = últimos 4 dígitos del teléfono) → crea/obtiene el user_request.",
			Run: func(c *flow.Ctx) (string, error) {
				uReqID, err := ValidateOtp(cfg, m.Hash, motai)
				if err != nil {
					return "", err
				}
				c.Set("uReqID", uReqID)
				return fmt.Sprintf("user_request #%d (estado 9)", uReqID), nil
			},
		},
		{
			Title: "Perfilamiento personal (AML)",
			Desc:  "Guarda identidad/ubicación y dispara la validación de identidad (Experian/ADO).",
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
			Desc:  fmt.Sprintf("Comercio %s: el backend AUTO-INYECTA el ingreso (Quanto/dummy) durante personal-info; se omite el formulario laboral.", m.Kind),
			Run:   func(c *flow.Ctx) (string, error) { return "ingreso inyectado por el backend (no se envía formulario)", nil },
		})
	} else {
		steps = append(steps, flow.Step{
			Title: "Capacidad de pago (laboral)",
			Desc:  "Envía situación laboral + ingresos (formulario laboral).",
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

// --- pasos sueltos (reutilizables; p.ej. el cierre revolving repite otp-validate) ---

// Register hace POST /phone/register. motai añade el flag isMotaiRenting. sendDoc controla si se
// manda document_number (es `sometimes` en el backend): se omite cuando personal-info debe fijar el
// documento por primera vez (ver NeedsPersonalInfo / Pullman).
func Register(cfg config.TestConfig, hash string, motai, sendDoc bool) error {
	body := map[string]interface{}{
		"phone_number": cfg.TestPhone, "otp_length": 4, "terms": true, "policies": true,
		"partner_branch_hash": hash,
	}
	if sendDoc {
		body["document_number"] = cfg.TestDoc
	}
	if motai {
		body["isMotaiRenting"] = true
	}
	_, err := client.Post(cfg.ApiBaseURL+"/onboarding/phone/register", body)
	return err
}

// ValidateOtp hace POST /otp-validate (OTP por bypass = últimos 4) y devuelve el user_request_id.
func ValidateOtp(cfg config.TestConfig, hash string, motai bool) (int64, error) {
	body := map[string]interface{}{
		"cell_phone": cfg.TestPhone, "otp_code": OtpCode(cfg.TestPhone, 4),
		"original_amount": cfg.TestAmount, "amount": cfg.TestAmount,
	}
	if motai {
		body["isMotaiRenting"] = true
	}
	resp, err := client.Post(fmt.Sprintf("%s/onboarding/loan-application/otp-validate/%s", cfg.ApiBaseURL, hash), body)
	if err != nil {
		return 0, err
	}
	uReqID := mocks.FindKey(resp, "user_request_id")
	if uReqID == 0 {
		return 0, fmt.Errorf("otp-validate no devolvió user_request_id")
	}
	return uReqID, nil
}

// PersonalInfo hace POST /personal-info (perfil demográfico + AML).
func PersonalInfo(cfg config.TestConfig, hash string, uReqID int64, p Person) error {
	p = p.withDefaults()
	_, err := client.Post(
		fmt.Sprintf("%s/onboarding/loan-application/personal-info/%s/%d", cfg.ApiBaseURL, hash, uReqID),
		map[string]interface{}{
			"document_type": p.DocumentType, "document_number": cfg.TestDoc, "name": p.Name, "surname": p.Surname,
			"email": cfg.TestEmail, "expedition_day": 1, "expedition_month": 1, "expedition_year": 2010,
			"address": "Calle 100", "gender": p.Gender, "city_id": 1,
		})
	return err
}

// OfferedLender es un lender que el marketplace devuelve para un branch.
type OfferedLender struct {
	ID, ResponseType int
	Name             string
}

// Marketplace hace GET /lenders para la solicitud y devuelve los lenders ofrecidos (id/name/rt),
// deduplicados. Sirve para descubrir pares (comercio, lender) válidos para validar.
func Marketplace(cfg config.TestConfig, hash string, uReqID int64) []OfferedLender {
	resp, err := client.Get(fmt.Sprintf("%s/onboarding/loan-application/lenders/%d", cfg.ApiBaseURL, uReqID))
	if err != nil {
		return nil
	}
	seen := map[int]bool{}
	var out []OfferedLender
	var walk func(v interface{})
	walk = func(v interface{}) {
		switch x := v.(type) {
		case map[string]interface{}:
			for k, vv := range x {
				if k == "lenders" {
					if arr, ok := vv.([]interface{}); ok {
						for _, e := range arr {
							em, ok := e.(map[string]interface{})
							if !ok {
								continue
							}
							id := 0
							if f, ok := em["id"].(float64); ok {
								id = int(f)
							}
							if id == 0 || seen[id] {
								continue
							}
							seen[id] = true
							name, _ := em["name"].(string)
							rt := 0
							if f, ok := em["response_type"].(float64); ok {
								rt = int(f)
							}
							out = append(out, OfferedLender{ID: id, Name: name, ResponseType: rt})
						}
					}
				}
				walk(vv)
			}
		case []interface{}:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(resp)
	return out
}

// LaboralInfo hace POST /laboral-info (situación laboral + ingresos).
func LaboralInfo(cfg config.TestConfig, hash string, uReqID int64, p Person) error {
	p = p.withDefaults()
	_, err := client.Post(
		fmt.Sprintf("%s/onboarding/loan-application/laboral-info/%s/%d", cfg.ApiBaseURL, hash, uReqID),
		map[string]interface{}{"employment_situation": "Empleado", "income_amount": p.Income, "original_amount": cfg.TestAmount, "amount": cfg.TestAmount})
	return err
}
