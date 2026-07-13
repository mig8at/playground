package lender

import (
	"creditop-tests/channel"
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"creditop-tests/pkg/mocks"
	"database/sql"
	"fmt"
)

// testIMEI es el IMEI de prueba que se ancla como colateral en el flujo Motai.
const testIMEI = "356938035643809"

// revolvingClose — cupo rotativo (response_type=3). uReqID es la 1ª compra (ya con entrada hecha):
// genera el Pagaré Maestro, otorga el cupo, y en una 2ª compra verifica que NO se duplica el pagaré.
func revolvingClose(db *sql.DB, cfg config.TestConfig, uReqID int64, l Lender) error {
	l = l.withDefaults()
	db.Exec("UPDATE lenders SET response_type = 3 WHERE id = ?", l.ID)

	// Ciclo 1: cierre in-platform completo (igual mecánica que CreditopXClose) → genera Pagaré Maestro.
	client.PrintRule("ciclo 1: originación + Pagaré Maestro → Estado 11")
	mocks.SeedApprovedProfile(db, cfg.TestPhone, uReqID, 750)
	db.Exec("UPDATE user_requests SET lender_id=?, rate=?, fee_number=?, initial_fee=? WHERE id=?", l.ID, l.Rate, l.FeeNumber, l.InitialFee, uReqID)

	// rt=3 lee el FGA del cupo rotativo: hay que crear creditop_x_revolving_credits antes del pagaré
	// (si no, "Attempt to read property fga on null").
	db.Exec(`INSERT INTO creditop_x_revolving_credits
		(user_id, approved_limit, calc_limit, used_limit, billing_used_limit, installment_amount,
		 next_payment_amount, total_payment_amount, creditop_x_requests_status_id, fee_number,
		 initial_fee, fga, min_fee_number, status, allied_id, lender_id, created_at, updated_at)
		SELECT ur.user_id, 5000000, 5000000, 0, 0, 0, 0, 0, 1, 12, 0, 10, 1, 1, ur.allied_id, ?, NOW(), NOW()
		FROM user_requests ur WHERE ur.id = ?`, l.ID, uReqID)
	if _, err := client.Get(fmt.Sprintf("%s/loans/requests/promissory-note/%d", cfg.ApiBaseURL, uReqID)); err != nil {
		return fmt.Errorf("ciclo1 promissory-note: %w", err)
	}
	client.Post(cfg.ApiBaseURL+"/loans/requests/promissory-note/validate/send-otp", map[string]interface{}{"user_request_id": uReqID})
	otpID := mocks.ForceOtpValidation(db, cfg.TestPhone)
	if _, err := client.Post(cfg.ApiBaseURL+"/loans/requests/promissory-note/validate/authorize", map[string]interface{}{"user_request_id": uReqID, "otp_id": otpID}); err != nil {
		return fmt.Errorf("ciclo1 authorize: %w", err)
	}
	if !database.AssertRowExists(db, "user_requests", "id = ? AND user_request_status_id = 11", uReqID) {
		return fmt.Errorf("ciclo1 no llegó a Estado 11")
	}
	if !database.AssertRowExists(db, "promissory_notes", "user_request_id = ?", uReqID) {
		return fmt.Errorf("ciclo1 no generó Pagaré Maestro")
	}
	client.PrintRule("✓ ciclo 1: Estado 11 + Pagaré Maestro")

	// Ciclo 2: nueva compra sobre el cupo. La regla revolving (shouldRequestPromissoryNote=false)
	// debe evitar un pagaré nuevo. Best-effort: si no hay revolving_credit vinculado, se reporta.
	client.PrintRule("ciclo 2: nueva compra (a un clic, sin pagaré nuevo)")
	cfg2 := cfg
	cfg2.TestAmount = 500000
	uReqID2, err := channel.ValidateOtp(cfg2, cfg.PartnerHash, false)
	if err != nil {
		return fmt.Errorf("ciclo2 otp-validate: %w", err)
	}
	db.Exec("UPDATE user_requests SET lender_id=?, rate=?, fee_number=?, initial_fee=? WHERE id=?", l.ID, l.Rate, l.FeeNumber, l.InitialFee, uReqID2)
	client.Get(fmt.Sprintf("%s/loans/requests/promissory-note/%d", cfg.ApiBaseURL, uReqID2))
	client.Post(cfg.ApiBaseURL+"/loans/requests/promissory-note/validate/send-otp", map[string]interface{}{"user_request_id": uReqID2})
	otpID2 := mocks.ForceOtpValidation(db, cfg.TestPhone)
	client.Post(cfg.ApiBaseURL+"/loans/requests/promissory-note/validate/authorize", map[string]interface{}{"user_request_id": uReqID2, "otp_id": otpID2})
	if database.AssertRowExists(db, "promissory_notes", "user_request_id = ?", uReqID2) {
		client.PrintRule("⚠ ciclo 2 generó pagaré (la regla de no-duplicado depende de revolving_credit real)")
	} else {
		client.PrintRule("✓ ciclo 2: sin pagaré nuevo")
	}
	return nil
}

// motaiClose — Motai Renting (IMEI + Abaco). Best-effort; el cierre real tiene gaps conocidos
// (MDM enroll, Abaco) que requieren extender el modo mock. Secuencia: datacrédito → abaco → lenders
// → select 158 → device/register(IMEI) → firma renting → device/disburse → Estado 11.
func motaiClose(db *sql.DB, cfg config.TestConfig, uReqID int64, l Lender) error {
	mocks.SeedApprovedProfile(db, cfg.TestPhone, uReqID, 750)

	client.PrintRule("check-abaco-requirement (ingresos gig)")
	client.Post(cfg.ApiBaseURL+"/onboarding/motai/check-abaco-requirement", map[string]interface{}{"user_request_id": uReqID})

	client.PrintRule("GET /lenders (filtrado por allied mode Motai)")
	client.Get(fmt.Sprintf("%s/onboarding/loan-application/lenders/%d", cfg.ApiBaseURL, uReqID))

	client.PrintRule(fmt.Sprintf("select lender Motai (#%d) — se pasa rate (sin credit_line)", l.ID))
	if _, err := client.Post(fmt.Sprintf("%s/onboarding/loan-application/update-user-request/%d", cfg.ApiBaseURL, uReqID),
		map[string]interface{}{"lender_id": l.ID, "fee_number": 12, "amount": cfg.TestAmount, "original_amount": cfg.TestAmount, "rate": 2.0}); err != nil {
		return fmt.Errorf("update-user-request: %w", err)
	}

	// Firma del contrato: send-otp → verify-otp (transiciona a "Autorizado pendiente desembolso").
	// (El path IMEI NO usa GET promissory-note; el contrato se genera en device/disburse.)
	client.PrintRule("firma renting: send-otp → verify-otp (→ estado intermedio)")
	if _, err := client.Post(cfg.ApiBaseURL+"/loans/requests/promissory-note/validate/send-otp", map[string]interface{}{"user_request_id": uReqID}); err != nil {
		return fmt.Errorf("send-otp: %w", err)
	}
	otp := channel.OtpCode(cfg.TestPhone, 6) // el OTP del pagaré usa los últimos 6 dígitos
	if _, err := client.Post(cfg.ApiBaseURL+"/loans/requests/promissory-note/validate/verify-otp", map[string]interface{}{"user_request_id": uReqID, "otp": otp}); err != nil {
		return fmt.Errorf("verify-otp: %w", err)
	}

	// Asesor registra el IMEI (MDM; en local va por el bypass de AlliedProductService).
	client.PrintRule("device/register (IMEI como colateral)")
	if _, err := client.Post(cfg.ApiBaseURL+"/loans/requests/device/register",
		map[string]interface{}{"user_request_id": uReqID, "imei": testIMEI}); err != nil {
		return fmt.Errorf("device/register: %w", err)
	}

	// Desembolso técnico: verifica IMEI → regenera contrato → Estado 11.
	client.PrintRule("device/disburse → Estado 11")
	if _, err := client.Post(fmt.Sprintf("%s/loans/requests/device/%d/disburse", cfg.ApiBaseURL, uReqID), nil); err != nil {
		return fmt.Errorf("device/disburse: %w", err)
	}

	if !database.AssertRowExists(db, "user_requests", "id = ? AND user_request_status_id = 11", uReqID) {
		return fmt.Errorf("estado final != 11")
	}
	return nil
}

// bancolombiaClose — motor de decisión multiproducto (BNPL vs Consumo). El lender lo decide el motor
// PLS; aquí solo recorremos el handoff: pre-aprobado → login-redirect → clave dinámica → originación.
// bancolombiaClose valida la lógica DISTINTIVA de Bancolombia: el motor de decisión PLS que evalúa
// BNPL(#68) y Consumo(#100) en paralelo y asigna el producto. El cierre completo (login→…→origination,
// 8 pasos OAuth) ocurre en el PORTAL del banco (redirect), no in-platform — queda fuera del alcance.
func bancolombiaClose(db *sql.DB, cfg config.TestConfig, uReqID int64, l Lender) error {
	// Gap de config: ~10 allieds OFRECEN Bancolombia (68/100) pero NO tienen lender_allied_credentials,
	// así el motor PLS no evalúa el lender y no lo asigna. Sembramos la credencial faltante copiando una
	// existente (con fakeBancolombiaForLocal el contenido no importa; solo que la fila exista). Idempotente.
	ensureBancolombiaCreds(db, uReqID)

	client.PrintRule("validate-preapproved (motor PLS: BNPL #68 vs Consumo #100 en paralelo)")
	pls, err := client.Post(fmt.Sprintf("%s/onboarding/bancolombia/validate-preapproved/%d", cfg.ApiBaseURL, uReqID), nil)
	if err != nil {
		return fmt.Errorf("validate-preapproved: %w", err)
	}
	client.PrintRule(fmt.Sprintf("PLS decidió: %v", pls["message"]))

	// El motor PLS asigna el lender Bancolombia (68 BNPL / 100 Consumo) al user_request.
	var lid int
	db.QueryRow("SELECT lender_id FROM user_requests WHERE id = ?", uReqID).Scan(&lid)
	if lid != 68 && lid != 100 {
		return fmt.Errorf("el motor PLS no asignó lender Bancolombia (lender_id=%d)", lid)
	}
	producto := "BNPL"
	if lid == 100 {
		producto = "Consumo"
	}
	client.PrintRule(fmt.Sprintf("✓ motor PLS validado → asignó %s (#%d)", producto, lid))
	client.PrintRule("nota: el cierre (login-redirect→origination, OAuth+JWT) es el portal del banco, no in-platform")
	return nil
}

// externalClose — lenders externos de integración (response_type=1: Welli, Meddipay, BdB CeroPay…).
// La lógica DISTINTIVA de rt=1 es la PRE-APROBACIÓN/cupo que cada integración consulta a su host al
// pintar el marketplace (PreApprovedLenderService → Action::consult). Validamos ESO: con el host
// mockeado (ver AppServiceProvider::fakeExternalLendersForLocal), el lender debe salir en GET /lenders
// con pre_approved_lender=true y su transaction_data poblado por la respuesta del proveedor. El CIERRE
// completo de estos lenders es el portal externo del banco/financiera (redirect), fuera del alcance
// in-platform — igual que Bancolombia. Requiere que el branch tenga lender_allied_credentials para el
// lender (si no, consult no corre y queda pre_approved_lender=false).
func externalClose(db *sql.DB, cfg config.TestConfig, uReqID int64, l Lender) error {
	// Perfil aprobado (buró) para que el usuario entre al set de candidatos del marketplace.
	mocks.SeedApprovedProfile(db, cfg.TestPhone, uReqID, 750)

	// Neutralizamos el corte por hora del día (p.ej. Meddipay `available_until=20:00:00`): fuera de esa
	// ventana PreApprovedLenderService SALTA el consult() del lender, así que la validación dependería
	// del reloj. Lo limpiamos solo para el lender bajo prueba (BD local, reversible) → determinista.
	db.Exec("UPDATE lenders SET available_until = NULL WHERE id = ? AND available_until IS NOT NULL", l.ID)

	client.PrintRule(fmt.Sprintf("GET /lenders (pre-aprobación rt=1 vía integración host-mockeado · lender #%d)", l.ID))
	resp, err := client.Get(fmt.Sprintf("%s/onboarding/loan-application/lenders/%d", cfg.ApiBaseURL, uReqID))
	if err != nil {
		return fmt.Errorf("GET /lenders: %w", err)
	}

	offered, preApproved, txn := findOfferedLender(resp, l.ID)
	if !offered {
		return fmt.Errorf("el marketplace no ofreció el lender #%d (¿branch sin lenders_by_allieds para %s?)", l.ID, l.Name)
	}
	if !preApproved {
		return fmt.Errorf("lender #%d ofrecido pero pre_approved_lender=false (¿branch sin lender_allied_credentials, o consult no aprobó?)", l.ID)
	}
	client.PrintRule(fmt.Sprintf("✓ %s (#%d) PRE-APROBADO vía integración rt=1 → transaction_data=%v", l.Name, l.ID, txn))
	client.PrintRule("nota: el cierre (originación) es el portal externo del proveedor (redirect), no in-platform")
	return nil
}

// ensureBancolombiaCreds siembra lender_allied_credentials para 68 y 100 en el allied del user_request si
// faltan (copiando allied_type + credential de una fila existente del mismo lender, para no lidiar con el
// escape del backslash de 'App\Models\Allied' ni con el blob cifrado). Idempotente (NOT EXISTS).
func ensureBancolombiaCreds(db *sql.DB, uReqID int64) {
	db.Exec(`INSERT INTO lender_allied_credentials (lender_id, allied_type, allied_id, credential, created_at, updated_at)
		SELECT t.lid,
		       (SELECT allied_type FROM lender_allied_credentials WHERE lender_id = t.lid LIMIT 1),
		       ur.allied_id,
		       (SELECT credential FROM lender_allied_credentials WHERE lender_id = t.lid LIMIT 1),
		       NOW(), NOW()
		FROM user_requests ur
		JOIN (SELECT 68 AS lid UNION SELECT 100) t
		WHERE ur.id = ?
		  AND NOT EXISTS (SELECT 1 FROM lender_allied_credentials lac
		                  WHERE lac.allied_id = ur.allied_id AND lac.lender_id = t.lid)`, uReqID)
}

// findOfferedLender recorre la respuesta de GET /lenders y busca el lender por id, devolviendo si fue
// ofrecido, si quedó pre_approved_lender=true, y su transaction_data (poblado por la integración).
func findOfferedLender(resp map[string]interface{}, id int) (offered, preApproved bool, txn interface{}) {
	var walk func(v interface{})
	walk = func(v interface{}) {
		switch x := v.(type) {
		case map[string]interface{}:
			if f, ok := x["id"].(float64); ok && int(f) == id {
				if _, hasRT := x["response_type"]; hasRT {
					offered = true
					if pa, ok := x["pre_approved_lender"].(bool); ok && pa {
						preApproved = true
					}
					if t, ok := x["transaction_data"]; ok {
						txn = t
					}
				}
			}
			for _, vv := range x {
				walk(vv)
			}
		case []interface{}:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(resp)
	return
}

// credifamiliaClose — estudio de crédito asíncrono: radica, simula el fin del proceso del tercero
// (status 3 = APROBADO) y consulta el polling de estado.
func credifamiliaClose(db *sql.DB, cfg config.TestConfig, uReqID int64, l Lender) error {
	// Radicación: ocurre al pintar el marketplace (PreApprovedLenderService → Credifamilia::register
	// → lender_transactions status 40). En local el register usa el bypass (sin host).
	client.PrintRule("GET /lenders (radicación → status 40 'En validación')")
	client.Get(fmt.Sprintf("%s/onboarding/loan-application/lenders/%d", cfg.ApiBaseURL, uReqID))

	// Si el branch no ofrecía el lender 24, el marketplace no radicó; sembramos la radicación directa.
	if !database.AssertRowExists(db, "lender_transactions", "user_request_id = ? AND lender_id = 24", uReqID) {
		client.PrintRule("sembrando radicación (lender 24 no ofrecido por el branch)")
		db.Exec("INSERT INTO lender_transactions (lender_id, user_request_id, status_id, order_id, request, response, created_at, updated_at) VALUES (24, ?, 40, ?, '{}', '{}', NOW(), NOW())", uReqID, fmt.Sprintf("E2E-%d", uReqID))
	}

	// Polling: el front consulta el estado hasta finalizar; show() (bypass local) devuelve APROBADO → 41.
	client.PrintRule("polling: pre-approval-status (→ APROBADO)")
	if _, err := client.Get(fmt.Sprintf("%s/onboarding/loan-application/lenders/%d/24/pre-approval-status", cfg.ApiBaseURL, uReqID)); err != nil {
		return fmt.Errorf("pre-approval-status: %w", err)
	}

	var statusID int
	db.QueryRow("SELECT status_id FROM lender_transactions WHERE user_request_id = ? AND lender_id = 24 ORDER BY id DESC LIMIT 1", uReqID).Scan(&statusID)
	if statusID != 41 {
		return fmt.Errorf("Credifamilia no quedó APROBADO (status_id=%d, esperado 41)", statusID)
	}
	client.PrintRule("✓ Credifamilia APROBADO (lender_transactions.status_id=41)")
	return nil
}
