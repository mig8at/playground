/**
 * ¿EL BANCO DE VERDAD ACEPTA LO QUE MANDAMOS? — In Store Billing Code contra el gateway REAL.
 *
 * POR QUÉ EXISTE. Había dos oráculos y a los dos les faltaba lo mismo. `mock-bancolombia` (:8104) dice
 * si el flujo cierra con datos reales, y `contrato-bancolombia` si el mock cumple los esquemas del front
 * — pero los dos son NUESTRA lectura del contrato. Un mock no puede contradecir la documentación de la
 * que nació: por eso el sobre PLANO pasaba los 8 tests con `Http::fake` en verde, y el banco lo habría
 * rechazado con SA400 en la primera prueba real (ver la tarea `bancolombia-billing-code`). Esto pega
 * contra el gateway y **deja que el banco contradiga**.
 *
 * QUÉ CUBRE, Y QUÉ NO. El gateway (APIC) es real y valida de verdad: firma RS256 del JWT contra el
 * módulo del certificado, `message-id` UUID v4, `maxLength` de `address`, el sobre anidado, el cliente.
 * Lo que hay DETRÁS en el catálogo `Sandbox` es **Microcks** —lo dice el propio OpenAPI
 * (`endpoint: https://microcks-qa…`)—, así que despacha por igualdad estricta del JSON y devuelve
 * códigos enlatados. **Esto valida transporte y contrato, NO negocio.** Si el `billingCode` es el mismo
 * PIN que la conciliación cruza contra la factura, esto no lo puede contestar: hace falta el catálogo
 * `Development` o `Testing` (los únicos con backend real: `…/faas/order/api/v1/{createOrder,consultOrder}`).
 *
 * ⚠ ES UN ESPEJO, NO LA FUENTE. El JWT, los 5 headers y el sobre se arman acá replicando
 * `app/Actions/Lenders/BancolombiaBillingCode.php` + `Bancolombia::generateJsonWebToken`. Si el PHP
 * cambia y esto no, este script pasa en verde mintiendo. Para cruzar con la clase REAL:
 *
 *     docker exec legacy-backend-laravel.test-1 php artisan tinker <script que haga config([...]) y la llame>
 *
 * SOLO LECTURA: hace `SELECT` sobre `lender_allied_credentials` y no escribe nada, ni en BD ni en el banco
 * (en Sandbox el emisor es un mock). Nunca imprime el secreto, el JWT ni el certificado.
 *
 * USO:  node dev/sandbox-bancolombia.ts [--grupo A|B|C|D|E] [--cred 1124]
 *   env: E2E_TARGET (dev) · BC_SANDBOX_HOST · BC_SANDBOX_PREFIX
 * Sale 1 si alguna respuesta se apartó de lo medido el 2026-08-04.
 */
import { query, TARGET, appKey } from '../pkg/db.ts';
import { decryptLaravelString } from '../pkg/laravel-crypt.ts';
import { createSign, generateKeyPairSync, randomBytes, randomUUID, X509Certificate } from 'node:crypto';

const HOST = process.env.BC_SANDBOX_HOST || 'https://gw-sandbox-qa.apps.ambientesbc.com';
const PREFIX = process.env.BC_SANDBOX_PREFIX
    || '/public-partner/sb/v1/operations/product-specific/loans/consumer-loan/in-store-billing-code/code-management';
const BASE = HOST.replace(/\/+$/, '') + PREFIX;

const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
};
// #1124 = Alkosto (allied 209, lender 68). Es la ÚNICA de las 4 credenciales Bancolombia distintas que
// está aprovisionada en este sandbox: las otras tres —incluida la de los 167 comercios `creditop-bnpl`—
// dan 401. Si cambiás esto y todo da 401, es eso.
const CRED = Number(arg('--cred') || 1124);
const GROUP = (arg('--grupo') || '').toUpperCase();

const b64url = (b: Buffer | string) =>
    (Buffer.isBuffer(b) ? b : Buffer.from(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const row = (await query<any>('SELECT credential FROM lender_allied_credentials WHERE id = ?', [CRED]))[0];
if (!row) {
    console.error(`✗ la credencial #${CRED} no existe en ${TARGET}`);
    process.exit(2);
}
const c: Record<string, string> = JSON.parse(decryptLaravelString(row.credential, appKey()));

/** Espejo de `Bancolombia::generateJsonWebToken` (RS256, exp +1 min, nonce de 8 bytes). */
function jwt(op: { privkey?: string; exp?: number } = {}): string {
    const iat = Math.floor(Date.now() / 1000);
    const payload = {
        iss: c.bancolombia_application_name,
        sub: c.bancolombia_client_id,
        aud: c.bancolombia_api_gw,
        iat,
        exp: op.exp ?? iat + 60,
        nonce: randomBytes(8).toString('hex'),
    };
    const sign = `${b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256' }))}.${b64url(JSON.stringify(payload))}`;
    const s = createSign('RSA-SHA256');
    s.update(sign);
    return `${sign}.${b64url(s.sign(op.privkey ?? c.bancolombia_privkey))}`;
}

// Espejo de `Bancolombia::getCertificateBase64`: PEM re-exportado con los saltos de línea como ESPACIOS.
const CERT = new X509Certificate(c.bancolombia_cert).toString().replace(/\n/g, ' ');

/** Los 5 headers del contrato, como los arma `billingHeaders()`. */
const H = () => ({
    'Client-Id': c.bancolombia_client_id,
    'Client-Secret': c.bancolombia_client_secret,
    'json-web-token': jwt(),
    'x-client-certificate': CERT,
    'message-id': randomUUID(),
});
const without = (k: string) => { const h: any = H(); delete h[k]; return h; };

/** El sobre ANIDADO. Plano el banco lo rechaza con SA400 — es el hallazgo que originó este script. */
const over = (transactionId: string, address: string, cityCode: string, departmentCode: string) => ({
    data: { security: { transactionId }, customer: { contactInformation: { address, cityCode, departmentCode } } },
});

type Case = {
    grupo: string;
    nombre: string;
    /** Lo MEDIDO el 2026-08-04. Si cambia, este script lo canta: puede ser buena noticia. */
    espera: { status: number; code?: string; billingCode?: string };
    correr: () => Promise<Response>;
};

const post = (body: unknown, headers: Record<string, string> = H()) =>
    fetch(`${BASE}/generateBillingCode`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });

const HAPPY = over('62835dd-185f-49de-9bf1-d96c60b94f0e', 'Calle 45 #12-34', '11001', '01');
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const CASES: Case[] = [
    // ── A · los escenarios que el dispatcher del OpenAPI declara (match exacto del JSON completo)
    { grupo: 'A', nombre: 'camino feliz BNPL', espera: { status: 200, billingCode: '6cc5078c6d9087cdf077' },
      correr: () => post(HAPPY) },
    { grupo: 'A', nombre: 'camino feliz CONSUMO (el servicio sirve a los dos productos)', espera: { status: 200, billingCode: 'f68cd46b856ded015974' },
      correr: () => post(over('i4TX8ZVEpX0NLNj4Clbu0/M3WVLULqTX2zWVwb7sxsJmL325LAdy4jxl9WPc7gZmJbG2pGbFkOAbw7WHwQWGY77IePcM2kO6gVB/UCekyk+y5w+fAaFLUyqA1LFISbL+DfFbEBNERqmRdK5P3YGPbOAzedEqISbyvJf3NGTYf5f5iPdnoq5c6WSF3w==', 'Calle 45 #12-34', '11001', '01')) },
    { grupo: 'A', nombre: 'transactionId en conflicto → el 409 de RECUPERACIÓN', espera: { status: 409, code: 'BP21000' },
      correr: () => post(over('a12b34c5-d678-49f0-8e21-ff093a5bcd12', 'Cra 7 #45-89', '05001', '02')) },
    { grupo: 'A', nombre: 'error interno del proveedor', espera: { status: 500, code: 'SP500' },
      correr: () => post(over('f98e21c3-6b42-4c1e-a12d-9d87ac34ef56', 'Av 30 #100-15', '76001', '03')) },
    // El OTRO 409, y no es el mismo: BP12700001 es el `DefaultResponse` del mock ("no te conozco"), no un
    // conflicto de negocio. Confundirlos hace tratar como recuperable lo que sólo es dato desconocido.
    { grupo: 'A', nombre: 'datos REALES → el 409 del mock, que NO es el de recuperación', espera: { status: 409, code: 'BP12700001' },
      correr: () => post(over(randomUUID(), 'Cl 89a 21-31', '11001', '11')) },

    // ── B · el sobre y las longitudes: acá es donde el banco contradice a nuestros fakes
    { grupo: 'B', nombre: 'sobre PLANO (4 campos sueltos) → el banco lo rechaza', espera: { status: 400, code: 'SA400' },
      correr: () => post({ data: { transactionId: '62835dd-185f-49de-9bf1-d96c60b94f0e', address: 'Calle 45 #12-34', cityCode: '11001', departmentCode: '01' } }) },
    { grupo: 'B', nombre: 'falta `customer` (requerido)', espera: { status: 400, code: 'SA400' },
      correr: () => post({ data: { security: { transactionId: '62835dd-185f-49de-9bf1-d96c60b94f0e' } } }) },
    // Esto es lo que sostiene la decisión de NO truncar: 35 caracteres mueren en el gateway, antes de que
    // el negocio del banco los vea. "Que Bancolombia se encargue" no existe.
    { grupo: 'B', nombre: 'address de 35 chars → SA400 en el GATEWAY, no en el negocio', espera: { status: 400, code: 'SA400' },
      correr: () => post(over('62835dd-185f-49de-9bf1-d96c60b94f0e', 'Carrera 77 b # 64 h 50 apto 301 t 6', '11001', '01')) },
    { grupo: 'B', nombre: 'body vacío', espera: { status: 400, code: 'SA400' },
      correr: () => post({}) },

    // ── C · la consulta por código. En Sandbox NO se puede ejercitar y no es culpa nuestra: el catálogo
    // `Sandbox` del OpenAPI define `endpoint` pero NO `endpointRetrieve`. Si algún día esto da 200, es
    // NOTICIA (significa que nos movieron a un catálogo con backend real).
    { grupo: 'C', nombre: 'retrieve-order-details · Sandbox no tiene backend para el GET', espera: { status: 400, code: 'SA409' },
      correr: () => fetch(`${BASE}/retrieve-order-details?billingCode=1770694a38b230dbf0f0`,
          { method: 'GET', headers: { ...H(), Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }) },

    // ── D · la seguridad SÍ se ejercita (esto corrigió F-81, que decía lo contrario)
    { grupo: 'D', nombre: 'sin json-web-token', espera: { status: 403, code: 'SA403' }, correr: () => post(HAPPY, without('json-web-token')) },
    { grupo: 'D', nombre: 'json-web-token basura', espera: { status: 403, code: 'SA403' }, correr: () => post(HAPPY, { ...H(), 'json-web-token': 'no-soy-un-jwt' }) },
    { grupo: 'D', nombre: 'JWT firmado con OTRA llave → verifica la firma contra NUESTRO cert', espera: { status: 403, code: 'SA403' },
      correr: () => post(HAPPY, { ...H(), 'json-web-token': jwt({ privkey: otherKey }) }) },
    { grupo: 'D', nombre: 'JWT vencido', espera: { status: 403, code: 'SA403' },
      correr: () => post(HAPPY, { ...H(), 'json-web-token': jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }) }) },
    { grupo: 'D', nombre: 'sin x-client-certificate', espera: { status: 400, code: 'SA500' }, correr: () => post(HAPPY, without('x-client-certificate')) },
    { grupo: 'D', nombre: 'Client-Secret incorrecto', espera: { status: 401 }, correr: () => post(HAPPY, { ...H(), 'Client-Secret': '0'.repeat(32) }) },
    { grupo: 'D', nombre: 'sin message-id', espera: { status: 400, code: 'SA400' }, correr: () => post(HAPPY, without('message-id')) },
    // El `message-id` está validado por regex como UUID **v4**: `Str::orderedUuid()` (v1) sería rechazado.
    { grupo: 'D', nombre: 'message-id UUID v1 → rechazado (la bomba de orderedUuid es real)', espera: { status: 400, code: 'SA400' },
      correr: () => post(HAPPY, { ...H(), 'message-id': 'c4e6bd04-5149-11e7-b114-b2f933d5fe68' }) },

    // ── E · /health. El contrato dice que no lleva cabeceras y MIENTE: pelado da 401.
    { grupo: 'E', nombre: 'health pelado → 401 (por esto la sonda decía false con el servicio sano)', espera: { status: 401 },
      correr: () => fetch(`${BASE}/health`, { method: 'HEAD', signal: AbortSignal.timeout(30_000) }) },
    { grupo: 'E', nombre: 'health con Client-Id + Client-Secret → 200', espera: { status: 200 },
      correr: () => fetch(`${BASE}/health`, { method: 'HEAD', signal: AbortSignal.timeout(30_000),
          headers: { 'Client-Id': c.bancolombia_client_id, 'Client-Secret': c.bancolombia_client_secret } }) },
];

const x = new X509Certificate(c.bancolombia_cert);
const days = Math.round((new Date(x.validTo).getTime() - Date.now()) / 86400000);
console.log(`\n  ${BASE}`);
console.log(`  BD=${TARGET} · credencial #${CRED} (app=${c.bancolombia_application_name}) · cert ${days < 0 ? `VENCIDO hace ${-days}d` : `vigente ${days}d`}`);
console.log(`  el certificado vencido NO bloquea: el gateway lee el módulo, no valida vigencia ni cadena\n`);

let bad = 0, news = 0, currentGroup = '';

for (const scenarioCase of CASES) {
    if (GROUP && scenarioCase.grupo !== GROUP) continue;
    if (scenarioCase.grupo !== currentGroup) {
        currentGroup = scenarioCase.grupo;
        console.log(`  ── ${scenarioCase.grupo}`);
    }

    let status = 0, code: string | undefined, billingCode: string | undefined, detail = '';
    try {
        const r = await scenarioCase.correr();
        status = r.status;
        const txt = await r.text();
        try {
            const j = JSON.parse(txt);
            billingCode = j?.data?.billingCode;
            code = j?.errors?.[0]?.code;
            detail = j?.errors?.[0]?.detail ?? '';
        } catch { /* HEAD no trae cuerpo */ }
    } catch (e: any) {
        console.log(`  ✗ ${scenarioCase.nombre}\n      transporte: ${e.name}: ${e.message}`);
        bad++;
        continue;
    }

    const okStatus = status === scenarioCase.espera.status;
    const okCode = !scenarioCase.espera.code || code === scenarioCase.espera.code;
    const okBilling = !scenarioCase.espera.billingCode || billingCode === scenarioCase.espera.billingCode;

    if (okStatus && okCode && okBilling) {
        console.log(`  ✓ ${scenarioCase.nombre}`);
        continue;
    }

    // Un 200 donde se esperaba error no es una regresión: es que el banco nos movió de ambiente.
    const goodNews = status === 200 && scenarioCase.espera.status >= 400;
    if (goodNews) news++; else bad++;

    const expected = `${scenarioCase.espera.status}${scenarioCase.espera.code ? ` ${scenarioCase.espera.code}` : ''}${scenarioCase.espera.billingCode ? ` ${scenarioCase.espera.billingCode}` : ''}`;
    const obtained = `${status}${code ? ` ${code}` : ''}${billingCode ? ` ${billingCode}` : ''}`;
    console.log(`  ${goodNews ? '★' : '✗'} ${scenarioCase.nombre}`);
    console.log(`      esperado ${expected}  ·  obtenido ${obtained}${detail ? `  «${detail}»` : ''}`);
}

console.log('');
if (news) console.log(`  ★ ${news} caso(s) responden MEJOR que lo medido: puede ser que nos movieron de catálogo. Revisá.`);
if (bad) {
    console.log(`  ✗ ${bad} caso(s) se apartaron de lo medido el 2026-08-04.\n`);
    process.exit(1);
}
console.log(`  ✓ el banco responde como se midió. Ojo: esto valida TRANSPORTE y CONTRATO, no negocio.\n`);
process.exit(0);
