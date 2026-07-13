import { test, expect, type Page } from '@playwright/test';
import { runHappyPathUntilLenders } from '../channel/steps';

/**
 * UI tests para diferenciación de partner por `partner_hash`.
 *
 * Cubre los flujos 02 "Pullman/Quanto" del onboarding (`allied_id` 94 y 189).
 * El mock-server consulta `partner-registry.ts` y devuelve datos distintos
 * por hash en `GET /api/onboarding/phone/register/:hash`.
 *
 * Capas de validación:
 *   1. Smoke por partner — logo + branch visible en phone step (rápido).
 *   2. End-to-end por partner — recorre el wizard completo hasta /lenders
 *      verificando que la identidad del partner sobrevive cada navegación.
 *
 * Selector strategy: el FE pinta el partner en `phone-number.tsx:105-109` —
 * un `<img alt={partnerName}>` y un texto con `startCase(lowerCase(branchName))`.
 */

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 300 } });

async function advanceToPhoneStep(page: Page, hash: string, amount = '1500000') {
    await page.goto(`/self-service/${hash}/solicitar`);
    await expect(page.getByTestId('amount-input')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('amount-input').fill(amount);
    await page.getByTestId('amount-submit').click();
    await expect(page.getByTestId('phone-input')).toBeVisible({ timeout: 15_000 });
}

// --- Smoke: el partner se identifica correctamente en el phone step --------

test.fixme('Pullman (hash 3e67eade): logo y branch "Pullman" visibles en phone step', async ({ page }) => {
    await advanceToPhoneStep(page, '3e67eade');

    await expect(page.locator('img[alt="Pullman"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Pullman/i).first()).toBeVisible();
});

test.fixme('Quanto (hash qu4nt0001): logo y branch "Quanto" visibles', async ({ page }) => {
    await advanceToPhoneStep(page, 'qu4nt0001');

    await expect(page.locator('img[alt="Quanto"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Quanto/i).first()).toBeVisible();

    // Negative check: el partner Pullman NO debería aparecer cuando el hash es Quanto.
    await expect(page.locator('img[alt="Pullman"]')).toHaveCount(0);
});

// --- End-to-end por partner: amount → ... → lenders -----------------------
// Pullman y Quanto comparten lenders ([Credipullman X, Medipay]). La pantalla
// de lenders NO repite el logo del partner — la identidad sobrevive a través
// del path de la URL (`/self-service/<hash>/...`). El smoke ya validó el logo
// en phone step; acá probamos que el flujo completo cierra hasta lenders.

test.fixme('Pullman E2E: amount → phone → otp → personal → laboral → lenders', async ({ page }) => {
    await runHappyPathUntilLenders(page, '3e67eade');
    expect(page.url()).toMatch(/\/lenders/);
    expect(page.url()).toContain('3e67eade');
    await expect(page.getByRole('heading', { name: /Credipullman X/i }).first()).toBeVisible({
        timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: /Medipay/i }).first()).toBeVisible();
});

test.fixme('Quanto E2E: amount → phone → otp → personal → laboral → lenders', async ({ page }) => {
    await runHappyPathUntilLenders(page, 'qu4nt0001');
    expect(page.url()).toMatch(/\/lenders/);
    expect(page.url()).toContain('qu4nt0001');
    await expect(page.getByRole('heading', { name: /Credipullman X/i }).first()).toBeVisible({
        timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: /Medipay/i }).first()).toBeVisible();
});
