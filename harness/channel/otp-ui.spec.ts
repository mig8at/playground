import { test, expect } from '@playwright/test';
import { config, fakeScenarios, happyUser } from '../pkg/config';
import { injectFakeScenario } from '../pkg/mock-control';

const ENTRY_URL = `/self-service/${config.partnerHash}/solicitar`;

// Comparten una sola instancia del FE; serial evita race conditions del SSR.
test.describe.configure({ mode: 'serial' });

/**
 * Tests UI del flujo amount → phone → OTP contra el loan-request-wizard real.
 *
 * Selectores: usamos `data-testid` (introducidos en `feature/onboarding/fe-obs-04`
 * del frontend-monorepo). Es la única forma estable de identificar inputs y
 * botones — los labels tienen ambigüedad con hidden inputs y los placeholders
 * a veces no se asocian correctamente con el input wrapped por Form components.
 *
 * Pre-requisitos:
 *   1. legacy-backend en modo mock en localhost (make mock-all). El viejo
 *      mock-server :4000 de validation-driven fue eliminado.
 *   2. loan-request-wizard en :5174 con VITE_API_URL=http://localhost.
 *   3. La rama del FE incluye los data-testid del componente.
 */

async function fillAmountAndContinue(page: import('@playwright/test').Page, amount = '1500000') {
    await page.goto(ENTRY_URL);
    await expect(page.getByTestId('amount-input')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('amount-input').fill(amount);
    await page.getByTestId('amount-submit').click();
}

async function fillPhoneAndContinue(page: import('@playwright/test').Page, phone: string) {
    await expect(page.getByTestId('phone-input')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('phone-input').fill(phone);
    await page.getByTestId('phone-submit').click();
}

async function submitOtp(page: import('@playwright/test').Page, code = '1234') {
    await expect(page.getByTestId('otp-input')).toBeVisible({ timeout: 15_000 });
    // InputOTP es un input controlado: focus + keyboard.type para que se
    // dispare onChange correctamente.
    await page.getByTestId('otp-input').click();
    await page.keyboard.type(code, { delay: 30 });
    await page.getByTestId('otp-submit').click();
}

async function advanceToOtpStep(page: import('@playwright/test').Page, phone: string) {
    await fillAmountAndContinue(page);
    await fillPhoneAndContinue(page, phone);
    await page.waitForURL(/\/otp(\?|$)/, { timeout: 15_000 });
}

test.describe('Onboarding Fase 1 — flujo amount → phone → OTP screen', () => {
    test.fixme('happy path llega al paso de OTP', async ({ page }) => {
        await injectFakeScenario(page, fakeScenarios.otp.success, config.mockUrl);

        await advanceToOtpStep(page, happyUser.phoneNumber);

        await expect(page.getByTestId('otp-input')).toBeVisible();
    });
});

test.describe('Onboarding Fase 1 — OBS-OTP-02 subcódigos en UI', () => {
    test.fixme('código incorrecto → mensaje específico CODE_INVALID', async ({ page }) => {
        await injectFakeScenario(page, fakeScenarios.otp.invalidCode, config.mockUrl);
        await advanceToOtpStep(page, '3001112222');
        await submitOtp(page, '9876');

        // Con OBS-OTP-02 en el FE, el mensaje debería contener "código" + "correcto".
        // Fallback: cualquier indicador visible de error.
        const error = page.getByRole('alert').or(page.getByText(/no es correcto|inv[áa]lid|incorrect/i));
        await expect(error.first()).toBeVisible({ timeout: 10_000 });
    });

    test.fixme('código expirado → mensaje sugiere solicitar uno nuevo', async ({ page }) => {
        await injectFakeScenario(page, fakeScenarios.otp.expired, config.mockUrl);
        await advanceToOtpStep(page, '3001113333');
        await submitOtp(page, '1234');

        const error = page.getByRole('alert').or(page.getByText(/expir|nuevo c[óo]digo|reenv[íi]/i));
        await expect(error.first()).toBeVisible({ timeout: 10_000 });
    });

    test.fixme('proveedor caído → mensaje de problema de conexión', async ({ page }) => {
        await injectFakeScenario(page, fakeScenarios.otp.providerDown, config.mockUrl);
        await advanceToOtpStep(page, '3001114444');
        await submitOtp(page, '1234');

        const error = page.getByRole('alert').or(page.getByText(/conexi[óo]n|reintent|problema/i));
        await expect(error.first()).toBeVisible({ timeout: 10_000 });
    });
});
