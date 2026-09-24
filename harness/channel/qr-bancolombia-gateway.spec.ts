import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ¿`mock-bancolombia` contesta lo que contestó EL BANCO? — la seguridad del gateway del billing code.
 *
 * POR QUÉ EXISTE. El oráculo de este canal era `dev/sandbox-bancolombia.ts`, que pega contra
 * `gw-sandbox-qa` y es el único capaz de contradecirnos: un mock no puede contradecir la documentación
 * de la que nació. **Ese oráculo hoy no se puede correr** — desde la red de CreditOp el WAF (Imperva)
 * devuelve 503 a todo, incluido `HEAD /health` pelado, y nunca se llega a hablar con APIC (F-226).
 *
 * Así que esto hace lo segundo mejor: toma las respuestas que el banco YA dio —medidas el 2026-08-04 y
 * congeladas como `espera:` en ese script— y comprueba que el mock las reproduce. No reemplaza al
 * sandbox: cuando el WAF deje pasar, ese script sigue siendo el que puede descubrir algo NUEVO. Esto
 * sólo evita que lo ya aprendido se pierda mientras tanto.
 *
 * QUÉ CUBRE. Sólo el servicio *In Store Billing Code*, que es el que declara su seguridad en 5 headers
 * (sin bearer). Los flujos BNPL/Consumo usan OAuth y no pasan por acá.
 *
 * ⚠ LO QUE NO SE REPRODUCE, Y ES A PROPÓSITO. Tres de las 20 medidas son del DISPATCHER del catálogo
 * `Sandbox` (Microcks), no del banco: los `billingCode` enlatados, el 409 `BP12700001` de su
 * `DefaultResponse`, y el `SA409` de `retrieve-order-details` —que sólo dice que ese catálogo no tiene
 * backend para el GET—. Copiarlas haría el mock MENOS parecido a la realidad. El último test de este
 * archivo fija esa divergencia para que nadie la "corrija".
 *
 * PURO: levanta el mock en un puerto aparte y no toca BD, backend ni navegador. El certificado se firma
 * al vuelo con `openssl` (viene en macOS y en la imagen de CI).
 */

// ⚠ UN PORT POR WORKER. Playwright reparte el archivo entre varios procesos y `beforeAll` corre una
// vez EN CADA UNO: con un puerto fijo, el primero liga y los demás mueren con EADDRINUSE — pero su
// sonda de arranque ve vivo al mock AJENO y siguen igual, hasta que ese worker termina y les cierra el
// socket. El síntoma era `ECONNRESET` en tests salteados, que se lee como un mock inestable.
const PORT = Number(process.env.MOCK_BC_TEST_PORT || 8914) + Number(process.env.TEST_WORKER_INDEX || 0);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'secreto-de-prueba-del-harness';

let mock: ChildProcess;
let dir: string;
let privkey: string;
let cert: string;

/** Espejo de `Bancolombia::getCertificateBase64`: el PEM con los saltos de línea como ESPACIOS. */
const certHeader = () => cert.replace(/\n/g, ' ');

/** Espejo de `Bancolombia::generateJsonWebToken` (RS256, exp +1 min, nonce de 8 bytes). */
const b64url = (b: Buffer | string) =>
    (Buffer.isBuffer(b) ? b : Buffer.from(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const jwt = (op: { key?: string; exp?: number } = {}) => {
    const iat = Math.floor(Date.now() / 1000);
    const reqBody = { iss: 'harness', sub: 'cliente', aud: 'gw', iat, exp: op.exp ?? iat + 60, nonce: randomBytes(8).toString('hex') };
    const sign = `${b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256' }))}.${b64url(JSON.stringify(reqBody))}`;
    return `${sign}.${b64url(createSign('RSA-SHA256').update(sign).sign(op.key ?? privkey))}`;
};

const H = (): Record<string, string> => ({
    'Client-Id': 'cliente-de-prueba',
    'Client-Secret': SECRET,
    'json-web-token': jwt(),
    'x-client-certificate': certHeader(),
    'message-id': randomUUID(),
});
const without = (k: string) => { const h = H(); delete h[k]; return h; };

/** El sobre ANIDADO que el banco exige: plano responde SA400. */
const over = (tx: string, address = 'Calle 45 #12-34', cityCode = '11001', departmentCode = '01') =>
    ({ data: { security: { transactionId: tx }, customer: { contactInformation: { address, cityCode, departmentCode } } } });

const post = async (body: unknown, headers: Record<string, string> = H()) => {
    const r = await fetch(`${BASE}/generateBillingCode`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
    const txt = await r.text();
    let j: any = null;
    try { j = JSON.parse(txt); } catch { /* HEAD y cuerpos vacíos */ }
    return { status: r.status, code: j?.errors?.[0]?.code, billingCode: j?.data?.billingCode, detail: j?.errors?.[0]?.detail };
};

test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bc-gw-'));
    // Un par llave/certificado de verdad: el mock verifica la firma del JWT contra la llave pública del
    // certificado que viaja en la misma petición, igual que el gateway.
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=harness', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')],
        { stdio: 'ignore' });
    privkey = readFileSync(join(dir, 'key.pem'), 'utf8');
    cert = readFileSync(join(dir, 'cert.pem'), 'utf8');

    const server = fileURLToPath(new URL('../mock-bancolombia/server.mjs', import.meta.url));
    mock = spawn(process.execPath, [server], {
        env: { ...process.env, MOCK_BC_PORT: String(PORT), MOCK_BC_CLIENT_SECRET: SECRET, MOCK_BC_FAIL: '' },
        stdio: 'ignore',
    });

    for (let i = 0; i < 60; i++) {
        const alive = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1_000) }).then((r) => r.ok).catch(() => false);
        if (alive) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`el mock no levantó en ${BASE} — ¿puerto ocupado? (MOCK_BC_TEST_PORT)`);
});

test.afterAll(() => {
    mock?.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lo que el banco contestó el 2026-08-04. Cada test nombra la medición que reproduce.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test.describe('el sobre y las longitudes', () => {
    test('camino feliz → 200 con billingCode', async () => {
        const r = await post(over(randomUUID()));
        expect(r.status).toBe(200);
        expect(r.billingCode).toMatch(/^[0-9a-f]{20}$/);
    });

    // 🔴 EL hallazgo que originó el sandbox: el sobre plano pasaba 8 tests con `Http::fake` en verde
    // porque comprobaban la misma suposición con la que se escribió el código.
    test('sobre PLANO → 400 SA400', async () => {
        const r = await post({ data: { transactionId: randomUUID(), address: 'Calle 45 #12-34', cityCode: '11001', departmentCode: '01' } });
        expect(r.status).toBe(400);
        expect(r.code).toBe('SA400');
    });

    test('sin `customer` → 400 SA400', async () => {
        expect(await post({ data: { security: { transactionId: randomUUID() } } })).toMatchObject({ status: 400, code: 'SA400' });
    });

    test('cuerpo vacío → 400 SA400', async () => {
        expect(await post({})).toMatchObject({ status: 400, code: 'SA400' });
    });

    // 🔴 Esto es lo que sostiene la decisión de NO truncar en el llamador: los 35 caracteres mueren en el
    // GATEWAY, antes de que el negocio del banco los vea. «Que Bancolombia se encargue» no existe.
    test('address de 35 chars → 400 SA400 en el gateway', async () => {
        const r = await post(over(randomUUID(), 'Carrera 77 b # 64 h 50 apto 301 t 6'));
        expect(r.status).toBe(400);
        expect(r.code).toBe('SA400');
    });
});

test.describe('la seguridad — y el banco NO la aplana en un solo código', () => {
    // 🔴 Los cuatro del JWT dan 403 SA403, no 400. Antes el mock contestaba 400 SA400 a todo.
    test('sin json-web-token → 403 SA403', async () => {
        expect(await post(over(randomUUID()), without('json-web-token'))).toMatchObject({ status: 403, code: 'SA403' });
    });

    test('json-web-token basura → 403 SA403', async () => {
        expect(await post(over(randomUUID()), { ...H(), 'json-web-token': 'no-soy-un-jwt' }))
            .toMatchObject({ status: 403, code: 'SA403' });
    });

    // 🔴 EL test con más valor del archivo: que el gateway rechace un JWT firmado con OTRA llave prueba
    // que verifica la firma contra NUESTRO certificado. Es lo único que puede atrapar en local una
    // regresión de `generateJsonWebToken` — y hasta hoy sólo lo veía el sandbox.
    test('JWT firmado con otra llave → 403 SA403', async () => {
        const anotherOne = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
            .export({ type: 'pkcs8', format: 'pem' }) as string;
        expect(await post(over(randomUUID()), { ...H(), 'json-web-token': jwt({ key: anotherOne }) }))
            .toMatchObject({ status: 403, code: 'SA403' });
    });

    test('JWT vencido → 403 SA403', async () => {
        expect(await post(over(randomUUID()), { ...H(), 'json-web-token': jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }) }))
            .toMatchObject({ status: 403, code: 'SA403' });
    });

    // 🔴 400 con código SA500. Raro, pero es lo medido: no lo "arregles" a SA400.
    test('sin x-client-certificate → 400 SA500', async () => {
        expect(await post(over(randomUUID()), without('x-client-certificate'))).toMatchObject({ status: 400, code: 'SA500' });
    });

    // 🔴 El 401 es la firma de «la credencial rotó», que es la falla operativa más común.
    test('Client-Secret incorrecto → 401', async () => {
        expect(await post(over(randomUUID()), { ...H(), 'Client-Secret': '0'.repeat(32) })).toMatchObject({ status: 401 });
    });

    test('sin message-id → 400 SA400', async () => {
        expect(await post(over(randomUUID()), without('message-id'))).toMatchObject({ status: 400, code: 'SA400' });
    });

    // 🔴 La bomba de `Str::orderedUuid()`: genera v1 y el schema del banco valida v4 por regex.
    test('message-id UUID v1 → 400 SA400', async () => {
        expect(await post(over(randomUUID()), { ...H(), 'message-id': 'c4e6bd04-5149-11e7-b114-b2f933d5fe68' }))
            .toMatchObject({ status: 400, code: 'SA400' });
    });
});

test.describe('la sonda de conectividad', () => {
    const head = (headers: Record<string, string> = {}) =>
        fetch(`${BASE}/health`, { method: 'HEAD', headers, signal: AbortSignal.timeout(10_000) }).then((r) => r.status);

    // 🔴 El contrato declara `HEAD /health` sin parámetros y MIENTE. Por esto la primera versión de
    // `health()` devolvía false con el servicio arriba y sano.
    test('pelada → 401', async () => {
        expect(await head()).toBe(401);
    });

    test('con Client-Id y Client-Secret → 200', async () => {
        expect(await head({ 'Client-Id': 'cliente-de-prueba', 'Client-Secret': SECRET })).toBe(200);
    });

    // 🔴 Lo que hacía inútil la sonda en local: sin esta ruta, `/health` caía en el catch-all del mock
    // —que contesta 200 a todo— y `health()` devolvía `true` SIEMPRE. Una sonda que sólo sabe decir que
    // sí es peor que no tenerla. Este test es el que impide que vuelva a pasar.
    test('sólo con Client-Id → 401, no 200 del catch-all', async () => {
        expect(await head({ 'Client-Id': 'cliente-de-prueba' })).toBe(401);
    });
});

// 🔴 LA DIVERGENCIA DELIBERADA. En el catálogo `Sandbox` este GET devuelve `400 SA409` porque Microcks
// no tiene backend para él — es una limitación del catálogo, no del banco. El mock contesta lo que el
// servicio hace: 404 con código de negocio si no conoce la orden. Si alguien cruza el mock contra el
// sandbox y "corrige" esto, está rompiendo el mock para que se parezca a un mock ajeno.
test('retrieve-order-details con código desconocido → 404 de negocio, NO el SA409 del sandbox', async () => {
    const r = await fetch(`${BASE}/retrieve-order-details?billingCode=1770694a38b230dbf0f0`, {
        method: 'GET', headers: { ...H(), Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
    });
    const j: any = await r.json();
    expect(r.status).toBe(404);
    expect(j?.errors?.[0]?.code).toBe('BP40421052');
});

// Y los 5 headers también se exigen en el GET: `billingHeaders()` los arma una vez para los dos métodos.
test('retrieve-order-details sin JWT → 403 SA403', async () => {
    const r = await fetch(`${BASE}/retrieve-order-details?billingCode=x`, {
        method: 'GET', headers: { ...without('json-web-token'), Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
    });
    expect(r.status).toBe(403);
});
