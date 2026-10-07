// ecommerce.ts — arma la URL del checkout ecommerce (contrato base64 + phpSerialize + token).
// Port de ecommerce.go (b64/phpSerialize/branchToken/ecommerceContract/opEcommerceURL).
import { createHmac } from 'node:crypto';
import { config } from './config.ts';
import { scalar, env, appKey, isLocalDb } from './db.ts';
import { decryptLaravelString } from './laravel-crypt.ts';
import { resolveMerchant, listEcommerce } from './merchants.ts';

export interface PersonalInfo {
    docType: string; doc: string; name: string; surname: string; email: string;
    /** `YYYY-MM-DD`. Sólo la manda el auto-onboarding: con ella el comprador no llena el formulario personal. */
    expeditionDate?: string;
    /** `YYYY-MM-DD`. También sólo del auto-onboarding: la exigen las sucursales con Welli, Credifamilia… */
    birthDate?: string;
}

export const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** Subconjunto de serialize() de PHP que pide el contrato del plugin ecommerce. Claves ORDENADAS. */
export function phpSerialize(v: unknown): string {
    if (typeof v === 'string') return `s:${Buffer.byteLength(v, 'utf8')}:"${v}";`; // longitud en BYTES
    if (typeof v === 'number' && Number.isInteger(v)) return `i:${v};`;
    if (typeof v === 'boolean') return `b:${v ? 1 : 0};`;
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

/**
 * Cómo firma la tienda el pedido (auto-onboarding SIN OTP, `MerchantOrderSignatureService` del backend):
 * `valid` firma con el secreto de la credencial · `invalid` firma con otro (el backend debe caer al OTP) ·
 * `none` no manda `verification` (el OTP de siempre).
 */
export type MerchantSignature = 'valid' | 'invalid' | 'none';

export function merchantSignatureMode(): MerchantSignature {
    const v = (process.env.E2E_MERCHANT_SIGNATURE || '').trim();
    return v === 'valid' || v === 'invalid' ? v : 'none';
}

/**
 * El secreto de firma de la sucursal (`allied_ecommerce_credentials.signing_secret`, cifrado con el APP_KEY).
 * SÓLO en local: en un ambiente compartido el secreto es del comercio y no se lee. Vacío = la credencial no
 * tiene (se genera con `php artisan ecommerce:signing-secret <hash>`) o la columna no existe en esa rama.
 */
export async function branchSigningSecret(hash: string): Promise<string> {
    if (!isLocalDb()) return '';
    const encrypted = await scalar<string>(
        `SELECT aec.signing_secret FROM allied_ecommerce_credentials aec
         JOIN allied_branches ab ON ab.id = aec.allied_branch_id WHERE ab.hash = ? LIMIT 1`,
        [hash],
    ).catch(() => null);
    return encrypted ? decryptLaravelString(encrypted, appKey()) : '';
}

/**
 * Lo que declara la tienda de la aceptación de los documentos, en `order.verification` (constancia; el salto del OTP
 * lo decide sólo la firma).
 * Las versiones son las de los documentos acordados con Refurbi (`E2E_TERMS_VERSION`, `E2E_PRIVACY_POLICY_VERSION`).
 */
export function merchantVerification(now = new Date()): Record<string, unknown> {
    return {
        terms_accepted_at: new Date(now.getTime() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        terms_version: process.env.E2E_TERMS_VERSION || 'V20260206',
        privacy_policy_version: process.env.E2E_PRIVACY_POLICY_VERSION || 'V20260206',
    };
}

/**
 * La firma de la tienda, el esquema de los eventos CreditopX que verifica el backend (`MerchantOrderSignatureService`):
 * `v1=` + HMAC-SHA256 de `v1\n{ts}\n{o}`, con el `o` (base64) tal cual viaja en la URL.
 */
export function signOrderParam(orderParam: string, secret: string, now = new Date()): { sig: string; ts: string } {
    const ts = String(Math.floor(now.getTime() / 1000));
    return { ts, sig: 'v1=' + createHmac('sha256', secret).update(`v1\n${ts}\n${orderParam}`).digest('hex') };
}

/**
 * El secreto con que firma la tienda según `E2E_MERCHANT_SIGNATURE` (auto-onboarding sin OTP): vacío = sin firma;
 * `invalid` firma con un secreto que no es el de la credencial (el backend debe caer al OTP).
 */
export async function merchantSigningSecret(hash: string, name = hash): Promise<string> {
    const mode = merchantSignatureMode();
    if (mode === 'none') return '';
    const secret = await branchSigningSecret(hash);
    if (!secret) throw new Error(`la credencial de ${name} (${hash}) no tiene secreto de firma en local: `
        + `docker exec legacy-backend-laravel.test-1 php artisan ecommerce:signing-secret ${hash}`);
    return mode === 'invalid' ? 'no-es-el-secreto-' + secret : secret;
}

/** La query del checkout de la tienda, con la firma (`sig`/`ts`) cuando la hay. */
export function checkoutQuery(c: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ o: c.order, p: c.products, t: c.token, u: c.returnUrl, ps: c.processUrl, config: c.config,
        ...(c.sig ? { sig: c.sig, ts: c.ts } : {}) });
}

/** Valores base64 del contrato (order/products/token/returnUrl/processUrl/config). `o` lleva orden+monto+moneda+facturación (spec). */
export function ecommerceContract(hash: string, token: string, phone: string, processURL: string, returnURL: string, p: PersonalInfo, total: number, signingSecret = ''): Record<string, string> {
    const order: { order_key: string; total: string; billing: Record<string, string | undefined>; [k: string]: unknown } = {
        // order_key ÚNICO por corrida → cada run crea un ecommerce_request FRESCO (processed=0) y el
        // observer re-notifica al cerrar. Con el determinista 'wc_mcp_'+hash el ER se reusaba entre runs
        // y, una vez processed=1, la idempotencia del observer saltaba la notificación.
        id: 5002, order_key: 'wc_mcp_' + hash + '_' + Date.now().toString(36), total: String(total), currency: 'COP',
        billing: {
            first_name: p.name, last_name: p.surname, phone,
            email: p.email, document_type: p.docType, document_number: p.doc,
            ...(p.expeditionDate ? { document_expedition_date: p.expeditionDate } : {}),
            ...(p.birthDate ? { birth_date: p.birthDate } : {}),
        },
    };
    // Lo que la tienda declara va DENTRO del pedido; la firma, afuera (`sig`/`ts`), sobre el `o` ya armado.
    if (signingSecret) order.verification = merchantVerification();
    // productos de mentiras (solo para el ejercicio): 2 ítems que suman el total.
    const big = Math.round(total * 0.7);
    const products = JSON.stringify([
        { product_id: 101, name: 'Smartphone Demo X', sku: 'SKU-DEMO-X', price: String(big), quantity: 1 },
        { product_id: 102, name: 'Funda + protector de pantalla', sku: 'SKU-ACC-01', price: String(total - big), quantity: 1 },
    ]);
    const configJSON = JSON.stringify([]);
    const orderParam = b64(phpSerialize(order));
    return {
        order: orderParam,
        ...(signingSecret ? signOrderParam(orderParam, signingSecret) : {}),
        products: b64(products),
        token: b64(token),
        returnUrl: b64(phpSerialize(returnURL)),
        processUrl: b64(processURL),
        config: b64(phpSerialize(configJSON)),
    };
}

export interface EcommerceUrl { merchant: string; hash: string; amount: number; phone: string; checkout_path: string; }

/**
 * La identidad que el COMERCIO dice conocer del comprador — la que viaja en `billing` y que el wizard
 * usa para prellenar (y bloquear) el formulario.
 *
 * Sale del caso del panel (`E2E_SYNTH_*`) cuando lo hay. Antes era fija, y eso rompía en silencio lo
 * único que el canal promete: correr LA MISMA identidad por la puerta del asesor y por la de la tienda
 * para poder compararlas. El panel decía «CC 2941056394 · SYNTH TEST USER» y por la tienda entraba
 * «CC 1032456789 · SYNTH ECOM» — dos personas distintas, y ningún error a la vista.
 *
 * `E2E_DOC` gana sobre el caso a propósito: es el override por corrida de `dev/ecommerce.ts`, que
 * necesita un documento nuevo cada vez (son UNIQUE en `users`).
 */
export function caseIdentity(): PersonalInfo {
    const parts = (process.env.E2E_SYNTH_NAME || '').trim().split(/\s+/).filter(Boolean);
    const doc = process.env.E2E_DOC || process.env.E2E_SYNTH_DOC || '1032456789';
    return {
        docType: process.env.E2E_SYNTH_DOCTYPE || 'CC',
        doc,
        name: parts[0] || 'SYNTH',
        surname: parts.slice(1).join(' ') || 'ECOM',
        // El default sigue el documento para que dos casos distintos no compartan correo: es UNIQUE.
        email: process.env.E2E_SYNTH_EMAIL || (parts.length ? `synth-${doc}@creditop.com` : 'synth-ecom@creditop.com'),
        // Sólo en el auto-onboarding (`bin/auto-onboarding`): el canal ecommerce de siempre NO la manda, así
        // una sucursal habilitada para el auto se sigue pudiendo probar por la puerta normal.
        expeditionDate: process.env.E2E_AUTO_ONBOARDING === '1' ? (process.env.E2E_SYNTH_EXP || '2010-01-01') : undefined,
        // La de nacimiento, la misma persona que el caso: su fecha o, si no, la que da su edad.
        // `E2E_AUTO_NO_BIRTH=1` la omite, para probar la tienda que no la manda.
        birthDate: process.env.E2E_AUTO_ONBOARDING === '1' && process.env.E2E_AUTO_NO_BIRTH !== '1' ? caseBirthDate() : undefined,
    };
}

function caseBirthDate(): string {
    if (process.env.E2E_SYNTH_DOB) return process.env.E2E_SYNTH_DOB;
    const age = Number(process.env.E2E_SYNTH_AGE);
    if (!age) return '1990-01-01';
    const d = new Date(); d.setFullYear(d.getFullYear() - age); d.setMonth(0, 1);
    return d.toISOString().slice(0, 10);
}

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
    const p: PersonalInfo = caseIdentity();
    // process_url al que el backend notifica al sellar Estado 11 (configurable con E2E_WEBHOOK_URL).
    // ecommerce_id=1 (Woo) concatena el order_identifier al process_url → normalizamos con '/' final
    // para que un receptor tipo webhook.site capture la notificación en .../{token}/{orderId}.
    // E2E_WEBHOOK_URL / E2E_RETURN_URL salen de .env.<target> vía env() (process.env tiene prioridad para
    // overrides inline). Default del .env.dev/.env.local: webhook.site.
    const rawHook = env('E2E_WEBHOOK_URL', 'https://tienda-mcp.test/webhook');
    const processURL = rawHook.endsWith('/') ? rawHook : rawHook + '/';
    // return_url = destino del botón "volver al comercio" en loan-approved (configurable con E2E_RETURN_URL).
    const returnURL = env('E2E_RETURN_URL', 'https://tienda-mcp.test/return');
    const c = ecommerceContract(b.hash, token, ph, processURL, returnURL, p, amt, await merchantSigningSecret(b.hash, b.name));
    const v = checkoutQuery(c);
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
    // El backend DEL TARGET, por la única cadena que lo resuelve (`pkg/config.ts`).
    //
    // ⚠ Antes era `process.env.E2E_MOCK_URL ?? 'http://localhost'`, y eso se salta la cadena: `env()`
    // NO escribe en `process.env`, y `E2E_MOCK_URL` sólo existe en `.env.local`. O sea que este POST
    // iba a **localhost en los cuatro targets** — medido el 2026-09-15. Con `E2E_TARGET=qa` (la forma
    // documentada de apuntar un spec a otro ambiente) el token de la sucursal se leía de la base
    // COMPARTIDA y el `/vtex/init` se posteaba al backend LOCAL: la misma mezcla huérfana de F-65, por
    // un camino que ese arreglo no cubría. `dev/sweep.ts` ya había pagado este pozo.
    const base = config.mockUrl;
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

/**
 * El contrato del checkout como PARAMS, para los specs de `channel/`.
 *
 * Existe para sacarlos de `generate_checkout_url.php`, que era una dependencia con tres defectos:
 * vivía en una ruta ABSOLUTA fuera del repo (y se movió, dejando specs apuntando a la nada), pedía
 * `php` instalado, y sobre todo usaba un **`order_key` FIJO** — así que el `upsert` caía siempre en la
 * MISMA fila de `ecommerce_requests` y, con `processed = 1` de una corrida vieja, la notificación al
 * comercio ya no se disparaba. Es el mismo defecto que `ecommerceContract` documenta arriba y que
 * resolvió con una clave única por corrida.
 */
export async function contractForSpec(
    merchantQ = 'amoblar',
    options: { processUrl?: string; amount?: number; phone?: string } = {},
) {
    if (options.processUrl) process.env.E2E_WEBHOOK_URL = options.processUrl;
    // `phone` viaja DENTRO del contrato (billing.phone) porque así funciona el canal: el comercio ya
    // conoce al comprador y el wizard recibe el campo prellenado y BLOQUEADO. Un spec que necesite un
    // celular único por corrida —lo son en `users`— tiene que ponerlo acá, no tipearlo en la pantalla.
    const u = await buildEcommerceUrl(merchantQ, options.phone ?? '', options.amount ?? 600_000);
    const q = new URLSearchParams(u.checkout_path.split('?')[1]);
    return {
        hash: u.hash,
        amount: u.amount,
        o: q.get('o') ?? '', p: q.get('p') ?? '', t: q.get('t') ?? '',
        u: q.get('u') ?? '', ps: q.get('ps') ?? '', config: q.get('config') ?? '',
        checkout_path: u.checkout_path,
    };
}
