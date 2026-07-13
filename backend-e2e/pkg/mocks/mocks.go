package mocks

import (
	"creditop-tests/pkg/client"
	"database/sql"
	"fmt"
	"os/exec"
	"strings"
)

// SeedApprovedProfile siembra un perfil aprobado (datacrédito) para que el cierre
// asigne categoría de lender y genere documentos: users.age/gender/email, occupation
// (field 29) y una fila risk_central_user_data con score PLANO + `data` (encriptado,
// por eso vía `php artisan tinker`). Espejo del seed de backend-e2e/woocommerce.
func SeedApprovedProfile(db *sql.DB, phone string, uReqID int64, score int) {
	var uid int64
	// El user_request es el dato autoritativo (el flujo lo creó); el teléfono puede no coincidir
	// (el backend local genera usuarios TEMP con celular propio). Fallback al teléfono por compat.
	db.QueryRow("SELECT user_id FROM user_requests WHERE id = ? LIMIT 1", uReqID).Scan(&uid)
	if uid == 0 {
		db.QueryRow("SELECT id FROM users WHERE cell_phone = ? ORDER BY id DESC LIMIT 1", phone).Scan(&uid)
	}
	if uid == 0 {
		client.FatalError("SeedApprovedProfile: usuario no encontrado", nil, nil)
	}
	php := fmt.Sprintf(`
$u = \App\Models\User::find(%d);
if ($u) { if (empty($u->gender)) { $u->gender='M'; } if (empty($u->date_of_birth)) { $u->date_of_birth='1990-01-01'; } if (empty($u->age)) { $u->age=35; } if (empty($u->email)) { $u->email='e2e-%d@creditop.test'; } $u->save(); }
foreach (['29'=>'Empleado','87'=>'2500000'] as $fid=>$val) {
  \App\Models\UserFieldValue::updateOrCreate(['user_id'=>%d,'field_id'=>(int)$fid,'form_id'=>1,'user_request_id'=>%d],['value'=>$val]);
}
$r = new \App\Models\RiskCentralUserData();
$r->user_id=%d; $r->risk_central_id=1; $r->score=%d; $r->request='{}'; $r->uuid=(string)\Illuminate\Support\Str::uuid();
$r->data=['agregatedInfo'=>['overview'=>['principals'=>['negativeHistoricalLast12Months'=>0,'currentNegativeCredits'=>0,'maturationSince'=>'2018-01-01','consultedLast6Months'=>1],'balances'=>['valueMonthlyPayment'=>850,'totalValueBalanceOverdue'=>0]]],'creditCard'=>[]];
$r->save(); echo 'seeded:'.$r->id;
`, uid, uid, uid, uReqID, uid, score)
	cmd := exec.Command("docker", "exec", "-i", "legacy-backend-laravel.test-1", "php", "artisan", "tinker")
	cmd.Stdin = strings.NewReader(php)
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "seeded:") {
		client.FatalError("SeedApprovedProfile (tinker) falló", err, map[string]interface{}{"out": string(out)})
	}
}

// RiskProfile describe el perfil de riesgo CONTROLADO que se siembra para validar el Perfilador.
// Cada dimensión mapea a un dato que evalúan las reglas duras del lender (lender_rules /
// lender_datacredito_rules). Los ceros toman defaults sanos (WithDefaults) para que cada caso
// declare SOLO la dimensión que quiere probar.
type RiskProfile struct {
	Score     int  // datacrédito score (lender_datacredito_rules.score; típico piso 400)
	Negatives int  // negativeHistoricalLast12Months + currentNegativeCredits
	Reportado bool // field 160 = "si" → reportado en centrales restrictivas
	Income    int  // field 87 (ingreso mensual). 0 → 2_500_000
	Age       int  // users.age (lender_rules specific_table=users). 0 → 35
	Overdue   int  // totalValueBalanceOverdue (saldo en mora). default 0
}

// WithDefaults rellena los ceros con valores que PASAN las reglas típicas (para aislar la
// dimensión bajo prueba). Income→2.5M y Age→35 superan los pisos de un lender Creditop X (#77).
func (p RiskProfile) WithDefaults() RiskProfile {
	if p.Income == 0 {
		p.Income = 2_500_000
	}
	if p.Age == 0 {
		p.Age = 35
	}
	return p
}

// SeedRiskProfile siembra un perfil de riesgo CONTROLADO para validar el Perfilador (no solo el
// cierre): score, reportes negativos 12m, reportado en centrales (field 160), ingreso (field 87),
// edad (users.age) y saldo en mora (totalValueBalanceOverdue). Permite construir un perfil que PASE
// o FALLE las reglas duras de un lender a voluntad. Devuelve el user_id.
func SeedRiskProfile(db *sql.DB, phone string, uReqID int64, p RiskProfile) int64 {
	p = p.WithDefaults()
	var uid int64
	db.QueryRow("SELECT user_id FROM user_requests WHERE id = ? LIMIT 1", uReqID).Scan(&uid)
	if uid == 0 {
		db.QueryRow("SELECT id FROM users WHERE cell_phone = ? ORDER BY id DESC LIMIT 1", phone).Scan(&uid)
	}
	if uid == 0 {
		client.FatalError("SeedRiskProfile: usuario no encontrado", nil, nil)
	}
	rep := "no"
	if p.Reportado {
		rep = "si"
	}
	php := fmt.Sprintf(`
$u = \App\Models\User::find(%d);
if ($u) { $u->gender='M'; $u->date_of_birth='1990-01-01'; $u->age=%d; if (empty($u->email)) { $u->email='e2e-%d@creditop.test'; } $u->save(); }
foreach (['29'=>'Empleado','87'=>'%d','160'=>'%s'] as $fid=>$val) {
  \App\Models\UserFieldValue::updateOrCreate(['user_id'=>%d,'field_id'=>(int)$fid,'form_id'=>1,'user_request_id'=>%d],['value'=>(string)$val]);
}
\App\Models\RiskCentralUserData::where('user_id',%d)->delete();
$r = new \App\Models\RiskCentralUserData();
$r->user_id=%d; $r->risk_central_id=1; $r->score=%d; $r->request='{}'; $r->uuid=(string)\Illuminate\Support\Str::uuid();
$r->data=['agregatedInfo'=>['overview'=>['principals'=>['negativeHistoricalLast12Months'=>%d,'currentNegativeCredits'=>%d,'maturationSince'=>'2018-01-01','consultedLast6Months'=>1],'balances'=>['valueMonthlyPayment'=>850,'totalValueBalanceOverdue'=>%d]]],'creditCard'=>[]];
$r->save(); echo 'seeded:'.$r->id;
`, uid, p.Age, uid, p.Income, rep, uid, uReqID, uid, uid, p.Score, p.Negatives, p.Negatives, p.Overdue)
	cmd := exec.Command("docker", "exec", "-i", "legacy-backend-laravel.test-1", "php", "artisan", "tinker")
	cmd.Stdin = strings.NewReader(php)
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "seeded:") {
		client.FatalError("SeedRiskProfile (tinker) falló", err, map[string]interface{}{"out": string(out)})
	}
	return uid
}

// EnsureOtpBypass agrega el teléfono al setting `qa_otp_bypass_phones` para que
// el envío de OTP (onboarding y pagaré) NO pegue a Twilio (early-return en local;
// código = últimos dígitos del teléfono). Necesario en el stack local mock.
func EnsureOtpBypass(db *sql.DB, phone string) {
	_, err := db.Exec(
		"UPDATE settings SET value = JSON_ARRAY_APPEND(value, '$', ?) "+
			"WHERE `key`='qa_otp_bypass_phones' AND code='setting' AND NOT JSON_CONTAINS(value, JSON_QUOTE(?))",
		phone, phone)
	if err != nil {
		client.FatalError("Error agregando bypass de OTP", err, nil)
	}
}

func ForceOtpValidation(db *sql.DB, phone string) int64 {
	_, err := db.Exec("UPDATE otps SET validated = 1 WHERE cell_phone = ? ORDER BY id DESC LIMIT 1", phone)
	if err != nil {
		client.FatalError("Error forzando validación OTP", err, nil)
	}
	var id int64
	db.QueryRow("SELECT id FROM otps WHERE cell_phone = ? ORDER BY id DESC LIMIT 1", phone).Scan(&id)
	return id
}

func SetStatusAndLender(db *sql.DB, uReqID int64, statusID, lenderID int) {
	_, err := db.Exec("UPDATE user_requests SET user_request_status_id = ?, lender_id = ?, status = 1, rate = 2.1, fee_number = 12, initial_fee = 0 WHERE id = ?", statusID, lenderID, uReqID)
	if err != nil {
		client.FatalError("Error forzando status y lender en DB", err, nil)
	}
}

func MockCredifamiliaTransaction(db *sql.DB, uReqID int64) {
	db.Exec(`INSERT INTO lender_transactions (user_request_id, lender_id, order_id, status, created_at, updated_at) 
             VALUES (?, 24, 'CF-MOCK-123', 1, NOW(), NOW())`, uReqID)

	db.Exec(`UPDATE lender_transactions SET status = 3, response = '{"status_detail": "APROBADO"}' 
             WHERE user_request_id = ? AND lender_id = 24`, uReqID)
}

func FindKey(m map[string]interface{}, targetKey string) int64 {
	for k, v := range m {
		if k == targetKey {
			switch val := v.(type) {
			case float64:
				return int64(val)
			case int64:
				return val
			case int:
				return int64(val)
			}
		}
		if nextMap, ok := v.(map[string]interface{}); ok {
			if res := FindKey(nextMap, targetKey); res != 0 {
				return res
			}
		}
		if items, ok := v.([]interface{}); ok {
			for _, item := range items {
				if nextMap, ok := item.(map[string]interface{}); ok {
					if res := FindKey(nextMap, targetKey); res != 0 {
						return res
					}
				}
			}
		}
	}
	return 0
}
