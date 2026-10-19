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
//
// ESCRIBE en la base LOCAL y sólo en ella.   uso: bin/mock-payment-link start   ·   env: MOCK_PAYMENT_LINK_PORT (8113)
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
const CODE = String(statSync(new URL(import.meta.url)).mtimeMs);

type Event = { at: string; kind: string; platform?: string; detail: unknown };
const events: Event[] = [];
const log = (kind: string, platform: string | undefined, detail: unknown) => {
    events.unshift({ at: new Date().toISOString(), kind, platform, detail });
    events.length = Math.min(events.length, 200);
    console.log(`[mock-payment-link] ${kind}${platform ? ' · ' + platform : ''}`);
};

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
        if (r.method === 'GET' && p === '/api/config') return send(res, 200, { self: SELF, from_backend: FROM_BACKEND, payment_link_url: PAYMENT_LINK_URL, wizard: wizardBase(), real_token: Boolean(PAYMENT_LINK_TOKEN) });
        if (r.method === 'GET' && p === '/api/events') return send(res, 200, events);

        // Las sucursales con credencial de ecommerce en la base local: de acá sale «AppKey/AppToken» y la config de Shopify.
        if (r.method === 'GET' && p === '/api/branches') {
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
            return send(res, out.status, { ...out.body, ...(out.warnings.length ? { _mock_warnings: out.warnings } : {}), ...(out.row ? { _mock_row: out.row } : {}) });
        }

        // 2a · el conector VTEX
        if (r.method === 'POST' && p === '/plugin/vtex/authorize') {
            const req = await body(r);
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

        // 2b · la app de Shopify
        if (r.method === 'POST' && p === '/plugin/shopify/configure') {
            const b = await body(r);
            shopifyShops.set(String(b.shop), { hash: String(b.hash), token: String(b.token) });
            log('shopify configure', 'shopify', { shop: b.shop, hash: b.hash });
            return send(res, 200, { ok: true, shop: b.shop, hash: b.hash });
        }
        if (r.method === 'POST' && p === '/plugin/shopify/payment-session') {
            const session = await body(r);
            const shop = String(r.headers['shopify-shop-domain'] || '');
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
