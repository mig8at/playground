import { test, expect } from '@playwright/test';
import { config } from '../pkg/config';
import { injectFakeScenario } from '../pkg/mock-control';
import { fillAmountStep, fillPhoneStep } from '../channel/steps';

/**
 * Demo visual contra el backend de develop (cascada de stabilize ya mergeada).
 *
 * Cada test atraviesa amount → phone → OTP, escribe un código y pausa unos
 * segundos en la pantalla resultante para que el operador humano observe
 * el mensaje que el FE renderea por cada `error_subcode` que el backend emite.
 *
 * Escenarios cubiertos:
 *   1. happy           → ONB002 (avanza a personal-info)
 *   2. invalid-code    → ONB001 + CODE_INVALID
 *   3. expired         → ONB001 + CODE_EXPIRED
 *   4. provider-down   → ONB001 + PROVIDER_UNREACHABLE
 *
 * El test pasa siempre (no assertion final sobre URL en los subcódigos), pero
 * el video y los screenshots quedan en test-results/ para revisar después.
 */

const ENTRY_URL = `/self-service/${config.partnerHash}/solicitar`;
const OBSERVE_MS = 4500; // tiempo en pantalla para que el operador observe

test.describe.configure({ mode: 'serial' });

async function reachOtpStep(page: import('@playwright/test').Page) {
    await page.goto(ENTRY_URL);
    await expect(page.getByTestId('amount-input')).toBeVisible({ timeout: 30_000 });
    await fillAmountStep(page, '1500000');
    await fillPhoneStep(page);
    await expect(page.getByTestId('otp-input')).toBeVisible({ timeout: 20_000 });
}

async function submitOtp(page: import('@playwright/test').Page, code: string) {
    await page.getByTestId('otp-input').click();
    await page.keyboard.type(code, { delay: 40 });
    await page.getByTestId('otp-submit').click();
}

test.describe('Demo subcódigos OTP contra develop', () => {
    test('1 · happy path → ONB002 navega a /personal-info', async ({ page }) => {
        await reachOtpStep(page);
        await submitOtp(page, '1234');
        await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 15_000 });
        await page.waitForTimeout(OBSERVE_MS); // observar la pantalla de personal-info
    });

    test('2 · X-Fake-Scenario:invalid-code → CODE_INVALID con mensaje accionable', async ({ page }) => {
        await injectFakeScenario(page, 'invalid-code', '');
        await reachOtpStep(page);
        await submitOtp(page, '9999');
        // Esperamos que aparezca el mensaje accionable mapeado por getErrorMessage.
        await expect(
            page.getByText(/no es correcto/i),
        ).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(OBSERVE_MS);
    });

    test('3 · X-Fake-Scenario:expired → CODE_EXPIRED sugiere solicitar uno nuevo', async ({ page }) => {
        await injectFakeScenario(page, 'expired', '');
        await reachOtpStep(page);
        await submitOtp(page, '1234');
        await expect(
            page.getByText(/expir[óo]|solicit/i),
        ).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(OBSERVE_MS);
    });

    test('4 · X-Fake-Scenario:provider-down → PROVIDER_UNREACHABLE como problema de conexión', async ({ page }) => {
        await injectFakeScenario(page, 'provider-down', '');
        await reachOtpStep(page);
        await submitOtp(page, '1234');
        await expect(
            page.getByText(/conexi[óo]n|reintent/i),
        ).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(OBSERVE_MS);
    });
});
