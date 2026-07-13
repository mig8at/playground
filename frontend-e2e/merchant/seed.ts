import { execFileSync } from 'node:child_process';

/**
 * Eje COMERCIO — seeders de perfil/estado, espejo de `backend-e2e/pkg/mocks/mocks.go`.
 *
 * Igual que el backend: para validar cierres por UI hace falta (a) un perfil de riesgo sembrado para que
 * el marketplace OFREZCA el lender (el marketplace real es restrictivo) y/o (b) FORZAR el lender en el
 * user_request. Estos helpers ejecutan `docker exec` contra el mysql / tinker del legacy-backend local.
 *
 * NO commitear cambios de datos a prod — esto opera SOLO contra el stack local (legacy-backend-mysql-1).
 */

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'legacy-backend-mysql-1';
const APP_CONTAINER = process.env.E2E_APP_CONTAINER ?? 'legacy-backend-laravel.test-1';
const DB_NAME = process.env.E2E_DB_NAME ?? 'creditop';

/** Ejecuta SQL contra el mysql local y devuelve la salida (tab-separated, sin headers). */
export function sql(query: string): string {
    return execFileSync(
        'docker',
        ['exec', DB_CONTAINER, 'mysql', '-uroot', '-ppassword', DB_NAME, '-N', '-B', '-e', query],
        { encoding: 'utf8' },
    ).trim();
}

/** Ejecuta un script PHP vía `php artisan tinker` (para campos encriptados / modelos Eloquent). */
function tinker(php: string): string {
    const out = execFileSync('docker', ['exec', '-i', APP_CONTAINER, 'php', 'artisan', 'tinker'], {
        input: php,
        encoding: 'utf8',
    });
    if (!out.includes('seeded:') && !out.includes('ok:')) {
        throw new Error(`tinker no confirmó (esperaba 'seeded:'/'ok:'):\n${out.slice(-400)}`);
    }
    return out;
}

/** user_id por teléfono (último). */
export function userIdByPhone(phone: string): number {
    const id = sql(`SELECT id FROM users WHERE cell_phone='${phone}' ORDER BY id DESC LIMIT 1;`);
    return Number.parseInt(id, 10) || 0;
}

/**
 * Siembra un perfil APROBADO (datacrédito) para el usuario: edad/género/email + field 29 (ocupación) y
 * 87 (ingreso) + una fila `risk_central_user_data` con score plano + `data` (encriptado → vía tinker).
 * Espejo de `mocks.SeedApprovedProfile`.
 */
export function seedApprovedProfile(phone: string, uReqID: number, score = 750): void {
    const uid = userIdByPhone(phone);
    if (!uid) throw new Error(`seedApprovedProfile: usuario no encontrado para phone=${phone}`);
    tinker(`
$u = \\App\\Models\\User::find(${uid});
if ($u) { if (empty($u->gender)) { $u->gender='M'; } if (empty($u->date_of_birth)) { $u->date_of_birth='1990-01-01'; } if (empty($u->age)) { $u->age=35; } if (empty($u->email)) { $u->email='e2e-${uid}@creditop.test'; } $u->save(); }
foreach (['29'=>'Empleado','87'=>'2500000'] as $fid=>$val) {
  \\App\\Models\\UserFieldValue::updateOrCreate(['user_id'=>${uid},'field_id'=>(int)$fid,'form_id'=>1,'user_request_id'=>${uReqID}],['value'=>$val]);
}
$r = new \\App\\Models\\RiskCentralUserData();
$r->user_id=${uid}; $r->risk_central_id=1; $r->score=${score}; $r->request='{}'; $r->uuid=(string)\\Illuminate\\Support\\Str::uuid();
$r->data=['agregatedInfo'=>['overview'=>['principals'=>['negativeHistoricalLast12Months'=>0,'currentNegativeCredits'=>0,'maturationSince'=>'2018-01-01','consultedLast6Months'=>1],'balances'=>['valueMonthlyPayment'=>850,'totalValueBalanceOverdue'=>0]]],'creditCard'=>[]];
$r->save(); echo 'seeded:'.$r->id;
`);
}

/**
 * Siembra un perfil de riesgo CONTROLADO (score / nº negativos / reportado en centrales field 160) para
 * forzar que el marketplace ofrezca (o no) un lender. Espejo de `mocks.SeedRiskProfile`.
 */
export function seedRiskProfile(
    phone: string,
    uReqID: number,
    opts: { score?: number; negatives?: number; reportado?: boolean } = {},
): void {
    const { score = 800, negatives = 0, reportado = false } = opts;
    const uid = userIdByPhone(phone);
    if (!uid) throw new Error(`seedRiskProfile: usuario no encontrado para phone=${phone}`);
    const rep = reportado ? 'si' : 'no';
    tinker(`
$u = \\App\\Models\\User::find(${uid});
if ($u) { $u->gender='M'; $u->date_of_birth='1990-01-01'; $u->age=35; if (empty($u->email)) { $u->email='e2e-${uid}@creditop.test'; } $u->save(); }
foreach (['29'=>'Empleado','87'=>'2500000','160'=>'${rep}'] as $fid=>$val) {
  \\App\\Models\\UserFieldValue::updateOrCreate(['user_id'=>${uid},'field_id'=>(int)$fid,'form_id'=>1,'user_request_id'=>${uReqID}],['value'=>$val]);
}
\\App\\Models\\RiskCentralUserData::where('user_id',${uid})->delete();
$r = new \\App\\Models\\RiskCentralUserData();
$r->user_id=${uid}; $r->risk_central_id=1; $r->score=${score}; $r->request='{}'; $r->uuid=(string)\\Illuminate\\Support\\Str::uuid();
$r->data=['agregatedInfo'=>['overview'=>['principals'=>['negativeHistoricalLast12Months'=>${negatives},'currentNegativeCredits'=>${negatives},'maturationSince'=>'2018-01-01','consultedLast6Months'=>1],'balances'=>['valueMonthlyPayment'=>850,'totalValueBalanceOverdue'=>0]]],'creditCard'=>[]];
$r->save(); echo 'seeded:'.$r->id;
`);
}

/** Fuerza lender + estado en el user_request (bypassea la oferta del marketplace). Espejo de `SetStatusAndLender`. */
export function setStatusAndLender(uReqID: number, statusID: number, lenderID: number): void {
    sql(
        `UPDATE user_requests SET user_request_status_id=${statusID}, lender_id=${lenderID}, status=1, rate=2.1, fee_number=12, initial_fee=0 WHERE id=${uReqID};`,
    );
}

/** Marca el OTP como validado (para saltar Twilio en cierres). Espejo de `ForceOtpValidation`. */
export function forceOtpValidation(phone: string): void {
    sql(`UPDATE otps SET validated=1 WHERE cell_phone='${phone}' ORDER BY id DESC LIMIT 1;`);
}

/**
 * Setea el % de cuota inicial de una categoría de lender (lender_users_categories.min_initial_fee).
 * El backend calcula initial_fee_amount = (min_initial_fee/100) × amount. Útil para FORZAR un cierre
 * rt=2 CON cuota inicial (→ ejercita el pago Wompi) o SIN (=0 → directo al cierre in-platform).
 * Devuelve el valor PREVIO (para restaurarlo). Seed precondicional local (CONVENCIONES §2.2).
 */
export function setCategoryMinInitialFee(lenderId: number, categoryName: string, pct: number): number {
    const prev = sql(
        `SELECT COALESCE(min_initial_fee,0) FROM lender_users_categories WHERE lender_id=${lenderId} AND name='${categoryName}' LIMIT 1;`,
    );
    sql(`UPDATE lender_users_categories SET min_initial_fee=${pct} WHERE lender_id=${lenderId} AND name='${categoryName}';`);
    return Number.parseFloat(prev) || 0;
}

/**
 * Fuerza una `payment_gateway_transactions` a APPROVED (status 22 del lender Wompi #52). Belt-and-
 * suspenders del mock de Wompi (`pkg/wompi-mock.ts`): el backend con `WOMPI_MOCK_ENABLED=true` ya
 * aprueba vía el job `StatusCheck`, pero esto cubre el caso de que el primer poll de check-status
 * llegue antes que el job sync. Idempotente.
 */
export function approvePaymentTransaction(txId: number): void {
    sql(`UPDATE payment_gateway_transactions SET status_id=22 WHERE id=${txId};`);
}

/**
 * Siembra la credencial del lender Wompi (#52) para un branch — precondición de
 * `/initial-fee-payment/initiate` (`findOrFailByLenderAndAlly` tira si falta). Copia la estructura de
 * una credencial Wompi existente (allied_type + credential) cambiando el allied al branch. Idempotente.
 * El `credential` va cast/encriptado → se siembra vía tinker (Eloquent), no por SQL directo.
 */
export function seedWompiCredential(branchHash: string): void {
    // Nota: #77/3e67eade YA tiene credencial Wompi (close.ts observó el redirect a Wompi hosted, lo que
    // implica que /initiate resolvió la credencial). Este helper es para branches que NO la tengan.
    // Usa replicate() de una plantilla existente: copia allied_type + el credential ENCRIPTADO con el
    // formato correcto (create([]) dropea allied_type por no ser fillable → 1364 NOT NULL).
    tinker(`
$branch = \\App\\Models\\AlliedBranch::where('hash','${branchHash}')->firstOrFail();
$wompi = \\App\\Models\\Lender::where('name','Wompi')->firstOrFail();
$tmpl = \\App\\Models\\LenderAlliedCredential::where('lender_id',$wompi->id)->first();
if (!$tmpl) { throw new \\Exception('no hay credencial Wompi plantilla para clonar'); }
$isBranch = stripos((string)($tmpl->allied_type ?? ''), 'branch') !== false;
$alliedId = $isBranch ? $branch->id : $branch->allied_id;
$exists = \\App\\Models\\LenderAlliedCredential::where('lender_id',$wompi->id)
  ->where('allied_type',$tmpl->allied_type)->where('allied_id',$alliedId)->first();
if (!$exists) {
  $new = $tmpl->replicate();
  $new->allied_id = $alliedId;
  $new->save();
}
echo 'ok:wompi-cred';
`);
}
