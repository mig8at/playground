import { test, expect, type Page } from '@playwright/test';
import { config, fakeScenarios } from '../pkg/config';
import { injectFakeScenario } from '../pkg/mock-control';
import {
    fillEmploymentInfo,
    fillExpeditionDate,
    fillOtpStep,
    fillPersonalInfoIdentification,
    fillPhoneStep,
} from '../channel/steps';

/**
 * UI tests del flujo 05 "Motai Renting" (lender_id=158, hash `motai001`).
 *
 * Diferencias del flujo Motai vs. otros merchant:
 *   - Entry point `/merchant/<hash>/modes` (pantalla de selección de modo),
 *     no `/merchant/<hash>/request-amount`.
 *   - `partner_modes` no vacío en la respuesta del partner — default-layout
 *     redirige a /modes cuando el array tiene entries.
 *   - Imagen `<img alt="motai-logo">` (vs `partnerName` en self-service).
 *   - Background image MotaiBg (paleta azul oscura #010C4E).
 *   - Al seleccionar el modo, posteo de form establece session `merchant-mode`
 *     y redirige a /merchant/<hash>/solicitar?step=phoneNumber.
 *
 * El bypass `X-Dev-Session` es requisito porque /merchant/* exige Cognito.
 */

const MOTAI_HASH = 'motai001';
const DEV_SESSION = 'e2e-local-only-do-not-deploy';

test.describe.configure({ mode: 'serial' });

async function setMockUserAllied(request: import('@playwright/test').APIRequestContext, hash: string, countryId: number) {
    const res = await request.post(`${config.mockUrl}/__mock/state`, {
        data: { userAlliedHash: hash, userAlliedCountryId: countryId },
    });
    expect(res.ok()).toBeTruthy();
}

async function attachDevSession(page: Page) {
    await page.route('**/*', async (route) => {
        const headers = { ...route.request().headers(), 'x-dev-session': DEV_SESSION };
        await route.continue({ headers });
    });
}

test.beforeEach(async ({ request }) => {
    await setMockUserAllied(request, MOTAI_HASH, 1);
});

test.afterAll(async ({ request }) => {
    await setMockUserAllied(request, 'f0548728', 1);
});

test.fixme('Motai API: GET /phone/register/:hash devuelve partner_modes con motai-renting', async ({ request }) => {
    const res = await request.get(`${config.mockUrl}/api/onboarding/phone/register/${MOTAI_HASH}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    expect(body.data.partner.id).toBe(158);
    expect(body.data.partner.name).toBe('Motai Renting');

    const codes = body.data.partner_modes.map((m: { code: string }) => m.code);
    expect(codes).toContain('motai-renting');
    expect(body.data.partner_modes.every((m: { is_enabled: boolean }) => m.is_enabled)).toBe(true);
});

test.fixme('Motai API: partners sin modos retornan partner_modes vacío', async ({ request }) => {
    // Sanity: el partner Pullman (3e67eade) NO debe disparar la pantalla de modos.
    const res = await request.get(`${config.mockUrl}/api/onboarding/phone/register/3e67eade`);
    const body = await res.json();
    expect(body.data.partner_modes).toEqual([]);
});

test.fixme('Motai UI: /merchant/<hash>/modes renderiza con bypass + logo motai', async ({ page }) => {
    await attachDevSession(page);

    const response = await page.goto(`/merchant/${MOTAI_HASH}/modes`);
    expect(response?.status()).toBe(200);

    // Logo distintivo del componente MerchantMode.
    await expect(page.locator('img[alt="motai-logo"]').first()).toBeVisible({ timeout: 10_000 });
    // Heading textual.
    await expect(page.getByText(/Selecciona una opci[óo]n/i).first()).toBeVisible();
});

test.fixme('Motai UI: ambos botones de modo están visibles y son submit buttons', async ({ page }) => {
    await attachDevSession(page);
    await page.goto(`/merchant/${MOTAI_HASH}/modes`);

    const motaiBtn = page.getByRole('button', { name: /Motai Renting/i });
    const standardBtn = page.getByRole('button', { name: /Cr[éeé]dito Est[áa]ndar/i });

    await expect(motaiBtn).toBeVisible();
    await expect(standardBtn).toBeVisible();
});

test.fixme('Motai UI: click en "Motai Renting" persiste el merchant-mode y redirige a /solicitar', async ({ page }) => {
    await attachDevSession(page);
    await page.goto(`/merchant/${MOTAI_HASH}/modes`);

    await page.getByRole('button', { name: /Motai Renting/i }).click();

    // El action en merchant-mode.tsx:27 redirige a `${partner_hash}/solicitar?step=phoneNumber`.
    await page.waitForURL(/\/merchant\/motai001\/solicitar\?step=phoneNumber/, { timeout: 10_000 });
    expect(page.url()).toContain('/merchant/motai001/solicitar');
    expect(page.url()).toContain('step=phoneNumber');
});

test.fixme('Motai UI: sin bypass redirige a /login', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto(`/merchant/${MOTAI_HASH}/modes`);
    await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 5_000 });
});

// --- E2E helpers compartidos por los 3 tests de Motai -----------------------

async function setupMotaiHeaders(context: import('@playwright/test').BrowserContext) {
    // attachDevSession + injectFakeScenario ambos hacen page.route('**/*') y
    // se pisan entre sí (el último gana). Usamos setExtraHTTPHeaders que es
    // aditivo y persiste durante toda la sesión.
    await context.setExtraHTTPHeaders({
        'x-dev-session': DEV_SESSION,
        'x-fake-scenario': fakeScenarios.otp.success,
    });
}

async function pickMotaiMode(page: Page, mode: 'motai-renting' | 'credit-standard') {
    await page.goto(`/merchant/${MOTAI_HASH}/modes`);
    const label = mode === 'motai-renting' ? /Motai Renting/i : /Cr[éeé]dito Est[áa]ndar/i;
    await page.getByRole('button', { name: label }).click();
    await page.waitForURL(/\/merchant\/motai001\/solicitar/, { timeout: 10_000 });
}

async function runMotaiFlowUntilLenders(
    page: Page,
    options: { documentType?: 'CC' | 'CE' | 'PEP' } = {},
) {
    const { documentType = 'CC' } = options;

    // Mode picker ya pasó. Acá retomamos en phone step.
    await fillPhoneStep(page);
    await fillOtpStep(page);
    await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 15_000 });

    // Si el caller pide algo distinto de CC (default), seleccionar antes del
    // resto del form. RadioCard de Radix → click en el item con value=X.
    if (documentType !== 'CC') {
        await page.getByTestId('doctype-radio').locator(`[value="${documentType}"]`).click();
    }

    await fillPersonalInfoIdentification(page);
    await fillExpeditionDate(page);
    await page.waitForURL(/\/employment-info(\?|$)/, { timeout: 15_000 });
    await fillEmploymentInfo(page);
    await page.waitForURL(/\/lenders(\?|$)/, { timeout: 20_000 });
}

test.fixme('Motai E2E (motai-renting): modes → phone → otp → personal → laboral → lenders', async ({ page, context }) => {
    test.setTimeout(90_000);
    await setupMotaiHeaders(context);

    await pickMotaiMode(page, 'motai-renting');
    await runMotaiFlowUntilLenders(page);

    expect(page.url()).toMatch(/\/merchant\/motai001/);
    expect(page.url()).toMatch(/\/lenders/);
});

test.fixme('Motai E2E (credit-standard): modes → phone → otp → personal → laboral → lenders', async ({ page, context }) => {
    test.setTimeout(90_000);
    await setupMotaiHeaders(context);

    await pickMotaiMode(page, 'credit-standard');
    await runMotaiFlowUntilLenders(page);

    expect(page.url()).toMatch(/\/merchant\/motai001/);
    expect(page.url()).toMatch(/\/lenders/);
});

test.fixme('Motai E2E (motai-renting): document-type PEP habilitado y aceptado', async ({ page, context }) => {
    test.setTimeout(90_000);
    await setupMotaiHeaders(context);

    // El flow completo con PEP — runMotaiFlowUntilLenders selecciona PEP
    // dentro del form de personal-info. Si PEP no estuviera disponible (gating
    // en personal-info-form.tsx:53-57), el click fallaría.
    await pickMotaiMode(page, 'motai-renting');
    await runMotaiFlowUntilLenders(page, { documentType: 'PEP' });

    expect(page.url()).toMatch(/\/lenders/);
});

// --- Motai lender pick (lender 158 → /continue) -----------------------------
// El FE chequea MOTAI_LENDER_IDS=[158] en available-lenders.tsx:332 y, cuando
// el usuario pickea ese lender, short-circuitea cualquier otra lógica para
// redirigir directo a /continue (sub-flujo Abaco).

test.fixme('Motai E2E: pick lender 158 en /lenders → redirige a /continue', async ({ page, context }) => {
    test.setTimeout(90_000);
    await setupMotaiHeaders(context);
    await pickMotaiMode(page, 'motai-renting');
    await runMotaiFlowUntilLenders(page);

    // En el flow merchant Motai el amount no se setea hasta /lenders (el
    // mode-picker entra por ?step=phoneNumber saltando amount). La pantalla
    // de lenders pide ingresar el monto antes de mostrar las opciones.
    await page.getByTestId('lenders-amount-input').click();
    await page.keyboard.type('1500000', { delay: 30 });

    // Los lenders rt=1 (Motai Renting) van en OtherLendersSection con un
    // CollapsibleLenderCard: hay que expandirlo primero clickeando el header
    // (el botón outer con el nombre del lender) antes de que el botón inner
    // de acción se vuelva clickeable.
    await page.getByRole('button', { name: /Motai Renting/i }).first().click();
    const motaiBtn = page.getByTestId('lender-action-158');
    await expect(motaiBtn).toBeVisible({ timeout: 15_000 });
    await motaiBtn.click();

    // Para Motai, el short-circuit en available-lenders.tsx:332 lleva a /continue.
    await page.waitForURL(/\/merchant\/motai001\/\d+\/continue(\?|$)/, { timeout: 15_000 });
});

// --- Abaco sub-flow ---------------------------------------------------------
// Mock endpoints añadidos en validation-driven/MOCK_SERVER/server.ts (sección
// "MOTAI ENDPOINTS"). Acá validamos el contrato API. La UI completa de Abaco
// (/abaco/platforms, /abaco/platform-otp-validation) requiere agregar testids
// en 4 componentes del FE para ser testeable end-to-end — deferred.

test.fixme('Abaco API: check-abaco-requirement default = NOT_REQUIRED', async ({ request }) => {
    const res = await request.post(
        `${config.mockUrl}/api/onboarding/motai/check-abaco-requirement`,
        { data: { userRequestId: 123 } },
    );
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.code).toBe('NOT_REQUIRED');
});

test.fixme('Abaco API: X-Fake-Scenario abaco-required → code REQUIRED', async ({ request }) => {
    const res = await request.post(
        `${config.mockUrl}/api/onboarding/motai/check-abaco-requirement`,
        {
            data: { userRequestId: 123 },
            headers: { 'X-Fake-Scenario': 'abaco-required' },
        },
    );
    expect((await res.json()).data.code).toBe('REQUIRED');
});

test.fixme('Abaco API: X-Fake-Scenario abaco-error → code INTERNAL_ERROR', async ({ request }) => {
    const res = await request.post(
        `${config.mockUrl}/api/onboarding/motai/check-abaco-requirement`,
        {
            data: { userRequestId: 123 },
            headers: { 'X-Fake-Scenario': 'abaco-error' },
        },
    );
    expect((await res.json()).data.code).toBe('INTERNAL_ERROR');
});

test.fixme('Abaco API: scraping/platforms devuelve catálogo de plataformas gig', async ({ request }) => {
    const res = await request.get(`${config.mockUrl}/api/onboarding/scraping/platforms`);
    const body = await res.json();
    const slugs = body.data.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain('rappi');
    expect(slugs).toContain('uber');
    expect(slugs).toContain('didi');
});

test.fixme('Abaco API: scraping/init/gig-economy retorna token + sessionId', async ({ request }) => {
    const res = await request.post(`${config.mockUrl}/api/onboarding/scraping/init/gig-economy`, {
        data: { partnerBranchId: MOTAI_HASH, creditProcessId: 555 },
    });
    const body = await res.json();
    expect(body.data.token).toContain('abaco-token-555');
    expect(body.data.customerId).toContain('cust-555');
    expect(body.data.sessionId).toBeTruthy();
});

test.fixme('Abaco API: scraping/login/step-1 happy path → sessionCookie', async ({ request }) => {
    const res = await request.post(`${config.mockUrl}/api/onboarding/scraping/login/step-1`, {
        data: { token: 't', platform: 'rappi', credentials: {} },
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.result).toBe('success');
    expect(body.data.sessionCookie).toBeTruthy();
});

test.fixme('Abaco API: scraping/login/step-1 con scenario bad-creds → error', async ({ request }) => {
    const res = await request.post(`${config.mockUrl}/api/onboarding/scraping/login/step-1`, {
        data: { token: 't', platform: 'rappi', credentials: {} },
        headers: { 'X-Fake-Scenario': 'abaco-step1-bad-creds' },
    });
    const body = await res.json();
    expect(body.data.result).toBe('error');
    expect(body.data.errors).toContain('Credenciales inválidas');
});

test.fixme('Abaco UI: navegación directa a /abaco renderiza AbacoRedirect con CTA', async ({ page, context }) => {
    test.setTimeout(60_000);
    await setupMotaiHeaders(context);

    // Necesitamos un loan_request_id válido para que el layout del /abaco
    // pueda fetchear loan-request-details. Lo creamos haciendo el handshake
    // mínimo phone/otp con el mock.
    const phone = `301${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    await page.request.post(`${config.mockUrl}/api/onboarding/phone/register`, {
        data: { phone_number: phone, otp_length: 4, terms: true, policies: true },
    });
    const validate = await page.request.post(
        `${config.mockUrl}/api/onboarding/loan-application/otp-validate/${MOTAI_HASH}`,
        { data: { cell_phone: phone, otp_code: '1234', amount: 1500000 } },
    );
    const userRequestId = (await validate.json()).payload.user_request_id;

    // Las rutas /abaco/* solo existen bajo /:flow/ (self-service), no bajo
    // /merchant/. Confirmado en apps/loan-request-wizard/app/routes.ts:36-41.
    // El loan_request_id sigue siendo válido y el mock devuelve los detalles
    // del lender Motai sin importar el flow path.
    await page.goto(`/self-service/${MOTAI_HASH}/${userRequestId}/abaco`);

    // El AbacoRedirect renderiza con un CTA "Ir a Abaco" — testid agregado
    // en abaco/src/ui/components/AbacoRedirect.tsx:43.
    const cta = page.getByTestId('abaco-redirect-btn');
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await expect(cta).toContainText(/Ir a Abaco/i);

    // Click → navega a /abaco/platforms (handleRedirect en AbacoRedirect.tsx
    // espera 1-2s antes del onNext, dejamos margen).
    await cta.click();
    await page.waitForURL(/\/abaco\/platforms(\?|$)/, { timeout: 10_000 });

    // En /platforms aparecen las cards de cada plataforma del mock (rappi,
    // uber, didi). Testid agregado en PlatformCard.tsx:52.
    await expect(page.getByTestId('abaco-platform-rappi')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('abaco-platform-uber')).toBeVisible();
    await expect(page.getByTestId('abaco-platform-didi')).toBeVisible();
});

test.fixme('Abaco UI: seleccionar plataforma rappi muestra input de email', async ({ page, context }) => {
    test.setTimeout(60_000);
    await setupMotaiHeaders(context);

    const phone = `301${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    await page.request.post(`${config.mockUrl}/api/onboarding/phone/register`, {
        data: { phone_number: phone, otp_length: 4, terms: true, policies: true },
    });
    const validate = await page.request.post(
        `${config.mockUrl}/api/onboarding/loan-application/otp-validate/${MOTAI_HASH}`,
        { data: { cell_phone: phone, otp_code: '1234', amount: 1500000 } },
    );
    const userRequestId = (await validate.json()).payload.user_request_id;

    await page.goto(`/self-service/${MOTAI_HASH}/${userRequestId}/abaco/platforms`);

    // Click en rappi (login=email en el mock).
    await page.getByTestId('abaco-platform-rappi').click();

    // Aparece el input de email — testid agregado en CredentialSelection.tsx:268.
    await expect(page.getByTestId('abaco-credentials-email-input')).toBeVisible({ timeout: 10_000 });

    // El botón de guardar aparece pero está disabled hasta que se llena email válido.
    const saveBtn = page.getByTestId('abaco-credentials-save-btn');
    await expect(saveBtn).toBeVisible();

    // Llenar email válido habilita el save.
    await page.getByTestId('abaco-credentials-email-input').fill('test@creditop.com');
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
});

test.fixme('Abaco API: scraping/results retorna completed=true con income_summary', async ({ request }) => {
    const res = await request.post(`${config.mockUrl}/api/onboarding/scraping/results`, {
        data: { customerId: 'c', creditProcessId: 1 },
    });
    const body = await res.json();
    expect(body.data.completed).toBe(true);
    expect(body.data.income_summary.monthly_avg).toBeGreaterThan(0);
});

test.fixme('Motai E2E (credit-standard): document-type PEP NO disponible', async ({ page, context }) => {
    test.setTimeout(60_000);
    await setupMotaiHeaders(context);

    await pickMotaiMode(page, 'credit-standard');
    await fillPhoneStep(page);
    await fillOtpStep(page);
    await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 15_000 });

    // En credit-standard, PEP queda filtrado del array de opciones.
    // CC y CE deben estar; PEP no debería existir.
    await expect(page.getByTestId('doctype-radio').locator('[value="CC"]')).toBeVisible();
    await expect(page.getByTestId('doctype-radio').locator('[value="PEP"]')).toHaveCount(0);
});
