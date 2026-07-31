/**
 * CONTRATO MOCK ↔ FRONT (Bancolombia) — valida el mock contra los esquemas ZOD REALES del wizard.
 *
 * POR QUÉ EXISTE. Los controllers de Bancolombia hacen **passthrough** del `data` del banco
 * (`'retrieve_quota' => $quotaResponse['data']`, `'purchase' => $purchaseResponse['data']`, …), así que las
 * claves que manda el proveedor las termina validando **el front** con zod. Si no cumplen, el use-case
 * devuelve `success:false` y la pantalla muestra un banner genérico — «Error al cargar la información» —
 * que **no nombra el campo**. El runner por consola (`dev/qr-corbeta.ts`) no lo detecta: pega contra el
 * backend, que es más laxo (sólo exige que la clave exista). Los dos podían estar verdes con el recorrido
 * visual roto. Ver **F-88**.
 *
 * NO IMPORTA una copia de los esquemas: importa los del monorepo. Una copia se desincroniza y entonces el
 * chequeo miente, que es peor que no tenerlo.
 *
 * USO:  npx tsx dev/contrato-bancolombia.ts            (levantá antes el mock: bin/mock-bancolombia start)
 *   env: MOCK_BC_URL (http://localhost:8104) · CFE_FRONT_PATH (ruta del frontend-monorepo)
 * Sale 1 si algún contrato falla, y dice el campo exacto.
 *
 * ⚠ Necesita resolver `zod`, que vive en el node_modules del MONOREPO (pnpm). Si tira
 * `Cannot find package 'zod'`, corrélo desde ahí:
 *     cd "$CFE_FRONT_PATH" && npx tsx <ruta-a-este-archivo>
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FRONT = process.env.CFE_FRONT_PATH || join(homedir(), 'Desktop/CREDITOP/github/frontend-monorepo');
const ESQUEMAS = join(FRONT, 'modules/loan-request-wizard/bancolombia-origination/src/domain/schemas/origination');
const BASE = (process.env.MOCK_BC_URL || 'http://localhost:8104').replace(/\/+$/, '');

if (!existsSync(ESQUEMAS)) {
    console.error(`✗ no encontré los esquemas del front en ${ESQUEMAS}\n  ajustá CFE_FRONT_PATH.`);
    process.exit(2);
}

const S = await import(join(ESQUEMAS, 'bnpl/bnpl-api.schema.ts'));
const L = await import(join(ESQUEMAS, 'loan/loan-api.schema.ts'));

const post = async (ruta: string, body: unknown = {}) => {
    const r = await fetch(BASE + ruta, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return (await r.json()) as any;
};

let malos = 0;
let total = 0;
const chequear = (nombre: string, schema: any, payload: unknown) => {
    total++;
    const r = schema.safeParse(payload);
    if (r.success) return void console.log(`  ✓ ${nombre}`);
    malos++;
    console.log(`  ✗ ${nombre}`);
    for (const i of r.error.issues) console.log(`      ${i.path.join('.') || '(raíz)'}: ${i.message}`);
};

if (!(await fetch(BASE).then((r) => r.ok).catch(() => false))) {
    console.error(`✗ el mock no responde en ${BASE} — corré  bin/mock-bancolombia start`);
    process.exit(2);
}

// ── BNPL ────────────────────────────────────────────────────────────────────────────────────────────────
// Cada payload se arma como lo arma el CONTROLLER (ver los `return $this->success(...)` de
// BancolombiaBnplController): lo que no viene del banco lo pone el backend y va acá a mano.
console.log('\nBNPL');
const login = await post('/auth/session');
chequear('login-redirect → BnplStartResponse', S.BnplStartResponsePayloadSchema, { data: login.data });

const quota = await post('/credit-quota-information/retrieve-quota');
chequear('retrieve-quota → BnplRetrieveQuota', S.BnplRetrieveQuotaPayloadSchema, { retrieve_quota: quota.data });

const compra = await post('/payments/purchase-intention', { data: { totalPrice: 2_000_000 } });
chequear('list-accounts-and-quota → BnplListAccountsQuota', S.BnplListAccountsQuotaPayloadSchema, {
    purchase: compra.data, retrieve_quota: quota.data,
});

// fuera de producción el backend manda este `account` fijo (BancolombiaBnpl.php::selectAccount)
const sel = await post('/payments/select-account', { data: { account: { id: '1', type: 'CUENTA_DE_AHORRO', number: '9220' } } });
chequear('account-select → BnplSelectAccount', S.BnplSelectAccountPayloadSchema, { select_account: sel.data });

const terms = await post('/terms/retrieve');
chequear('fetch-terms → BnplTerms', S.BnplTermsPayloadSchema, {
    terms: terms.data, user: { first_name: 'SYNTH', surname: 'TEST', email: null },
});

const dyn = await post('/auth/provide-authentication');
chequear('dynamic-key → BnplDynamicKey', S.BnplDynamicKeyPayloadSchema, { data: dyn.data });

const orig = await post('/electronic-signature-management/origination');
chequear('origination → BnplOrigination', S.BnplOriginationPayloadSchema, {
    origination: orig.data, user_id: 1, status: '25', is_self_management: true,
});

// ── CONSUMO ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nCONSUMO');
const val = await post('/customers/validate');
chequear('login-redirect → LoanLoginRedirect', L.LoanLoginRedirectPayloadSchema, { data: val.data });
chequear('fetch-terms → LoanTerms', L.LoanTermsPayloadSchema, { terms: terms.data });

const reg = await post('/terms/register');
chequear('register-terms → LoanRegisterTerms', L.LoanRegisterTermsPayloadSchema, { data: reg.data });

const ofertas = await post('/enable-offers/preapproved');
chequear('enable-offers → LoanEnableOffers', L.LoanEnableOffersPayloadSchema, { enable_offers: ofertas.data });

const sim = await post('/simulations');
const ctas = await post('/accounts/retrieve');
chequear('detail-simulation → LoanDetailSimulation', L.LoanDetailSimulationPayloadSchema, {
    // ⚠ `data` COMPLETO, no `data.simulation`: así lo manda el controller
    // (`'simulation' => $bancolombiaSimulations['data']`, BancolombiaLoanController.php:1297). Con el
    // mapeo mal, este chequeo validaba una forma que nunca ocurre y daba verde con la pantalla trabada.
    simulation: sim.data, retrieve_accounts: ctas.data,
});

const estudio = await post('/validate-credit-study');
chequear('validate-credit-study → LoanValidateCreditStudy', L.LoanValidateCreditStudyPayloadSchema, {
    validate_credit_study: estudio.data,
});

const confirmar = await post('/disbursements/confirm');
chequear('select-insurance → LoanSelectAccount', L.LoanSelectAccountPayloadSchema, {
    confirm: confirmar.data, user: { first_name: 'SYNTH', surname: 'TEST', email: null },
    additional_fields: ['address'],
});

const esign = await post('/customers/eSignDocument');
chequear('e-sign → LoanESignDocument', L.LoanESignDocumentPayloadSchema, {
    // el backend arma el `url` desde `data.security.urlDynamicKey` (BancolombiaLoanController.php:1606)
    url: esign.data?.security?.urlDynamicKey ?? null, e_sign_document: esign.data,
});

const desem = await post('/disbursements');
const conf = await post('/disbursements/confirm');
chequear('origination → LoanOrigination', L.LoanOriginationPayloadSchema, {
    // `user_id` lo pone el BACKEND (BancolombiaLoanController.php:1733), no el banco.
    disbursement: desem.data, confirmed: conf.data, user_id: 1, status: '25', is_self_management: true,
});

console.log(malos
    ? `\n✗ ${malos}/${total} incumplimiento(s) — el recorrido visual se cae en ese paso`
    : `\n✓ el mock cumple los ${total} contratos del front`);
process.exit(malos ? 1 : 0);
