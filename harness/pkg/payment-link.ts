/**
 * payment-link.ts — lo que hace `POST /api/ecommerce/payment-link` (CORE-746, legacy-backend#1682), en la base:
 * valida el cuerpo, comprueba sucursal y credencial, rechaza un `order_key` repetido y guarda el pedido en
 * `ecommerce_requests` con `origin = 'payment_link'`, una referencia UUID y su vencimiento. Devuelve lo mismo que la
 * API: `redirect_url` con `?ref=`, `order_key`, `status: PENDING` y `expires_at`.
 *
 * Lo copia de `EcommercePaymentLinkService::create` y `CreatePaymentLinkRequest` de esa rama (revisado el 2026-10-19).
 * Dos diferencias a propósito, porque es un mock local:
 *   · el Bearer es la credencial de la sucursal (`allied_ecommerce_credentials.credential`), no un token Sanctum con
 *     la ability `ecommerce` (eso lo emite `ecommerce:issue-token`, que todavía no está en local);
 *   · `return_url`, `webhook_url` y `back_url` aceptan `http://` de localhost y host.docker.internal: la API exige
 *     `https://`, y lo avisa en `warnings`.
 *
 * ESCRIBE: sólo en local. Lo usan el mock (mock-payment-link/server.ts) y dev/payment-link.ts.
 */
import { randomUUID } from 'node:crypto';
import { env, exec, one, query, TARGET } from './db.ts';

export const PAYMENT_LINK_TTL_MINUTES = 60;
const BILLING_KEYS = ['email', 'phone', 'first_name', 'last_name', 'document_type', 'document_number',
    'document_expedition_date', 'birth_date'] as const;

export interface PaymentLinkInput {
    hash: string;
    order_key: string;
    id?: string | number;
    total: number;
    termAccepted?: string;
    policyAccepted?: string;
    billing: Partial<Record<(typeof BILLING_KEYS)[number], string>>;
    products?: unknown[];
    return_url: string;
    webhook_url: string;
    back_url?: string;
}

export interface PaymentLinkResult {
    status: number;
    body: Record<string, unknown>;
    /** Lo que la API de verdad rechazaría y el mock deja pasar. */
    warnings: string[];
    /** Para la tienda demo: qué fila quedó y con qué origen. */
    row?: { id: number; allied_branch_id: number; ecommerce_id: number; origin: string };
}

const isoWithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const ymd = /^\d{4}-\d{2}-\d{2}$/;
const localHttp = /^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\//;

/** Las reglas de `CreatePaymentLinkRequest`: devuelve los errores por campo (vacío = válido). */
export function validatePaymentLink(input: any, warnings: string[]): Record<string, string[]> {
    const errors: Record<string, string[]> = {};
    const add = (k: string, m: string) => { (errors[k] ||= []).push(m); };
    const str = (k: string, v: unknown, required: boolean) => {
        if (v === undefined || v === null || v === '') { if (required) add(k, `The ${k} field is required.`); return; }
        if (typeof v !== 'string') add(k, `The ${k} field must be a string.`);
        else if (v.length > 255) add(k, `The ${k} field must not be greater than 255 characters.`);
    };
    const url = (k: string, v: unknown, required: boolean) => {
        str(k, v, required);
        if (typeof v !== 'string' || !v) return;
        if (v.startsWith('https://')) return;
        if (localHttp.test(v)) { warnings.push(`${k}: la API exige https://; el mock acepta ${v} por ser local`); return; }
        add(k, `The ${k} field must start with https://.`);
    };
    if (!input || typeof input !== 'object') return { body: ['The body must be a JSON object.'] };
    if (typeof input.id === 'number') input.id = String(input.id);
    str('hash', input.hash, true);
    str('order_key', input.order_key, true);
    str('id', input.id, false);
    if (input.total === undefined || input.total === null || input.total === '') add('total', 'The total field is required.');
    else if (!Number.isFinite(Number(input.total))) add('total', 'The total field must be a number.');
    else if (Number(input.total) <= 0) add('total', 'The total field must be greater than 0.');
    for (const k of ['termAccepted', 'policyAccepted']) {
        if (input[k] != null && !(typeof input[k] === 'string' && isoWithOffset.test(input[k]))) {
            add(k, `The ${k} field must match the format Y-m-d\\TH:i:sP.`);
        }
    }
    if (input.billing === undefined || input.billing === null || typeof input.billing !== 'object' || Array.isArray(input.billing)) {
        add('billing', 'The billing field must be present and be an array.');
    } else {
        for (const k of BILLING_KEYS) {
            const v = input.billing[k];
            if (v == null) continue;
            if (typeof v !== 'string') add(`billing.${k}`, `The billing.${k} field must be a string.`);
            else if ((k === 'document_expedition_date' || k === 'birth_date') && !ymd.test(v)) {
                add(`billing.${k}`, `The billing.${k} field must match the format Y-m-d.`);
            }
        }
    }
    if (input.products != null && !Array.isArray(input.products)) add('products', 'The products field must be a list.');
    url('return_url', input.return_url, true);
    url('webhook_url', input.webhook_url, true);
    url('back_url', input.back_url, false);
    return errors;
}

/** El pedido como lo guarda la API: JSON puro, `billing` filtrado, y las aceptaciones y `back_url` sólo si llegaron. */
function buildOrder(input: PaymentLinkInput): Record<string, unknown> {
    const billing: Record<string, string> = {};
    for (const k of BILLING_KEYS) if (input.billing[k] != null) billing[k] = input.billing[k] as string;
    const order: Record<string, unknown> = {
        id: String(input.id ?? input.order_key),
        order_key: String(input.order_key),
        total: input.total,
        billing,
    };
    for (const k of ['termAccepted', 'policyAccepted', 'back_url'] as const) if (input[k] != null) order[k] = input[k];
    return order;
}

/** El equivalente de `expires_at` en -05:00 (`setTimezone('America/Bogota')->toIso8601String()`). */
function bogotaIso(d: Date): string {
    return new Date(d.getTime() - 5 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '-05:00');
}

export function wizardBase(): string {
    return env('E2E_BASE_URL', 'http://localhost:5174').replace(/\/$/, '');
}

/**
 * Crea el pedido como `POST /api/ecommerce/payment-link`. `bearer` es lo que viene en `Authorization: Bearer …`.
 * Opciones de prueba: `expired` deja la referencia vencida.
 */
export async function createPaymentLink(input: any, bearer: string, opts: { expired?: boolean } = {}): Promise<PaymentLinkResult> {
    if (TARGET !== 'local') {
        return { status: 500, body: { message: `el mock sólo escribe en local (E2E_TARGET=${TARGET})` }, warnings: [] };
    }
    const warnings: string[] = [];
    if (!bearer) return { status: 401, body: { message: 'Unauthenticated.' }, warnings };

    const errors = validatePaymentLink(input, warnings);
    if (Object.keys(errors).length) {
        return { status: 422, body: { message: Object.values(errors)[0][0], errors }, warnings };
    }

    // El token es de la sucursal: en la API, el dueño del token Sanctum; acá, la sucursal de esa credencial. En local
    // la misma credencial se repite entre sucursales (la base es una copia de dev), así que se busca la del `hash`.
    const owners = await query<{ id: number; allied_id: number; hash: string; ecommerce_type_id: string }>(
        `SELECT ab.id, ab.allied_id, ab.hash, aec.ecommerce_type_id FROM allied_ecommerce_credentials aec
         JOIN allied_branches ab ON ab.id = aec.allied_branch_id WHERE aec.credential = ?`, [bearer]);
    if (!owners.length) return { status: 401, body: { message: 'Unauthenticated.' }, warnings };
    const tokenBranch = owners.find(o => o.hash === input.hash);
    if (!tokenBranch) {
        return { status: 403, body: { error: 'Forbidden', message: 'This action is unauthorized.' }, warnings };
    }

    const orderKey = String(input.order_key);
    const exists = await one('SELECT id FROM ecommerce_requests WHERE allied_branch_id = ? AND order_key = ? LIMIT 1',
        [tokenBranch.id, orderKey]);
    if (exists) {
        return { status: 409, body: { error: 'TransactionAlreadyExists', message: 'A transaction with this order_key already exists.' }, warnings };
    }

    const order = buildOrder(input as PaymentLinkInput);
    const reference = randomUUID();
    const expiresAt = new Date(Date.now() + (opts.expired ? -60_000 : PAYMENT_LINK_TTL_MINUTES * 60_000));
    const ecommerceId = Number(tokenBranch.ecommerce_type_id);
    const { insertId } = await exec(
        `INSERT INTO ecommerce_requests (order_key, order_identifier, allied_id, allied_branch_id, ecommerce_id, data, products,
           return_url, process_url, processed, origin, checkout_reference, reference_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'payment_link', ?, NOW() + INTERVAL ? MINUTE, NOW(), NOW())`,
        [orderKey, order.id, tokenBranch.allied_id, tokenBranch.id, ecommerceId, JSON.stringify(order),
            // El vencimiento con el reloj de la base, el mismo que mira la entrada por referencia en local.
            JSON.stringify(input.products ?? []), input.return_url, input.webhook_url, reference,
            opts.expired ? -1 : PAYMENT_LINK_TTL_MINUTES],
    );

    return {
        status: 200,
        body: {
            redirect_url: `${wizardBase()}/ecommerce/${tokenBranch.hash}/checkout?ref=${reference}`,
            order_key: orderKey,
            status: 'PENDING',
            expires_at: bogotaIso(expiresAt),
        },
        warnings,
        row: { id: insertId, allied_branch_id: tokenBranch.id, ecommerce_id: ecommerceId, origin: 'payment_link' },
    };
}
