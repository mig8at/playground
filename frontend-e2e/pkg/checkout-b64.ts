// checkout-b64.ts — arma la ENTRADA POR ECOMMERCE: la URL base64 que una tienda genera para mandar
// al cliente al wizard de CreditOp.
//
// POR QUÉ EXISTE:
//   Hasta ahora el harness solo entraba por el login del asesor. La entrada real de ecommerce es otra:
//   la tienda arma una URL con el pedido serializado en base64, el backend la decodifica, CREA la
//   solicitud y redirige al wizard. Sin esto, todo el tramo tienda→backend→wizard quedaba sin probar.
//
// QUIÉN PRODUCE ESTA URL DE VERDAD: el plugin de WooCommerce, `playground/creditop-woocommerce`
//   (`class-creditop-gateway.php:470-512`). Es la fuente autoritativa del contrato — esto lo imita.
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
//     pegamos al endpoint del BACKEND. No es capricho: esa landing no existe en la rama actual — vive
//     solo en `feat/ecommerce-checkout-integration` (F-54). O sea el plugin apunta hoy a una ruta que
//     el wizard de esta rama no tiene.
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

export type Pedido = {
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
export function urlCheckout(branchHash: string, p: Pedido): string {
    // OJO: E2E_API_BASE_URL ya trae `/api` en local (`http://localhost/api`) pero no siempre en otros
    // targets. Normalizamos a la RAÍZ y agregamos `/api` nosotros, para no armar `/api/api/…` (404 mudo).
    const api = (env('E2E_API_BASE_URL') || 'http://localhost').replace(/\/+$/, '').replace(/\/api$/, '');
    // Forma FIEL de una orden WooCommerce. Salió de cruzar el plugin real
    // (`creditop-woocommerce/class-creditop-gateway.php`) con `github/generate_checkout_url.php`.
    // El backend solo mira `billing` y `total`, pero mandar la forma completa evita falsos negativos
    // el día que valide algo más. OJO: `total` va como STRING — así lo manda WooCommerce.
    const orden = {
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
    const productos = p.productos ?? [{ id: 1, name: 'Producto de prueba', qty: 1, price: p.total }];
    const q = new URLSearchParams({
        o: b64(orden),
        p: b64(productos),
        t: b64(`tok-e2e-${p.documentNumber}`),
        u: b64(p.returnUrl ?? 'http://localhost:8090/gracias'),
        ps: b64(p.processEndpoint ?? 'http://localhost:8090/webhook'),
    });
    return `${api}/api/onboarding/checkout/${branchHash}?${q}`;
}

export type Aterrizaje = { ok: boolean; uReq: number; destino: string; error?: string };

/**
 * Sigue el checkout SIN navegador y devuelve dónde aterriza. Útil para el camino rápido y para saber
 * el uReq antes de abrir el browser (el harness lo necesita para trazar contra la BD desde el paso 1).
 */
export async function seguirCheckout(branchHash: string, p: Pedido): Promise<Aterrizaje> {
    const res = await fetch(urlCheckout(branchHash, p), { redirect: 'manual' }).catch(() => null);
    const destino = res?.headers.get('location') ?? '';
    if (!destino) return { ok: false, uReq: 0, destino: '', error: `el checkout no redirigió (HTTP ${res?.status ?? '?'})` };

    // el camino feliz trae el uReq en la ruta; el de error trae ?code=… y NO crea solicitud
    const m = destino.match(/resolve-ecommerce-flow\/(\d+)/);
    if (!m) {
        let code = '';
        try { code = new URL(destino).searchParams.get('code') ?? ''; } catch { /* destino raro */ }
        const pista = code === 'BP12700001' ? ' (user conflict: el teléfono/documento ya tiene usuario — scrubbealo)' : '';
        return { ok: false, uReq: 0, destino, error: `el checkout rebotó${code ? ` con ${code}` : ''}${pista}` };
    }
    return { ok: true, uReq: Number(m[1]), destino };
}
