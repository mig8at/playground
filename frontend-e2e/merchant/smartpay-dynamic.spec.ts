import { expect, test } from '@playwright/test';
import { cognitoCreds } from '../pkg/config';
import { cognitoLogin, cognitoStorageState } from '../pkg/cognito';
import { Flow } from '../pkg/flow';
import {
    acquireAccountLock,
    MOTAI_MERCHANT,
    pointAccount,
    releaseAccountLock,
    SMARTPAY_MERCHANT,
} from '../pkg/account-lock';

/**
 * SmartPay — FORMULARIO DINÁMICO por UI (flujo /merchant/{hash}/request-*), contra el stack local.
 *
 * ARQUITECTURA (clave): el wizard llama al microservicio `onboarding-forms-service` DIRECTO
 * (VITE_ONBOARDING_FORM_SERVICE). Como NO se levanta ese microservicio (restricción del proyecto),
 * legacy-backend sirve su CONTRATO como FAKE: `AppServiceProvider::fakeFormsServiceRoutesForLocal`
 * expone /api/forms-fake/dynamic/{schema,send-otp,validate-otp,full/find-user-*,upload,submit}, y el
 * .env.local del wizard apunta VITE_ONBOARDING_FORM_SERVICE=http://localhost/api/forms-fake.
 * El SUBMIT delega al origination REAL (DynamicFormsService::userCreateFacade → DYFS1001) → userRequestId
 * auténtico → /api/partners/user-request-product (real) → /merchant/{hash}/{id}/lenders.
 *
 * PRERREQUISITOS:
 *  - Credenciales Cognito (.cognito.json). Las rutas /merchant/* exigen sesión (default-layout requireUser).
 *  - El usuario solo accede a SU propio merchant (default-layout redirige si el hash de la URL ≠ el del
 *    usuario). Por eso beforeAll RE-APUNTA la cuenta de prueba (1827080) al branch SmartPay bb534d6a
 *    (allied 24, con productos). afterAll la restaura a Motai (158/682) para no romper motai-ui.spec.ts.
 *  - bb534d6a se eligió porque allied 24 tiene productos (el paso amount los exige) y mi fake submit
 *    origina correctamente contra ese branch.
 *
 * Testids agregados (frontend-monorepo stash, Grupo G): sp-city-trigger, sp-documentType, sp-birthdate.
 * Lo demás se driva por id/name/placeholder/rol. OtpForm ya traía data-testid otp-input/otp-submit.
 */

const HASH = 'bb534d6a';
const TS = String(Date.now()).slice(-8);

test.describe.configure({ mode: 'serial' });
// storageState: reusa la sesión Cognito cacheada (.auth/cognito-state.json) → cognitoLogin queda no-op
// mientras la sesión viva; si murió, re-loguea y re-guarda. Ahorra el Hosted UI en cada corrida.
test.use({ launchOptions: { slowMo: 120 }, storageState: cognitoStorageState() });

test.beforeAll(async () => {
    if (!cognitoCreds.user) return;
    test.setTimeout(220_000); // el lock-wait puede tardar si otro spec de la cuenta está corriendo
    await acquireAccountLock(); // mutex: la cuenta 1827080 la comparten varios specs (ver pkg/account-lock)
    pointAccount(SMARTPAY_MERCHANT.allied, SMARTPAY_MERCHANT.branch); // la cuenta debe "ser" el comercio SmartPay
});
test.afterAll(() => {
    if (!cognitoCreds.user) return;
    pointAccount(MOTAI_MERCHANT.allied, MOTAI_MERCHANT.branch); // restaurar Motai
    releaseAccountLock();
});

/** Abre un Radix Select por su placeholder y elige una opción (regex opcional; por defecto la primera). */
async function pickSelect(page: import('@playwright/test').Page, placeholder: RegExp | string, option?: RegExp) {
    await page.locator('[role="combobox"]').filter({ hasText: placeholder }).first().click();
    const opt = option
        ? page.getByRole('option').filter({ hasText: option })
        : page.getByRole('option');
    await opt.first().click();
}

test('SmartPay dinámico por UI: amount → phone → otp → personal → financial → /lenders', async ({ page }) => {
    test.skip(!cognitoCreds.user, 'Requiere .cognito.json (cuenta Cognito merchant)');
    test.setTimeout(200_000);

    const dateCombo = (re: RegExp) => page.locator('[role="combobox"]').filter({ hasText: re });

    await new Flow(
        'SmartPay dinámico por UI',
        'amount → phone → otp → personal → financial → /lenders',
    )
        .step('Login Cognito', 'Las rutas /merchant/* exigen sesión; entra y autentica', async () => {
            await page.goto(`http://localhost:5174/merchant/${HASH}/request-amount`);
            await cognitoLogin(page);
            await page.goto(`http://localhost:5174/merchant/${HASH}/request-amount`, { waitUntil: 'networkidle' });
            return 'sesión iniciada';
        })
        .step('Monto y producto', 'Schema servido por el fake "SmartPay E2E (local)"; elige producto y monto', async () => {
            await expect(page.getByText('SmartPay E2E (local)')).toBeVisible();
            await page.getByPlaceholder(/Buscar/i).click();
            await page.getByRole('button', { name: 'LG - Electronic Bamboo Computer' }).click();
            await page.locator('#amount').fill('800000');
            await page.getByRole('button', { name: 'Activar mi crédito' }).click();
            return 'producto LG · monto 800k';
        })
        .step('Teléfono', 'send-otp → fake 200', async () => {
            await page.waitForURL(/request-phone/, { timeout: 20_000 });
            await page.locator('#phone').fill('30' + TS);
            await page.getByRole('button', { name: 'Continuar' }).click();
            return `teléfono 30${TS}`;
        })
        .step('OTP', 'validate-otp → fake success (el código es irrelevante, lo valida el fake)', async () => {
            await page.waitForURL(/request-otp/, { timeout: 20_000 });
            await page.getByTestId('otp-input').click();
            await page.keyboard.type('1234');
            await page.getByTestId('otp-submit').click();
            return 'OTP validado';
        })
        .step('Datos personales', 'find-user-by-email/document → fake disponible (OFS6001/OFS7001)', async () => {
            await page.waitForURL(/request-personal-info/, { timeout: 20_000 });
            await page.locator('#name').fill('Maria');
            await page.locator('#lastName').fill('SmartpayUI');
            await page.locator('#email').fill(`sp.ui.${TS}@creditop.com`);
            await page.getByTestId('sp-city-trigger').click();
            await page.getByRole('option').first().click();
            await page.getByTestId('sp-documentType').getByText('CED', { exact: true }).click();
            await page.locator('#document').fill('109' + TS); // CED = 11 dígitos
            await dateCombo(/Día/).click();
            await page.getByRole('option', { name: '15', exact: true }).click();
            await dateCombo(/Mes/).click();
            await page.getByRole('option').first().click();
            await dateCombo(/Año/).click();
            await page.getByRole('option', { name: '1990', exact: true }).click(); // edad ~36 (rango 22–72)
            await page.getByRole('button', { name: 'Continuar' }).click();
            return 'Maria SmartpayUI · CED 109' + TS;
        })
        .step('Datos financieros', 'Ocupación: evitar "Conductor de plataforma digital" (pide upload)', async () => {
            await page.waitForURL(/request-financial-info/, { timeout: 20_000 });
            await pickSelect(page, /ingreso mensual promedio/);
            await pickSelect(page, /ocupación principal/, /emplead/i);
            await pickSelect(page, /cómo suelen ser tus ingresos/);
            await pickSelect(page, /tiempo en tu ocupación/);
            await page.getByText('Cuenta bancaria').click(); // incomeChannels (radio)
            await pickSelect(page, /créditos activos/);
            await page.getByRole('radio', { name: 'No', exact: true }).first().click(); // hasActiveCreditCard
            await pickSelect(page, /gasto mensual aproximado/);
            await page.getByText('No, nunca').click(); // hasLatePayments (radio)
            await page.getByRole('button', { name: 'Enviar solicitud' }).click();
            return 'formulario financiero enviado';
        })
        .step('Submit → /lenders', 'fake delega a create-user (DYFS1001) → userRequestId real → user-request-product', async (ctx) => {
            await page.waitForURL(/\/merchant\/bb534d6a\/\d+\/lenders/, { timeout: 30_000 });
            await expect(page).toHaveURL(/\/lenders/);
            const loanRequestId = page.url().match(/\/(\d+)\/lenders/)?.[1] ?? '';
            ctx.set('loanRequestId', loanRequestId);
            return `loanRequestId ${loanRequestId} · /lenders`;
        })
        .run();
});
