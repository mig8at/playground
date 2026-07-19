// Mock de ÁBACO — el proveedor externo que valida ingresos de plataformas gig (Uber/Didi/Rappi…).
//
// POR QUÉ EXISTE (verificado 2026-07-19):
//   En el flujo de RENTING (Motai), tras la validación de identidad el cliente debe validar sus
//   ingresos con Ábaco. No tenemos el código del proveedor: es 100% externo.
//   En local `ABACO_HOST=http://localhost` apuntaba al PROPIO backend (se pegaba a sí mismo) → el
//   init devolvía `ABAC2004 Error initializing ABACO`. El `.env` ya insinuaba la intención de mockear:
//   `ABACO_SCRAPING_PREFIX=/mock`.
//
// LO QUE **NO** HACE FALTA MOCKEAR (ya resuelto en el código, verificado):
//   · `/results`   → `Abaco::results()` corta en `app()->environment(['local'])` y devuelve
//                    `AbacoFixture::generateDynamicMock()`. Nunca sale al proveedor en local.
//   · `/platforms` → el setting `abaco_config.platforms_check_enabled = false` hace que el listado
//                    salga de la config en BD, sin llamada externa.
//   Por eso este mock cubre solo lo que SÍ sale: **init** y **login**.
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
//   env: MOCK_ABACO_PORT (8102) · MOCK_ABACO_PREFIX (/mock) · MOCK_ABACO_FAIL=1 → simula caída

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_ABACO_PORT || 8102);
const PREFIX = process.env.MOCK_ABACO_PREFIX || '/mock';
const FAIL = process.env.MOCK_ABACO_FAIL === '1';
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
            const paso = p.step ?? '-';
            log(`login paso=${paso} plataforma=${p.platform ?? '-'} customer_id=${p.customer_id ?? '-'}`);
            // step-1 suele pedir un segundo factor; step-2 lo confirma. Ambos se reportan OK.
            return json(res, 200, {
                success: true,
                data: { status: 'ok', step: paso, requires_otp: String(paso) === '1', session_id: p.session_id ?? '', message: 'login simulado' },
            });
        }

        // /results y /platforms NO deberían llegar acá en local (ver cabecera). Si llegan, se avisa.
        if (path.startsWith('/results') || path.startsWith('/platforms')) {
            log(`⚠ ${path} llegó al mock — en local se esperaba que lo resolviera el propio backend (fixture/config)`);
            return json(res, 200, { success: true, data: path.startsWith('/results') ? { 'gig-economy': [] } : [] });
        }

        log(`⚠ RUTA NO MAPEADA ← ${req.method} ${url.pathname}${raw ? ' body=' + raw.slice(0, 200) : ''}`);
        json(res, 404, { success: false, message: 'ruta no mockeada', path: url.pathname });
    });
});

server.listen(PORT, () => log(`mock-abaco escuchando en :${PORT} (prefijo ${PREFIX})${FAIL ? ' · modo caída' : ''}`));
