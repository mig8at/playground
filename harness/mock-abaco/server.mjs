// Mock de ÁBACO — el proveedor externo que valida ingresos de plataformas gig (Uber/Didi/Rappi…).
//
// POR QUÉ EXISTE (verificado 2026-07-19):
//   En el flujo de RENTING (Motai), tras la validación de identidad el cliente debe validar sus
//   ingresos con Ábaco. No tenemos el código del proveedor: es 100% externo.
//   En local `ABACO_HOST=http://localhost` apuntaba al PROPIO backend (se pegaba a sí mismo) → el
//   init devolvía `ABAC2004 Error initializing ABACO`. El `.env` ya insinuaba la intención de mockear:
//   `ABACO_SCRAPING_PREFIX=/mock`.
//
// LO QUE CUBRE: **init**, **login** y **results**.
//   · `/results` SÍ sale al mock. Esta cabecera decía que `Abaco::results()` cortaba en local con su
//     fixture; desde el 2026-08-13 (`130e1ac95`) el fixture es OPCIONAL (`abaco_config.fixture_enabled`),
//     y sin él el backend le pregunta a este mock. Contesta con la forma de ese fixture (ver `/results`
//     abajo). `MOCK_ABACO_RESULTS=pending|error` prueba los otros desenlaces.
//   · `/platforms` NO hace falta: `abaco_config.platforms_check_enabled = false` saca el listado de la
//     config en BD, sin llamada externa.
//
// CONTRATO (leído de app/Actions/RiskCentrals/Abaco.php + Modules/Onboarding/App/Services/AbacoService.php):
//   Cliente: `{ABACO_HOST}{ABACO_SCRAPING_PREFIX}{endpoint}`, y los POST van **form-encoded**
//   (`Http::asForm()`), NO JSON — ojo al parsear.
//   · POST /init/gig-economy → el service lee `data.customer_id`, `data.token` y `data.redirect_url`.
//     Si viene `redirect_url`, el backend le hace GET y extrae la cookie **`sessionid`** de los headers;
//     por eso el mock expone `/session` devolviendo justamente ese Set-Cookie.
//   · POST /login → basta con `success` para que el service registre el paso.
//
// Uso:  node mock-abaco/server.mjs   (o  bin/mock-abaco start)
//   env: MOCK_ABACO_PORT (8102) · MOCK_ABACO_PREFIX (/mock) · MOCK_ABACO_FAIL=1 → simula caída · MOCK_ABACO_RESULTS · MOCK_ABACO_MONTHLY (pesos por mes, 1.200.000)

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_ABACO_PORT || 8102);
const PREFIX = process.env.MOCK_ABACO_PREFIX || '/mock';
const FAIL = process.env.MOCK_ABACO_FAIL === '1';
/** Qué contesta `/results`: `success` (default) · `pending` (el scraping sigue) · `error` (todas fallaron). */
const RESULTS = (process.env.MOCK_ABACO_RESULTS || 'success').toLowerCase();
/** Lo que gana el conductor por mes, en pesos. Inventado: la respuesta real se guarda cifrada y no se
 *  puede medir desde afuera. Alcanza con que sea plausible; la forma es la que importa. */
const MONTHLY = Number(process.env.MOCK_ABACO_MONTHLY || 1_200_000);

/** Las plataformas en las que cada cliente inició sesión: `/results` contesta por ésas, como el proveedor.
 *  ⚠ El login NO trae el `customer_id`: trae el token que este mock entregó en `init`
 *  (`Authorization: Bearer …`, ver `Abaco::login`). Por eso el cliente se encuentra por el token. */
const loggedIn = new Map();
const customerByToken = new Map();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const json = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
};

// El cliente manda form-encoded; algunos clientes podrían mandar JSON. Aceptamos ambos.
const parseBody = (raw, contentType = '') => {
    if (!raw) return {};
    if (contentType.includes('json')) { try { return JSON.parse(raw); } catch { return {}; } }
    return Object.fromEntries(new URLSearchParams(raw));
};

const server = http.createServer((req, res) => {
    const url = new URL(String(req.url).replace(/^\/{2,}/, '/'), `http://localhost:${PORT}`);
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) || '/' : url.pathname;

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return json(res, 200, { mock: 'abaco', port: PORT, prefix: PREFIX, fail: FAIL });
    }

    // Destino del `redirect_url`: el backend le pega para quedarse con la cookie `sessionid`.
    if (req.method === 'GET' && path.startsWith('/session')) {
        const sid = randomUUID().replace(/-/g, '').slice(0, 24);
        log(`session → entrego cookie sessionid=${sid.slice(0, 8)}…`);
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': `sessionid=${sid}; Path=/; HttpOnly` });
        return res.end('<!doctype html><p>mock abaco · sesión iniciada</p>');
    }

    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
        const p = parseBody(raw, String(req.headers['content-type'] ?? ''));

        if (FAIL) {
            log(`FAIL forzado ← ${req.method} ${path}`);
            return json(res, 500, { success: false, message: 'Ábaco no disponible (simulado)' });
        }

        if (req.method === 'POST' && path.startsWith('/init/gig-economy')) {
            const customerId = String(p.customer_id ?? p.document ?? Date.now());
            const token = 'abaco-mock-' + randomUUID().slice(0, 8);
            log(`init/gig-economy customer_id=${customerId} → token ${token}`);
            customerByToken.set(token, customerId);
            // ⚠ Los campos van al nivel RAÍZ, no anidados en `data`: el cliente (Abaco::makeRequest)
            // ya envuelve la respuesta como `['success'=>…, 'data'=> $response->json()]`, así que el
            // service lee `$response['data']['customer_id']` = la raíz de ESTE cuerpo. Envolverlos en
            // `data` devuelve 200 y "initialized successfully" pero con customerId/token VACÍOS.
            return json(res, 200, {
                customer_id: customerId,
                token,
                // El backend hace GET de esta URL para sacar la cookie `sessionid`.
                redirect_url: `http://host.docker.internal:${PORT}${PREFIX}/session?token=${token}`,
            });
        }

        if (req.method === 'GET' && path.startsWith('/init/gig-economy')) {
            log(`init por token=${url.searchParams.get('token') ?? '-'}`);
            return json(res, 200, { success: true, data: { customer_id: String(Date.now()), token: url.searchParams.get('token') ?? '' } });
        }

        if (req.method === 'POST' && path.startsWith('/login')) {
            const step = p.step ?? '-';
            const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
            const customer = p.customer_id ?? customerByToken.get(bearer);
            log(`login paso=${step} plataforma=${p.platform ?? '-'} customer_id=${customer ?? '-'}`);
            if (customer && p.platform) {
                const set = loggedIn.get(String(customer)) ?? new Set();
                set.add(String(p.platform).toLowerCase());
                loggedIn.set(String(customer), set);
            }
            // step-1 suele pedir un segundo factor; step-2 lo confirma. Ambos se reportan OK.
            return json(res, 200, {
                success: true,
                data: { status: 'ok', step: step, requires_otp: String(step) === '1', session_id: p.session_id ?? '', message: 'login simulado' },
            });
        }

        // ⚠ /results SÍ LLEGA ACÁ, y hasta el 2026-09-25 contestaba vacío: la cabecera decía que el backend
        // lo resolvía con su fixture en local, pero desde el 2026-08-13 ese fixture es opcional
        // (`abaco_config.fixture_enabled`) y sin él el backend le pregunta a este mock. Con el resultado
        // vacío el backend lo toma como «pendiente», NO guarda la consulta viva, y el paso de Ábaco se
        // vuelve a pedir: la solicitud terminaba cancelada (467005).
        //
        // LA FORMA es la del fixture del propio backend (`App\Actions\RiskCentrals\AbacoFixture`) y va en
        // la RAÍZ, sin `data`: el cliente (`Abaco::makeRequest`) ya envuelve la respuesta, y el parser lee
        // `['gig-economy']` de ahí. Contesta por las plataformas en las que el cliente inició sesión.
        if (path.startsWith('/results')) {
            const customerId = String(p.customer_id ?? '');
            const platforms = [...(loggedIn.get(customerId) ?? [])];
            if (RESULTS === 'pending' || !platforms.length) {
                log(`results customer_id=${customerId} → pendiente (${platforms.length ? 'MOCK_ABACO_RESULTS=pending' : 'sin logins vistos'})`);
                return json(res, 200, { 'gig-economy': [] });
            }
            const now = new Date();
            const gig = {};
            for (const slug of platforms) {
                gig[slug] = RESULTS === 'error'
                    ? { result: 'error', errors: ['Error simulado por el mock'], last_updated_at: now.toISOString() }
                    : successPlatform(now);
            }
            log(`results customer_id=${customerId} → ${RESULTS} en ${platforms.join(', ')}`);
            return json(res, 200, { 'gig-economy': gig });
        }
        if (path.startsWith('/platforms')) {
            log(`⚠ ${path} llegó al mock — en local se esperaba que lo resolviera el propio backend (config)`);
            return json(res, 200, { success: true, data: [] });
        }

        log(`⚠ RUTA NO MAPEADA ← ${req.method} ${url.pathname}${raw ? ' body=' + raw.slice(0, 200) : ''}`);
        json(res, 404, { success: false, message: 'ruta no mockeada', path: url.pathname });
    });
});

/** Una plataforma con datos: tres meses de ganancias diarias que suman `MONTHLY` por mes. */
function successPlatform(now) {
    const earnings = [];
    for (let d = 1; d <= 90; d++) {
        const day = new Date(now.getTime() - d * 86_400_000);
        earnings.push({ date: day.toISOString().slice(0, 10), earnings: Math.round(MONTHLY / 30), events: [{ datetime: day.toISOString() }] });
    }
    return {
        first_name: 'SYNTH', last_name: 'TEST USER', email: 'synth@creditop.com', phone_number: '+573000000000',
        earnings, last_updated_at: now.toISOString(),
    };
}

server.listen(PORT, () => log(`mock-abaco escuchando en :${PORT} (prefijo ${PREFIX})${FAIL ? ' · modo caída' : ''}`));
