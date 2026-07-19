// Pasarela MOCK de integraciones de ENTIDADES (Sistecrédito, Welli, Meddipay, Bancolombia…).
//
// POR QUÉ EXISTE (relevado 2026-07-18):
//   En el .env local varios proveedores apuntan a hosts `*.fake` que no resuelven. Al seleccionar una de
//   esas entidades, el flujo muere con `cURL error 6: Could not resolve host`. Pero OJO — el relevamiento
//   mostró que **la mayoría de las entidades NO llama a nadie**: devuelven un modal ("continuá con el
//   asesor" / "te enviamos un link por WhatsApp") y funcionan en local sin mock. Los que sí llaman son la
//   minoría; este server existe para ESOS.
//
// FILOSOFÍA — responder algo razonable y DELATAR lo desconocido:
//   · Rutas conocidas → respuesta con la forma que el backend espera (ver abajo).
//   · Ruta NO conocida → igual responde 200 con un cuerpo genérico, pero lo LOGUEA en mayúsculas con
//     método + path + query + cuerpo. Así el próximo muro se documenta solo en vez de aparecer como un
//     error opaco, y se agrega acá con su forma real.
//   Un 200 genérico puede no tener la forma exacta que el consumidor espera; es a propósito: falla MÁS
//   ADELANTE y con el log en la mano, en vez de morir en el DNS sin información.
//
// Uso:  node mock-lenders/server.mjs   (o  bin/mock-lenders start)
//   env: MOCK_LENDERS_PORT (8099) · MOCK_LENDERS_FAIL=1 → responde 500 (para probar el camino de error)

import http from 'node:http';

const PORT = Number(process.env.MOCK_LENDERS_PORT || 8099);
const FAIL = process.env.MOCK_LENDERS_FAIL === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

// Rutas con forma CONOCIDA (verificadas leyendo app/Actions/Lenders/*).
const RUTAS = [
    {
        // SistecreditoPos::register → GET /{pos}/getCreditToken. El backend pasa la respuesta tal cual como
        // `transaction.data`, sin exigir campos → alcanza con algo plausible.
        test: (p) => /getCreditToken$/.test(p),
        body: (q) => ({ token: 'MOCK-' + Date.now(), creditValue: q.get('creditValue') ?? null, months: q.get('months') ?? null, message: 'OK', errorCode: null }),
    },
    {
        // SistecreditoPos::consult → cupo disponible del cliente.
        test: (p) => /getCreditLimitClient$/.test(p),
        body: () => ({ creditLimit: 5_000_000, availableCredit: 5_000_000, status: 'ACTIVE', errorCode: null }),
    },
    {
        test: (p) => /getCreditDetails$/.test(p),
        body: (q) => ({ creditValue: q.get('creditValue') ?? 0, months: q.get('months') ?? 0, quotaValue: 0, status: 'APPROVED', errorCode: null }),
    },
    {
        // SistecreditoPay::register → POST /pay/create
        test: (p) => /\/pay\/create$/.test(p),
        body: () => ({ id: 'MOCK-PAY-' + Date.now(), url: 'https://pay.mock-lenders.local/checkout', status: 'CREATED', errorCode: null }),
    },
];

const server = http.createServer((req, res) => {
    // OJO: el backend arma URLs con DOBLE barra (`baseUrl` + `/{pos}/getCreditToken` con `{pos}` vacío →
    // `//getCreditToken`). `new URL('//x', base)` lo lee como URL PROTOCOLO-RELATIVA → host='x', path='/'
    // → toda petición caía en el handler raíz y no se logueaba. Colapsamos las barras iniciales primero.
    const url = new URL(String(req.url).replace(/^\/{2,}/, '/'), `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') {
        return json(res, 200, { mock: 'lenders-gateway', port: PORT, fail: FAIL, rutasConocidas: RUTAS.length });
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        if (FAIL) {
            log(`FAIL forzado ← ${req.method} ${url.pathname}`);
            return json(res, 500, { message: 'Fallo simulado del proveedor', errorCode: 'MOCK_FAIL' });
        }
        const hit = RUTAS.find((r) => r.test(url.pathname));
        if (hit) {
            log(`${req.method} ${url.pathname}${url.search} → conocida`);
            return json(res, 200, hit.body(url.searchParams));
        }
        // Lo importante: que un endpoint no mapeado sea RUIDOSO, no silencioso.
        log(`⚠ RUTA NO MAPEADA ← ${req.method} ${url.pathname}${url.search}${body ? ' body=' + body.slice(0, 300) : ''}`);
        log('  (agregala a RUTAS en mock-lenders/server.mjs con la forma que el backend espera)');
        json(res, 200, { status: 'OK', approved: true, message: 'respuesta genérica del mock', errorCode: null });
    });
});

server.listen(PORT, () => log(`mock-lenders escuchando en :${PORT}${FAIL ? ' · modo FALLO' : ''}`));
