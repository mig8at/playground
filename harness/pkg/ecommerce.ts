// ecommerce.ts — arma la URL del checkout ecommerce (contrato base64 + phpSerialize + token).
// Port de ecommerce.go (b64/phpSerialize/branchToken/ecommerceContract/opEcommerceURL).
import { scalar, env } from './db.ts';
import { resolveMerchant, listEcommerce } from './merchants.ts';

export interface PersonalInfo { docType: string; doc: string; name: string; surname: string; email: string; }

export const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** Subconjunto de serialize() de PHP que pide el contrato del plugin ecommerce. Claves ORDENADAS. */
export function phpSerialize(v: unknown): string {
    if (typeof v === 'string') return `s:${Buffer.byteLength(v, 'utf8')}:"${v}";`; // longitud en BYTES
    if (typeof v === 'number' && Number.isInteger(v)) return `i:${v};`;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const obj = v as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        let out = `a:${keys.length}:{`;
        for (const k of keys) out += phpSerialize(k) + phpSerialize(obj[k]);
        return out + '}';
    }
    throw new Error(`phpSerialize: tipo no soportado ${typeof v}`);
}

/** Token ecommerce (texto plano en allied_ecommerce_credentials.credential) de la sucursal. */
export async function branchToken(hash: string): Promise<string> {
    return (await scalar<string>(
        `SELECT aec.credential FROM allied_ecommerce_credentials aec
         JOIN allied_branches ab ON ab.id = aec.allied_branch_id WHERE ab.hash = ? LIMIT 1`,
        [hash],
    )) ?? '';
}

/** Valores base64 del contrato (order/products/token/returnUrl/processUrl/config). `o` lleva orden+monto+moneda+facturación (spec). */
export function ecommerceContract(hash: string, token: string, phone: string, processURL: string, returnURL: string, p: PersonalInfo, total: number): Record<string, string> {
    const order = {
        // order_key ÚNICO por corrida → cada run crea un ecommerce_request FRESCO (processed=0) y el
        // observer re-notifica al cerrar. Con el determinista 'wc_mcp_'+hash el ER se reusaba entre runs
        // y, una vez processed=1, la idempotencia del observer saltaba la notificación.
        id: 5002, order_key: 'wc_mcp_' + hash + '_' + Date.now().toString(36), total: String(total), currency: 'COP',
        billing: {
            first_name: p.name, last_name: p.surname, phone,
            email: p.email, document_type: p.docType, document_number: p.doc,
        },
    };
    // productos de mentiras (solo para el ejercicio): 2 ítems que suman el total.
    const big = Math.round(total * 0.7);
    const products = JSON.stringify([
        { product_id: 101, name: 'Smartphone Demo X', sku: 'SKU-DEMO-X', price: String(big), quantity: 1 },
        { product_id: 102, name: 'Funda + protector de pantalla', sku: 'SKU-ACC-01', price: String(total - big), quantity: 1 },
    ]);
    const configJSON = JSON.stringify([]);
    return {
        order: b64(phpSerialize(order)),
        products: b64(products),
        token: b64(token),
        returnUrl: b64(phpSerialize(returnURL)),
        processUrl: b64(processURL),
        config: b64(phpSerialize(configJSON)),
    };
}

export interface EcommerceUrl { merchant: string; hash: string; amount: number; phone: string; checkout_path: string; }

/** Arma la URL del CHECKOUT que abre el wizard: /ecommerce/{hash}/checkout?o=…&t=… Port de opEcommerceURL. */
export async function buildEcommerceUrl(merchantQ: string, phone = '', amount = 0): Promise<EcommerceUrl> {
    const branches = await listEcommerce(merchantQ);
    if (branches.length === 0) throw new Error(`no hay sucursal con credencial ecommerce para ${JSON.stringify(merchantQ)}`);
    let b = branches[0];
    // preferir una branch ecommerce del MISMO allied que el comercio principal
    try {
        const m = await resolveMerchant(merchantQ);
        const same = branches.find((c) => c.allied_id === m.alliedId);
        if (same) b = same;
    } catch { /* sin match principal: queda branches[0] */ }

    const token = await branchToken(b.hash);
    if (!token) throw new Error(`sin token ecommerce para ${b.name} (${b.hash})`);

    const ph = phone || '3131010101';
    const amt = amount || 600000;
    // billing del contrato → pre-llena (y bloquea) el form personal-info del wizard. document_number configurable
    // con E2E_DOC (default sintético). En el harness, synthFill luego fija el doc real del user para el buró.
    const p: PersonalInfo = { docType: 'CC', doc: process.env.E2E_DOC || '1032456789', name: 'SYNTH', surname: 'ECOM', email: 'synth-ecom@creditop.com' };
    // process_url al que el backend notifica al sellar Estado 11 (configurable con E2E_WEBHOOK_URL).
    // ecommerce_id=1 (Woo) concatena el order_identifier al process_url → normalizamos con '/' final
    // para que un receptor tipo webhook.site capture la notificación en .../{token}/{orderId}.
    // E2E_WEBHOOK_URL / E2E_RETURN_URL salen de .env.<target> vía env() (process.env tiene prioridad para
    // overrides inline). Default del .env.dev/.env.local: webhook.site.
    const rawHook = env('E2E_WEBHOOK_URL', 'https://tienda-mcp.test/webhook');
    const processURL = rawHook.endsWith('/') ? rawHook : rawHook + '/';
    // return_url = destino del botón "volver al comercio" en loan-approved (configurable con E2E_RETURN_URL).
    const returnURL = env('E2E_RETURN_URL', 'https://tienda-mcp.test/return');
    const c = ecommerceContract(b.hash, token, ph, processURL, returnURL, p, amt);

    const v = new URLSearchParams({ o: c.order, p: c.products, t: c.token, u: c.returnUrl, ps: c.processUrl, config: c.config });
    return { merchant: b.name, hash: b.hash, amount: amt, phone: ph, checkout_path: `/ecommerce/${b.hash}/checkout?${v.toString()}` };
}

export interface VtexInitResult {
    merchant: string;
    hash: string;
    amount: number;
    authorizationId: number;
    redirectUrl: string;
    checkout_path: string;
}

/**
 * Crea la URL base64 llamando al `/vtex/init` REAL de legacy (NO la arma local): el harness actúa
 * como el conector VTEX. legacy valida partnerKey/secretToken, crea el EcommerceRequest (ecommerce_id
 * desde la credencial) y devuelve el `redirectUrl` base64. Devolvemos también el `checkout_path`
 * (path+query) para `page.goto` — el host del redirectUrl es el frontend configurado en legacy
 * (ECOMMERCE_FRONTEND_URL), pero abrimos el path en el FE local (Playwright resuelve contra baseURL).
 *
 * Ejercita el flujo MIGRADO (legacy genera la URL), a diferencia de buildEcommerceUrl que la arma local.
 * Las rutas /vtex/* viven en la RAÍZ de legacy (webhooks.php), no bajo /api → base = E2E_MOCK_URL.
 */
export async function vtexInit(
    merchantQ: string,
    opts: { amount?: number; processURL?: string; returnURL?: string } = {},
): Promise<VtexInitResult> {
    const branches = await listEcommerce(merchantQ);
    if (branches.length === 0) throw new Error(`no hay sucursal con credencial ecommerce para ${JSON.stringify(merchantQ)}`);
    let b = branches[0];
    try {
        const m = await resolveMerchant(merchantQ);
        const same = branches.find((c) => c.allied_id === m.alliedId);
        if (same) b = same;
    } catch { /* sin match principal: queda branches[0] */ }

    const token = await branchToken(b.hash);
    if (!token) throw new Error(`sin token ecommerce para ${b.name} (${b.hash})`);

    const amount = opts.amount || 600000;
    const base = (process.env.E2E_MOCK_URL ?? 'http://localhost').replace(/\/$/, '');
    const payload = {
        paymentId: 'vtex_fe_' + b.hash,
        orderId: 'vtex_fe_ord_' + b.hash,
        value: amount,
        currency: 'COP',
        partnerKey: b.hash,
        secretToken: token,
        callbackUrl: opts.processURL ?? env('E2E_WEBHOOK_URL', 'https://tienda-e2e.test/webhook'),
        returnUrl: opts.returnURL ?? env('E2E_RETURN_URL', 'https://tienda-e2e.test/return'),
        products: [{ product_id: 101, name: 'Producto VTEX FE', sku: 'SKU-VTEX-FE', price: String(amount), quantity: 1 }],
    };

    const res = await fetch(`${base}/vtex/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.status !== 200 || !json.redirectUrl) {
        throw new Error(`/vtex/init falló: HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    }

    const u = new URL(json.redirectUrl);
    return {
        merchant: b.name,
        hash: b.hash,
        amount,
        authorizationId: Number(json.authorizationId),
        redirectUrl: json.redirectUrl,
        checkout_path: u.pathname + u.search,
    };
}
