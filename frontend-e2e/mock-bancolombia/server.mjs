// Mock de la API de BANCOLOMBIA — los dos productos: BNPL (lender 68) y Consumo (lender 100).
//
// POR QUÉ EXISTE (2026-07-31):
//   En local `BANCOLOMBIA_HOST=https://bancolombia.fake` — un placeholder PUESTO A PROPÓSITO: nadie
//   espera que resuelva. Sin mock, los 8 pasos de BNPL y los 11 de Consumo mueren todos con
//   `cURL error 6: Could not resolve host`, el flujo nunca llega al estado 25 y el código de compra
//   no se puede ejercitar. Con esto el canal QR corre entero en local.
//
//   Dato que importa: el backend llega HASTA el DNS. O sea la credencial se desencripta bien, el
//   certificado se exporta y el JWT se firma — lo único que falta es alguien del otro lado.
//
// CONTRATO — leído de las Actions en origin/main, no inventado:
//   `app/Actions/Lenders/Bancolombia.php`          → OAuth2 `POST {AUTH_HOST}{AUTH_PREFIX}/oauth2/token`
//                                                    (form-encoded, client_credentials)
//   `app/Actions/Lenders/BancolombiaBnpl.php`      → 9 rutas bajo `{HOST}{BNPL_PREFIX}`
//   `app/Actions/Lenders/BancolombiaConsumerLoan.php` → 11 rutas bajo `{HOST}{CONSUMER_LOAN_PREFIX*}`
//                                                    (usa TRES prefijos distintos: base, -v1 y -v2)
//
// CÓMO RUTEA (y por qué así): **por la COLA del path, ignorando el prefijo**. Los prefijos salen de
//   variables de entorno (`BANCOLOMBIA_BNPL_PREFIX`, `…_CONSUMER_LOAN_PREFIX{,_V1,_V2}`) y el mock no
//   tiene por qué conocerlos: matchear el sufijo lo hace inmune a que cambien. Ojo con el ORDEN:
//   `/disbursements/confirm` tiene que evaluarse antes que `/disbursements`.
//
// LOS DOS STRINGS QUE SELLAN EL ESTADO 25 (el desenlace del canal Corbeta):
//   · BNPL:    `data.status = "PENDIENTE DESEMBOLSO"`   → `BancolombiaBnplController.php:1395`
//   · Consumo: `data.payment.status = "pendiente"`      → `BancolombiaLoanController.php:1796`
//   En los dos casos el controller ADEMÁS exige que el allied esté en `Setting('corbeta_allieds')`.
//   Cambiá esos strings con el control de abajo y podés ejercitar la rama NO-Corbeta.
//
// EL `bnplTransactionId` ROUND-TRIPPEA: se mintea en `/auth/provide-authentication` y, si el backend
//   lo manda de vuelta en un paso posterior, se ECHOA tal cual. Si no round-trippeara, el controller
//   escribiría basura en `lender_integration_flows` y los pasos siguientes fallarían por una razón que
//   no es la del flujo.
//
// LAS RESPUESTAS SON UN SUPERSET a propósito: los controllers leen con `data_get`, así que una clave
//   de más es inocua y una de menos es un 500. Cuando dos productos comparten cola de path
//   (`/terms/retrieve` existe en BNPL y en Consumo-v2) se devuelve una respuesta que sirve a los dos.
//
// APUNTÁ EL BACKEND (legacy-backend/.env) — Docker, así que NO es localhost, y va por HTTP:
//   BANCOLOMBIA_HOST=http://host.docker.internal:8104
//   BANCOLOMBIA_AUTH_HOST=http://host.docker.internal:8104
//
// USO:  node mock-bancolombia/server.mjs   (o  bin/mock-bancolombia start)
//   env: MOCK_BC_PORT (8104) · MOCK_BC_FAIL=1 → todo responde 500 SP500
// CONTROL en caliente:
//   GET  /                              → estado + escenario + últimas llamadas
//   POST /_control/escenario  {hasQuota?, balance?, bnplStatus?, consumoStatus?, errorCode?}
//   POST /_control/reset

// ⚠ EN LOS ÉXITOS NO VA LA CLAVE `errors` — NI VACÍA.
//   El controller decide con `if (isset($quotaResponse['errors']))` (BancolombiaBnplController, bloque de
//   retrieve-quota): un `"errors": []` **está set**, así que un array vacío se lee como ERROR y sale
//   `BNPL001 error retrieving quota` con la respuesta feliz en la mano. Costó una corrida entera.
//   (De paso: es una trampa latente de la integración real, no sólo del mock — si el banco algún día
//   devuelve `errors: []` en un éxito, el flujo se cae igual.)

import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';

const PORT = Number(process.env.MOCK_BC_PORT || 8104);
const FAIL = process.env.MOCK_BC_FAIL === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** Escenario en caliente. Los defaults son el CAMINO FELIZ del canal Corbeta. */
const esc = {
    hasQuota: true,
    balance: 5_000_000,
    bnplStatus: 'PENDIENTE DESEMBOLSO',   // sella estado 25 en BNPL
    consumoStatus: 'pendiente',           // sella estado 25 en Consumo
    errorCode: null,                      // ej. 'BP40920507' (sin cupo) o 'BP20790'
};
/** La cuenta del cliente, como SUPERSET de nombres. El controller de `list-accounts-and-quota` lee
 *  `['id']` (verificado: sin esa clave tira `Undefined array key "id"` → BNPL999), y otros consumidores
 *  usan `accountId`/`accountNumber`. Se mandan todos: una clave de más es inocua, una de menos es un 500. */
const CUENTA = {
    id: '1', accountId: '1',
    accountNumber: '****1234', maskedAccountNumber: '****1234', number: '****1234',
    accountType: 'AHORROS', type: 'AHORROS',
    balance: 5_000_000, name: 'AHORROS ****1234',
};
const llamadas = [];
let txId = null;          // el bnplTransactionId vigente (BNPL)
let sessionToken = null;  // el sessionToken vigente (Consumo)

const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};
const leer = (req) => new Promise((ok) => {
    let raw = '';
    req.on('data', (d) => { raw += d; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => ok(raw));
});
const parse = (raw, ct = '') => {
    if (!raw) return {};
    if (ct.includes('form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
    try { return JSON.parse(raw); } catch { return { raw: raw.slice(0, 200) }; }
};
/** Sobre de error del banco: el código va en `errors[0].code` (los controllers lo leen con data_get). */
const err = (res, status, code, detail) => json(res, status, {
    meta: { _messageId: randomUUID(), _requestDateTime: new Date().toISOString() },
    status, title: 'Error', errors: [{ code, detail }],
});
/** Busca el transactionId en el body, en cualquiera de las formas en que el backend lo manda. */
const txDelBody = (b) => b?.data?.security?.transactionId ?? b?.transactionId ?? b?.bnplTransactionId
    ?? b?.data?.info?.bnplTransactionId ?? null;

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const raw = req.method === 'POST' ? await leer(req) : '';
    const body = parse(raw, req.headers['content-type'] || '');

    if (path === '/' && req.method === 'GET') {
        return json(res, 200, { mock: 'bancolombia', puerto: PORT, fail: FAIL, escenario: esc, transactionId: txId, llamadas: llamadas.slice(-25) });
    }
    if (path === '/_control/reset') { llamadas.length = 0; txId = null; sessionToken = null; log('control: reset'); return json(res, 200, { ok: true }); }
    if (path === '/_control/escenario') {
        for (const k of Object.keys(esc)) if (body[k] !== undefined) esc[k] = body[k];
        log(`control: escenario ${JSON.stringify(esc)}`);
        return json(res, 200, { ok: true, escenario: esc });
    }

    // ── el contrato ───────────────────────────────────────────────────────────────────────────────
    const tail = (s) => path.endsWith(s);
    llamadas.push({ at: new Date().toISOString(), path, tx: txDelBody(body) });
    log(`${req.method} ${path}`);

    if (FAIL) return err(res, 500, 'SP500', 'Error interno (MOCK_BC_FAIL=1)');
    if (esc.errorCode) return err(res, 409, esc.errorCode, 'Error forzado por escenario del mock');

    // OAuth2 (form-encoded). El caller lee token_type/expires_in/scope y usa el access_token.
    if (tail('/oauth2/token')) {
        return json(res, 200, {
            access_token: `mock-bc-${randomBytes(12).toString('hex')}`,
            token_type: 'Bearer', expires_in: 3600, scope: body.scope ?? 'mock',
        });
    }

    // ── BNPL ──────────────────────────────────────────────────────────────────────────────────────
    // provide-authentication / session: acá NACE el bnplTransactionId — el único insumo que después
    // Bancolombia exige para emitir el código de compra (`data.security.transactionId`).
    if (tail('/auth/provide-authentication') || tail('/auth/session')) {
        txId = txDelBody(body) ?? txId ?? randomUUID();
        return json(res, 200, {
            data: {
                info: { bnplTransactionId: txId, status: 'OK' },
                security: { transactionId: txId },
                url: `http://localhost:${PORT}/_login-simulado?tx=${txId}`,
            },
        });
    }
    if (tail('/credit-quota-information/retrieve-quota')) {
        txId = txDelBody(body) ?? txId ?? randomUUID();
        return json(res, 200, {
            data: {
                hasQuota: esc.hasQuota, balance: esc.balance, availableQuota: esc.balance,
                info: { bnplTransactionId: txId }, security: { transactionId: txId },
                // ⚠ LAS CUENTAS VAN ANIDADAS EN `account.accounts` — no basta con la lista plana.
                // `list-accounts-and-quota` relee el paso `retrieve_quota` que quedó guardado en
                // `lender_integration_flows` y corta con `!isset($retrieveQuota['account']['accounts'])`
                // → `BNPL010 retrieve quota missing or invalid`. La lista plana se deja además por si
                // algún consumidor la lee así (superset a propósito).
                account: {
                    accounts: [CUENTA],
                },
                accounts: [CUENTA],
            },
        });
    }
    // El del LISTADO (`validatePreApproveLender` → `validateQuota`): sólo mira `data.hasQuota`.
    if (tail('/prospect-validation/validate-quota')) {
        return json(res, 200, { data: { hasQuota: esc.hasQuota, validate: esc.hasQuota, balance: esc.balance } });
    }
    if (tail('/payments/select-account')) {
        return json(res, 200, { data: { selected: true, accountId: body?.data?.accountId ?? '1', info: { bnplTransactionId: txId } } });
    }
    if (tail('/payments/purchase-intention')) {
        return json(res, 200, { data: { purchaseId: randomUUID(), status: 'OK', info: { bnplTransactionId: txId } } });
    }
    // `/terms/retrieve` la comparten BNPL y Consumo-v2 → superset que sirve a los dos.
    if (tail('/terms/retrieve')) {
        return json(res, 200, {
            data: {
                termsId: randomUUID(), status: 'OK',
                // ⚠ `terms` es un OBJETO, no un string: `register-terms` lo indexa como
                // `$allSteps['retrieve_terms']['terms']['version']` y `['customerAcceptedTerms']`
                // (BancolombiaLoanController.php:711). Con un string sale
                // `Cannot access offset of type string on string`.
                terms: { version: '1.0', customerAcceptedTerms: true, text: 'Términos simulados por el mock.', id: '1' },
                termsAndConditions: 'Términos y condiciones simulados por el mock.',
                documents: [{ id: '1', name: 'terminos.pdf', url: `http://localhost:${PORT}/_doc.pdf` }],
                security: { transactionId: txId },
            },
        });
    }
    if (tail('/terms/acceptance') || tail('/terms/register')) {
        return json(res, 200, { data: { accepted: true, status: 'OK', registered: true, security: { transactionId: txId } } });
    }
    // ORIGINATION — el que sella el estado 25 en BNPL.
    if (tail('/electronic-signature-management/origination')) {
        return json(res, 200, {
            data: { status: esc.bnplStatus, authorizationCode: '098734', info: { bnplTransactionId: txId }, security: { transactionId: txId } },
        });
    }

    // ── CONSUMO ───────────────────────────────────────────────────────────────────────────────────
    // validate: de acá sale el `customerValidateKey`, que es el transactionId del producto Consumo
    // (`BancolombiaLoanController.php:187` lo guarda como `loan_validate_key`).
    if (tail('/customers/validate')) {
        const key = `mock-validate-key-${randomBytes(48).toString('base64url')}`;
        return json(res, 200, {
            data: {
                status: 'Success', validate: 'Success',
                security: { customerValidateKey: key, sessionToken: sessionToken ?? (sessionToken = `mock-session-${randomBytes(16).toString('hex')}`), urlDynamicKey: `http://localhost:${PORT}/_clave-dinamica-simulada` },
            },
        });
    }
    // ⚠ ACÁ NACE EL `sessionToken`, y es el insumo del que dependen SIETE pasos de Consumo.
    // El controller lo lee como `$allSteps['authenticate']['security']['sessionToken']` (siete sitios:
    // :709 :836 :1102 :1257 :1423 :1569 :1700) desde el paso `authenticate` que guarda en el flow con
    // `$bancolombiaAuthenticate['data']` (:343). Sin él, register-terms / enable-offers / select-insurance
    // / e-sign / origination revientan todos con `Undefined array key "sessionToken"` → LOAN999.
    if (tail('/customers/authenticate')) {
        sessionToken = sessionToken ?? `mock-session-${randomBytes(16).toString('hex')}`;
        return json(res, 200, {
            data: {
                status: 'Success', authenticated: true,
                security: {
                    sessionToken,
                    customerValidateKey: body?.data?.security?.customerValidateKey ?? 'mock-key',
                    urlDynamicKey: `http://localhost:${PORT}/_clave-dinamica-simulada`,
                },
            },
        });
    }
    if (tail('/customers/eSignDocument')) {
        return json(res, 200, { data: { status: 'Success', signed: true, documentId: randomUUID() } });
    }
    if (tail('/enable-offers/preapproved')) {
        return json(res, 200, {
            data: {
                status: 'Success',
                offers: [{ offerId: '1', amount: esc.balance, feeNumber: 12, rate: 1.8, feeValue: Math.round(esc.balance / 12) }],
                // ⚠ `get-detail-simulation` lee `enable_offers['products'][0]['interestRates'][0]['type']`
                // (BancolombiaLoanController.php:1262) → sin `products` sale `Undefined array key "products"`.
                products: [{
                    productId: '14', id: '14', name: 'Crédito de consumo',
                    interestRates: [{ type: 'FIJA', value: 1.8, rate: 1.8 }],
                    // `get-detail-simulation` también itera `products[0]['insurances']` (:1265) para armar
                    // `insurance_type` → sin la clave sale `Undefined array key "insurances"`.
                    insurances: [{ type: 'VIDA', code: 'VIDA', name: 'Seguro de vida', value: 12_000 }],
                    terms: [12, 24, 36, 48], maxAmount: esc.balance, minAmount: 1_000_000,
                }],
                creditLimit: { result: 'APP', amount: esc.balance },
            },
        });
    }
    if (tail('/simulations')) {
        return json(res, 200, {
            data: {
                status: 'Success',
                simulation: { amount: esc.balance, feeNumber: 12, feeValue: Math.round(esc.balance / 12), rate: 1.8, totalAmount: esc.balance },
                fees: [{ number: 1, value: Math.round(esc.balance / 12) }],
            },
        });
    }
    if (tail('/accounts/retrieve')) {
        return json(res, 200, { data: { status: 'Success', accounts: [CUENTA] } });
    }
    // ⚠ ORDEN: confirm ANTES que /disbursements, porque `/disbursements/confirm` también termina en él.
    if (tail('/disbursements/confirm')) {
        return json(res, 200, { data: { status: 'Success', payment: { status: esc.consumoStatus, reference: randomUUID() } } });
    }
    // DISBURSEMENT — el que sella el estado 25 en Consumo (lee `data.payment.status`).
    if (tail('/disbursements')) {
        return json(res, 200, { data: { status: 'Success', payment: { status: esc.consumoStatus, reference: randomUUID() } } });
    }

    // ── confirmaciones de la conciliación batch ───────────────────────────────────────────────────
    if (tail('/bnplConfirmed') || tail('/consumoConfirmed')) {
        return json(res, 200, { data: { status: 'Recibida' } });
    }

    // Ruta no mapeada: 200 + log en mayúsculas (convención de mock-lenders, F-25). Así aparece en el
    // log en vez de romper el flujo con un 404 que se lee como error del producto.
    log(`⚠ RUTA NO MAPEADA: ${req.method} ${path} · body=${raw.slice(0, 300)}`);
    return json(res, 200, { data: { status: 'OK' } });
});

server.listen(PORT, () => log(`mock-bancolombia escuchando en :${PORT}${FAIL ? ' · MODO FALLO' : ''}`));
