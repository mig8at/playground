// checkout-b64.ts — arma la entrada del checkout de **CORBETA**: la URL base64 que su tienda genera
// para mandar al cliente al wizard.
//
// ⚠⚠ NO ES «EL» CHECKOUT DE ECOMMERCE: ES UNO DE DOS, Y VAN A CONTROLADORES DISTINTOS.
//
//     este archivo        → GET `/api/onboarding/checkout/{hash}`        → CorbetaCheckoutController@show
//                           302 a `…/resolve-ecommerce-flow/{uReq}` (el resolvedor de BANCOLOMBIA)
//     `pkg/ecommerce.ts`  → GET `/ecommerce/{hash}/checkout` (el FRONT)  → `ecommerce-request/create`
//                           302 a `…/solicitar?erId=…` (el canal genérico, el de la tarea #6)
//
// Elegir el equivocado no da un error: da OTRO FLOW. Con un comercio que no es Corbeta, el resolvedor
// saca `flowType: no_preapproved` y su propio loader llama `cancelCorbetaCheckout` — **la solicitud
// nace CANCELADA** y el harness lo reporta como si el producto la hubiera rechazado.
//
// CÓMO SABER CUÁL ARMÓ UNA URL que estás mirando, sin decodificar nada: el `order_key`.
//     `wc_order_e2e_<documento>`      → este archivo (Corbeta)
//     `wc_mcp_<hash>_<timestamp36>`   → `pkg/ecommerce.ts` (genérico)
// Saber eso costó decodificar base64 a mano el 2026-09-14.
//
// POR QUÉ EXISTE:
//   Hasta ahora el harness solo entraba por el login del asesor. La entrada real de ecommerce es otra:
//   la tienda arma una URL con el pedido serializado en base64, el backend la decodifica, CREA la
//   solicitud y redirige al wizard. Sin esto, todo el tramo tienda→backend→wizard quedaba sin probar.
//
// QUIÉN PRODUCE ESTA URL DE VERDAD: el plugin de WooCommerce que instala el comercio
//   (`class-creditop-gateway.php:470-512`). Es la fuente autoritativa del contrato — esto lo imita. Su
//   copia se borró del playground el 2026-09-24: `git show 2b9d13be:creditop-woocommerce/class-creditop-gateway.php`.
//   Dos diferencias reconciliadas contra él:
//   · SERIALIZACIÓN: cada parámetro va distinto en el original. El mapa exacto (del plugin y de
//     `github/generate_checkout_url.php`, que coinciden):
//         o      base64(  serialize(orden)          )   ← PHP serialize
//         u      base64(  serialize(return_url)     )   ← PHP serialize
//         p      base64(  json_encode(productos)    )   ← JSON
//         config base64(  serialize(json_encode(…)) )   ← ¡las dos!
//         t, ps  base64(  string crudo              )   ← sin serializar
//     Acá va todo JSON y el backend lo acepta igual: `deserializeData` (:767-787) intenta
//     `unserialize`, cae a `json_decode`, y castea array→objeto en ambos casos. Si algún día valida
//     más estrictamente, ESTE es el mapa a respetar.
//   · DESTINO: el plugin apunta a `{front}/ecommerce/{hash}/checkout` (la LANDING del wizard); acá
//     pegamos al endpoint del BACKEND de Corbeta.
//     ⚠ El motivo original de hacerlo así CADUCÓ el 2026-09-14: decía que esa landing «no existe en la
//     rama actual, vive sólo en `feat/ecommerce-checkout-integration` (F-54)», y ya está en `qa`
//     (frontend-monorepo#997). Quien quiera la landing genérica hoy usa `pkg/ecommerce.ts`; este
//     archivo se queda porque el checkout de Corbeta SIGUE siendo otro endpoint y otro flujo.
//
// CONTRATO (leído de Modules/Onboarding/App/Http/Controllers/CorbetaCheckoutController.php:119-146):
//   GET /api/onboarding/checkout/{allied_branch_hash}?o=&p=&t=&u=&ps=[&config=]
//     o  = order      (JSON b64) — DEBE traer `billing` y `total`, si no: SP20754
//     p  = products   (JSON b64)
//     t  = token      (string b64)
//     u  = return_url (string b64) — a dónde vuelve el cliente al terminar
//     ps = process_endpoint (string b64) — el webhook de la tienda
//   Falta cualquiera de los 5 → SP20754 sin más explicación.
//
//   Responde 302 a  {FRONTEND_URL_DEV}/bancolombia/self-service/{hash}/resolve-ecommerce-flow/{uReq}
//   (CorbetaCheckoutController:1250). Esa ruta SÍ existe en la rama actual del wizard, así que el flujo
//   sigue desde ahí — lo que NO existe hoy es la landing `/{hash}/checkout` (solo vive en la rama
//   `feat/ecommerce-checkout-integration`, de abril). Ver findings F-40.
//
// GOTCHAS que ya costaron un intento fallido:
//   · Si el teléfono/documento ya tiene usuario, el backend corta con BP12700001 "user conflict"
//     (CorbetaCheckoutController:265) y te manda a una pantalla de error. Scrubbeá antes.
//   · En LOCAL, `resolveFrontendBaseUrl()` cae al default `originaciones.dev.creditop.com`: sin
//     FRONTEND_URL_DEV en legacy-backend/.env el flujo se te ESCAPA A DEV sin avisar.

import { env } from './db.ts';

const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64');

export type Order = {
    total: number;
    phone: string;
    documentNumber: string;
    documentType?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    returnUrl?: string;
    processEndpoint?: string;
    productos?: Array<{ id: number; name: string; qty: number; price: number }>;
};

/** Arma la URL de checkout tal como la generaría la tienda. */
export function urlCheckout(branchHash: string, p: Order): string {
    // OJO: E2E_API_BASE_URL ya trae `/api` en local (`http://localhost/api`) pero no siempre en otros
    // targets. Normalizamos a la RAÍZ y agregamos `/api` nosotros, para no armar `/api/api/…` (404 mudo).
    const api = (env('E2E_API_BASE_URL') || 'http://localhost').replace(/\/+$/, '').replace(/\/api$/, '');
    // Forma FIEL de una orden WooCommerce. Salió de cruzar el plugin real
    // (`class-creditop-gateway.php`, hoy en la historia de git) con `generate_checkout_url.php`.
    // El backend solo mira `billing` y `total`, pero mandar la forma completa evita falsos negativos
    // el día que valide algo más. OJO: `total` va como STRING — así lo manda WooCommerce.
    const order = {
        id: Number(String(p.documentNumber).slice(-6)) || 365,
        parent_id: 0,
        status: 'pending',
        currency: 'COP',
        version: '9.4.4',
        prices_include_tax: false,
        discount_total: '0', discount_tax: '0',
        shipping_total: '0', shipping_tax: '0', cart_tax: '0', total_tax: '0',
        total: String(p.total),
        customer_id: 0,
        order_key: `wc_order_e2e_${p.documentNumber}`,
        billing: {
            first_name: p.firstName ?? 'SYNTH',
            last_name: p.lastName ?? 'TEST USER',
            company: 'Empresa Test',
            address_1: 'Calle Falsa 123',
            address_2: 'Apto 101',
            city: 'bogota',
            state: 'CO-CUN',
            postcode: '1110111',
            country: 'CO',
            email: p.email ?? `synth-${p.documentNumber}@creditop.com`,
            phone: p.phone,
            document_type: p.documentType ?? 'CC',
            document_number: p.documentNumber,
        },
        payment_method: 'creditop_gateway',
        payment_method_title: 'Paga a cuotas con Creditop',
    };
    const products = p.productos ?? [{ id: 1, name: 'Producto de prueba', qty: 1, price: p.total }];
    const q = new URLSearchParams({
        o: b64(order),
        p: b64(products),
        t: b64(`tok-e2e-${p.documentNumber}`),
        u: b64(p.returnUrl ?? 'http://localhost:8090/gracias'),
        ps: b64(p.processEndpoint ?? 'http://localhost:8090/webhook'),
    });
    return `${api}/api/onboarding/checkout/${branchHash}?${q}`;
}

export type Landing = { ok: boolean; uReq: number; destino: string; error?: string };

/**
 * Sigue el checkout SIN navegador y devuelve dónde aterriza. Útil para el camino rápido y para saber
 * el uReq antes de abrir el browser (el harness lo necesita para trazar contra la BD desde el paso 1).
 */
export async function followCheckout(branchHash: string, p: Order): Promise<Landing> {
    const res = await fetch(urlCheckout(branchHash, p), { redirect: 'manual' }).catch(() => null);
    const target = res?.headers.get('location') ?? '';
    if (!target) return { ok: false, uReq: 0, destino: '', error: `el checkout no redirigió (HTTP ${res?.status ?? '?'})` };

    // el camino feliz trae el uReq en la ruta; el de error trae ?code=… y NO crea solicitud
    const m = target.match(/resolve-ecommerce-flow\/(\d+)/);
    if (!m) {
        let code = '';
        try { code = new URL(target).searchParams.get('code') ?? ''; } catch { /* destino raro */ }
        const hint = code === 'BP12700001' ? ' (user conflict: el teléfono/documento ya tiene usuario — scrubbealo)' : '';
        return { ok: false, uReq: 0, destino: target, error: `el checkout rebotó${code ? ` con ${code}` : ''}${hint}` };
    }
    return { ok: true, uReq: Number(m[1]), destino: target };
}
