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
// DICTAR LA RESPUESTA, sin reiniciar (admin API):
//   POST /__mock/escenario  {"lender":"meddipay","modo":"rechaza"}
//        modos: aprueba (APP) · reserva (HOL) · rechaza (DEN, la card desaparece) · falla (500)
//        con `"doc":"1095…"` aplica SÓLO a esa cédula — es lo que permite casos en paralelo
//   GET  /__mock/escenario   → qué está dictado ahora
//   DELETE /__mock/escenario → vuelve todo a `aprueba`
//
// Es el mismo mecanismo que la lambda de centrales (`enableAdminApi`), y por la misma razón: se PIDE de
// antemano la respuesta que se quiere y después el flujo corre normal, sin tocar código ni `.env`.
// ⚠ Diferencia que importa: esto es UN proceso local, así que el estado es compartido y dictar en
// paralelo es seguro. En la lambda NO lo es — es serverless y sus global-vars viven por contenedor
// (F-139). No copies esa costumbre de un lado al otro.
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
        // Meddipay::auth → POST /User/Login. Estaba SIN MAPEAR, y por eso Meddipay desaparecía del
        // listado en local sin decir nada: el Action exige `data.token` (`Meddipay.php:234`) y la
        // respuesta genérica del mock no lo trae. Una ausencia muda que se leía como regla de negocio
        // (F-140).
        lender: 'meddipay',
        test: (p) => /\/User\/Login$/.test(p),
        body: (q, doc) => (modoDe('meddipay', doc) === 'rechaza'
            ? { data: null, message: 'Credenciales inválidas', errorCode: 'AUTH_FAILED' }
            : { data: { token: 'MOCK-MEDDIPAY-' + Date.now(), expiresIn: 3600 }, message: 'OK', errorCode: null }),
    },
    {
        // Meddipay::consult → POST /CREDITOP/Customer/CreateOrder. La forma la fija
        // `Meddipay.php:314-316` (`data.order_id`, `data.creditLimit.{creditLimit,result}`), y el
        // veredicto lo interpreta `PreApprovedLenderService.php:476-495`:
        //     APP → «Pre aprobado» (`pre_approved_lender = true`)
        //     HOL → «Probabilidad alta»
        //     DEN → `unset`: la entidad DESAPARECE del listado, sin mensaje
        // Por eso `rechaza` acá manda DEN y no un 4xx: un rechazo de NEGOCIO viaja en un 200, y el
        // camino que borra la card es ése, no el del error de transporte.
        lender: 'meddipay',
        test: (p) => /\/Customer\/CreateOrder$/.test(p),
        body: (q, doc) => {
            const modo = modoDe('meddipay', doc);
            const result = modo === 'rechaza' ? 'DEN' : modo === 'reserva' ? 'HOL' : 'APP';
            return {
                data: {
                    order_id: 'MOCK-ORDER-' + Date.now(),
                    creditLimit: { creditLimit: result === 'DEN' ? 0 : 4_000_000, result },
                    commercialOffer: [{ idGroup: 'NODISC_CUSRISKINT', minTerm: 4 }],
                },
                message: 'OK', errorCode: null,
            };
        },
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
    {
        // Welli::register → POST /api/externals/risk/run_risk/. Auto-descubierta por el log de rutas no
        // mapeadas (2026-07-19). El action valida data.id (orderId) y data.estado — y el estado DEBE
        // matchear un lender_transaction_statuses.name del lender 23 ('approved', 'pendiente_desembolso',
        // 'rejected', …), si no cae al default 'rejected'. MOCK_WELLI_ESTADO lo cambia sin reiniciar código.
        test: (p) => /\/risk\/run_risk\/?$/.test(p),
        body: () => ({ data: { id: 'MOCK-WELLI-' + Date.now(), estado: process.env.MOCK_WELLI_ESTADO || 'approved', comision_aliado: 0 }, error: null }),
    },
];

// Qué le pasa a cada entidad. Se dicta por el admin API; `aprueba` es el default.
//
// ⚠ SE PUEDE DICTAR POR CÉDULA, y eso es lo que habilita correr casos EN PARALELO. Con un escenario
// global, dos casos simultáneos que quieran «Meddipay aprueba» y «Meddipay rechaza» se pisan y el
// resultado depende de quién dictó último — un fallo que no se ve, porque los dos terminan bien.
// La clave por documento es la misma idea que usa la lambda de centrales para lo mismo.
const escenarios = new Map();          // `${lender}` (global) o `${lender}:${doc}` (por cédula)
const modoDe = (lender, doc) =>
    (doc && escenarios.get(`${lender}:${doc}`)) || escenarios.get(lender) || 'aprueba';

/** La cédula que viaja en el cuerpo, para resolver el escenario del caso. Meddipay la manda en
 *  `document.number`; si algún proveedor la mandara distinto, se agrega acá y no en cada ruta. */
const docDe = (body) => {
    try {
        const b = JSON.parse(body || '{}');
        return String(b?.document?.number ?? b?.documentNumber ?? b?.idDocument ?? '') || null;
    } catch { return null; }
};

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
        if (url.pathname === '/__mock/escenario') {
            if (req.method === 'GET') return json(res, 200, Object.fromEntries(escenarios));
            if (req.method === 'DELETE') { escenarios.clear(); log('escenarios limpiados'); return json(res, 200, {}); }
            if (req.method === 'POST') {
                let p = {};
                try { p = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'JSON inválido' }); }
                if (!p.lender || !['aprueba', 'rechaza', 'reserva', 'falla'].includes(p.modo)) {
                    return json(res, 400, { error: 'se espera {lender, modo: aprueba|rechaza|reserva|falla}' });
                }
                const clave = p.doc ? `${p.lender}:${p.doc}` : p.lender;
                escenarios.set(clave, p.modo);
                log(`escenario dictado: ${clave} → ${p.modo}`);
                return json(res, 200, Object.fromEntries(escenarios));
            }
            return json(res, 405, { error: 'método no soportado' });
        }
        if (FAIL) {
            log(`FAIL forzado ← ${req.method} ${url.pathname}`);
            return json(res, 500, { message: 'Fallo simulado del proveedor', errorCode: 'MOCK_FAIL' });
        }
        const hit = RUTAS.find((r) => r.test(url.pathname));
        if (hit) {
            // `falla` se resuelve ACÁ y no en el cuerpo: es un fallo de TRANSPORTE (500), no una
            // respuesta de negocio. Mezclarlos haría que «el proveedor se cayó» y «el proveedor dijo
            // que no» se vieran igual desde el backend, que es justo lo que F-140 mostró que confunde.
            if (hit.lender && modoDe(hit.lender, docDe(body)) === 'falla') {
                log(`${req.method} ${url.pathname} → FALLA dictada para ${hit.lender}`);
                return json(res, 500, { message: 'Fallo simulado del proveedor', errorCode: 'MOCK_FAIL' });
            }
            log(`${req.method} ${url.pathname}${url.search} → conocida${hit.lender ? ` (${hit.lender}: ${modoDe(hit.lender, docDe(body))}${docDe(body) ? ' doc ' + docDe(body) : ''})` : ''}`);
            return json(res, 200, hit.body(url.searchParams, docDe(body)));
        }
        // Lo importante: que un endpoint no mapeado sea RUIDOSO, no silencioso.
        log(`⚠ RUTA NO MAPEADA ← ${req.method} ${url.pathname}${url.search}${body ? ' body=' + body.slice(0, 300) : ''}`);
        log('  (agregala a RUTAS en mock-lenders/server.mjs con la forma que el backend espera)');
        json(res, 200, { status: 'OK', approved: true, message: 'respuesta genérica del mock', errorCode: null });
    });
});

server.listen(PORT, () => log(`mock-lenders escuchando en :${PORT}${FAIL ? ' · modo FALLO' : ''}`));
