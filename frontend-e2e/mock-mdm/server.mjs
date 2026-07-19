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

import http from 'node:http';

const PORT = Number(process.env.MOCK_MDM_PORT || 8098);
const EMPTY = process.env.MOCK_MDM_EMPTY === '1';
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

const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const tenant = req.headers['x-lb-tenant-id'] ?? '(sin tenant)';

    if (req.method === 'GET' && url.pathname === '/') {
        return json(res, 200, { mock: 'mdm/device-locking', port: PORT, empty: EMPTY });
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
                return json(res, 200, {
                    results: devices.map((d) => ({ deviceId: d.deviceId, state: estado, success: true, message: 'OK' })),
                });
            }
        }
        log(`${req.method} ${url.pathname} → 404 (ruta no mockeada)`);
        json(res, 404, { error: 'ruta no mockeada', path: url.pathname });
    });
});

server.listen(PORT, () => log(`mock-mdm escuchando en :${PORT} (device-locking${EMPTY ? ' · modo IMEI-no-encontrado' : ''})`));
