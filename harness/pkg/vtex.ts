// vtex.ts — la tienda VTEX de pruebas (cuenta `creditop`) manejada por API, como la manejaría un comprador desde el
// checkout: crear un pedido pagado con Creditop, leer su transacción y cancelarlo.
//
// La compra va por la API de Checkout en los tres pasos que hace el checkout: `PUT /api/checkout/pub/orders` (el
// pedido), `POST …/transactions/{tid}/payments` (el pago con Creditop) y `POST /api/checkout/pub/gatewayCallback/
// {grupo}`, que dispara el authorize del conector y devuelve la URL a la que mandaría al comprador (el wizard con
// `?ref=`). Sin autenticar, la API niega el pedido (`CHK003 Aceso bloqueado`): va con la llave de la cuenta.
//
// QUÉ CONECTOR ATIENDE lo decide la condición de pago activa, no esta API: hoy «Creditop qa» → afiliación v5 del
// workspace `develop` → qa. Por eso sólo tiene sentido con TARGET=qa.
//
// ESCRIBE en VTEX (pedidos reales de la cuenta de pruebas) y, a través del conector, en la base compartida de qa (el
// pedido de `payment-link`), igual que una compra a mano.
//
// Credenciales: `harness/.env.vtex` (VTEX_ACCOUNT, VTEX_APP_KEY, VTEX_APP_TOKEN).
import { envFrom } from './env.ts';

export type VtexBuyer = { tel: string; doc: string; firstName: string; lastName: string; email: string };

export type VtexOrder = {
    orderId: string;         // 1674110500265-01
    orderGroup: string;      // 1674110500265
    transactionId: string;
    redirectUrl: string;     // adonde el checkout mandaría al comprador
    total: number;           // en centavos
    ms: number;              // de crear el pedido a tener la URL
};

export type VtexState = {
    orderId: string;
    orderStatus: string;     // payment-pending, canceled, window-to-cancel, ready-for-handling…
    transactionId: string;
    paymentId: string | null; // el order_key del pedido en Creditop
    txStatus: string;        // Authorizing, Approved, Cancelling, Cancelled, Finished…
    firstAuthorizeMs: number | null;
    proxyTimeout: boolean;
    cancelDenied: string | null;     // el código con que el conector negó una cancelación, si la negó
    cancelApproved: boolean;
    ignoredResult: boolean;  // «cannot advance from Cancelled»: un segundo resultado que VTEX ignoró
    events: { at: string; message: string }[];
};

function creds() {
    const account = envFrom('vtex', 'VTEX_ACCOUNT');
    const key = envFrom('vtex', 'VTEX_APP_KEY');
    const token = envFrom('vtex', 'VTEX_APP_TOKEN');
    if (!account || !key || !token) throw new Error('falta la llave de VTEX: VTEX_ACCOUNT, VTEX_APP_KEY y VTEX_APP_TOKEN en harness/.env.vtex');
    return { account, key, token };
}

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; data: any; text: string }> {
    const { key, token } = creds();
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-VTEX-API-AppKey': key, 'X-VTEX-API-AppToken': token },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* texto plano */ }
    return { status: res.status, data, text };
}

const store = () => `https://${creds().account}.myvtex.com`;
const oms = () => `https://${creds().account}.vtexcommercestable.com.br`;
const payments = () => `https://${creds().account}.vtexpayments.com.br`;

/** El medio de pago «Creditop» y el envío, de la simulación del carrito: no se queman ids que cambian con la cuenta. */
async function simulate(sku: string) {
    const r = await call('POST', `${store()}/api/checkout/pub/orderForms/simulation?sc=1`,
        { items: [{ id: sku, quantity: 1, seller: '1' }], country: 'COL', postalCode: '110111' });
    if (r.status !== 200) throw new Error(`VTEX: la simulación del carrito dio ${r.status}`);
    const pay = (r.data.paymentData?.paymentSystems ?? []).find((p: any) => /creditop/i.test(p.name));
    if (!pay) throw new Error('VTEX: «Creditop» no aparece como medio de pago (¿alguien apagó la condición de pago?)');
    const item = r.data.items?.[0];
    if (!item || item.availability !== 'available') throw new Error(`VTEX: el SKU ${sku} no está disponible`);
    const sla = r.data.logisticsInfo?.[0]?.slas?.[0];
    if (!sla) throw new Error(`VTEX: el SKU ${sku} no tiene envío a Bogotá`);
    return { paymentSystem: Number(pay.id), price: Number(item.sellingPrice ?? item.price), sla: { id: sla.id as string, price: Number(sla.price) } };
}

/* Qué producto comprar: el de VTEX_TEST_SKU si se fijó; si no, el que tenga más stock. Cada pedido aprobado de una
   prueba se queda con su unidad (nadie lo factura ni lo cancela), y el 2026-11-05 la BMX de siempre (SKU 9) llegó a 1:
   de cuatro compras a la vez, tres dieron 400 al crear el pedido. */
async function pickSku(): Promise<string> {
    const fixed = envFrom('vtex', 'VTEX_TEST_SKU');
    if (fixed) return fixed;
    const r = await call('GET', `${store()}/api/catalog_system/pub/products/search?_from=0&_to=49`);
    const items = ((r.data ?? []) as any[]).flatMap((p) => p.items ?? [])
        .map((it: any) => ({ id: String(it.itemId), stock: Number(it.sellers?.[0]?.commertialOffer?.AvailableQuantity ?? 0) }))
        .sort((a, b) => b.stock - a.stock);
    if (!items.length || items[0].stock < 1) throw new Error('VTEX: no hay ningún producto con stock en la tienda de pruebas (hay que reponer el inventario)');
    return items[0].id;
}

/** Una compra con Creditop, como desde el checkout. Devuelve la URL a la que iría el comprador. */
export async function placeVtexOrder(buyer: VtexBuyer, chosen?: string): Promise<VtexOrder> {
    const t0 = Date.now();
    const sku = chosen ?? await pickSku();
    const sim = await simulate(sku);
    const total = sim.price + sim.sla.price;
    const order = {
        items: [{ id: sku, quantity: 1, seller: '1', price: sim.price }],
        clientProfileData: { email: buyer.email, firstName: buyer.firstName, lastName: buyer.lastName, documentType: 'cedulaCOL',
            document: buyer.doc, phone: `+57${buyer.tel}`, isCorporate: false },
        shippingData: { id: 'shippingData',
            address: { addressType: 'residential', receiverName: `${buyer.firstName} ${buyer.lastName}`, postalCode: '110111', city: 'Bogotá',
                state: 'Bogotá, D.C.', country: 'COL', street: 'Calle 100', number: '10', neighborhood: 'Chicó' },
            logisticsInfo: [{ itemIndex: 0, selectedSla: sim.sla.id, price: sim.sla.price }] },
        paymentData: { payments: [{ paymentSystem: sim.paymentSystem, referenceValue: total, value: total, installments: 1 }] },
    };
    // VTEX a veces no crea el pedido con un 500 que pide reintentar («ORD015.6 … Vuelve a intentarlo», visto el
    // 2026-11-05 con cuatro compras a la vez): se reintenta una vez, para no contarlo como una falla del conector.
    let placed = await call('PUT', `${store()}/api/checkout/pub/orders?sc=1`, order);
    if (placed.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000));
        placed = await call('PUT', `${store()}/api/checkout/pub/orders?sc=1`, order);
    }
    if (placed.status !== 201 && placed.status !== 200) {
        const why = (placed.data?.orderForm?.messages ?? placed.data?.messages ?? []).map((m: any) => m.text).filter(Boolean).join(' · ')
            || placed.data?.error?.message || placed.text.slice(0, 200);
        throw new Error(`VTEX: crear el pedido dio ${placed.status} · ${why} (SKU ${sku})`);
    }
    const o = placed.data.orders[0];
    const mt = placed.data.transactionData.merchantTransactions[0];
    const pay = await call('POST', `${payments()}/api/pub/transactions/${mt.transactionId}/payments?orderId=${o.orderGroup}`, [{
        paymentSystem: sim.paymentSystem, installments: 1, currencyCode: 'COP', value: total, installmentsInterestRate: 0,
        installmentsValue: total, referenceValue: total, fields: {}, transaction: { id: mt.transactionId, merchantName: mt.merchantName } }]);
    if (pay.status !== 201 && pay.status !== 200) throw new Error(`VTEX: mandar el pago dio ${pay.status} · ${pay.text.slice(0, 200)}`);
    // El callback espera al authorize del conector. Con un pago en redirect contesta 428 con la URL del comprador.
    const cb = await call('POST', `${store()}/api/checkout/pub/gatewayCallback/${o.orderGroup}`);
    const redirectUrl: string | undefined = cb.data?.RedirectResponseCollection?.[0]?.redirectUrl;
    if (!redirectUrl) throw new Error(`VTEX: el authorize no devolvió adónde mandar al comprador (callback ${cb.status} · ${cb.text.slice(0, 200)}): mirá la transacción ${mt.transactionId}`);
    return { orderId: o.orderId, orderGroup: o.orderGroup, transactionId: mt.transactionId, redirectUrl, total, ms: Date.now() - t0 };
}

const firstAuthorize = (events: { at: string; message: string }[]): number | null => {
    const send = events.find((e) => e.message.startsWith('Sending authorization request'));
    const resp = events.find((e) => e.message.startsWith('Authorization response received'));
    if (!send || !resp) return null;
    return Date.parse(resp.at + 'Z') - Date.parse(send.at + 'Z');
};

/** El pedido y su transacción, como los ve VTEX ahora. Los mensajes van recortados: sin cuerpos ni `?ref=`. */
export async function readVtex(orderId: string): Promise<VtexState> {
    const o = await call('GET', `${oms()}/api/oms/pvt/orders/${encodeURIComponent(orderId)}`);
    if (o.status !== 200) throw new Error(`VTEX: el pedido ${orderId} dio ${o.status}`);
    const tid: string = o.data.paymentData.transactions[0].transactionId;
    const [tx, it, pays] = await Promise.all([
        call('GET', `${payments()}/api/pvt/transactions/${tid}`),
        call('GET', `${payments()}/api/pvt/transactions/${tid}/interactions`),
        call('GET', `${payments()}/api/pvt/transactions/${tid}/payments`),
    ]);
    const events = ((it.data ?? []) as any[])
        .map((e) => ({ at: String(e.Date).slice(0, 23), message: String(e.Message ?? '').replace(/\s+/g, ' ').replace(/\{.*$/, '{…}').replace(/\?ref=\S+/, '?ref=…') }))
        .sort((a, b) => a.at.localeCompare(b.at));
    const cancelDenied = events.map((e) => /Connector Code: (cancellation-not-supported|cancel-manually|CREDITOP_UNAVAILABLE)/.exec(e.message)?.[1]).find(Boolean) ?? null;
    return {
        orderId, orderStatus: o.data.status, transactionId: tid,
        paymentId: (pays.data ?? [])[0]?.id ?? null,
        txStatus: tx.data?.status ?? '?',
        firstAuthorizeMs: firstAuthorize(events),
        proxyTimeout: events.some((e) => /ProxyTimeout/.test(e.message)),
        cancelDenied,
        cancelApproved: events.some((e) => /Cancellation response received: \[200/.test(e.message)) && !cancelDenied,
        ignoredResult: events.some((e) => /cannot advance from Cancelled/i.test(e.message)),
        events,
    };
}

/** Cancela el pedido desde la tienda (como el comercio en el admin): VTEX le pide la cancelación al conector. */
export async function cancelVtexOrder(orderId: string): Promise<void> {
    const r = await call('POST', `${oms()}/api/oms/pvt/orders/${encodeURIComponent(orderId)}/cancel`, { reason: 'Prueba automática del conector Creditop' });
    if (r.status !== 200) throw new Error(`VTEX: cancelar ${orderId} dio ${r.status} · ${r.text.slice(0, 200)}`);
}

/** Espera hasta que el pedido cumpla la condición o se acabe el tiempo; devuelve el último estado leído. */
export async function waitVtex(orderId: string, done: (s: VtexState) => boolean, timeoutMs = 120_000, everyMs = 5_000): Promise<{ ok: boolean; state: VtexState }> {
    const until = Date.now() + timeoutMs;
    let state = await readVtex(orderId);
    while (!done(state) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, everyMs));
        state = await readVtex(orderId);
    }
    return { ok: done(state), state };
}

/** Qué versión del conector (`creditop.creditop`) tiene cada workspace: `installation` (publicada) o `link`. La API de
 *  apps de VTEX IO no acepta la llave en headers: se cambia por un token de VTEX ID. */
export async function connectorVersions(workspaces = ['master', 'develop']): Promise<{ workspace: string; version: string; source: string }[]> {
    const { account, key, token } = creds();
    const login = await fetch(`${oms()}/api/vtexid/apptoken/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appkey: key, apptoken: token }), signal: AbortSignal.timeout(20_000) });
    const io = (await login.json().catch(() => ({})))?.token;
    if (!io) throw new Error(`VTEX ID no dio un token para la llave (${login.status})`);
    return Promise.all(workspaces.map(async (ws) => {
        const r = await fetch(`https://infra.io.vtex.com/apps/v0/${account}/${ws}/apps`, { headers: { Authorization: `Bearer ${io}` }, signal: AbortSignal.timeout(20_000) });
        const app = ((await r.json().catch(() => ({})))?.data ?? []).find((a: any) => String(a.id).startsWith('creditop.creditop@'));
        return { workspace: ws, version: app ? String(app.id).replace('creditop.creditop@', '') : '—', source: app?._source ?? (r.ok ? 'no está' : `HTTP ${r.status}`) };
    }));
}
