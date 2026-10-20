// mock-payment-link — la puerta única de las tiendas, en local, mientras `POST /api/ecommerce/payment-link`
// (CORE-746, legacy-backend#1682) no esté en el backend local. Tres piezas en un puerto (:8113):
//
//   1. LA API  · POST /api/ecommerce/payment-link        el contrato de Oscar: guarda el pedido con
//      `origin = 'payment_link'` y una referencia, y devuelve `redirect_url` con `?ref=` (pkg/payment-link.ts).
//   2. LOS PLUGINS, simulados: lo que haría cada uno con lo que le manda su plataforma.
//      · POST /plugin/vtex/authorize                     el conector VTEX IO: recibe el AuthorizationRequest
//        (AppKey = hash de la sucursal, AppToken = token) y responde `Authorizations.redirect`.
//      · POST /plugin/shopify/payment-session            la app de pagos offsite: recibe la sesión de pago,
//        busca la sucursal configurada para la tienda y responde `{ redirect_url }`.
//      · POST /plugin/shopify/configure                  lo que el comercio carga al instalar la app.
//      Los dos llaman a PAYMENT_LINK_URL (por defecto, la API de este mismo mock; con la de Oscar en el backend
//      local, PAYMENT_LINK_URL=http://localhost/api/ecommerce/payment-link y PAYMENT_LINK_TOKEN=<token Sanctum>).
//   3. LA TIENDA DEMO · GET /  un checkout con selector de plataforma; GET /return (vuelta) y
//      POST /webhook/<plataforma> (la notificación que manda el backend al terminar), visibles en GET /api/events.
//      Con VTEX, después del aviso, «Cobrar» hace lo que hace el gateway: el settle (POST /plugin/vtex/settle).
//   4. EL ESTADO · GET /api/ecommerce/status/{orderId}   la consulta de estado de legacy-backend, que el settle del
//      conector usa para confirmar el cobro.
//
// DOS MODOS:
//   · local (por defecto): las sucursales salen de la base LOCAL y la API es este mock (o el backend local).
//     ESCRIBE en la base LOCAL y sólo en ella.
//   · qa (STORE_BRANCHES=<archivo.json>): las sucursales y sus tokens salen de ese archivo, privado y fuera de git
//     ([{hash, name, allied, ecommerce_type_id, platform, credential}]), y la API es PAYMENT_LINK_URL (la de qa:
//     https://api.dev.creditop.com/legacy-api/ecommerce/payment-link). El aviso de qa llega por un túnel:
//     MOCK_PAYMENT_LINK_PUBLIC=https://<túnel>. Este proceso no escribe en ninguna base: escribe qa por su API.
//     El conector VTEX real tiene que apuntar a la misma API (CREDITOP_API_URL).
//
// uso: bin/mock-payment-link start   ·   env: MOCK_PAYMENT_LINK_PORT (8113)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

process.env.E2E_TARGET ||= 'local';   // escribe en la base LOCAL; sin esto db.ts defaultea a dev
if (process.env.E2E_TARGET !== 'local') {
    console.error(`✗ mock-payment-link sólo corre contra local (E2E_TARGET=${process.env.E2E_TARGET})`);
    process.exit(2);
}
const { query } = await import('../pkg/db.ts');
const { createPaymentLink, wizardBase } = await import('../pkg/payment-link.ts');

const PORT = Number(process.env.MOCK_PAYMENT_LINK_PORT || 8113);
const SELF = `http://localhost:${PORT}`;
// El backend corre en Docker: para él, este mock está en host.docker.internal.
const FROM_BACKEND = process.env.MOCK_PAYMENT_LINK_PUBLIC || `http://host.docker.internal:${PORT}`;
const PAYMENT_LINK_URL = process.env.PAYMENT_LINK_URL || `${SELF}/api/ecommerce/payment-link`;
const PAYMENT_LINK_TOKEN = process.env.PAYMENT_LINK_TOKEN || '';
const STORE = new URL('./store.html', import.meta.url);
// Modo qa: las sucursales (con su token) vienen de un archivo, no de la base local.
const STORE_BRANCHES = process.env.STORE_BRANCHES || '';
const MODE = STORE_BRANCHES ? 'qa' : 'local';
// Los plugins REALES corriendo en local (repo vtex: `yarn --cwd node local` · repo shopify: `npm run local`). Si
// contestan, la tienda les manda a ellos; si no, usa los simulados de abajo.
const VTEX_CONNECTOR_URL = (process.env.VTEX_CONNECTOR_URL || 'http://localhost:8114').replace(/\/$/, '');
const SHOPIFY_APP_URL = (process.env.SHOPIFY_APP_LOCAL_URL || 'http://localhost:8115').replace(/\/$/, '');
const CODE = String(statSync(new URL(import.meta.url)).mtimeMs);

type Event = { at: string; kind: string; platform?: string; detail: unknown };
const events: Event[] = [];
const log = (kind: string, platform: string | undefined, detail: unknown) => {
    events.unshift({ at: new Date().toISOString(), kind, platform, detail });
    events.length = Math.min(events.length, 200);
    console.log(`[mock-payment-link] ${kind}${platform ? ' · ' + platform : ''}`);
};

// Lo último que recibió y contestó la API por order_key: con un plugin real, es la única vista de su llamada.
const apiCalls = new Map<string, { url: string; status: number; request: unknown; response: unknown }>();

async function alive(url: string): Promise<boolean> {
    try { return (await fetch(url, { signal: AbortSignal.timeout(600) })).status < 500; } catch { return false; }
}
const realVtex = () => alive(`${VTEX_CONNECTOR_URL}/health`);
const realShopify = async () => { try { return (await fetch(`${SHOPIFY_APP_URL}/payments/session`, { signal: AbortSignal.timeout(1500) })).status === 405; } catch { return false; } };

// Lo que el comercio configuró en la app de Shopify, por tienda (`*.myshopify.com` → sucursal y token).
const shopifyShops = new Map<string, { hash: string; token: string }>();

async function body(r: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    for await (const c of r) chunks.push(c as Buffer);
    const s = Buffer.concat(chunks).toString('utf8');
    if (!s) return {};
    try { return JSON.parse(s); } catch { return { _raw: s }; }
}
function send(res: ServerResponse, status: number, payload: unknown, type = 'application/json') {
    res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
}

/** Lo único que el plugin le pide a Creditop: la URL. Igual para las dos plataformas. */
async function askCreditop(payload: Record<string, unknown>, token: string) {
    const bearer = PAYMENT_LINK_TOKEN || token;
    const r = await fetch(PAYMENT_LINK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(payload),
    });
    const text = await r.text();
    let json: any; try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
    return { url: PAYMENT_LINK_URL, status: r.status, request: payload, response: json };
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '');

/** VTEX AuthorizationRequest → cuerpo de payment-link. El `paymentId` es la llave con que VTEX vuelve (settle). */
function fromVtex(req: any, hash: string) {
    const buyer = req.miniCart?.buyer ?? {};
    return {
        hash,
        order_key: req.paymentId,
        id: req.orderId,
        total: req.value,
        billing: {
            first_name: buyer.firstName, last_name: buyer.lastName, email: buyer.email, phone: digits(buyer.phone),
            document_type: buyer.documentType === 'CPF' ? 'CC' : (buyer.documentType || 'CC'), document_number: buyer.document,
        },
        products: (req.miniCart?.items ?? []).map((i: any) => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })),
        return_url: req.returnUrl,
        webhook_url: req.callbackUrl,
    };
}

/** Sesión de pago offsite de Shopify → cuerpo de payment-link. El `id` de la sesión es la llave para resolverla. */
function fromShopify(session: any, hash: string) {
    const c = session.customer ?? {};
    const addr = c.billing_address ?? {};
    return {
        hash,
        order_key: session.id,
        id: session.group,
        total: Number(session.amount),
        billing: {
            first_name: addr.given_name, last_name: addr.family_name, email: c.email, phone: digits(c.phone_number),
            // Shopify no trae documento: lo pide Creditop. Una tienda que lo capture lo mandaría en un atributo del pedido.
        },
        products: [],
        return_url: `${SELF}/return?platform=shopify&session=${encodeURIComponent(session.id)}`,
        webhook_url: `${FROM_BACKEND}/webhook/shopify`,
    };
}

const server = createServer(async (r, res) => {
    const u = new URL(r.url || '/', SELF);
    const p = u.pathname;
    try {
        if (r.method === 'GET' && p === '/health') return send(res, 200, { mock: 'payment-link', ok: true, codigo: CODE, payment_link_url: PAYMENT_LINK_URL, wizard: wizardBase() });
        if (r.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, readFileSync(STORE, 'utf8'), 'text/html');
        if (r.method === 'GET' && p === '/api/config') {
            return send(res, 200, { mode: MODE, self: SELF, from_backend: FROM_BACKEND, payment_link_url: PAYMENT_LINK_URL, wizard: MODE === 'qa' ? 'el de qa' : wizardBase(), real_token: Boolean(PAYMENT_LINK_TOKEN),
                plugins: { vtex: (await realVtex()) ? `real ${VTEX_CONNECTOR_URL}` : 'simulado', shopify: (await realShopify()) ? `real ${SHOPIFY_APP_URL}` : 'simulado' } });
        }
        if (r.method === 'GET' && p === '/api/events') return send(res, 200, events);

        // Las sucursales con credencial de ecommerce en la base local: de acá sale «AppKey/AppToken» y la config de Shopify.
        if (r.method === 'GET' && p === '/api/branches') {
            if (MODE === 'qa') return send(res, 200, JSON.parse(readFileSync(STORE_BRANCHES, 'utf8')));
            const rows = await query(`SELECT ab.hash, ab.name, a.name AS allied, aec.ecommerce_type_id, e.name AS platform, aec.credential
                FROM allied_ecommerce_credentials aec JOIN allied_branches ab ON ab.id = aec.allied_branch_id
                JOIN allieds a ON a.id = ab.allied_id LEFT JOIN ecommerces e ON e.id = aec.ecommerce_type_id
                ORDER BY aec.ecommerce_type_id DESC, a.name`);
            return send(res, 200, rows);
        }

        // 1 · la API (el mock de CORE-746)
        if (r.method === 'POST' && p === '/api/ecommerce/payment-link') {
            const input = await body(r);
            const bearer = String(r.headers.authorization || '').replace(/^Bearer\s+/i, '');
            const out = await createPaymentLink(input, bearer, { expired: u.searchParams.get('expired') === '1' });
            log(`payment-link ${out.status}`, undefined, { order_key: input?.order_key, hash: input?.hash, row: out.row, warnings: out.warnings });
            if (input?.order_key) apiCalls.set(String(input.order_key), { url: `${SELF}${p}`, status: out.status, request: input, response: out.body });
            return send(res, out.status, { ...out.body, ...(out.warnings.length ? { _mock_warnings: out.warnings } : {}), ...(out.row ? { _mock_row: out.row } : {}) });
        }

        // 2a · el conector VTEX
        if (r.method === 'POST' && p === '/plugin/vtex/authorize') {
            const req = await body(r);
            if (await realVtex()) {
                // El conector REAL: se le reenvía lo mismo que manda el gateway de VTEX a `POST /payments`.
                const fw = await fetch(`${VTEX_CONNECTOR_URL}/payments`, { method: 'POST', body: JSON.stringify(req), headers: {
                    'Content-Type': 'application/json', 'X-PROVIDER-API-AppKey': String(r.headers['x-provider-api-appkey'] || ''),
                    'X-PROVIDER-API-AppToken': String(r.headers['x-provider-api-apptoken'] || '') } });
                const out = await fw.json();
                log('vtex authorize (conector real)', 'vtex', { paymentId: req.paymentId, status: out.status });
                return send(res, 200, { ...out, _plugin: `real ${VTEX_CONNECTOR_URL}`, _trace: apiCalls.get(String(req.paymentId)) ?? { url: PAYMENT_LINK_URL, note: 'la llamada no pasó por este mock' } });
            }
            const hash = String(r.headers['x-provider-api-appkey'] || '');
            const token = String(r.headers['x-provider-api-apptoken'] || '');
            const call = await askCreditop(fromVtex(req, hash), token);
            const ok = call.status === 200 && call.response?.redirect_url;
            // Lo que el conector le contesta a VTEX: redirect si hubo URL; si no, deny (no un pending que se queda colgado).
            const vtex = ok
                ? { paymentId: req.paymentId, status: 'undefined', authorizationId: call.response.order_key, tid: req.paymentId,
                    redirectUrl: call.response.redirect_url, delayToAutoSettle: 21600, delayToCancel: 21600, code: null, message: null }
                : { paymentId: req.paymentId, status: 'denied', tid: req.paymentId, code: `CREDITOP_${call.status}`, message: call.response?.message ?? 'payment-link failed' };
            log('vtex authorize', 'vtex', { paymentId: req.paymentId, creditop: call.status });
            return send(res, 200, { ...vtex, _trace: call });
        }

        // 1b · el estado del pedido (la consulta de legacy-backend), contra la base local. Mismas reglas: el pedido de
        // OTRA sucursal da 404, y sólo los estados finales salen como tales (11 completed, 6 failed, 7 y 8 cancelled).
        const status = p.match(/^\/api\/ecommerce\/status\/([^/]+)$/);
        if (r.method === 'GET' && status) {
            if (MODE === 'qa') return send(res, 404, { message: 'en modo qa el estado lo da la API de qa' });
            const bearer = String(r.headers.authorization || '').replace(/^Bearer\s+/i, '');
            const [order] = await query(`SELECT er.id, er.order_key, ur.user_request_status_id AS st, ur.final_amount, ur.amount, ur.initial_fee
                FROM ecommerce_requests er JOIN allied_ecommerce_credentials aec ON aec.allied_branch_id = er.allied_branch_id
                LEFT JOIN user_requests_by_ecommerce_request ub ON ub.id = (SELECT MAX(id) FROM user_requests_by_ecommerce_request WHERE ecommerce_request_id = er.id)
                LEFT JOIN user_requests ur ON ur.id = ub.user_request_id
                WHERE er.order_key = ? AND aec.credential = ? ORDER BY er.id DESC LIMIT 1`, [decodeURIComponent(status[1]), bearer]);
            if (!order) return send(res, 404, { message: 'Order not found.' });
            const st = Number(order.st);
            const merchant = st === 11 ? 'completed' : st === 6 ? 'failed' : st === 7 || st === 8 ? 'cancelled' : 'pending';
            log(`status ${merchant}`, undefined, { order_key: order.order_key, user_request_status_id: order.st ?? null });
            return send(res, 200, { orderId: order.order_key, approvedAmount: Number(order.final_amount ?? order.amount ?? 0) + Number(order.initial_fee ?? 0),
                currency: 'COP', status: merchant, _mock: true });
        }

        // 2a' · el cobro de VTEX (settle): lo que el gateway le manda al conector después del aviso de aprobado.
        if (r.method === 'POST' && p === '/plugin/vtex/settle') {
            const req = await body(r);
            if (!(await realVtex())) return send(res, 409, { error: 'el settle se prueba con el conector real (repo vtex: yarn --cwd node local)' });
            const settlement = { paymentId: req.paymentId, authorizationId: req.paymentId, transactionId: req.paymentId,
                requestId: `settle-${Date.now()}`, settleId: `settle-${Date.now()}`, value: req.value };
            const fw = await fetch(`${VTEX_CONNECTOR_URL}/payments/${encodeURIComponent(req.paymentId)}/settlements`, { method: 'POST', body: JSON.stringify(settlement), headers: {
                'Content-Type': 'application/json', 'X-PROVIDER-API-AppKey': String(r.headers['x-provider-api-appkey'] || ''),
                'X-PROVIDER-API-AppToken': String(r.headers['x-provider-api-apptoken'] || '') } });
            const out = await fw.json();
            log(`vtex settle ${out.settleId ? 'aprobado' : (out.code || 'negado')}`, 'vtex', { paymentId: req.paymentId, settleId: out.settleId, code: out.code, message: out.message });
            return send(res, 200, { request: settlement, response: out });
        }

        // 2b · la app de Shopify
        if (r.method === 'POST' && p === '/plugin/shopify/configure') {
            const b = await body(r);
            shopifyShops.set(String(b.shop), { hash: String(b.hash), token: String(b.token) });
            if (await realShopify()) {
                await fetch(`${SHOPIFY_APP_URL}/local/shop-config`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shop: b.shop, branchHash: b.hash, token: b.token, environment: 'develop' }) });
            }
            log('shopify configure', 'shopify', { shop: b.shop, hash: b.hash });
            return send(res, 200, { ok: true, shop: b.shop, hash: b.hash });
        }
        if (r.method === 'POST' && p === '/plugin/shopify/payment-session') {
            const session = await body(r);
            const shop = String(r.headers['shopify-shop-domain'] || '');
            if (await realShopify()) {
                // La app REAL: se le reenvía la sesión como lo haría Shopify a `payment_session_url`.
                const fw = await fetch(`${SHOPIFY_APP_URL}/payments/session`, { method: 'POST', body: JSON.stringify(session),
                    headers: { 'Content-Type': 'application/json', 'Shopify-Shop-Domain': shop, 'Shopify-Request-Id': String(r.headers['shopify-request-id'] || randomUUID()) } });
                const out = await fw.json().catch(() => ({}));
                log('shopify payment-session (app real)', 'shopify', { session: session.id, status: fw.status });
                return send(res, fw.status, { ...out, _plugin: `real ${SHOPIFY_APP_URL}`, _trace: apiCalls.get(String(session.id)) ?? { url: PAYMENT_LINK_URL, note: 'la llamada no pasó por este mock' } });
            }
            const conf = shopifyShops.get(shop);
            if (!conf) return send(res, 422, { error: `la tienda ${shop || '(sin Shopify-Shop-Domain)'} no configuró su sucursal en la app` });
            const call = await askCreditop(fromShopify(session, conf.hash), conf.token);
            log('shopify payment-session', 'shopify', { session: session.id, shop, creditop: call.status });
            // Shopify espera { redirect_url }; ante un error, la app rechaza la sesión (paymentSessionReject) y responde 4xx.
            if (call.status === 200 && call.response?.redirect_url) return send(res, 200, { redirect_url: call.response.redirect_url, _trace: call });
            return send(res, 502, { error: 'creditop no devolvió redirect_url', _trace: call });
        }

        // 3 · la tienda: la notificación del backend y la vuelta del comprador
        if (r.method === 'POST' && p.startsWith('/webhook/')) {
            // (con la app de Shopify real, el webhook va a la app, no acá)
            const b = await body(r);
            log('webhook recibido', p.split('/')[2], { path: p, headers: { 'x-vtex-api-appkey': r.headers['x-vtex-api-appkey'] ? '(viene)' : undefined, authorization: r.headers.authorization ? '(viene)' : undefined }, body: b });
            return send(res, 200, { ok: true });
        }
        if (r.method === 'GET' && p === '/return') {
            log('el comprador volvió a la tienda', u.searchParams.get('platform') || undefined, Object.fromEntries(u.searchParams));
            res.writeHead(302, { Location: `/?returned=1&${u.searchParams}` });
            return res.end();
        }
        if (r.method === 'GET' && p === '/api/new-ids') return send(res, 200, { paymentId: randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase(), orderId: `v${Date.now()}cdp-01`, session: `shp_${randomUUID()}` });
        return send(res, 404, { error: 'no existe', path: p });
    } catch (e) {
        console.error(e);
        return send(res, 500, { error: (e as Error).message });
    }
});

server.listen(PORT, () => console.log(`[mock-payment-link] :${PORT} · tienda ${SELF}/ · API → ${PAYMENT_LINK_URL} · wizard ${wizardBase()}`));
