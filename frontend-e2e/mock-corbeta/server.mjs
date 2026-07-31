// Mock de la API FONDOS de CORBETA — el servicio propio del grupo Corbeta que hoy EMITE el código
// (PIN) que el cliente presenta en la caja de Alkosto / K-TRONIX / Alkomprar.
//
// POR QUÉ EXISTE (2026-07-31):
//   El camino del código de compra es lo único del canal QR que no se podía correr en local: sale a
//   un servicio 100% externo del comercio. Sin este mock no hay forma de ejercitar
//   `purchase-code/generate` ni de escribir el TEST DE CARACTERIZACIÓN que congele el comportamiento
//   actual — y hoy ese camino tiene **cero** tests (ver `context/…/findings` F-79..F-82).
//   Se vuelve doblemente necesario porque el reemplazo del emisor (Corbeta → Bancolombia, servicio
//   *In Store Billing Code*) va a tocar exactamente estos dos puntos:
//     · `merchants/CodeGenerationService::getRequestNumber()`  (emisión)
//     · `merchants/PurchaseCodeService::validateCurrentOrder()` (consulta de estado)
//
// CONTRATO — leído de `legacy-backend/app/Actions/Allieds/Corbeta.php` (origin/main), no inventado:
//   · `authorize()` (`:38`) → POST /ObtenerToken/getToken   body {UserName, Password}
//        el caller lee `['token']` y `['userId']`.
//   · `register()`  (`:58`) → POST /GenerarOrden/setOrder   Bearer + header `UserId`, 18 campos
//        el caller lee `['code']` (compara `== 200`) y `['message']`, y **el PIN va EMBEBIDO EN EL
//        TEXTO** del message: `CodeGenerationService.php:72` lo saca con `/PIN\s+([a-f0-9]{20,})/i`.
//        → por eso acá el message es una frase con el PIN adentro, en hex minúscula de 20 chars.
//   · `query()`    (`:131`) → POST /ConsultaOrden/getOrder  body {EstadoOrden, FechaInicio, FechaFin,
//        NitCliente} (fechas `Y-m-d\TH:i:s`). La respuesta es un **array plano** de órdenes con
//        `{pin, fechaSolicitud, fechaFacturacion, noFactura, valorFacturado}`; el caller ordena por
//        `fechaFacturacion` desc y deduplica por `pin` (`:161-165`).
//        ⚠ `EstadoOrden`: 1 solicitada · 2 (el default del método) · 3 facturada. El enum del proveedor
//        no está documentado en ningún lado; esto respeta el uso que hace el código.
//
// LA SUTILEZA QUE HAY QUE PRESERVAR (y que el reemplazo va a cambiar):
//   `validateCurrentOrder()` NO evalúa el estado de la orden: pide las de ayer→mañana con
//   `EstadoOrden = 2` y sólo mira si el PIN está en la lista. O sea "si ya facturó, no mostrar el
//   código" funciona hoy **por efecto colateral del filtro**, no por una regla escrita. Por eso el
//   control de abajo (`/_control/facturar`) mueve la orden a estado 3: es lo que hace que DESAPAREZCA
//   de la consulta y el código deje de mostrarse. Es el caso que el test tiene que congelar.
//
// LO QUE **NO** MOCKEA:
//   · La conciliación batch (los 4 crons de `application` que llaman `query()` con status=3 y
//     confirman a Bancolombia). Necesitan además el confirm del banco: es otro ejercicio.
//   · El servicio nuevo de Bancolombia (*In Store Billing Code*). Ese es `mock-bancolombia`, y sólo
//     tiene sentido cuando exista el cliente nuevo en el backend.
//
// APUNTÁ EL BACKEND (legacy-backend/.env) — corre en Docker, así que NO es `localhost`:
//   CORBETA_HOST=http://host.docker.internal:8103
//   CORBETA_NIT=900123456      CORBETA_PASSWORD=cualquiera
//   CORBETA_CONVENIO_BNPL=1    CORBETA_CONVENIO_CONSUMO=2
//
// USO:  node mock-corbeta/server.mjs   (o  bin/mock-corbeta start)
//   env: MOCK_CORBETA_PORT (8103) · MOCK_CORBETA_FAIL=1 → setOrder responde 400
//        (⚠ ese 400 es EL camino del bug P1: sin seed de `LenderErrorCode` para
//         `App\Actions\Allieds\Corbeta`, `handleException` retorna void y `register()` hace
//         `return $apiResponse` NUNCA ASIGNADA → `Error` de PHP 8 que ningún catch atrapa)
// CONTROL en caliente (sin reiniciar):
//   GET  /                      → estado + órdenes en memoria
//   POST /_control/facturar     {pin}            → pasa la orden a EstadoOrden 3 (+ noFactura, valorFacturado)
//   POST /_control/estado       {pin, estado}    → fuerza cualquier estado
//   POST /_control/reset        → limpia el registro

import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.MOCK_CORBETA_PORT || 8103);
const FAIL = process.env.MOCK_CORBETA_FAIL === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** Registro en memoria: pin → orden. Es la "BD de cajas" del proveedor. */
const ordenes = new Map();

const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

const leerBody = (req) => new Promise((ok) => {
    let raw = '';
    req.on('data', (d) => { raw += d; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { ok(raw ? JSON.parse(raw) : {}); } catch { ok({}); } });
});

/** El PIN real de Corbeta es hex minúscula de 20 chars — el regex del backend exige `[a-f0-9]{20,}`. */
const nuevoPin = () => randomBytes(10).toString('hex');

/** Formato de fecha que devuelve el proveedor (lo que el cron parsea): `2025-07-18T13:14:54.32`. */
const ahoraIso = () => new Date().toISOString().replace('Z', '').slice(0, 22);

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    const body = req.method === 'POST' ? await leerBody(req) : {};

    // ── estado (lo consume bin/mock-corbeta para saber si hay que reiniciar por cambio de modo) ──
    if (ruta === '/' && req.method === 'GET') {
        return json(res, 200, {
            mock: 'corbeta-api-fondos', puerto: PORT, fail: FAIL,
            ordenes: [...ordenes.values()],
        });
    }

    // ── control en caliente ───────────────────────────────────────────────────────────────────────
    if (ruta === '/_control/reset') { ordenes.clear(); log('control: reset'); return json(res, 200, { ok: true }); }
    if (ruta === '/_control/facturar' || ruta === '/_control/estado') {
        const o = ordenes.get(String(body.pin || ''));
        if (!o) return json(res, 404, { ok: false, error: 'pin no registrado', pines: [...ordenes.keys()] });
        if (ruta === '/_control/facturar') {
            o.estado = 3;
            o.fechaFacturacion = ahoraIso();
            o.noFactura = `SETT${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
            o.valorFacturado = String(o.valor);
        } else {
            o.estado = Number(body.estado);
        }
        log(`control: pin ${o.pin} → estado ${o.estado}${o.noFactura ? ` factura ${o.noFactura}` : ''}`);
        return json(res, 200, { ok: true, orden: o });
    }

    // ── el contrato real ──────────────────────────────────────────────────────────────────────────
    if (ruta === '/ObtenerToken/getToken') {
        // El caller sólo usa ['token'] y ['userId']; no valida nada más.
        log(`getToken · UserName=${body.UserName ?? '(vacío)'}`);
        return json(res, 200, { token: `mock-corbeta-${Date.now()}`, userId: 'MOCK-USER-1' });
    }

    if (ruta === '/GenerarOrden/setOrder') {
        if (FAIL) {
            // El camino del bug P1. Se devuelve 400 para que `->throw()` levante RequestException.
            log('setOrder · MODO FALLO → 400');
            return json(res, 400, { code: 400, message: 'Error controlado del mock (MOCK_CORBETA_FAIL=1)' });
        }
        const pin = nuevoPin();
        const orden = {
            pin,
            estado: 2,                       // recién solicitada: es la que ve `validateCurrentOrder`
            valor: Number(body.Valor || 0),
            convenio: body.IdConvenio ?? null,
            documento: body.NoDocumento ?? null,
            departamento: body.IdDepartamento ?? null,
            ciudad: body.IdCiudad ?? null,
            direccion: body.Direccion ?? null,
            fechaSolicitud: ahoraIso(),
            fechaFacturacion: null,
            noFactura: null,
            valorFacturado: null,
        };
        ordenes.set(pin, orden);
        log(`setOrder · pin=${pin} valor=${orden.valor} convenio=${orden.convenio} doc=${orden.documento}`);
        // El PIN va EMBEBIDO EN EL TEXTO: así es como responde el proveedor y así lo raspa el backend.
        return json(res, 200, {
            code: 200,
            message: `Orden generada correctamente. PIN ${pin} - presentelo en caja`,
        });
    }

    if (ruta === '/ConsultaOrden/getOrder') {
        const estado = Number(body.EstadoOrden ?? 2);
        const desde = body.FechaInicio ? Date.parse(body.FechaInicio) : -Infinity;
        const hasta = body.FechaFin ? Date.parse(body.FechaFin) : Infinity;
        const lista = [...ordenes.values()]
            .filter((o) => o.estado === estado)
            .filter((o) => {
                const t = Date.parse(o.fechaSolicitud);
                return Number.isNaN(t) ? true : t >= desde && t <= hasta;
            })
            .map(({ pin, fechaSolicitud, fechaFacturacion, noFactura, valorFacturado }) => ({
                pin, fechaSolicitud, fechaFacturacion, noFactura, valorFacturado,
            }));
        log(`getOrder · EstadoOrden=${estado} rango=${body.FechaInicio ?? '—'}..${body.FechaFin ?? '—'} → ${lista.length} órden(es)`);
        // Array PLANO: el caller hace collect() + sortByDesc('fechaFacturacion') + unique('pin').
        return json(res, 200, lista);
    }

    // Ruta desconocida: 200 + log en mayúsculas, misma convención que mock-lenders (F-25) — así una
    // llamada que no mapeamos se ve en el log en vez de romper el flujo con un 404 silencioso.
    log(`⚠ RUTA NO MAPEADA: ${req.method} ${ruta} · body=${JSON.stringify(body).slice(0, 300)}`);
    return json(res, 200, {});
});

server.listen(PORT, () => log(`mock-corbeta (API Fondos) escuchando en :${PORT}${FAIL ? ' · MODO FALLO' : ''}`));
