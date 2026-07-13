import type { Page, Route } from '@playwright/test';
import { approvePaymentTransaction } from '../merchant/seed';

/**
 * Mock del checkout HOSTED de Wompi para el pago de cuota inicial de Creditop X (rt=2).
 *
 * EL PROBLEMA (verificado leyendo el wizard + legacy-backend, 2026-06):
 *   El cierre rt=2 con cuota inicial > 0 hace, en `available-lenders.tsx:180`:
 *     selección → `initial-fee-payment` → action → `POST /api/loans/requests/initial-fee-payment/initiate`
 *     → { transaction_id, checkout_url } → el wizard hace `redirect(checkout_url)`.
 *   `checkout_url = config('services.wompi.checkout.host') + '?' + http_build_query({... redirect-url ...})`
 *   donde `redirect-url` = `.../down-payment-validation/{txId}` (a dónde Wompi devuelve tras pagar).
 *   Wompi real cobraría en su página HOSTED (externa) y volvería a esa redirect-url. Headless NO se puede
 *   completar esa página → el flujo se traba ahí (este era el "muro rt=2" de `lender/close.ts`).
 *
 * LA SOLUCIÓN (este helper):
 *   Interceptamos la navegación de documento al checkout de Wompi (la reconocemos porque su URL trae el
 *   query param `redirect-url` apuntando a `down-payment-validation/{txId}` — robusto aunque el host del
 *   checkout no esté seteado en local) y, en vez de cargar Wompi, respondemos un 302 a esa `redirect-url`
 *   → el browser vuelve al wizard como si el pago hubiera sido exitoso.
 *
 *   El ESTADO del pago lo aprueba el BACKEND: el `.env` local tiene `WOMPI_MOCK_ENABLED=true` +
 *   `WOMPI_MOCK_STATUS=APPROVED`, y `initiatePayment` despacha `StatusCheck` (queue sync) que corre el
 *   Wompi Action en modo mock → la transacción queda APPROVED. La ruta `down-payment-validation` poll-ea
 *   `check-status` (sin auth) → `is_approved=true` → `validate` → sigue el flujo in-platform
 *   (confirmation → first-payment-date → payment-schedule → sign-documents → loan-approved).
 *
 *   `approvePaymentTransaction(txId)` se llama como BELT-AND-SUSPENDERS por si el job sync no alcanzó a
 *   correr antes del primer poll (fuerza status_id=22 APPROVED del lender Wompi #52). Idempotente.
 *
 * PRECONDICIÓN: el branch necesita una `lender_allied_credentials` del lender Wompi (#52) — si falta,
 * `/initiate` tira `findOrFailByLenderAndAlly`. Sembrar con `seedWompiCredential(branchHash)` (ver seed.ts).
 *
 * USO:
 *   await mockWompiHostedCheckout(page);   // antes de disparar el pago de cuota inicial
 */
export async function mockWompiHostedCheckout(page: Page): Promise<void> {
    // Matcher por PREDICADO: solo intercepta URLs que llevan el query param `redirect-url` (la firma del
    // checkout de Wompi). Así NO tocamos el resto del tráfico del wizard (onboarding/SSR form-posts) —
    // un `**/*` interceptaría todo y puede interferir con los POST a la action del FE.
    const isWompiCheckoutUrl = (url: URL): boolean => {
        try {
            return !!(url.searchParams.get('redirect-url') ?? url.searchParams.get('redirect_url'));
        } catch {
            return false;
        }
    };

    await page.route(isWompiCheckoutUrl, async (route: Route) => {
        const u = new URL(route.request().url());
        const redirectUrl = u.searchParams.get('redirect-url') ?? u.searchParams.get('redirect_url');

        // Solo el caso esperado: navegación de documento cuya redirect-url va a down-payment-validation.
        if (
            route.request().resourceType() !== 'document' ||
            !redirectUrl ||
            !/down-payment-validation\/\d+/.test(redirectUrl)
        ) {
            await route.fallback();
            return;
        }

        const txMatch = redirectUrl.match(/down-payment-validation\/(\d+)/);
        if (txMatch) {
            // Belt-and-suspenders: el backend (WOMPI_MOCK_ENABLED) ya aprueba vía StatusCheck, pero
            // forzamos APPROVED por si el primer poll llega antes que el job sync.
            approvePaymentTransaction(Number(txMatch[1]));
        }

        // En vez de cargar la página hosted de Wompi, "volvemos" como si el pago hubiera sido exitoso.
        await route.fulfill({ status: 302, headers: { location: redirectUrl }, body: '' });
    });
}
