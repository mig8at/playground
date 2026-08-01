import { expect, test } from '@playwright/test';
import { seedAndOfferLender } from './close';
import { mockWompiHostedCheckout } from '../pkg/wompi-mock';

/**
 * Cierre Creditop X (rt=2) por UI + mock del checkout HOSTED de Wompi — eje LENDER.
 * Espejo de backend-e2e `asesor 3e67eade 77` (que cierra a Estado 11 sin pasar por Wompi/UI).
 *
 * QUÉ SE VERIFICÓ (lectura del wizard + legacy-backend, 2026-06):
 *  - El cierre rt=2 con cuota inicial > 0 va: selección → /initial-fee-payment → "Pagar cuota inicial"
 *    → POST /initiate → redirect(checkout_url Wompi HOSTED) → vuelve a /down-payment-validation/{txid}
 *    → poll check-status → validate → confirmation → first-payment-date → … → loan-approved (cadena CABLEADA).
 *  - El backend local auto-aprueba el pago (`WOMPI_MOCK_ENABLED=true` + StatusCheck sync).
 *  - El único tramo no-headless es la PÁGINA hosted de Wompi → la mockea `pkg/wompi-mock.ts`
 *    (intercepta la navegación al checkout, rebota a la redirect-url = down-payment-validation).
 *
 * MURO REMANENTE (no es el mock): para #77, `getInitialFeeData` calcula initial_fee = (categoría.
 * min_initial_fee/100) × amount, y la categoría asignada por el MOTOR DE SCORING SQL da min_initial_fee=0
 * → monto $0 → el botón "Pagar cuota inicial" queda disabled → el redirect a Wompi NUNCA se dispara.
 * Forzar la fila `lender_users_categories` no alcanza (la asignación es del motor de scoring). Cerrar el
 * cierre rt=2 por UI hasta loan-approved exige cirugía del motor de scoring (fuera del alcance bypass) o
 * un lender con fee>0 consistente. El cierre rt=2 → Estado 11 YA está validado en backend.
 */

const PULLMAN_HASH = '3e67eade';
const CREDIPULLMAN_ID = 77; // rt=2 Creditop X

test('Wompi mock: intercepta el checkout hosted y rebota a down-payment-validation', async ({ page }) => {
    // Verificación DETERMINÍSTICA del helper, desacoplada del flujo (no depende del motor de scoring).
    await mockWompiHostedCheckout(page);

    // URL con la forma del checkout de Wompi: trae el query param `redirect-url` → down-payment-validation.
    const returnUrl = `http://localhost:5174/self-service/${PULLMAN_HASH}/1/down-payment-validation/424242`;
    const wompiCheckout = `https://checkout.wompi.co/p/?public-key=pub_test&amount-in-cents=22500000&currency=COP&reference=abc&redirect-url=${encodeURIComponent(returnUrl)}`;

    await page.goto(wompiCheckout).catch(() => {});
    // El mock debe haber respondido 302 → location=redirect-url → el browser termina en down-payment-validation.
    await page.waitForURL(/down-payment-validation\/424242/, { timeout: 10_000 });
    expect(page.url()).toContain('down-payment-validation/424242');
});

// Llega a /initial-fee-payment con el mock instalado (demostrado en dev). En fixme porque la pata de
// ONBOARDING (runHappyPathUntilLenders, compartida) es intermitente headless y el cierre completo está
// walled igual (ver test.fixme abajo). El mock en sí lo cubre el test determinístico de arriba.
test.fixme('rt=2 por UI: el flujo llega a /initial-fee-payment con el mock instalado', async ({ page }) => {
    test.setTimeout(120_000);
    await mockWompiHostedCheckout(page);
    await seedAndOfferLender(page, PULLMAN_HASH, CREDIPULLMAN_ID, { score: 800, reportado: false });

    // Seleccionar plazo (combobox sin testid) + "Validar Pre aprobado" → card expande cuota inicial.
    const combo = page.getByRole('combobox').first();
    if (await combo.count()) {
        await combo.selectOption({ index: 1 }).catch(async () => {
            await combo.click().catch(() => {});
            await page.getByRole('option').first().click().catch(() => {});
        });
    }
    await page.getByTestId(`lender-action-${CREDIPULLMAN_ID}`).click();
    await page.waitForTimeout(1500);

    const fee = page.getByTestId('initial-fee-input');
    if (await fee.count()) {
        await fee.fill('225000');
        await page.getByRole('button', { name: /continuar|pagar|validar|siguiente/i }).last().click().catch(() => {});
    }

    // Checkpoint verificado: el flujo rt=2 con cuota inicial llega a la página de pago.
    await page.waitForURL(/\/initial-fee-payment/, { timeout: 15_000 });
    expect(page.url()).toContain('/initial-fee-payment');
});

test.fixme('rt=2 por UI: cierre completo hasta loan-approved', async () => {
    // BLOQUEADO por el motor de scoring (no por el mock): getInitialFeeData → $0 → botón "Pagar" disabled
    // → el redirect a Wompi (que mockWompiHostedCheckout intercepta) nunca se dispara. Ver doc arriba.
    // El mock está listo (test 1 lo prueba) para cuando se resuelva el fee>0 + se agreguen los testids del
    // Grupo B/C (first-payment-date/payment-schedule/sign-documents/signature-otp/loan-approved).
    // Cierre rt=2 → Estado 11 validado en backend: `go run . asesor 3e67eade 77`.
});
