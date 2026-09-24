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
 * USO:  npx tsx dev/bancolombia-contract.ts            (levantá antes el mock: bin/mock-bancolombia start)
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
const SCHEMAS = join(FRONT, 'modules/loan-request-wizard/bancolombia-origination/src/domain/schemas/origination');
const BASE = (process.env.MOCK_BC_URL || 'http://localhost:8104').replace(/\/+$/, '');

if (!existsSync(SCHEMAS)) {
    console.error(`✗ no encontré los esquemas del front en ${SCHEMAS}\n  ajustá CFE_FRONT_PATH.`);
    process.exit(2);
}

const S = await import(join(SCHEMAS, 'bnpl/bnpl-api.schema.ts'));
const L = await import(join(SCHEMAS, 'loan/loan-api.schema.ts'));

const post = async (path: string, body: unknown = {}) => {
    const r = await fetch(BASE + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return (await r.json()) as any;
};

let badList = 0;
let total = 0;
const verify = (name: string, schema: any, payload: unknown) => {
    total++;
    const r = schema.safeParse(payload);
    if (r.success) return void console.log(`  ✓ ${name}`);
    badList++;
    console.log(`  ✗ ${name}`);
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
verify('login-redirect → BnplStartResponse', S.BnplStartResponsePayloadSchema, { data: login.data });

const quota = await post('/credit-quota-information/retrieve-quota');
verify('retrieve-quota → BnplRetrieveQuota', S.BnplRetrieveQuotaPayloadSchema, { retrieve_quota: quota.data });

const purchase = await post('/payments/purchase-intention', { data: { totalPrice: 2_000_000 } });
verify('list-accounts-and-quota → BnplListAccountsQuota', S.BnplListAccountsQuotaPayloadSchema, {
    purchase: purchase.data, retrieve_quota: quota.data,
});

// fuera de producción el backend manda este `account` fijo (BancolombiaBnpl.php::selectAccount)
const sel = await post('/payments/select-account', { data: { account: { id: '1', type: 'CUENTA_DE_AHORRO', number: '9220' } } });
verify('account-select → BnplSelectAccount', S.BnplSelectAccountPayloadSchema, { select_account: sel.data });

const terms = await post('/terms/retrieve');
verify('fetch-terms → BnplTerms', S.BnplTermsPayloadSchema, {
    terms: terms.data, user: { first_name: 'SYNTH', surname: 'TEST', email: null },
});

const dyn = await post('/auth/provide-authentication');
verify('dynamic-key → BnplDynamicKey', S.BnplDynamicKeyPayloadSchema, { data: dyn.data });

const orig = await post('/electronic-signature-management/origination');
verify('origination → BnplOrigination', S.BnplOriginationPayloadSchema, {
    origination: orig.data, user_id: 1, status: '25', is_self_management: true,
});

// ── CONSUMER ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nCONSUMO');
const val = await post('/customers/validate');
verify('login-redirect → LoanLoginRedirect', L.LoanLoginRedirectPayloadSchema, { data: val.data });
verify('fetch-terms → LoanTerms', L.LoanTermsPayloadSchema, { terms: terms.data });

const reg = await post('/terms/register');
verify('register-terms → LoanRegisterTerms', L.LoanRegisterTermsPayloadSchema, { data: reg.data });

const offers = await post('/enable-offers/preapproved');
verify('enable-offers → LoanEnableOffers', L.LoanEnableOffersPayloadSchema, { enable_offers: offers.data });

const sim = await post('/simulations');
const accts = await post('/accounts/retrieve');
verify('detail-simulation → LoanDetailSimulation', L.LoanDetailSimulationPayloadSchema, {
    // ⚠ `data` COMPLETO, no `data.simulation`: así lo manda el controller
    // (`'simulation' => $bancolombiaSimulations['data']`, BancolombiaLoanController.php:1297). Con el
    // mapeo mal, este chequeo validaba una forma que nunca ocurre y daba verde con la pantalla trabada.
    simulation: sim.data, retrieve_accounts: accts.data,
});

const study = await post('/validate-credit-study');
verify('validate-credit-study → LoanValidateCreditStudy', L.LoanValidateCreditStudyPayloadSchema, {
    validate_credit_study: study.data,
});

const confirm = await post('/disbursements/confirm');
verify('select-insurance → LoanSelectAccount', L.LoanSelectAccountPayloadSchema, {
    confirm: confirm.data, user: { first_name: 'SYNTH', surname: 'TEST', email: null },
    additional_fields: ['address'],
});

const esign = await post('/customers/eSignDocument');
verify('e-sign → LoanESignDocument', L.LoanESignDocumentPayloadSchema, {
    // el backend arma el `url` desde `data.security.urlDynamicKey` (BancolombiaLoanController.php:1606)
    url: esign.data?.security?.urlDynamicKey ?? null, e_sign_document: esign.data,
});

const disb = await post('/disbursements');
const conf = await post('/disbursements/confirm');
verify('origination → LoanOrigination', L.LoanOriginationPayloadSchema, {
    // `user_id` lo pone el BACKEND (BancolombiaLoanController.php:1733), no el banco.
    disbursement: disb.data, confirmed: conf.data, user_id: 1, status: '25', is_self_management: true,
});

console.log(badList
    ? `\n✗ ${badList}/${total} incumplimiento(s) — el recorrido visual se cae en ese paso`
    : `\n✓ el mock cumple los ${total} contratos del front`);
process.exit(badList ? 1 : 0);
