import { test, expect, request } from '@playwright/test';
import type { Page } from '@playwright/test';
import { config, fakeScenarios } from '../pkg/config';
import { injectFakeScenario } from '../pkg/mock-control';
import { dictateTusdatosVerdict } from '../pkg/risk-lambda';
import { bureauSources, bureauSourceProblem } from '../pkg/loki';

const PARTNER = config.partnerHash;
/** Un comercio estándar (fuera del pipeline de KYC v2, sin Experian forzado): la cascada de identidad llega a
 *  TusDatos. Pullman, el de por defecto, corre Experian Quanto y los veredictos de TusDatos no se ven ahí. */
const STANDARD = process.env.E2E_KYC_STANDARD_HASH || '802df3ce';   // Tu Colchón (112) en la base local

test.describe.configure({ mode: 'serial' });

/**
 * Tests UI end-to-end del flujo KYC contra el `loan-request-wizard` real
 * con `data-testid` y `error_subcode` integrados (rama
 * `feature/onboarding/fe-obs-04` del frontend-monorepo).
 *
 * El paso OTP → /personal-info se saltea con navegación directa porque
 * el HttpClient compartido del FE descarta el `payload` cuando la
 * respuesta tiene `success: false`. Cuando el HttpClient se patchee, los
 * tests pueden volver al camino completo OTP → personal-info.
 */

async function createUserRequest(hash = PARTNER): Promise<{ phone: string; userRequestId: number }> {
    const api = await request.newContext({ baseURL: config.mockUrl });
    const phone = `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    await api.post('/api/onboarding/phone/register', {
        data: { phone_number: phone, otp_length: 4, terms: true, policies: true },
    });
    const otpRes = await api.post(`/api/onboarding/loan-application/otp-validate/${hash}`, {
        data: { cell_phone: phone, otp_code: '1234', original_amount: 1_000_000, amount: 1_000_000 },
    });
    const body = await otpRes.json();
    // `success:false` + ONB002 (usuario temporal) es lo normal: el id viene en `errors.payload`.
    const userRequestId = body?.payload?.user_request_id ?? body?.data?.payload?.user_request_id ?? body?.errors?.payload?.user_request_id;
    if (typeof userRequestId !== 'number') {
        throw new Error('Mock no devolvió user_request_id: ' + JSON.stringify(body));
    }
    return { phone, userRequestId };
}

function uniqueDoc(): string {
    return Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000).toString();
}

function personalInfoUrl(userRequestId: number, hash = PARTNER): string {
    return `/self-service/${hash}/${userRequestId}/personal-info`;
}

async function typeInto(page: Page, testId: string, value: string) {
    const locator = page.getByTestId(testId);
    await locator.click();
    // pressSequentially en vez de fill: los Input con custom onChange que
    // hacen `field.onChange(transformed(value))` (react-hook-form) a veces
    // ignoran .fill() porque el dispatching de eventos no triggea bien el
    // ciclo onChange custom → field.onChange. Tipear secuencial funciona
    // siempre porque cada keystroke dispara su propio onChange.
    //
    // Delay 50ms necesario: el `documentNumber` tiene
    // `onChange={(e) => field.onChange(e.target.value.replace(/[^0-9]/g, ""))}`
    // que crea un ciclo de re-render. Con delay menor algunos chars se
    // pierden — vimos que un docnum de 10 dígitos quedaba truncado a 5.
    await locator.pressSequentially(value, { delay: 50 });
}

async function fillIdentificationStep(
    page: Page,
    data: { docNum: string; name: string; surname: string; email: string },
) {
    await typeInto(page, 'docnum-input', data.docNum);
    await typeInto(page, 'name-input', data.name);
    await typeInto(page, 'surname-input', data.surname);
    await typeInto(page, 'email-input', data.email);
    await page.getByTestId('identification-submit').click();
}

async function fillExpeditionDateAndSubmit(
    page: Page,
    data: { day: number; month: number; year: number },
) {
    // Esperar a que el DateSelector esté montado.
    await expect(page.getByTestId('date-selector-day')).toBeVisible({ timeout: 10_000 });

    // Orden DÍA → MES → AÑO impuesto por el componente:
    //   - Mes está disabled hasta que día tenga valor (disableMonthUntilDay).
    //   - Año está disabled hasta que mes y día tengan valor (disableYearUntilMonthDay).
    // Usamos day=15 que es válido en cualquier mes → no se resetea al elegir mes.
    await page.getByTestId('date-selector-day').click();
    await page.getByTestId(`date-selector-day-option-${data.day}`).click();

    await page.getByTestId('date-selector-month').click();
    await page.getByTestId(`date-selector-month-option-${data.month}`).click();

    await page.getByTestId('date-selector-year').click();
    await page.getByTestId(`date-selector-year-option-${data.year}`).click();

    // Checkbox de confirmación de identidad.
    await page.getByRole('checkbox').first().check({ force: true });

    // Submit del segundo step.
    await page.getByTestId('expedition-date-submit').click();
}

test.fixme('happy path: identification + documentDate → siguiente paso', async ({ page }) => {
    await injectFakeScenario(page, fakeScenarios.otp.success, config.mockUrl);
    const { userRequestId } = await createUserRequest();

    await page.goto(personalInfoUrl(userRequestId));

    await fillIdentificationStep(page, {
        docNum: uniqueDoc(),
        name: 'JUAN',
        surname: 'PEREZ',
        email: 'juan.perez@example.com',
    });

    await fillExpeditionDateAndSubmit(page, { day: 15, month: 6, year: 2010 });

    // Happy path: mock devuelve ONB004 → FE navega a employment-info / lenders.
    await page.waitForURL(/employment-info|laboral-info|lenders/, { timeout: 15_000 });
});

// Las centrales se DICTAN al lambda (F-139): el encabezado `X-Fake-Scenario` ya no llega a ningún driver «fake» de
// burós en local. Cada prueba dicta para SU cédula y comprueba en el log que contestó el lambda, no el fixture.
// ⏸️ El dictado y la comprobación de origen ya están; lo que falta es la PANTALLA: los `data-testid` que usa
// (`docnum-input`, `expedition-date-error`…) son de la rama `feature/onboarding/fe-obs-04` del front, que no está en
// `main` (medido el 2026-11-03: cero coincidencias en origin/main). Se activa cuando esa rama entre.
test.fixme('OBS-KYC-03 UI: TusDatos con fecha de expedición que no coincide (dictado al lambda) → mensaje específico', async ({ page }) => {
    test.skip(String(process.env.E2E_TARGET || 'local') !== 'local', 'dicta al lambda local: sólo vale en local');
    const doc = uniqueDoc();
    expect(await dictateTusdatosVerdict(doc, 'issue-date-mismatch'), 'el lambda local no tomó el dictado').toBe(true);
    const { userRequestId } = await createUserRequest(STANDARD);

    await page.goto(personalInfoUrl(userRequestId, STANDARD));
    const from = Date.now();

    await fillIdentificationStep(page, {
        docNum: doc,
        name: 'JUAN',
        surname: 'PEREZ',
        email: 'juan.perez@example.com',
    });

    await fillExpeditionDateAndSubmit(page, { day: 15, month: 6, year: 2010 });

    // Tras OBS-KYC-03 en el FE, el mensaje específico de EXPEDITION_DATE_MISMATCH
    // debería aparecer. Si el FE legacy aún no consume error_subcode, se ve un
    // mensaje genérico — aceptamos ambos durante la transición.
    const errorLocator = page
        .getByTestId('expedition-date-error')
        .or(page.getByRole('alert'))
        .or(page.getByText(/coincide|registradur[íi]a|fecha/i));
    await expect(errorLocator.first()).toBeVisible({ timeout: 15_000 });
    await new Promise((r) => setTimeout(r, 4_000));
    const problem = bureauSourceProblem(await bureauSources(from - 1_000, Date.now() + 1_000), ['tusdatos']);
    expect(problem, problem ?? '').toBeNull();
});

// ⚠ «Documento inexistente» y «error del proveedor» NO se pueden ejercitar por el lambda: el backend trata cualquier
// respuesta no-2xx del lambda como caída y sigue con el fixture de respaldo, y el formulario pasa como validado
// (`Tusdatos.php`/`Experian.php`; medido el 2026-11-03, ver `channel/kyc-subcodes.spec.ts`). Quedan en `fixme`.
test.fixme('OBS-KYC-03 UI: scenario kyc-doc-not-found → mensaje específico', async ({ page }) => {
    const { userRequestId } = await createUserRequest();

    await page.goto(personalInfoUrl(userRequestId));

    await fillIdentificationStep(page, {
        docNum: uniqueDoc(),
        name: 'JUAN',
        surname: 'PEREZ',
        email: 'juan.perez@example.com',
    });

    await fillExpeditionDateAndSubmit(page, { day: 15, month: 6, year: 2010 });

    const errorLocator = page
        .getByTestId('expedition-date-error')
        .or(page.getByRole('alert'))
        .or(page.getByText(/documento|encontrado|registradur[íi]a/i));
    await expect(errorLocator.first()).toBeVisible({ timeout: 15_000 });
});

test.fixme('OBS-KYC-03 UI: scenario kyc-provider-error → mensaje accionable', async ({ page }) => {
    const { userRequestId } = await createUserRequest();

    await page.goto(personalInfoUrl(userRequestId));

    await fillIdentificationStep(page, {
        docNum: uniqueDoc(),
        name: 'JUAN',
        surname: 'PEREZ',
        email: 'juan.perez@example.com',
    });

    await fillExpeditionDateAndSubmit(page, { day: 15, month: 6, year: 2010 });

    const errorLocator = page
        .getByTestId('expedition-date-error')
        .or(page.getByRole('alert'))
        .or(page.getByText(/problema|inv[áa]lid|inval|error|m[áa]s tarde/i));
    await expect(errorLocator.first()).toBeVisible({ timeout: 15_000 });
});
