// Mock del MERCHANT-GATEWAY / MDM (Trustonic) — la API `device-locking` del canal SmartPay.
//
// POR QUÉ EXISTE (verificado 2026-07-18):
//   En SmartPay el celular financiado ES la garantía. Tras la firma, el asesor escanea el IMEI y el backend
//   (Modules/Partner/App/Services/AlliedProductService::enroll) hace DOS llamadas al merchant-gateway:
//     1) POST /device-locking/devices/enroll         { imei }
//     2) GET  /device-locking/devices/status?deviceIds=<imei>   → { devices: [ {...} ] }
//   …y con la respuesta de (2) CREA el producto (`requires_imei = 1`) y le asocia el IMEI al user_request.
//   Si `devices` viene vacío, el backend corta con "No se encontró el IMEI".
//   En local `MERCHANT_GATEWAYS_HOST` apunta a `https://merchant-gateways.fake` → no resuelve → el flujo
//   se traba justo antes del desembolso.
//
//   Ambas llamadas mandan el header `X-Lb-Tenant-Id` = `allieds.trustonic_tenant_key`. El mock NO lo exige
//   (en local suele venir null), pero lo loguea para poder verlo.
//
// Incluye también los endpoints de SERVICING que usan los 3 crons diarios (lock 04:00 / unlock 05:00 /
// release 06:00), para poder ejercitar el ciclo de cobranza por hardware sin el proveedor real.
//
// Uso:  node mock-mdm/server.mjs   (o  bin/mock-mdm start)
//   env: MOCK_MDM_PORT (8098) · MOCK_MDM_EMPTY=1 → simula "IMEI no encontrado" (devices: [])
//        MOCK_MDM_TENANT_REQUIRED=1 → exige `X-Lb-Tenant-Id` como lo hace producción
//
// FALLOS DICTADOS (agregado 2026-08-22 para reproducir F-156). El ciclo de cobranza sólo se entiende
// cuando FALLA: en producción 28 equipos reales nunca llegaron a bloquearse, y cada intento escribe
// una fila nueva. Sin poder provocar el fallo, esa parte del código no se ejercita nunca en local.
//   POST /admin/dictar  { imei, resultCode }   → el próximo lock/unlock/release de ese IMEI falla así
//   POST /admin/limpiar                        → borra lo dictado
// Los `resultCode` y sus textos están COPIADOS de `device_locks.api_response` de producción, para que
// lo que se prueba acá sea lo que de verdad contesta el proveedor.

import http from 'node:http';

const PORT = Number(process.env.MOCK_MDM_PORT || 8098);
const EMPTY = process.env.MOCK_MDM_EMPTY === '1';
const TENANT_REQUIRED = process.env.MOCK_MDM_TENANT_REQUIRED === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Catálogo determinista: el mismo IMEI devuelve SIEMPRE el mismo equipo (útil para reproducir un caso).
const CATALOGO = [
    { marketName: 'Galaxy A15', model: 'SM-A155M', manufacturer: 'Samsung' },
    { marketName: 'Moto G24', model: 'XT2423-1', manufacturer: 'Motorola' },
    { marketName: 'Galaxy A06', model: 'SM-A065M', manufacturer: 'Samsung' },
    { marketName: 'Redmi 13C', model: '23100RN82L', manufacturer: 'Xiaomi' },
];
const equipoDe = (imei) => {
    const n = String(imei).split('').reduce((a, c) => a + (Number(c) || 0), 0);
    return CATALOGO[n % CATALOGO.length];
};

// Copiados de producción, no inventados: son los cuatro que aparecen en `api_response`.
const FALLOS = {
    DEVICE_INVALID_STATE: 'The device is unable to assign Action, please check the device state',
    STATE_TRANSITION: 'This imei [{imei}] is in State transition, please try again later',
    device_not_found: 'Not found the device with imei [{imei}]',
    external_service: 'External service error',
};
const dictado = new Map();   // imei → resultCode

const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const tenant = req.headers['x-lb-tenant-id'] ?? '(sin tenant)';

    if (req.method === 'GET' && url.pathname === '/') {
        return json(res, 200, {
            mock: 'mdm/device-locking', port: PORT, empty: EMPTY,
            tenantRequired: TENANT_REQUIRED, dictados: Object.fromEntries(dictado),
        });
    }

    // Producción exige el header y contesta EXACTAMENTE esto cuando falta — es la causa del 39% de las
    // filas fallidas de prod (un comercio sin `trustonic_tenant_key`). Opt-in para no romper lo que ya
    // se apoyaba en que el mock no lo pedía.
    if (TENANT_REQUIRED && !req.headers['x-lb-tenant-id']) {
        log(`${req.method} ${url.pathname} → 400 sin tenant`);
        return json(res, 400, { error: 'X-Lb-Tenant-Id header is required' });
    }

    // 2) status: de acá sale el equipo con el que el backend crea el Product y asocia el IMEI.
    if (req.method === 'GET' && url.pathname === '/device-locking/devices/status') {
        const imei = url.searchParams.get('deviceIds') || '';
        if (EMPTY) { log(`status imei=${imei} → devices:[] (MOCK_MDM_EMPTY)`); return json(res, 200, { devices: [] }); }
        const eq = equipoDe(imei);
        log(`status imei=${imei} tenant=${tenant} → ${eq.manufacturer} ${eq.marketName}`);
        return json(res, 200, { devices: [{ deviceId: imei, state: 'ENROLLED', locked: false, ...eq }] });
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        let p = {};
        try { p = JSON.parse(body || '{}'); } catch { /* algunos endpoints van sin cuerpo */ }
        const imei = p.imei ?? p.deviceId ?? (Array.isArray(p.deviceIds) ? p.deviceIds.join(',') : '');

        if (req.method === 'POST' && url.pathname === '/admin/dictar') {
            const code = FALLOS[p.resultCode] ? p.resultCode : null;
            if (!code || !p.imei) return json(res, 400, { error: 'pedí { imei, resultCode }', codigos: Object.keys(FALLOS) });
            dictado.set(String(p.imei), code);
            log(`dictado imei=${p.imei} → ${code}`);
            return json(res, 200, { imei: p.imei, resultCode: code });
        }
        if (req.method === 'POST' && url.pathname === '/admin/limpiar') {
            dictado.clear();
            return json(res, 200, { limpiado: true });
        }

        if (req.method === 'POST') {
            // 1) enroll: inscribe el equipo en el MDM (el backend solo verifica que no tire).
            if (url.pathname === '/device-locking/devices/enroll') {
                log(`enroll imei=${imei} tenant=${tenant}`);
                return json(res, 200, { deviceId: imei, state: 'ENROLLED', enrolled: true });
            }
            // Servicing: los 3 crons de cobranza por hardware. CONTRATO DISTINTO al de enroll — verificado en
            // AlliedProductService::lockDevice: el cuerpo es `{ devices: [{ deviceId, title, message }] }` y la
            // respuesta se lee con `data_get($response, 'results.0')`. Devolver `{deviceId, state}` plano deja
            // el device_lock en `failed` aunque el mock diga success (fue exactamente lo que pasó la 1ª vez).
            if (/\/device-locking\/devices\/(lock|unlock|release)$/.test(url.pathname)) {
                const accion = url.pathname.split('/').pop();
                const devices = Array.isArray(p.devices) ? p.devices : [{ deviceId: imei }];
                const estado = { lock: 'LOCKED', unlock: 'UNLOCKED', release: 'RELEASED' }[accion];
                log(`${accion} devices=${devices.map((d) => d.deviceId).join(',') || '(vacío)'} tenant=${tenant}`);
                // El fallo va con HTTP 200 y `success:false` dentro de `results`, igual que el proveedor:
                // el backend lee `results.0`, así que un 5xx probaría otro camino del que nos interesa.
                return json(res, 200, {
                    async: false,
                    results: devices.map((d) => {
                        const code = dictado.get(String(d.deviceId));
                        if (!code) return { deviceId: d.deviceId, state: estado, success: true, message: 'OK' };
                        return {
                            deviceId: d.deviceId, success: false, resultCode: code,
                            resultMessage: FALLOS[code].replace('{imei}', String(d.deviceId)),
                        };
                    }),
                });
            }
        }
        log(`${req.method} ${url.pathname} → 404 (ruta no mockeada)`);
        json(res, 404, { error: 'ruta no mockeada', path: url.pathname });
    });
});

server.listen(PORT, () => log(`mock-mdm escuchando en :${PORT} (device-locking${EMPTY ? ' · modo IMEI-no-encontrado' : ''})`));
