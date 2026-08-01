import { test, expect } from '@playwright/test';
import { config } from '../pkg/config';
import { runHappyPathUntilLenders } from '../channel/steps';

/**
 * UI tests del flujo 10 "Credifamilia" (lender_id=24).
 *
 * Credifamilia es un lender post-marketplace que aparece en la lista de
 * opciones cuando el partner está habilitado para él. El partner registrado
 * en el mock con `credifam001` incluye [Credipullman X, Credifamilia, Medipay].
 *
 * Cobertura:
 *   - API: el endpoint /lenders devuelve a Credifamilia con id=24, response_type=1.
 *   - UI: la pantalla de lenders renderiza Credifamilia como una opción visible.
 *   - Sanity: partners sin Credifamilia (Pullman default) no lo muestran.
 *
 * La cobertura del happy path completo (monto→phone→otp→personal→laboral→lenders)
 * vive en happy-path-e2e.spec.ts — este spec se enfoca solo en validar que
 * Credifamilia llega a la pantalla y se diferencia del resto.
 */

const CREDIFAM_HASH = 'credifam001';

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 500 } });

test.fixme('Credifamilia API: getLenders incluye lender id=24 para hash credifam001', async ({ request }) => {
    const phone = `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    await request.post(`${config.mockUrl}/api/onboarding/phone/register`, {
        data: { phone_number: phone, otp_length: 4, terms: true, policies: true },
    });
    const validate = await request.post(
        `${config.mockUrl}/api/onboarding/loan-application/otp-validate/${CREDIFAM_HASH}`,
        { data: { cell_phone: phone, otp_code: '1234', amount: 1500000 } },
    );
    const userRequestId = (await validate.json()).payload.user_request_id;

    const res = await request.get(`${config.mockUrl}/api/onboarding/loan-application/lenders/${userRequestId}`);
    const lenders = (await res.json()).data.lenders;

    const credifamilia = lenders.find((l: { id: number }) => l.id === 24);
    expect(credifamilia, 'Esperaba un lender con id=24 (Credifamilia)').toBeDefined();
    expect(credifamilia.name).toBe('Credifamilia');
});

test.fixme('Credifamilia sanity: hash Pullman default (3e67eade) NO incluye Credifamilia', async ({ request }) => {
    const phone = `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    await request.post(`${config.mockUrl}/api/onboarding/phone/register`, {
        data: { phone_number: phone, otp_length: 4, terms: true, policies: true },
    });
    const validate = await request.post(
        `${config.mockUrl}/api/onboarding/loan-application/otp-validate/3e67eade`,
        { data: { cell_phone: phone, otp_code: '1234', amount: 1500000 } },
    );
    const userRequestId = (await validate.json()).payload.user_request_id;

    const res = await request.get(`${config.mockUrl}/api/onboarding/loan-application/lenders/${userRequestId}`);
    const ids = (await res.json()).data.lenders.map((l: { id: number }) => l.id);
    expect(ids).not.toContain(24);
});

test.fixme('Credifamilia UI: el nombre "Credifamilia" aparece en la pantalla de lenders', async ({ page }) => {
    await runHappyPathUntilLenders(page, CREDIFAM_HASH);
    await expect(page.getByText(/Credifamilia/i).first()).toBeVisible({ timeout: 15_000 });
});

// --- Polling pre-approval-status ------------------------------------------
// Después de seleccionar Credifamilia en /lenders, el FE polea
// GET /api/onboarding/loan-application/lenders/:user_request_id/:lender_id/pre-approval-status
// para chequear si el cliente fue pre-aprobado. La ruta UI dedicada
// (/lenders/24/transaction-status) es loader-only (no rendea componente) —
// la consume otro flow externo. Acá testeamos: shape API + que la ruta del
// FE consume bien la respuesta sin errores.

test.fixme('Credifamilia API: pre-approval-status default = approved con shape Credifamilia', async ({ request }) => {
    const res = await request.get(
        `${config.mockUrl}/api/onboarding/loan-application/lenders/555/24/pre-approval-status`,
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    expect(body.data.is_approved).toBe(true);
    expect(body.data.is_completed).toBe(true);
    expect(body.data.transaction_id).toBe('TX-555-24');

    // Campos en español del shape Credifamilia (lender-transaction-status.entity.ts:13-25).
    const r = body.data.response;
    expect(r.valor_disponible_para_comprar).toBe(3_500_000);
    expect(r.plazo).toBe(36);
    expect(r.total_cuota_mensual).toBe(100_000);
});

test.fixme('Credifamilia API: X-Fake-Scenario credifamilia-rejected → is_approved=false + valor=0', async ({ request }) => {
    const res = await request.get(
        `${config.mockUrl}/api/onboarding/loan-application/lenders/555/24/pre-approval-status`,
        { headers: { 'X-Fake-Scenario': 'credifamilia-rejected' } },
    );
    const body = await res.json();
    expect(body.data.is_approved).toBe(false);
    expect(body.data.response.valor_disponible_para_comprar).toBe(0);
    expect(body.data.response.total_cuota_mensual).toBe(0);
});

test.fixme('Credifamilia API: otros lender_ids usan el shape genérico (available_credit, etc.)', async ({ request }) => {
    const res = await request.get(
        `${config.mockUrl}/api/onboarding/loan-application/lenders/555/170/pre-approval-status`,
    );
    const body = await res.json();
    expect(body.data.response.available_credit).toBe(3_500_000);
    expect(body.data.response.installments).toBe(24);
    // Las claves Credifamilia NO deben aparecer cuando lender_id !== 24.
    expect(body.data.response.valor_disponible_para_comprar).toBeUndefined();
});

test.fixme('Credifamilia UI: ruta /lenders/24/transaction-status responde 200 con la data del polling', async ({ page }) => {
    test.setTimeout(60_000);
    // Necesitamos un loan_request_id válido en el mock.
    const phone = `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    await page.request.post(`${config.mockUrl}/api/onboarding/phone/register`, {
        data: { phone_number: phone, otp_length: 4, terms: true, policies: true },
    });
    const validate = await page.request.post(
        `${config.mockUrl}/api/onboarding/loan-application/otp-validate/${CREDIFAM_HASH}`,
        { data: { cell_phone: phone, otp_code: '1234', amount: 1500000 } },
    );
    const userRequestId = (await validate.json()).payload.user_request_id;

    // Loader-only route: navegar invoca el loader (que consume el mock) y
    // valida shape. Si el parsing falla, captureServerException dispara y la
    // respuesta llega con error: <mensaje>.
    const res = await page.goto(
        `/self-service/${CREDIFAM_HASH}/${userRequestId}/lenders/24/transaction-status`,
    );
    expect(res?.status()).toBe(200);
});
