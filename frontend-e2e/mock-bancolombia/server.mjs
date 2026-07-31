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
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Huella del CÓDIGO que este proceso tiene en memoria. `bin/mock-bancolombia start` la compara con el
 *  archivo en disco: si editás el mock y el proceso viejo sigue vivo, `start` decía «ya arriba» y seguía
 *  sirviendo la versión anterior — el arreglo no se aplicaba y nada lo avisaba. */
const CODIGO = Math.floor(statSync(fileURLToPath(import.meta.url)).mtimeMs / 1000);

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
    // ⚠ DÓNDE falla, y no es un detalle: sin esto el `errorCode` aplica a TODAS las rutas, y lo PRIMERO
    // que hace el canal QR es la compuerta de pre-aprobación → cualquier falla global termina en
    // `no-preapproved` y **nunca** se alcanzan las pantallas de error de más adelante. Verificado: tanto
    // `errorCode: 'BP20790'` como `MOCK_BC_FAIL=1` daban `no-preapproved`, no `business-error` (F-90).
    // Con `errorEn` el error se dispara sólo cuando el path contiene ese texto
    // (ej. 'origination', 'retrieve-quota', 'purchase-intention'). `null` = todas, como antes.
    errorEn: null,
    // QUÉ PRODUCTO RESUELVE EL OTP. No es cosmético: `PreApprovedLenderService::validateBancolombiaPreapprove`
    // consulta las DOS compuertas y decide con un match (verificado):
    //   BNPL     → `validateQuota` (monto 100.000, lender 68) con `data.validate === true`
    //   Consumo  → `validate`      (monto 1.000.000, lender 100) con `data.validate === 'Success'`
    //              ('Pending' → pendiente · 409 BP40920507 → no habilitado)
    //   hasBnpl && (hasConsumer||pending) → PLS003 multiproducto (arranca en BNPL, lender 68)
    //   hasBnpl → PLS001 · hasConsumer → PLS002 (lender 100) · pending → PLS004 · nada → PLS005
    // Por eso, para ver las pantallas de CONSUMO hay que apagar la compuerta de BNPL: con las dos
    // prendidas el recorrido arranca siempre en BNPL y las 11 pantallas de Consumo no se alcanzan.
    producto: 'ambos',                    // ambos | bnpl | consumo | pendiente | ninguno
};
/** ¿Contesta la compuerta de este producto que sí hay cupo? */
const habilitado = (p) => esc.producto === 'ambos' || esc.producto === p;
/** La cuenta del cliente, como SUPERSET de nombres. El controller de `list-accounts-and-quota` lee
 *  `['id']` (verificado: sin esa clave tira `Undefined array key "id"` → BNPL999), y otros consumidores
 *  usan `accountId`/`accountNumber`. Se mandan todos: una clave de más es inocua, una de menos es un 500. */
const CUENTA = {
    // ⚠ `id` va NUMÉRICO. El front valida cada cuenta con `BnplAccountSchema` = `{ id: z.number(),
    // type: z.string(), number: z.string() }` (bnpl-api.schema.ts:3): con `id: '1'` zod rechaza la
    // respuesta COMPLETA, el UC devuelve `success:false` y `loan-info` muestra «Error al cargar la
    // información» sin nombrar el campo. El backend es más laxo —sólo exige que la clave exista— así que
    // el número le sirve igual. Cuando el front y el backend piden tipos distintos, gana el más estricto.
    id: 1, accountId: '1',
    // Los valores son los MISMOS que el backend le manda al banco fuera de producción
    // (`selectAccount`: id '1' · type CUENTA_DE_AHORRO · number 9220), para que la cuenta que ve el
    // cliente sea la misma en todas las pantallas del recorrido.
    accountNumber: '9220', maskedAccountNumber: '****9220', number: '9220',
    accountType: 'CUENTA_DE_AHORRO', type: 'CUENTA_DE_AHORRO',
    balance: 5_000_000, name: 'Ahorros ****9220',
};
/** Comisión del banco por la compra. Valor arbitrario: el front la MUESTRA (`commission` / `userCommission`
 *  son `z.number()`) y nadie compara contra un esperado. */
const COMISION = 5_000;
/** Cuotas del BNPL. «Compra y paga después» es un pago diferido: una sola cuota, a 30 días. */
const CUOTAS_BNPL = 1;
/** Fecha de la cuota `i` (0-based), un mes por cuota desde una BASE FIJA. Fija a propósito: el front sólo
 *  la muestra como string, y una fecha estable hace comparables las corridas de la suite de
 *  caracterización (con "hoy + n meses" el screenshot cambiaría cada día). */
const fechaCuota = (i) => {
    const d = new Date(Date.UTC(2026, 7, 15));       // 2026-08-15
    d.setUTCMonth(d.getUTCMonth() + i);
    return d.toISOString().slice(0, 10);
};
const llamadas = [];
let txId = null;          // el bnplTransactionId vigente (BNPL)
let sessionToken = null;  // el sessionToken vigente (Consumo)
let validateKey = null;   // el customerValidateKey vigente (Consumo)
const nuevoSessionToken = () => `mock-session-${randomBytes(16).toString('hex')}`;
const nuevaValidateKey = () => `mock-validate-key-${randomBytes(48).toString('base64url')}`;
/** A dónde vuelve el cliente después de "autenticarse" en el banco. Lo REGISTRA el harness (ver
 *  `/_control/retorno`), porque deducirlo del `document.referrer` no funciona: el wizard (:5174) y este
 *  mock (:8104) son ORÍGENES DISTINTOS y la política default del browser
 *  (`strict-origin-when-cross-origin`) recorta el referrer a `http://localhost:5174/` — sin path. Con eso
 *  la transformación /start/ → /loan-info/ no aplicaba, el regreso caía en `/`, y `/` → `/merchant` →
 *  **`/login`**: el cliente terminaba en el login de ASESOR en un canal autoasistido. */
let retorno = null;

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
        return json(res, 200, { mock: 'bancolombia', puerto: PORT, fail: FAIL, codigo: CODIGO, escenario: esc, transactionId: txId, retorno, llamadas: llamadas.slice(-25) });
    }
    if (path === '/_control/reset') { llamadas.length = 0; txId = null; sessionToken = null; validateKey = null; retorno = null; log('control: reset'); return json(res, 200, { ok: true }); }
    // El harness registra acá a dónde volver: él SÍ conoce el `encryptCode` (lo ve en la URL
    // `/bancolombia/{tipo}/start/{code}` del wizard) y el producto. Sin esto el regreso es adivinanza.
    if (path === '/_control/retorno') {
        retorno = typeof body.url === 'string' && body.url ? body.url : null;
        log(`control: retorno ${retorno ?? '(limpio)'}`);
        return json(res, 200, { ok: true, retorno });
    }
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
    if (esc.errorCode && (!esc.errorEn || path.includes(esc.errorEn))) {
        return err(res, 409, esc.errorCode, `Error forzado por escenario del mock${esc.errorEn ? ` (sólo en *${esc.errorEn}*)` : ''}`);
    }

    // ── PÁGINA de autenticación simulada del banco ────────────────────────────────────────────────
    // El flujo de Consumo manda al cliente a autenticarse en Bancolombia (clave dinámica) y vuelve con un
    // `code`. Sin una página real acá, el front navega a un JSON y el recorrido visual muere. Mismo patrón
    // que `mock-bank/index.html` para los otros lenders: no simula la seguridad, simula el REGRESO.
    // ⚠ LAS DOS RUTAS, porque cada producto manda a la suya: BNPL devuelve `data.url` →
    // `/_login-simulado` (login del banco) y Consumo devuelve `data.security.urlAuthenticate` →
    // `/_autenticacion` (clave dinámica). Servir sólo una dejaba a la otra cayendo en el catch-all, que
    // responde `{"data":{"status":"OK"}}` — y el cliente veía ESE JSON crudo en el navegador en vez de una
    // pantalla. Es el mismo bug con dos nombres, así que las dos apuntan a la misma página.
    if ((tail('/_autenticacion') || tail('/_login-simulado')) && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset=utf-8><title>Bancolombia · autenticación simulada</title>
<style>body{font:16px/1.5 system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#111;color:#eee}
.c{max-width:24rem;text-align:center;padding:2rem}b{color:#ffd400}
button{font:inherit;padding:.7rem 1.4rem;border:0;border-radius:.5rem;background:#ffd400;color:#111;cursor:pointer}</style>
<div class=c><h1>Autenticación Bancolombia</h1>
<p>Autenticación <b>simulada</b> de Bancolombia (mock del harness). No valida nada: reproduce el REGRESO al
flujo con el <code>code</code> que el wizard espera.</p>
<button onclick="volver()">Autenticarme y volver</button>
<p style="opacity:.6;font-size:.8rem" id=d></p></div>
<script>
  // A DÓNDE VOLVER. El wizard espera el regreso en LOAN-INFO con el code en la query (su loader lo exige
  // y tira 400 sin él); volver a /start/ sería un loop, porque start es justamente quien redirige al banco.
  //
  // ⚠ NO se deduce del referrer. El wizard (:5174) y este mock (:8104) son orígenes distintos, y la
  // política default del browser (strict-origin-when-cross-origin) manda SÓLO el origen: el referrer llega
  // como "http://localhost:5174/", sin path. La transformación /start/ -> /loan-info/ no encontraba nada,
  // el destino quedaba en "/", y "/" redirige a /merchant y de ahí a /login: el cliente terminaba en el
  // login de ASESOR dentro de un canal autoasistido. Por eso manda el retorno que REGISTRA el harness
  // (POST /_control/retorno) y el referrer queda sólo como respaldo, y únicamente si trae /start/.
  // (Sin backticks a propósito: este script vive DENTRO de un template literal del server y un backtick
  //  acá lo termina — ya rompió el mock una vez.)
  const fijo = ${JSON.stringify(retorno)};
  const delReferrer = () => {
    const ref = document.referrer;
    if (!ref || !ref.includes('/start/')) return null;   // sin path útil no se inventa un destino
    const u = new URL(ref);
    u.pathname = u.pathname.replace('/start/', '/loan-info/');
    u.searchParams.set('code', 'mock-auth-code');
    return u.toString();
  };
  const d = fijo || delReferrer();
  document.getElementById('d').textContent = d
    ? 'volverá a: ' + d
    : 'no hay retorno registrado: entrá por el flujo del wizard (el harness lo registra al pasar por /start/)';
  function volver() {
    if (!d) return alert('No hay retorno registrado. Entrá por el flujo del wizard: el harness lo registra al pasar por /start/. Abrir esta URL a mano no alcanza.');
    location.href = d;
  }
</script>`);
    }

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
                // El backend hace PASSTHROUGH de este `data` (`'retrieve_quota' => $quotaResponse['data']`),
                // así que las claves de acá las valida el front con `BnplRetrieveQuotaPayloadSchema`:
                // signatureMethod + balance + commission + account.accounts[]. Faltando UNA, zod tumba la
                // respuesta entera y la pantalla dice sólo «Error al cargar la información».
                signatureMethod: 'DYNAMIC_KEY',   // el front lo arrastra, no lo compara con nada
                commission: COMISION,
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
    // COMPUERTA DE BNPL. Dos consumidores: el LISTADO (`validatePreApproveLender` → `validateQuota`, que
    // sólo mira `data.hasQuota`) y la DECISIÓN DE PRODUCTO del canal QR, que exige `data.validate === true`
    // (`PreApprovedLenderService::validateBancolombiaPreapprove`). Se responde a los dos.
    if (tail('/prospect-validation/validate-quota')) {
        const ok = esc.hasQuota && habilitado('bnpl');
        return json(res, 200, { data: { hasQuota: ok, validate: ok, balance: esc.balance } });
    }
    if (tail('/payments/select-account')) {
        // El front exige `select_account.account.{id,type,number}` con **id STRING**
        // (`BnplSelectAccountPayloadSchema`) — al revés que en el listado de cuentas, donde el id es número.
        // Se devuelve por ECO de lo que mandó el backend: fuera de producción manda fijo
        // `{id:'1', type:'CUENTA_DE_AHORRO', number:'9220'}` (BancolombiaBnpl.php::selectAccount), así que
        // el eco es lo más fiel y además mantiene la cuenta idéntica en todas las pantallas.
        const pedida = body?.data?.account ?? {};
        return json(res, 200, {
            data: {
                selected: true, status: 'OK',
                account: {
                    id: String(pedida.id ?? CUENTA.accountId),
                    type: String(pedida.type ?? CUENTA.type),
                    number: String(pedida.number ?? CUENTA.number),
                },
                accountId: String(pedida.id ?? CUENTA.accountId),
                info: { bnplTransactionId: txId },
            },
        });
    }
    if (tail('/payments/purchase-intention')) {
        // El front valida esto con `BnplListAccountsQuotaPayloadSchema.purchase`: userCommission +
        // numberInstallments + installments[] con {installmentValue, installmentFee: array,
        // installmentTotal, paymentDate}. Sin el plan de cuotas la pantalla del resumen no carga.
        const total = Number(body?.data?.totalPrice ?? body?.data?.amount ?? esc.balance) || esc.balance;
        const cuotas = Number(body?.data?.numberInstallments) || CUOTAS_BNPL;
        const valor = Math.round(total / cuotas);
        const installments = Array.from({ length: cuotas }, (_, i) => ({
            installmentNumber: i + 1,
            installmentValue: valor,
            installmentFee: [],                       // z.array(z.unknown()): puede ir vacío, no ausente
            installmentTotal: valor + Math.round(COMISION / cuotas),
            paymentDate: fechaCuota(i),
        }));
        return json(res, 200, {
            data: {
                purchaseId: randomUUID(), status: 'OK',
                userCommission: COMISION,
                numberInstallments: cuotas,
                installments,
                totalPrice: total,
                info: { bnplTransactionId: txId },
            },
        });
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
                // ⚠ `url` NO es opcional para el front: `BnplTermsPayloadSchema` (y el de Consumo) exigen
                // `terms.terms.{url, version}` — el de Consumo pide además `customerAcceptedTerms`. Sin la
                // url, zod tumba la respuesta y la pantalla de términos no carga. Apunta a una página que el
                // mock SIRVE de verdad (`/_terminos`), así el link del cliente abre algo en vez de romper.
                terms: {
                    version: '1.0',
                    url: `http://localhost:${PORT}/_terminos`,
                    customerAcceptedTerms: true,
                    text: 'Términos simulados por el mock.', id: '1',
                },
                termsAndConditions: 'Términos y condiciones simulados por el mock.',
                documents: [{ id: '1', name: 'terminos.pdf', format: 'pdf', url: `http://localhost:${PORT}/_terminos` }],
                // ⚠ `security` es OPCIONAL en el schema de Consumo, pero si va tiene que ser VÁLIDA:
                // `LoanSecuritySchema` exige `customerValidateKey`. Mandarla a medias (sólo con
                // `transactionId`) rompe más que no mandarla — opcional no significa "cualquier cosa".
                security: {
                    transactionId: txId,
                    customerValidateKey: validateKey ?? (validateKey = nuevaValidateKey()),
                },
            },
        });
    }
    if (tail('/terms/acceptance') || tail('/terms/register')) {
        // `register-terms` (Consumo) se lo pasa al front como `data.security.customerValidateKey`
        // (`LoanRegisterTermsPayloadSchema` lo exige), así que el sobre `security` va con las dos claves.
        return json(res, 200, {
            data: {
                accepted: true, status: 'OK', registered: true,
                security: {
                    transactionId: txId,
                    customerValidateKey: validateKey ?? (validateKey = nuevaValidateKey()),
                    sessionToken: sessionToken ?? (sessionToken = nuevoSessionToken()),
                },
            },
        });
    }
    // ORIGINATION — el que sella el estado 25 en BNPL.
    if (tail('/electronic-signature-management/origination')) {
        return json(res, 200, {
            data: {
                status: esc.bnplStatus,
                // El front exige `origination.{signatureMethod, status}` (`BnplOriginationPayloadSchema`):
                // sin signatureMethod la ÚLTIMA pantalla —la del código de compra— no llega a renderizar,
                // justo después de que el backend ya sellara el estado 25. Un fallo así se lee como "no
                // originó" cuando en realidad originó y sólo se cayó la vista.
                signatureMethod: 'DYNAMIC_KEY',
                authorizationCode: '098734',
                info: { bnplTransactionId: txId }, security: { transactionId: txId },
            },
        });
    }

    // ── CONSUMO ───────────────────────────────────────────────────────────────────────────────────
    // validate: de acá sale el `customerValidateKey`, que es el transactionId del producto Consumo
    // (`BancolombiaLoanController.php:187` lo guarda como `loan_validate_key`).
    if (tail('/customers/validate')) {
        // La key se GUARDA (no es local): varios pasos posteriores de Consumo se la devuelven al front y
        // el schema la exige (`LoanSecuritySchema.customerValidateKey`). Que sea la misma en todo el
        // recorrido es lo que hace el flujo coherente.
        const key = validateKey ?? (validateKey = nuevaValidateKey());
        // COMPUERTA DE CONSUMO. Mismo endpoint para la decisión de producto y para el paso del flujo, así
        // que la perilla se aplica acá. `BP40920507@409` es la respuesta REAL del banco para "persona no
        // habilitada" y el servicio la trata como "sin cupo", no como error (por eso no rompe el recorrido).
        if (!habilitado('consumo') && esc.producto !== 'pendiente') {
            return err(res, 409, 'BP40920507', 'Persona no habilitada (escenario del mock)');
        }
        return json(res, 200, {
            data: {
                status: 'Success',
                validate: esc.producto === 'pendiente' ? 'Pending' : 'Success',
                // ⚠ LA CLAVE ES `urlAuthenticate`, no `urlDynamicKey`. El front la lee exactamente así:
                // `login-redirect.uc.ts:19` → `result.payload.data.security.urlAuthenticate`. Con la otra
                // clave el `url` llega **undefined**, la pantalla `/bancolombia/consumo/start/{code}` explota
                // con `Cannot read properties of undefined (reading 'value')` y muestra el banner genérico
                // «hubo un problema con el proceso» — que no dice nada del campo faltante.
                // (El nodo `ms-preapprovals` ya lo decía: el challenge de Consumo son `urlAuthenticate` +
                // `customerValidateKey`.) Se manda también `urlDynamicKey` por si algún consumidor la usa.
                security: {
                    customerValidateKey: key,
                    sessionToken: sessionToken ?? (sessionToken = `mock-session-${randomBytes(16).toString('hex')}`),
                    urlAuthenticate: `http://localhost:${PORT}/_autenticacion`,
                    urlDynamicKey: `http://localhost:${PORT}/_autenticacion`,
                },
            },
        });
    }
    // ⚠ ACÁ NACE EL `sessionToken`, y es el insumo del que dependen SIETE pasos de Consumo.
    // El controller lo lee como `$allSteps['authenticate']['security']['sessionToken']` (siete sitios:
    // :709 :836 :1102 :1257 :1423 :1569 :1700) desde el paso `authenticate` que guarda en el flow con
    // `$bancolombiaAuthenticate['data']` (:343). Sin él, register-terms / enable-offers / select-insurance
    // / e-sign / origination revientan todos con `Undefined array key "sessionToken"` → LOAN999.
    if (tail('/customers/authenticate')) {
        sessionToken = sessionToken ?? nuevoSessionToken();
        return json(res, 200, {
            data: {
                status: 'Success', authenticated: true,
                security: {
                    sessionToken,
                    customerValidateKey: body?.data?.security?.customerValidateKey ?? validateKey ?? (validateKey = nuevaValidateKey()),
                    // A la página que el mock SÍ sirve. Antes apuntaba a `/_clave-dinamica-simulada`, que no
                    // existe: caía en el catch-all y el cliente veía `{"data":{"status":"OK"}}` crudo.
                    urlDynamicKey: `http://localhost:${PORT}/_autenticacion`,
                },
            },
        });
    }
    if (tail('/customers/eSignDocument')) {
        // ⚠ El backend arma el `url` del front con `data.security.urlDynamicKey`
        // (BancolombiaLoanController.php:1606) y el front lo exige NO nulo
        // (`LoanESignDocumentPayloadSchema.url: z.string()`). Sin esta clave el paso de firma electrónica
        // queda con `url: null` → zod lo rechaza y la pantalla no carga.
        return json(res, 200, {
            data: {
                status: 'Success', signed: true, documentId: randomUUID(),
                security: {
                    urlDynamicKey: `http://localhost:${PORT}/_autenticacion`,
                    customerValidateKey: validateKey ?? (validateKey = nuevaValidateKey()),
                    sessionToken: sessionToken ?? (sessionToken = nuevoSessionToken()),
                },
            },
        });
    }
    if (tail('/enable-offers/preapproved')) {
        return json(res, 200, {
            data: {
                status: 'Success',
                offers: [{ offerId: '1', amount: esc.balance, feeNumber: 12, rate: 1.8, feeValue: Math.round(esc.balance / 12) }],
                // ⚠ `get-detail-simulation` lee `enable_offers['products'][0]['interestRates'][0]['type']`
                // (BancolombiaLoanController.php:1262) → sin `products` sale `Undefined array key "products"`.
                //
                // ⚠⚠ LOS `type` SON ENUMS DEL FRONT, no texto libre. `LoanEnableOffersProductSchema` valida
                // `interestRates[].type` contra ["TASA_FIJA","DEPOSITO_TERMINO_FIJO",
                // "INDICE_BANCARIO_DE_REFERENCIA"] y `insurances[].type` contra ["SEGURO_DE_DESEMPLEO",
                // "SEGURO_DE_VIDA","VIDA_MAS","SEGURO_DE_VEHICULO"] (loan-api.schema.ts:12 y :18). Los
                // valores cortos que había acá ('FIJA' / 'VIDA') le alcanzaban al BACKEND —que sólo los
                // arrastra— pero el front rechazaba la oferta entera. Y `totalAmount`, `expirationDate` y
                // `periodCredits[{min,max}]` son obligatorios: sin ellos no hay pantalla de oferta.
                products: [{
                    productId: '14', id: '14', name: 'Crédito de consumo',
                    totalAmount: esc.balance,
                    expirationDate: fechaCuota(6),
                    interestRates: [{
                        type: 'TASA_FIJA',
                        monthOverdue: 2.5, arreas: 2.5, effectiveAnnual: 23.87, nominalAnnual: 21.6,
                        variableInterestRateAdditionalPoints: 0,
                        value: 1.8, rate: 1.8,
                    }],
                    periodCredits: [{ min: 12, max: 48 }],
                    // `get-detail-simulation` también itera `products[0]['insurances']` (:1265) para armar
                    // `insurance_type` → sin la clave sale `Undefined array key "insurances"`.
                    insurances: [{
                        type: 'SEGURO_DE_VIDA', minAmount: 0, maxAmount: 100_000, factor: 0.0024,
                        amount: 12_000, code: 'VIDA', name: 'Seguro de vida', value: 12_000,
                    }],
                    terms: [12, 24, 36, 48], maxAmount: esc.balance, minAmount: 1_000_000,
                }],
                creditLimit: { result: 'APP', amount: esc.balance },
            },
        });
    }
    if (tail('/simulations')) {
        // El front pide `simulation.{security.customerValidateKey, installmentDatas[]}` y cada cuota con
        // `{installment, paymentDay, interestRate{…6 campos…}, expirationDate, insurances[{type,amount}]}`
        // (`LoanDetailSimulationPayloadSchema` + `LoanInstallmentDataSchema`). El `simulation` plano que
        // había acá le servía al backend pero el front no tenía de dónde armar la tabla de cuotas.
        const cuotas = 12;
        const valor = Math.round(esc.balance / cuotas);
        const tasa = {
            monthOverdue: 2.5, arreas: 2.5, effectiveAnnual: 23.87, nominalAnnual: 21.6,
            type: 'TASA_FIJA', variableInterestRateAdditionalPoints: 0,
        };
        // ⚠ LAS CLAVES VAN AL NIVEL DE `data`, no anidadas en `data.simulation`. El controller manda al
        // front `'simulation' => $bancolombiaSimulations['data']` (BancolombiaLoanController.php:1297): el
        // `data` COMPLETO es el objeto `simulation` que valida `LoanDetailSimulationPayloadSchema`. Con las
        // claves un nivel más abajo, la pantalla `consumo/loan-info` **no avanza y no muestra ningún error**:
        // el POST responde 200, el schema falla en silencio y el botón parece no hacer nada. Se deja la copia
        // anidada como superset por si algún paso del backend lee `data.simulation`.
        // ⚠ `installmentDatas` NO es un plan de amortización: **cada elemento es una TARJETA DE COBERTURA**
        // de la pantalla `consumo/loan-summary`. `mapInstallmentToCoveragePlan` (domain/mappers) lo traduce:
        // si entre sus `insurances` hay `SEGURO_DE_DESEMPLEO` la tarjeta se llama **«Plus»** (e incluye
        // "Seguro de empleado protegido" + "Tasa preferencial"); si no, **«Básica»**. La cuota que muestra es
        // `installment + Σ insurances.amount`, y la tasa sale de `interestRate`.
        // Por eso van DOS y no doce: mandar 12 pintaba 12 tarjetas idénticas «Cobertura Básica» (y el propio
        // `CoveragePlansResponseSchema` acota `plans` a `.min(1).max(2)`).
        const simulacion = {
            security: { customerValidateKey: validateKey ?? (validateKey = nuevaValidateKey()) },
            installmentDatas: [
                {   // Básica: sólo seguro de vida
                    installment: valor,
                    paymentDay: 15,
                    interestRate: tasa,
                    expirationDate: fechaCuota(0),
                    insurances: [{ type: 'SEGURO_DE_VIDA', amount: 12_000 }],
                },
                {   // Plus: agrega desempleo → nombre «Plus» + tasa preferencial (más baja)
                    installment: valor,
                    paymentDay: 15,
                    interestRate: { ...tasa, monthOverdue: 2.1, effectiveAnnual: 20.5 },
                    expirationDate: fechaCuota(0),
                    insurances: [
                        { type: 'SEGURO_DE_VIDA', amount: 12_000 },
                        { type: 'SEGURO_DE_DESEMPLEO', amount: 9_000 },
                    ],
                },
            ],
            amount: esc.balance, feeNumber: cuotas, feeValue: valor, rate: 1.8, totalAmount: esc.balance,
        };
        return json(res, 200, {
            data: {
                status: 'Success',
                ...simulacion,
                simulation: simulacion,
                fees: [{ number: 1, value: valor }],
            },
        });
    }
    if (tail('/accounts/retrieve')) {
        // `retrieve_accounts.{security.customerValidateKey, depositAccount[{type,number}]}` — el front lo
        // exige así; la lista `accounts` se queda como superset porque el backend la lee con ese nombre.
        return json(res, 200, {
            data: {
                status: 'Success',
                security: { customerValidateKey: validateKey ?? (validateKey = nuevaValidateKey()) },
                depositAccount: [{ type: CUENTA.type, number: CUENTA.number }],
                accounts: [CUENTA],
            },
        });
    }
    // ESTUDIO DE CRÉDITO (`BancolombiaConsumerLoanOfferEvaluation::validateCreditStudy`). Alimenta la
    // pantalla `consumo/loan-offer-evaluation`, que BNPL no tiene. El front exige la cadena completa
    // `validate_credit_study.offerInformationValidate.offer.id` (`LoanValidateCreditStudyPayloadSchema`).
    // Sin esta ruta el mock caía en el catch-all (`{"data":{"status":"OK"}}`) y la pantalla no cargaba.
    if (tail('/validate-credit-study')) {
        return json(res, 200, {
            data: {
                status: 'Success',
                offerInformationValidate: {
                    offer: { id: 'mock-offer-1', amount: esc.balance, status: 'APPROVED' },
                    result: 'APP',
                },
                security: { customerValidateKey: validateKey ?? (validateKey = nuevaValidateKey()) },
            },
        });
    }
    // ⚠ ORDEN: confirm ANTES que /disbursements, porque `/disbursements/confirm` también termina en él.
    if (tail('/disbursements/confirm')) {
        return json(res, 200, {
            data: {
                status: 'Success',
                payment: { status: esc.consumoStatus, reference: randomUUID() },
                // `select-insurance` lo manda al front como `confirm.documents[]`
                // (`LoanSelectAccountPayloadSchema`, opcional). Van con `url` servible para que la pantalla
                // `consumo/document-detail/{code}/{index}` tenga qué abrir.
                documents: [
                    { name: 'Pagaré', format: 'pdf', url: `http://localhost:${PORT}/_terminos` },
                    { name: 'Condiciones del crédito', format: 'pdf', url: `http://localhost:${PORT}/_terminos` },
                ],
                security: { customerValidateKey: validateKey ?? (validateKey = nuevaValidateKey()) },
            },
        });
    }
    // DISBURSEMENT — el que sella el estado 25 en Consumo (lee `data.payment.status`).
    if (tail('/disbursements')) {
        return json(res, 200, { data: { status: 'Success', payment: { status: esc.consumoStatus, reference: randomUUID() } } });
    }

    // PÁGINA DE TÉRMINOS. La `url` que viaja en `/terms/retrieve` tiene que abrir algo: el cliente le da
    // click y con el catch-all veía `{"data":{"status":"OK"}}` en una pestaña. Es HTML y no PDF a propósito
    // — el front la muestra en un iframe o en pestaña nueva, y un PDF falso no renderiza en ninguna.
    if (tail('/_terminos') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset=utf-8><title>Términos y condiciones · simulados</title>
<style>body{font:16px/1.6 system-ui;max-width:40rem;margin:3rem auto;padding:0 1.5rem;color:#222}
h1{font-size:1.3rem}blockquote{border-left:3px solid #ffd400;margin:0;padding:.2rem 0 .2rem 1rem;color:#555}</style>
<h1>Términos y condiciones</h1>
<blockquote>Documento <b>simulado por el harness</b> (mock-bancolombia). No es un texto legal ni se parece al
del banco: existe para que el link de la pantalla de términos abra una página de verdad.</blockquote>
<p>Versión 1.0 · producto Bancolombia · convenio de prueba local.</p>`);
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
