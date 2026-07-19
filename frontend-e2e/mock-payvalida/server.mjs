// Mock de PAYVALIDA (POST /api/v3/porders) — el proveedor de recaudo que dispara el lender rt=1.
//
// POR QUÉ EXISTE (verificado 2026-07-18):
//   El lender #8 "Bancolombia" tiene en BD `action = App\Actions\Lenders\Payvalida`. Al elegirlo, legacy
//   corre esa acción, que postea a `{+host}/api/v3/porders` con `host = config('services.payvalida.host')`.
//   En LOCAL no hay `PAYVALIDA_HOST` en el .env → la URL queda como `/api/v3/porders` SIN host →
//   `cURL error 3: URL rejected: No host part in the URL` → el wizard muestra
//   "No pudimos procesar tu solicitud · código <uReq>-63". O sea: rt=1 ni siquiera llegaba al banco.
//
// CONTRATO (leído de app/Actions/Lenders/Payvalida.php):
//   req:  { merchant, email, country:343, money:'COP', amount, order:<uuid>, description, method,
//           language, recurrent, expiration, iva, user_di, user_type_di, user_name,
//           redirect_timeout, shortener, checksum }
//   resp: { CODE: '0000', DATA: { checkout: '<host+path SIN esquema>' } }
//         · CODE distinto de '0000' → el middleware del backend lo convierte en 400.
//         · El backend hace `'https://' . DATA.checkout` y ESA es la URL a la que redirige el wizard.
//
//   Por eso el `checkout` apunta a un host SENTINELA (`pay.mock-payvalida.local`) que no resuelve:
//   el harness intercepta esa navegación y sirve el portal `mock-bank` en su lugar (ver pkg/payvalida-mock.ts).
//   Los query params van ya armados para mock-bank (lender/monto/volver/comercio), así que la página los lee
//   de su propio location.search sin que nadie reescriba nada.
//
// Uso:  node mock-payvalida/server.mjs   (o  bin/mock-payvalida start)
//   env: MOCK_PV_PORT (8097) · MOCK_PV_RETURN_URL (a dónde vuelve el "volver al comercio")
//        MOCK_PV_LENDER (Bancolombia) · MOCK_PV_CODE ('0000' → forzar un fallo con otro valor)

import http from 'node:http';

const PORT = Number(process.env.MOCK_PV_PORT || 8097);
const RETURN_URL = process.env.MOCK_PV_RETURN_URL || '';
const LENDER = process.env.MOCK_PV_LENDER || 'Bancolombia';
const CODE = process.env.MOCK_PV_CODE || '0000';
const SENTINEL = 'pay.mock-payvalida.local';

const log = (...a) => console.log(new Date().toISOString(), ...a);

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // health / status (lo usa bin/mock-payvalida)
    if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ mock: 'payvalida', port: PORT, code: CODE, sentinel: SENTINEL, returnUrl: RETURN_URL }));
    }

    if (req.method !== 'POST' || !url.pathname.endsWith('/porders')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ CODE: '9999', DESCRIPTION: 'ruta no mockeada' }));
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        let p = {};
        try { p = JSON.parse(body || '{}'); } catch { /* el backend manda JSON; si no, seguimos con defaults */ }
        const order = String(p.order || `mock-${Date.now()}`);
        const amount = String(p.amount ?? '0').replace(/\D/g, '') || '0';

        // El checkout va SIN esquema porque el backend le antepone 'https://'.
        const qs = new URLSearchParams({ lender: LENDER, monto: amount, comercio: 'CreditOp (demo)' });
        if (RETURN_URL) qs.set('volver', RETURN_URL);
        const checkout = `${SENTINEL}/checkout/${order}?${qs.toString()}`;

        log(`porders order=${order} amount=${amount} method=${p.method ?? '-'} → CODE ${CODE}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            CODE,
            DESCRIPTION: CODE === '0000' ? 'OK' : 'Error simulado por el mock',
            DATA: { checkout, order, amount },
        }));
    });
});

server.listen(PORT, () => log(`mock-payvalida escuchando en :${PORT} (checkout → ${SENTINEL})`));
