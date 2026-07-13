import { test, expect } from '@playwright/test';
import { config, fakeScenarios } from '../pkg/config';
import { injectFakeScenario } from '../pkg/mock-control';
import { runHappyPathUntilLenders } from '../channel/steps';

/**
 * Happy path COMPLETO desde amount → phone → otp → personal-info → laboral-info
 * → lenders. Es el spec más visual de la suite — corre con slowMo 500ms para
 * que un humano pueda seguir cada transición.
 *
 * Pre-requisitos en el FE:
 *   - HttpClient preserva payload en `success: false` (rama
 *     feature/onboarding/fe-httpclient-payload-fix). Sin esto el camino
 *     OTP → personal-info NUNCA llega — ONB002 trae el user_request_id
 *     en payload y la versión vieja lo descartaba.
 *   - Mock devuelve `success: false + error_code: ONB004` en savePersonalInfo
 *     para forzar el redirect a employment-info (validation-driven branch
 *     `feature/onboarding/mock-partner-differentiation`).
 *   - data-testid en employment-info-form (rama
 *     feature/onboarding/fe-happy-path-e2e).
 */

const PARTNER = config.partnerHash;

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 500 } });

test('Happy path E2E: amount → phone → otp → personal-info → laboral-info → lenders', async ({ page }) => {
    // El partner lo fija el hash que se pasa a runHappyPathUntilLenders (abajo); el
    // backend real no tiene estado de mock global que resetear (cada flujo lleva su hash).
    await injectFakeScenario(page, fakeScenarios.otp.success, config.mockUrl);

    await runHappyPathUntilLenders(page, PARTNER);

    expect(page.url()).toMatch(/\/lenders/);
});
