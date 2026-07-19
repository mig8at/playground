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
//   · SERIALIZACIÓN: el plugin manda `o` y `u` PHP-serializados y `p` como JSON; acá va todo JSON.
//     Las dos funcionan: `deserializeData` (:767-787) intenta `unserialize` y cae a `json_decode`,
//     y castea array→objeto en ambos casos.
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
    const orden = {
        id: `E2E-${p.documentNumber}`,
        order_key: `wc_order_e2e_${p.documentNumber}`,
        total: p.total,
        billing: {
            phone: p.phone,
            document_number: p.documentNumber,
            document_type: p.documentType ?? 'CC',
            email: p.email ?? `synth-${p.documentNumber}@creditop.com`,
            first_name: p.firstName ?? 'SYNTH',
            last_name: p.lastName ?? 'TEST USER',
        },
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
