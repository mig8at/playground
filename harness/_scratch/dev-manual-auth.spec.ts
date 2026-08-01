import { test, expect } from '@playwright/test';
import { config } from '../pkg/config';
import {
    fillAmountStep,
    fillPhoneStep,
    fillOtpStep,
    fillPersonalInfoIdentification,
    fillExpeditionDate,
} from '../channel/steps';

/**
 * Manual-auth bridge: corre contra el wizard apuntando al backend de develop.
 *
 * Cuando el wizard redirige a Cognito (o cualquier flujo de auth), el test
 * pausa por hasta 5 minutos esperando que el operador humano se autentique
 * y vuelva a una URL del onboarding self-service. Apenas detecta esa URL,
 * sigue con el flujo amount → phone → OTP → personal-info.
 *
 * Uso:
 *   E2E_PARTNER_HASH=<hash-dev> \
 *   npx playwright test tests/onboarding/dev-manual-auth.spec.ts --headed --workers=1
 *
 * Por defecto usa `config.partnerHash` (3e67eade) — cambialo si el hash no existe
 * en develop pasando E2E_PARTNER_HASH.
 */

const ENTRY_URL = `/self-service/${config.partnerHash}/solicitar`;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos para autenticarse a mano

test.describe.configure({ mode: 'serial' });

test('Manual auth bridge → amount → phone → OTP → personal-info (dev)', async ({ page }) => {
    test.setTimeout(AUTH_TIMEOUT_MS + 90_000);

    await page.goto(ENTRY_URL);

    // Si el wizard redirige fuera del self-service (login, Cognito, etc.),
    // esperamos a que el operador termine la auth manual y la URL vuelva al
    // espacio del onboarding. Si ya estamos dentro, este wait pasa de una.
    await page.waitForURL(/\/self-service\/.+\/solicitar/, { timeout: AUTH_TIMEOUT_MS });

    // Sanity: el step de monto debe ser visible al llegar acá.
    await expect(page.getByTestId('amount-input')).toBeVisible({ timeout: 30_000 });

    // Onboarding Fase 1 — los pasos que tu cascada cubre.
    await fillAmountStep(page, '1500000');
    await fillPhoneStep(page);
    await fillOtpStep(page);

    // Después de OTP, el wizard debe navegar a personal-info (ONB002 routing).
    await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 30_000 });

    // Validar que llegamos al form de identificación.
    await expect(page.getByTestId('personal-info-form')).toBeVisible({ timeout: 30_000 });

    // Llenar el form. Puede fallar por KYC real (AgilData/Mareigua/TusDatos)
    // pero al menos veremos exactamente dónde corta el flow contra dev.
    await fillPersonalInfoIdentification(page);
    await fillExpeditionDate(page);
});
