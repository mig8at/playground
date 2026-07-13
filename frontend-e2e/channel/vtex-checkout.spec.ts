import { expect, test } from '@playwright/test';
import { vtexInit } from '../pkg/ecommerce';
import { Flow } from '../pkg/flow';

/**
 * VTEX checkout E2E contra el stack LOCAL real: la URL base64 la CREA legacy vía `/vtex/init` (el
 * harness actúa como el conector VTEX) — NO se arma local como en ecommerce-local-real. Luego se
 * abre en el wizard y se maneja el onboarding hasta /personal-info:
 *   POST /vtex/init → /ecommerce/{hash}/checkout → amount(confirmar) → phone → OTP → personal-info
 *
 * Selectores por ROL (sin data-testid), para correr en el build actual del wizard.
 * Requiere: wizard (loan-request-wizard) en :5174 + legacy local en modo mock
 * (ONBOARDING_DRIVER_OTP=fake → el OTP valida con cualquier código). E2E_MERCHANT para cambiar el comercio.
 */
const MERCHANT = process.env.E2E_MERCHANT ?? 'pullman';
// Teléfono de bypass de OTP local (settings qa_otp_bypass_phones): el código = últimos 4 = 0101.
// Evita depender de ONBOARDING_DRIVER_OTP=fake. Override con E2E_PHONE / E2E_OTP.
const PHONE = process.env.E2E_PHONE ?? '3131010101';
const OTP = process.env.E2E_OTP ?? '0101';

test('VTEX checkout: /vtex/init (legacy genera base64) → wizard → /lenders', async ({ page }) => {
    test.setTimeout(150_000);

    await new Flow(
        'VTEX checkout (URL creada por /vtex/init real)',
        '/vtex/init → checkout → amount → phone → OTP → personal-info',
    )
        .step('VTEX init', 'POST /vtex/init → legacy genera la URL base64 (redirectUrl); abrimos el path en el FE', async () => {
            const init = await vtexInit(MERCHANT);
            await page.goto(init.checkout_path);
            return `authorizationId=${init.authorizationId} · ${init.hash} · ${init.checkout_path.slice(0, 70)}…`;
        })
        .step('Monto', 'el monto viene prellenado del order (contrato base64) y bloqueado: solo se confirma', async () => {
            const activar = page.getByRole('button', { name: /activar mi cr[ée]dito|continuar|siguiente/i });
            await expect(activar.first()).toBeEnabled({ timeout: 20_000 });
            await activar.first().click();
            return 'monto prellenado + confirmado';
        })
        .step('Teléfono', 'register persiste el OTP en la tabla otps', async () => {
            const phoneBox = page.getByRole('textbox', { name: /celular|tel[ée]fono|n[úu]mero/i });
            await expect(phoneBox).toBeVisible({ timeout: 20_000 });
            await phoneBox.click();
            await phoneBox.pressSequentially(PHONE, { delay: 30 });
            await page.getByRole('button', { name: /continuar|siguiente|enviar|activar/i }).click();
            await page.waitForURL(/\/otp(\?|$)/, { timeout: 20_000 });
            return `teléfono ${PHONE}`;
        })
        .step('OTP', 'con el teléfono de bypass (qa_otp_bypass_phones) el código 0101 valida; o ONBOARDING_DRIVER_OTP=fake', async () => {
            await page.waitForTimeout(2_000);
            const otpFields = page.locator('input:not([type="hidden"])');
            await otpFields.first().click();
            await page.keyboard.type(OTP, { delay: 60 });
            const otpSubmit = page.getByRole('button', { name: /validar|continuar|confirmar|verificar|enviar/i });
            if (await otpSubmit.count()) {
                await otpSubmit.first().click();
            }
            return `OTP ${OTP}`;
        })
        .step('Aterrizaje (personal-info o lenders)', 'user_request anclado al ecommerce_request creado por /vtex/init; un usuario nuevo cae en /personal-info, uno con datos previos salta al marketplace /lenders', async () => {
            await page.waitForURL(/\/(personal-info|lenders)(\?|$)/, { timeout: 30_000 });
            return page.url().includes('/lenders') ? '/lenders (marketplace)' : '/personal-info';
        })
        .run();
});
