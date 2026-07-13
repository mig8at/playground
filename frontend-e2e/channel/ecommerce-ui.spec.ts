import { test, expect } from '@playwright/test';
import { config } from '../pkg/config';

/**
 * Flujo Ecommerce (handshake de checkout) contra el LEGACY-BACKEND REAL en modo mock.
 *
 * Estado: el `POST /api/onboarding/ecommerce-request/create/{hash}` real exige el contrato COMPLETO
 * (`partnerId, order, products, token, returnUrl, processUrl, config` — todos required|string; ver
 * `Modules/Onboarding/App/Http/Requests/CreateEcommerceRequest.php`). El mock-server :4000 (ELIMINADO)
 * aceptaba solo `order + token`. Con los 7 campos pasa validación pero el **decode del contrato** (order/
 * products/config base64 PHP-serializado) devuelve 500 si el formato no es el exacto.
 *
 * Por eso: validamos que el backend EXIGE el contrato (test verde), y dejamos el happy-path del handshake
 * en `fixme` hasta replicar el formato base64 exacto que produce el plugin de la tienda (WooCommerce/VTEX).
 * El mapa del handshake está en `../docs/MAPA-FLUJOS.md` (B.1) y la notificación a la tienda en §Ciclo E2E.
 */

const PARTNER = config.partnerHash;

test.describe.configure({ mode: 'serial' });

test('Ecommerce contrato: create exige el contrato completo (rechaza handshake incompleto)', async ({ request }) => {
    // Handshake incompleto (solo order+token, como el viejo mock-server) → el backend real lo RECHAZA.
    const res = await request.post(`${config.mockUrl}/api/onboarding/ecommerce-request/create/${PARTNER}`, {
        data: {
            order: 'YToyOntzOjI6ImlkIjtzOjQ6Ijk5OTkiO3M6OToib3JkZXJfa2V5IjtzOjIyOiJ3Y19vcmRlcl90ZXN0XzEyMzQ1IjtzOjU6InRvdGFsIjtzOjc6IjE1MDAwMDAiO30=',
            token: 'eyJmaXJzdE5hbWUiOiJKdWFuIiwicGhvbmUiOiIzMDAxMjM0NTY3In0=',
        },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    // Faltan partnerId/products/returnUrl/processUrl/config → error de formato.
    expect(body.errors ?? body.message).toBeTruthy();
});

// ✅ RESUELTO en specs dedicados (el contrato base64 REAL lo arma generate_checkout_url.php):
//   - Handshake completo → /solicitar → … → /lenders: `channel/ecommerce-local-real.spec.ts` (VERDE).
//   - Notificación a la tienda (process_url POST {status} + return_url): `channel/ecommerce-notify.spec.ts` (VERDE).
// Este spec sólo conserva la aserción de CONTRATO (arriba): el backend rechaza el handshake incompleto.
