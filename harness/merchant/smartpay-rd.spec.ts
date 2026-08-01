import { test, expect, type Page } from '@playwright/test';
import { config } from '../pkg/config';

/**
 * UI tests del flujo 06 "SmartPay RD" (country_id=60, hash `smartpay001`).
 *
 * Diferencias del flujo SmartPay vs. self-service estándar:
 *   - URL bajo `/merchant/<hash>/request-amount` (no self-service).
 *   - Layout autenticado: requiere session Cognito → bypaseado en local con
 *     `X-Dev-Session: <DEV_SESSION_KEY>` (apps/.../auth-helpers.server.ts).
 *   - Schema dinámico SmartPay: theme `theme-smartpay`, ciudades DR
 *     (Santo Domingo, Santiago, La Vega, San Pedro de Macorís).
 *   - El default-layout valida `params.partner_hash === userAlliedBranchHash`;
 *     por eso seteamos el hash del asesor con POST /__mock/state antes de navegar.
 *
 * Pre-requisitos:
 *   - mock-server con endpoint /__mock/state (validation-driven branch
 *     mock-partner-differentiation).
 *   - loan-request-wizard con DEV_SESSION_KEY en .env.local y bypass en
 *     auth-helpers.server.ts (rama fe-obs-04 o posterior).
 *   - .env.local con APP_ENV=local.
 */

const SMARTPAY_HASH = 'smartpay001';
const DEV_SESSION = 'e2e-local-only-do-not-deploy';

test.describe.configure({ mode: 'serial' });

async function setMockUserAllied(request: import('@playwright/test').APIRequestContext, hash: string, countryId: number) {
    const res = await request.post(`${config.mockUrl}/__mock/state`, {
        data: { userAlliedHash: hash, userAlliedCountryId: countryId },
    });
    expect(res.ok()).toBeTruthy();
}

async function attachDevSession(page: Page) {
    // Inyectamos el header X-Dev-Session en TODAS las requests a localhost.
    // El SSR loader del wizard recibe la request original con sus headers,
    // así que el bypass en `requireUserWithSession` se activa.
    await page.route('**/*', async (route) => {
        const headers = { ...route.request().headers(), 'x-dev-session': DEV_SESSION };
        await route.continue({ headers });
    });
}

test.beforeEach(async ({ request }) => {
    // Sincronizamos el "asesor activo" del mock con el hash bajo test.
    // Si no lo hacemos, default-layout.tsx:63 redirige a /merchant/<otro>/solicitar.
    await setMockUserAllied(request, SMARTPAY_HASH, 60);
});

test.afterAll(async ({ request }) => {
    // Restauramos el default Pullman merchant para no contaminar otros specs
    // (ecommerce, etc.) que asumen el state inicial.
    await setMockUserAllied(request, 'f0548728', 1);
});

test.fixme('SmartPay API: GET /phone/register devuelve country_id=60 partner', async ({ request }) => {
    const res = await request.get(`${config.mockUrl}/api/onboarding/phone/register/${SMARTPAY_HASH}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.partner.name).toBe('SmartPay RD');
});

test.fixme('SmartPay API: /dynamic/:hash/schema devuelve theme-smartpay y ciudades DR', async ({ request }) => {
    const res = await request.get(`${config.mockUrl}/dynamic/${SMARTPAY_HASH}/schema`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.theme).toBe('theme-smartpay');
    expect(body.components.logo.boxs.userName.text).toBe('Vendedor SmartPay RD');
    expect(body.fields.city.options).toEqual(
        expect.arrayContaining(['Santo Domingo', 'Santiago', 'La Vega']),
    );
    // Negative: ciudades CO no deben aparecer en el schema RD.
    expect(body.fields.city.options).not.toContain('Bogotá');
});

test.fixme('SmartPay API: schema fallback para hashes no SmartPay devuelve Pullman', async ({ request }) => {
    const res = await request.get(`${config.mockUrl}/dynamic/3e67eade/schema`);
    const body = await res.json();
    expect(body.theme).toBe('theme-trustonic');
    expect(body.components.logo.boxs.userName.text).toBe('Vendedor Pullman');
});

test.fixme('SmartPay UI: request-amount renderiza con bypass + theme-smartpay', async ({ page }) => {
    await attachDevSession(page);

    const response = await page.goto(`/merchant/${SMARTPAY_HASH}/request-amount`);
    expect(response?.status()).toBe(200);

    // Verificación visual: el HTML SSR debe contener el theme y el vendor
    // que el mock devolvió para este hash.
    const content = await page.content();
    expect(content).toContain('theme-smartpay');
    expect(content).toContain('Vendedor SmartPay RD');
});

async function setupSmartPayHeaders(context: import('@playwright/test').BrowserContext) {
    // Headers aditivos (mismo patrón que Motai — page.route se pisa entre sí).
    await context.setExtraHTTPHeaders({ 'x-dev-session': DEV_SESSION });
}

async function runSmartPayUntilOtp(page: Page) {
    // 1. request-amount: el loader fetchea schema + products, crea sesión y
    //    rendea AmountForm con SearchableSelect (productos) + MoneyInput (monto).
    await page.goto(`/merchant/${SMARTPAY_HASH}/request-amount`);
    await page.getByPlaceholder('Buscar celular...').click();
    await page.getByRole('button', { name: /iPhone 15 Pro/i }).click();
    await page.getByTestId('dyn-amount-input').click();
    await page.keyboard.type('1500000', { delay: 30 });
    await page.getByTestId('dyn-amount-submit').click();

    // 2. request-phone.
    await page.waitForURL(/\/request-phone\?/, { timeout: 15_000 });
    await page.getByTestId('dyn-phone-input').click();
    await page.keyboard.type('3001234567', { delay: 30 });
    await page.getByTestId('dyn-phone-submit').click();

    // 3. request-otp: el FE ya invocó /dynamic/<hash>/send-otp.
    await page.waitForURL(/\/request-otp\?/, { timeout: 15_000 });
}

test.fixme('SmartPay E2E: request-amount → request-phone → request-otp (dynamic form flow)', async ({ page, context }) => {
    test.setTimeout(60_000);
    await setupSmartPayHeaders(context);
    await runSmartPayUntilOtp(page);
    expect(page.url()).toMatch(/\/request-otp/);
});

test.fixme('SmartPay E2E: request-otp → request-personal-info → request-financial-info', async ({ page, context }) => {
    test.setTimeout(120_000);
    await setupSmartPayHeaders(context);
    await runSmartPayUntilOtp(page);

    // 4. request-otp: el componente Otp shared usa testids `otp-input` + `otp-submit`
    //    (mismos que el flow standard). El mock valida cualquier código de 4 dígitos.
    await page.getByTestId('otp-input').click();
    await page.keyboard.type('1234', { delay: 30 });
    await page.getByTestId('otp-submit').click();

    // 5. request-personal-info: el PersonalInfoForm es hardcoded (no usa
    //    DynamicFormRenderer) con campos name/lastName/email/city/documentType/
    //    document/issueDay/Month/Year. Action checkea disponibilidad de email +
    //    document contra `/dynamic/full/find-user-by-{email,document-number}`.
    await page.waitForURL(/\/request-personal-info\?/, { timeout: 15_000 });

    await page.locator('#name').fill('JUAN');
    await page.locator('#lastName').fill('PEREZ');
    await page.locator('#email').fill(`juan${Date.now()}@example.com`);

    // City: Radix Select. Testid agregado en PersonalInfoForm.tsx.
    await page.getByTestId('dyn-city-trigger').click();
    await page.getByRole('option', { name: 'Santo Domingo' }).click();

    // Document type: RadioCard SmartPay tiene CED + PAS. CED = cédula dominicana.
    await page.getByRole('radio', { name: 'CED' }).click();

    // CED requiere 11 dígitos (CED_DOCUMENT_PATTERN en dynamic-step-one.ts:35).
    await page.locator('#document').fill('00112345678');

    // Date of birth: DateSelector tiene tres triggers (day/month/year). Los
    // testids del DateSelector (date-selector-day, etc.) son los mismos que
    // en el flow standard.
    await page.getByTestId('date-selector-day').click();
    await page.getByTestId('date-selector-day-option-15').click();
    await page.getByTestId('date-selector-month').click();
    await page.getByTestId('date-selector-month-option-6').click();
    await page.getByTestId('date-selector-year').click();
    await page.getByTestId('date-selector-year-option-1990').click();

    await page.getByTestId('dyn-personal-info-submit').click();

    // 6. request-financial-info: aterrizó después del submit + checks.
    await page.waitForURL(/\/request-financial-info\?/, { timeout: 20_000 });
});

test.fixme('SmartPay UI: sin bypass el wizard redirige a /login', async ({ page, context }) => {
    // Test de sanidad del guard. Sin X-Dev-Session, la auth NO debe ser bypaseada.
    // Limpiamos el contexto de cookies para no heredar sesión previa.
    await context.clearCookies();

    await page.goto(`/merchant/${SMARTPAY_HASH}/request-amount`);
    await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 5_000 });
});
