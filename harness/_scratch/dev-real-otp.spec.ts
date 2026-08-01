import { test, expect } from '@playwright/test';
import { fillAmountStep } from '../channel/steps';

/**
 * Real-OTP smoke contra develop:
 *   - amount → phone con el número REAL del operador
 *   - Twilio dispara el SMS contra dev
 *   - El operador digita el código manualmente en el browser
 *   - El test detecta la navegación a /personal-info (señal de ONB002)
 *
 * Uso:
 *   E2E_TWILIO_PHONE=3001234567 \
 *   E2E_PARTNER_HASH=e9409aff \
 *   npx playwright test tests/onboarding/dev-real-otp.spec.ts --headed --workers=1
 *
 * Diseñado para Pullman principal (allied 121 "Pullman-pruebas"), pero
 * cualquier hash que reciba SMS por Twilio funciona.
 */

const PHONE = process.env.E2E_TWILIO_PHONE;
const PARTNER_HASH = process.env.E2E_PARTNER_HASH ?? 'e9409aff';
const OTP_WAIT_MS = 4 * 60 * 1000; // 4 minutos para que el operador reciba el SMS y digite

test.describe.configure({ mode: 'serial' });

test('Real OTP contra develop → ONB002 navega a /personal-info', async ({ page }) => {
    test.skip(!PHONE, 'Define E2E_TWILIO_PHONE con tu número real antes de correr este spec.');
    test.setTimeout(OTP_WAIT_MS + 60_000);

    await page.goto(`/self-service/${PARTNER_HASH}/solicitar`);
    await expect(page.getByTestId('amount-input')).toBeVisible({ timeout: 30_000 });

    // 1. Amount
    await fillAmountStep(page, '1500000');

    // 2. Phone (REAL — Twilio dispara SMS contra develop)
    await expect(page.getByTestId('phone-input')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('phone-input').click();
    await page.getByTestId('phone-input').pressSequentially(PHONE!, { delay: 30 });
    await expect(page.getByTestId('phone-submit')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('phone-submit').click();

    // 3. OTP: aparece la pantalla, el operador digita el código que recibió por SMS.
    //    El test detecta la navegación apenas el operador clickea Confirmar.
    await expect(page.getByTestId('otp-input')).toBeVisible({ timeout: 20_000 });
    console.log('\n📱 SMS enviado a', PHONE, '— digitá el código en el browser cuando llegue.\n');
    await page.waitForURL(/\/personal-info(\?|$)/, { timeout: OTP_WAIT_MS });

    // 4. Validar que el FE consumió ONB002 + payload.user_request_id correctamente
    //    (si llegó hasta acá, ese routing está funcionando contra el backend real).
    await expect(page.getByTestId('personal-info-form')).toBeVisible({ timeout: 30_000 });

    // Pausa breve para observar la pantalla final
    await page.waitForTimeout(3_000);
});
