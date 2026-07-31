// qr-corbeta.ts — el CANAL QR de punta a punta, por API y SIN NAVEGADOR.
//
//   node dev/qr-corbeta.ts [--producto bnpl|consumo] [--branch <hash>] [--amount 1500000] [--facturar] [--keep]
//
// LOS DOS PRODUCTOS de Bancolombia son DOS integraciones distintas, no un flag cosmético:
//   · `bnpl`    (lender 68)  → 8 pasos · el insumo del código es `bnpl_transaction_id`, lo escribe
//                              SOLO `retrieve-quota` · sella el 25 con `data.status='PENDIENTE DESEMBOLSO'`
//   · `consumo` (lender 100) → 11 pasos · el insumo es `loan_validate_key`, lo escribe SOLO
//                              `redirect-user-validate` · sella el 25 con `data.payment.status='pendiente'`
//                              y ADEMÁS depende de un `sessionToken` que nace en `/customers/authenticate`
//                              y del que cuelgan siete pasos.
//
// Recorre la misma secuencia de endpoints que las pantallas del wizard cuando un cliente escanea el QR
// en la CAJA de un comercio Corbeta, y reporta cada paso con su HTTP status + lo que se movió en la BD.
// Es el camino RÁPIDO (el del agente): segundos, exit code = veredicto. El visual es el panel.
//
// EL DESENLACE DE ESTE FLUJO NO ES EL ESTADO 11. Ojo con esto, porque cambia qué se considera "cerró":
//   BNPL origination devuelve `PENDIENTE DESEMBOLSO` → si el allied está en `Setting('corbeta_allieds')`,
//   `BancolombiaBnplController.php:1395` sella **estado 25 ("Pendiente de facturación")** y de ahí se
//   emite el CÓDIGO. El desembolso real llega DESPUÉS y por afuera: el cliente factura en la caja y los
//   crons de conciliación de `application` cruzan por PIN, marcan **estado 26 (Facturado)** y recién ahí
//   confirman el consumo a Bancolombia. O sea: para este canal, "cerró" = **estado 25 + código emitido**.
//
// LA SECUENCIA (autoritativa: sale de los repositories del front, no de suponer —
// `modules/loan-request-wizard/bancolombia-origination/src/infrastructure/repositories/…`):
//   0  preflight            (mocks arriba, backend vivo, credencial, a dónde apunta CORBETA_HOST)
//   1  entrada QR           GET  {wizard}/bancolombia/self-service/{hash}/solicitar   (el aterrizaje del QR)
//   2  register             POST /api/onboarding/phone/register
//   3  uReq + buró          INSERT + synthFill (mismo criterio que dev/sweep.ts)
//   4  pre-aprobación       POST /api/onboarding/bancolombia/validate-preapproved/{ur}   ← decide bnpl|consumo
//   5  login-redirect       POST /api/onboarding/bancolombia-bnpl/login-redirect/{ur}
//   6  retrieve-quota       POST …/retrieve-quota/{ur}            ← el ÚNICO que escribe bnpl_transaction_id
//   7  list-accounts-quota  POST …/list-accounts-and-quota/{ur}
//   8  account-select       POST …/account-select/{ur}
//   9  fetch-terms          POST …/fetch-terms-and-conditions/{ur}
//  10  accept-terms         POST …/accept-terms-and-conditions/{ur}
//  11  dynamic-key          POST …/dynamic-key-signature/{ur}
//  12  origination          POST …/origination/{ur}               ← acá debería quedar el estado 25
//  13  purchase-code        POST /api/onboarding/purchase-code/generate/{ur}   ← el PIN
//  14  verificación         el PIN en el registro del mock + en `verification_token` de la BD
//  15  --facturar           mueve la orden a estado 3 en el mock y RE-pide el código: debe dejar de mostrarse
//
// QUÉ HACE FALTA PARA QUE CORRA COMPLETO (el preflight lo dice y no adivina):
//   · `bin/mock-corbeta start` + `CORBETA_HOST=http://host.docker.internal:8103` en legacy-backend/.env
//   · los pasos 5-12 salen a la API de Bancolombia: sin un mock apuntado por `BANCOLOMBIA_HOST` van a
//     fallar, y el paso donde fallen es EL DATO (por eso el script sigue y reporta, no aborta al primer
//     rojo). Ver la sección "partes complicadas" de la conversación: la credencial cifrada con el
//     `APP_KEY` local es el muro esperado antes del primer HTTP.
//
// Gotchas heredados de dev/sweep.ts (mismos, misma razón):
//   · UA de iPhone SIEMPRE (`onlyMobileValidation` → 403 con UA de escritorio).
//   · `E2E_TARGET` default es dev → acá se fuerza local salvo override explícito.
//   · el teléfono se scrubbea antes del register.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

process.env.E2E_TARGET ||= 'local';
process.env.CFE_TARGET ||= 'local';

const { one, exec, close } = await import('../pkg/db.ts');
const { synthFill } = await import('../pkg/inject.ts');
const { config: e2eConfig } = await import('../pkg/config.ts');
const { corbetaBranch, qrEntryUrl, bancolombiaEncryptCode } = await import('../pkg/qr.ts');
// MISMA capa de aserción que el camino VISUAL (dev/guided.spec.ts) y que el otro rápido (dev/sweep.ts).
// Que "pasó" signifique lo mismo en los tres es lo que hace informativa una divergencia: mismas
// aserciones + distinto transporte ⇒ la diferencia ES el frontend. Por eso el desenlace de este canal
// (estado 25) se agregó a `ESTADO_ESPERADO` en pkg/trace.ts en vez de tener un veredicto propio acá.
const traza = await import('../pkg/trace.ts');

const flowsRaw = JSON.parse(readFileSync(new URL('../.flows.json', import.meta.url), 'utf8'));
const API = e2eConfig.mockUrl;
const WIZARD = e2eConfig.feBaseUrl;
const MOCK_CORBETA = `http://localhost:${process.env.MOCK_CORBETA_PORT || 8103}`;
const PHONE = '3131010101';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const ASESOR_SUB = process.env.E2E_ASESOR_SUB || flowsRaw?.asesor?.sub || '';
const HDRS: Record<string, string> = {
    'content-type': 'application/json', accept: 'application/json', 'user-agent': UA,
    ...(ASESOR_SUB ? { 'x-cognito-identity-id': ASESOR_SUB } : {}),
};

// ── argumentos ────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d = '') => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? d) : d; };
const AMOUNT = Number(opt('--amount', '1500000')) || 1_500_000;
const FACTURAR = flag('--facturar');
const KEEP = flag('--keep');
/** `bnpl` (lender 68) o `consumo` (lender 100). Son DOS integraciones distintas, no un flag cosmético. */
const PRODUCTO = (opt('--producto', 'bnpl') || 'bnpl').toLowerCase() === 'consumo' ? 'consumo' : 'bnpl';
const LENDER = PRODUCTO === 'consumo' ? 100 : 68;
// El insumo que cada producto persiste en `lender_integration_flows` y que el servicio nuevo de
// Bancolombia va a exigir como `transactionId` para emitir el código.
const CLAVE_TX = PRODUCTO === 'consumo' ? 'loan_validate_key' : 'bnpl_transaction_id';
// El paso que la ESCRIBE (el único, en los dos productos).
const PASO_TX = PRODUCTO === 'consumo' ? 'user-validate' : 'retrieve-quota';

// ── salida ────────────────────────────────────────────────────────────────────────────────────────
const pasos: Array<{ n: string; ok: boolean | null; detalle: string }> = [];
let paso = 0;
const P = (n: string, ok: boolean | null, detalle = '') => {
    paso++;
    const icono = ok === null ? '·' : ok ? '✓' : '✗';
    console.log(`${icono} ${String(paso).padStart(2)} ${n.padEnd(22)} ${detalle}`);
    pasos.push({ n, ok, detalle });
};
const trim = (j: any, n = 150) => JSON.stringify(j?.data ?? j ?? {}).slice(0, n);

async function http(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(`${API}${path}`, {
        method, headers: HDRS, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
    }).catch((e) => e as Error);
    if (r instanceof Error) return { status: 0, json: { message: String(r.message).slice(0, 120) } };
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
    return { status: r.status, json };
}

/** POST al control del mock de Corbeta (no al backend). */
async function mock(path: string, body?: unknown): Promise<any> {
    const r = await fetch(`${MOCK_CORBETA}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (!r) return null;
    return await r.json().catch(() => null);
}

const estado = (ur: string) => one<{ s: number; l: number | null }>(
    'SELECT user_request_status_id AS s, lender_id AS l FROM user_requests WHERE id=?', [ur]);

// ── 0 · PREFLIGHT ─────────────────────────────────────────────────────────────────────────────────
console.log(`\n▶ CANAL QR · Corbeta · producto ${PRODUCTO.toUpperCase()} (lender ${LENDER}) — flujo por API (target ${process.env.E2E_TARGET})\n`);

const branchArg = opt('--branch');
const br = branchArg
    ? await one<{ id: number; hash: string; alliedId: number }>(
        'SELECT id, hash, allied_id AS alliedId FROM allied_branches WHERE hash=?', [branchArg])
    : await corbetaBranch();
if (!br) {
    P('sucursal Corbeta', false, branchArg ? `el hash ${branchArg} no existe` : 'ninguna sucursal Corbeta con 68 y 100 habilitados');
    await close(); process.exit(2);
}
P('sucursal Corbeta', true, `#${br.id} (allied ${br.alliedId}) hash=${br.hash}`);

// "Vivo" = contesta HTTP, aunque sea 404/405: la ruta de health puede no existir. Sólo status 0 (no
// resolvió / no conectó) o 5xx significan que el backend está caído. Marcarlo ok con un 500 en la mano
// fue lo que hizo que el veredicto apuntara al muro equivocado en la primera corrida.
const backend = await http('POST', '/api/onboarding/phone/register', {});
const backendOk = backend.status !== 0 && backend.status < 500;
P('backend vivo', backendOk, `${API} → HTTP ${backend.status}${backend.status >= 500 ? ` · ${trim(backend.json, 90)}` : ''}`);

const mockUp = await mock('/');
P('mock-corbeta', !!mockUp, mockUp ? `:${mockUp.puerto} · ${mockUp.ordenes?.length ?? 0} orden(es) en memoria${mockUp.fail ? ' · MODO FALLO' : ''}` : `no responde en ${MOCK_CORBETA} → bin/mock-corbeta start`);

const cred = await one<{ n: number }>(
    `SELECT COUNT(*) n FROM lender_allied_credentials
     WHERE lender_id = ? AND ((allied_type LIKE '%AlliedBranch%' AND allied_id = ?) OR (allied_type LIKE '%Allied%' AND allied_id = ?))`,
    [LENDER, br.id, br.alliedId]);
P(`credencial lender ${LENDER}`, (cred?.n ?? 0) > 0, (cred?.n ?? 0) > 0
    ? `${cred!.n} fila(s) para la sucursal/comercio`
    : 'NINGUNA → los pasos de Bancolombia van a morir antes del primer HTTP (findOrFailByLenderAndAlly)');

// ── 1 · la entrada del QR ─────────────────────────────────────────────────────────────────────────
// INFORMATIVO (`ok = null`), a propósito: este camino es por API y NO necesita el wizard levantado.
// Se toca la puerta para dejar constancia de si el front está arriba, pero un 500 acá NO es el muro del
// flujo — y contarlo como rojo hacía que el veredicto señalara "entrada QR" cuando el muro real estaba
// nueve pasos más abajo. Un veredicto que apunta al lugar equivocado es peor que ninguno.
const entry = qrEntryUrl(br.hash);
const land = await fetch(entry, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15_000) })
    .then((r) => ({ status: r.status })).catch(() => ({ status: 0 }));
P('entrada QR (info)', null, `${entry} → HTTP ${land.status || 'sin respuesta'}${land.status === 200 ? '' : ' · el front no hace falta para este camino'}`);

// ── 2..3 · onboarding: register + uReq + buró ──────────────────────────────────────────────────────
spawnSync('node', ['bin/dbops.ts', 'scrubphone', PHONE], { cwd: new URL('..', import.meta.url).pathname });
const reg = await http('POST', '/api/onboarding/phone/register', {
    phone_number: PHONE, phoneNumber: PHONE, terms: true, policies: true,
    otp_length: 4, otpLength: 4, partner_branch_hash: br.hash, partnerBranchHash: br.hash,
});
const uid = reg.json?.data?.user?.id;
P('register', !!uid, `HTTP ${reg.status} · user=${uid ?? trim(reg.json, 90)}`);
if (!uid) { await close(); process.exit(2); }

// El asesor NO existe en este canal (es autogestión), pero `corporate_user_id` es NOT NULL para los logs
// de pasos, así que se resuelve igual que en sweep.ts: sub del entorno, o el primer asesor de la sucursal.
const asesorId = (ASESOR_SUB
    ? (await one<{ id: number }>('SELECT id FROM users WHERE cognito_id=? LIMIT 1', [ASESOR_SUB]).catch(() => null))?.id
    : null)
    ?? (await one<{ id: number }>('SELECT id FROM users WHERE allied_branch_id=? AND cognito_id IS NOT NULL LIMIT 1', [br.id]).catch(() => null))?.id
    ?? null;

const ins = await exec(
    'INSERT INTO user_requests (user_id, allied_id, allied_branch_id, lender_id, amount, original_amount, user_request_status_id, corporate_user_id, credit_line_id, fee_number, fee_value, rate, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,1,0,0,0,NOW(),NOW())',
    [uid, br.alliedId, br.id, LENDER, AMOUNT, AMOUNT, asesorId],
).catch((e) => { P('uReq', false, String(e).slice(0, 120)); return null; });
if (!ins?.insertId) { await close(); process.exit(2); }
const UR = String(ins.insertId);
traza.trazarUReq(UR);
P('uReq creado', true, `#${UR} · lender ${LENDER} · monto ${AMOUNT.toLocaleString('es-CO')} · estado 1`);

await synthFill(ins.insertId, { income: 2_500_000, score: 700 });
P('buró sintético', true, 'ingreso 2.500.000 · score 700');
console.log(`   ↳ encryptCode = ${bancolombiaEncryptCode(ins.insertId, br.hash)}  (pantallas /bancolombia/…/{code})`);

// ── 4..12 · la máquina BNPL ────────────────────────────────────────────────────────────────────────
// Los datos del cliente que varios pasos revalidan (accept-terms exige los 5: code/name/surname/
// email/address). Salen del sintético, no de aire, para que el payload sea el que manda el wizard.
const CLIENTE = {
    code: 'mock-auth-code',
    name: 'SYNTH', surname: 'TEST USER',
    email: `synth.${UR}@gmail.com`,
    address: 'Cal 123 # 12-122',
};
const B = '/api/onboarding/bancolombia-bnpl';
const C = '/api/onboarding/bancolombia-consumer-loan';
const secuenciaBnpl: Array<[string, string, unknown?]> = [
    ['pre-aprobación', `/api/onboarding/bancolombia/validate-preapproved/${UR}`],
    ['login-redirect', `${B}/login-redirect/${UR}`],
    ['retrieve-quota', `${B}/retrieve-quota/${UR}`, CLIENTE],
    ['list-accts-quota', `${B}/list-accounts-and-quota/${UR}`, { ...CLIENTE, amount: AMOUNT }],
    ['account-select', `${B}/account-select/${UR}`, { ...CLIENTE, accountId: '1' }],
    ['fetch-terms', `${B}/fetch-terms-and-conditions/${UR}`, CLIENTE],
    ['accept-terms', `${B}/accept-terms-and-conditions/${UR}`, CLIENTE],
    ['dynamic-key', `${B}/dynamic-key-signature/${UR}`, CLIENTE],
    ['origination', `${B}/origination/${UR}`, CLIENTE],
];
// Consumo tiene DOS pasos más que BNPL y su propio orden (routes/api.php:75-90). El paso que escribe
// el insumo equivalente al `bnpl_transaction_id` es `redirect-user-validate` → `loan_validate_key`.
const secuenciaConsumo: Array<[string, string, unknown?]> = [
    ['pre-aprobación', `/api/onboarding/bancolombia/validate-preapproved/${UR}`],
    ['login-redirect', `${C}/login-redirect/${UR}`, CLIENTE],
    ['user-validate', `${C}/redirect-user-validate/${UR}`, CLIENTE],
    ['fetch-terms', `${C}/fetch-terms-and-conditions/${UR}`, CLIENTE],
    ['register-terms', `${C}/register-terms/${UR}`, CLIENTE],
    ['enable-offers', `${C}/enable-offers/${UR}`, { ...CLIENTE, amount: AMOUNT }],
    ['simulación', `${C}/get-detail-simulation/${UR}`, { ...CLIENTE, amount: AMOUNT, fee_number: 12, feeNumber: 12 }],
    ['accept-terms', `${C}/accept-terms-and-conditions/${UR}`, CLIENTE],
    // ⚠ TOLERADO (no cuenta como muro): `select-insurance` lee del flow `payment_day`, `insurance_type`,
    // `interest_rate` y `account.{type,number}` (BancolombiaLoanController.php:1421) — datos que RECOGE LA
    // UI en pantallas previas y que este camino por API no llena. El flujo cierra sin él (el estado 25 lo
    // sella `origination`), así que se ejercita para dejar constancia, no se exige.
    ['select-insurance (tolerado)', `${C}/select-insurance/${UR}`, { ...CLIENTE, insurance: true }],
    ['e-sign-document', `${C}/e-sign-document/${UR}`, CLIENTE],
    ['origination', `${C}/origination/${UR}`, CLIENTE],
];
const secuencia = PRODUCTO === 'consumo' ? secuenciaConsumo : secuenciaBnpl;
for (const [nombre, path, body] of secuencia) {
    const r = await http('POST', path, body ?? {});
    traza.paso('API', nombre);            // la traza contrasta cada paso contra la BD
    await traza.drenar();
    const ok = r.status >= 200 && r.status < 300;
    // Si el backend no pudo ni resolver el host del proveedor, decirlo con nombre y apellido: es el muro
    // más común en local (`BANCOLOMBIA_HOST=https://bancolombia.fake` es un placeholder a propósito) y
    // sin esta línea se lee como "internal error BNPL999", que no dice nada.
    const ex = r.json?.errors?.payload?.exception_message ?? '';
    const dns = /Could not resolve host: ([\w.-]+)/.exec(ex);
    P(nombre, nombre.includes('tolerado') ? (ok ? true : null) : ok, dns
        ? `HTTP ${r.status} · NO RESUELVE el host del proveedor: ${dns[1]} → falta mock-bancolombia + BANCOLOMBIA_HOST`
        : `HTTP ${r.status} · ${trim(r.json, 110)}`);
    // El paso 6 es el que escribe el insumo que Bancolombia va a exigir para emitir el código.
    if (nombre === PASO_TX) {
        const f = await one<{ v: string | null }>(
            `SELECT JSON_UNQUOTE(JSON_EXTRACT(data,'$.${CLAVE_TX}')) v FROM lender_integration_flows WHERE user_request_id=? AND lender_id=?`, [UR, LENDER]);
        P(`  ↳ ${CLAVE_TX}`, !!f?.v, f?.v ? `escrito en el flow: ${String(f.v).slice(0, 60)}${String(f.v).length > 60 ? '…' : ''}` : 'NO se escribió (sin él no se puede emitir el código nuevo)');
    }
}
const trasOrig = await estado(UR);
P('estado tras origination', trasOrig?.s === 25, `estado ${trasOrig?.s ?? '?'} (se espera 25 «Pendiente de facturación»)`);

// ── 13..14 · el código de compra ──────────────────────────────────────────────────────────────────
const pc = await http('POST', `/api/onboarding/purchase-code/generate/${UR}`);
const codigo = pc.json?.data?.code ?? null;
const muestra = pc.json?.data?.showBarCode;
// Ojo con el envelope: PCS002 = «Código generado correctamente» (recién emitido) y PCS001 = «Código
// consultado» (ya existía). Van al revés de lo que sugiere el número, y el handoff los documenta
// invertidos — ver `PurchaseCodeService.php:63-68`.
P('purchase-code', pc.status >= 200 && pc.status < 300 && !!codigo,
    `HTTP ${pc.status} · code=${codigo ?? '—'} · showBarCode=${muestra ?? '—'} · ${pc.json?.code ?? ''}${pc.json?.code === 'PCS002' ? ' (emitido)' : pc.json?.code === 'PCS001' ? ' (ya existía)' : ''}`);

if (codigo) {
    const enMock = (await mock('/'))?.ordenes?.some((o: any) => o.pin === codigo);
    const enBd = await one<{ v: string | null }>(
        "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json,'$.verification_token')) v FROM user_request_additional_information WHERE user_request_id=? AND type_data LIKE '%barcode%' ORDER BY id DESC LIMIT 1", [UR]);
    P('PIN en el proveedor', !!enMock, enMock ? 'la orden existe en el mock' : 'el mock no tiene esa orden');
    P('PIN persistido', enBd?.v === codigo, `verification_token=${enBd?.v ?? '—'}`);

    // ── 15 · el cliente factura en la caja ───────────────────────────────────────────────────────
    if (FACTURAR) {
        const f = await mock('/_control/facturar', { pin: codigo });
        P('facturar en caja', !!f?.ok, f?.ok ? `estado 3 · factura ${f.orden.noFactura}` : trim(f, 90));
        const pc2 = await http('POST', `/api/onboarding/purchase-code/generate/${UR}`);
        const muestra2 = pc2.json?.data?.showBarCode;
        // Hoy esto sale del FILTRO (`EstadoOrden=2`), no de una regla escrita. Es exactamente el
        // comportamiento que el reemplazo por Bancolombia tiene que preservar de forma explícita.
        P('ya facturada → oculta', muestra2 === false, `showBarCode=${muestra2 ?? '—'} (se espera false)`);
    }
}

// ── veredicto ─────────────────────────────────────────────────────────────────────────────────────
// La traza contrastada + el veredicto salen de pkg/trace.ts (compartidos con el visual). Lo único
// propio de este canal es la línea del CÓDIGO: el estado 25 sin código emitido no es un cierre.
await traza.resumen();
const v = await traza.veredicto(UR, 'facturacion');
const rojos = pasos.filter((p) => p.ok === false);
const cerro = v.ok && !!codigo;
console.log(`   código de compra: ${codigo ?? 'NO se emitió'}`);
console.log(`   pasos: ${pasos.filter((p) => p.ok === true).length} ok · ${rojos.length} en rojo${pasos.some((p) => p.ok === null) ? ` · ${pasos.filter((p) => p.ok === null).length} informativos/tolerados` : ''}`);
if (rojos.length) console.log(`   primer muro: ${rojos[0].n} → ${rojos[0].detalle.slice(0, 120)}`);
console.log(`   lectura: ${cerro
    ? '✓ CERRÓ para este canal — estado 25 + código emitido. El desembolso real es posterior y por afuera: el cliente factura en caja y los crons llevan al 26.'
    : v.ok ? '✗ llegó al estado 25 pero NO se emitió el código'
    : v.malo ? `✗ desenlace de muerte (estado ${v.st}) — el canal no llegó a facturación`
    : 'a mitad de flujo — mirá el primer muro'}`);
if (!KEEP) console.log(`   (la solicitud queda en la BD; el próximo run scrubbea el teléfono ${PHONE})`);

await close();
// Mismo contrato de exit code que dev/sweep.ts: 0 cerró · 1 desenlace malo o muro · 2 quedó a mitad.
process.exit(cerro ? 0 : (v.malo || rojos.length) ? 1 : 2);
