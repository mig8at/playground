// Mock de WOMPI — la pasarela con la que el comprador paga la cuota inicial.
//
// POR QUÉ EXISTE (2026-09-25):
//   El camino «debe pagar cuota inicial» no se podía cerrar en local. En la pantalla `/down-payment` el
//   front crea un intento de pago y abre el widget de Wompi, y después consulta el estado cada 3 s.
//   El backend se entera del pago preguntándole a Wompi, y en local `WOMPI_HOST` está vacío: la
//   consulta falla y el pago queda en PENDING para siempre. El `WOMPI_MOCK_ENABLED` del `.env` local
//   no lo lee ningún código. Sin esto, ninguna compra con cuota inicial llega al estado 11 por consola.
//
// CONTRATO — leído de legacy-backend, no inventado:
//   · `PaymentStatusService::resolve()` (lo que atiende `GET /api/loans/payments/{reference}/status`):
//     si la transacción está PENDING y tiene más de 20 s, llama a `Wompi::updateStatus()`.
//   · `Wompi::updateStatus()` (app/Actions/Lenders/Wompi.php): `GET {WOMPI_HOST}/transactions
//     ?reference=<order_id>` con la llave PRIVADA como Bearer; toma `data[0].status` (tiene que ser un
//     nombre de `lender_transaction_statuses` del lender 52) y, si es APPROVED y la transacción es de
//     cuota inicial, `data[0].amount_in_cents` es lo pagado: con eso recalcula `initial_fee`, `amount` y
//     `final_amount` de la solicitud.
//   · Sin transacción para esa referencia Wompi contesta `data: []` y el backend la deja en PENDING. Es lo
//     que pasa mientras el comprador no pagó: acá, hasta que alguien llame a `/__mock/pay`.
//
// LA FORMA DE LA RESPUESTA — medida en producción el 2026-09-25 sobre las 121 cuotas iniciales de 30
// días que se confirmaron por esta consulta (ninguna llegó por webhook): `{data: [...], meta}`, cada
// transacción con las 18 claves de abajo, `amount_in_cents` entero, `id` de 24 caracteres,
// `payment_method_type` PSE o BANCOLOMBIA_TRANSFER, y APPROVED o DECLINED con estos mensajes.
//
// LO QUE **NO** MOCKEA:
//   · El widget (checkout.wompi.co): corre en el navegador. El runner hace lo que haría el comprador al
//     terminar de pagar —`POST /__mock/pay`— en vez de abrirlo.
//   · El webhook `transaction.updated`: en producción no confirmó ninguna cuota inicial en 30 días, y el
//     backend igual la confirma por la consulta.
//
// APUNTÁ EL BACKEND (legacy-backend/.env) — corre en Docker, así que NO es `localhost`, y después
// `php artisan config:clear` en el contenedor:
//   WOMPI_HOST=http://host.docker.internal:8112/v1
//
// USO:  node mock-wompi/server.mjs     (o `make harness-wompi`)
//   env: MOCK_WOMPI_PORT (8112) · MOCK_WOMPI_BIND (127.0.0.1)
// CONTROL en caliente (sin reiniciar):
//   GET  /                → estado + transacciones en memoria
//   POST /__mock/pay      {reference, amount_in_cents, status?, payment_method_type?}  → el comprador pagó
//   POST /__mock/reset    → limpia todo

import http from 'node:http';
import { randomInt } from 'node:crypto';

const PORT = Number(process.env.MOCK_WOMPI_PORT || 8112);
const BIND = process.env.MOCK_WOMPI_BIND || '127.0.0.1';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

/** Las transacciones por referencia, la más nueva primero: una referencia puede tener varios intentos
 *  (en producción, 7 de las 121 traían dos) y el backend lee `data[0]`. */
const byReference = new Map();

/** Los mensajes que Wompi devolvió en producción para cada desenlace (ver la cabecera). */
const MESSAGES = {
    APPROVED: { PSE: null, BANCOLOMBIA_TRANSFER: 'Aprobado' },
    DECLINED: { PSE: 'La transacción fue rechazada por el usuario', BANCOLOMBIA_TRANSFER: 'Transacción rechazada por el usuario' },
};
const STATUSES = ['APPROVED', 'DECLINED', 'VOIDED', 'ERROR', 'PENDING'];

/** El id de Wompi: `<comercio>-<epoch>-<secuencia>`, 24 caracteres como los medidos. */
const transactionId = () =>
    `${randomInt(10000, 99999)}-${Math.floor(Date.now() / 1000)}-${String(randomInt(0, 9999999)).padStart(7, '0')}`;

function transaction({ reference, amount_in_cents, status, payment_method_type }) {
    const now = new Date().toISOString();
    const type = payment_method_type || 'PSE';
    return {
        id: transactionId(),
        origin: null,
        status,
        currency: 'COP',
        reference,
        created_at: now,
        billing_data: null,
        finalized_at: status === 'PENDING' ? null : now,
        redirect_url: null,
        customer_data: { full_name: 'Comprador de prueba', phone_number: '+573000000000' },
        customer_email: 'comprador@mock-wompi.local',
        payment_method: type === 'PSE'
            ? { type, extra: {}, user_type: 0, afe_decision: 'ACCEPT', user_legal_id: '1000000000', user_legal_id_type: 'CC', payment_description: 'Pago de cuota inicial', financial_institution_code: '1' }
            : { type, extra: {}, user_type: 'PERSON', afe_decision: 'ACCEPT', payment_description: 'Pago de cuota inicial' },
        status_message: MESSAGES[status]?.[type] ?? null,
        amount_in_cents: Number(amount_in_cents),
        payment_link_id: null,
        shipping_address: null,
        payment_source_id: null,
        payment_method_type: type,
    };
}

const readBody = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
});

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // `WOMPI_HOST` puede traer `/v1` o no: las dos formas llegan al mismo lugar.
    const path = url.pathname.replace(/^\/v1(?=\/)/, '');
    const body = req.method === 'POST' ? await readBody(req) : '';

    if (req.method === 'GET' && url.pathname === '/') {
        return json(res, 200, { mock: 'wompi', port: PORT, references: Object.fromEntries(byReference) });
    }

    if (req.method === 'POST' && path === '/__mock/pay') {
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'el cuerpo no es JSON' }); }
        const status = String(input.status || process.env.MOCK_WOMPI_STATUS || 'APPROVED').toUpperCase();
        if (!input.reference || !Number.isInteger(Number(input.amount_in_cents))) {
            return json(res, 422, { error: 'hacen falta reference y amount_in_cents (entero, en centavos)' });
        }
        if (!STATUSES.includes(status)) return json(res, 422, { error: `status tiene que ser uno de ${STATUSES.join(', ')}` });
        const tx = transaction({ ...input, status });
        byReference.set(input.reference, [tx, ...(byReference.get(input.reference) ?? [])]);
        log('pay', input.reference, status, tx.amount_in_cents);
        return json(res, 200, { data: tx });
    }

    if (req.method === 'POST' && path === '/__mock/reset') {
        byReference.clear();
        return json(res, 200, { ok: true });
    }

    // Lo que consulta el backend. Wompi pide la llave privada: sin Bearer contesta 401.
    if (req.method === 'GET' && (path === '/transactions' || path.startsWith('/transactions/'))) {
        if (!/^Bearer \S+/.test(req.headers.authorization || '')) {
            return json(res, 401, { error: { type: 'INVALID_ACCESS_TOKEN', reason: 'Se esperaba una llave privada' } });
        }
        if (path === '/transactions') {
            const reference = url.searchParams.get('reference') || '';
            const data = byReference.get(reference) ?? [];
            log('consulta', reference, data[0]?.status ?? '(sin transacción)');
            return json(res, 200, { data, meta: {} });
        }
        const id = decodeURIComponent(path.slice('/transactions/'.length));
        const tx = [...byReference.values()].flat().find((t) => t.id === id);
        return tx
            ? json(res, 200, { data: tx, meta: {} })
            : json(res, 404, { error: { type: 'NOT_FOUND_ERROR', reason: 'La entidad solicitada no existe' } });
    }

    log('sin ruta', req.method, url.pathname);
    return json(res, 404, { error: `el mock de Wompi no atiende ${req.method} ${url.pathname}` });
});

server.listen(PORT, BIND, () => log(`mock-wompi escuchando en ${BIND}:${PORT}`));
