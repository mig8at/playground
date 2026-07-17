import { execSync } from 'node:child_process';
import { expect, type Page, test } from '@playwright/test';
import { fillAmountStep } from '../pkg/wizard-steps';

/**
 * Pullman → elegir "Sí" en Confirmación de cupo hace que el backend SALTE el buró (Experian).
 *
 * El test está enfocado en las DOS verdades de datos de la feature:
 *   1) GUARDA EN DB: al elegir "Sí", tras el OTP el front hace
 *      POST /api/v1/user-request/{id}/flow-signature/already-confirmed-pre-approval
 *      → persiste user_requests.flow_id = 2.
 *   2) EL BURÓ LEE DE DB Y SALTA: con flow_id=2 el backend NO consulta Experian. Lo verificamos
 *      con la API de trigger check-hard-rules-trigger → RKV24029 ("...already has ready pre-approvals"),
 *      que es la misma decisión que hace Experian::creditScore (devuelve null) leyendo ese flow_id.
 *
 * Recorremos el UI real solo para PROVOCAR el guardado (la selección "Sí" es lo que dispara el POST);
 * las aserciones son sobre la DB / la lectura de la DB, no sobre el DOM.
 *
 * PRE-REQS (stack local; ver pullman-confirmacion-cupo.spec.ts):
 *   make up · migración flow_id aplicada · setting allowed_to_omit_experian_allieds con Pullman (94/121) ·
 *   wizard :5174 → local. Teléfono bypass de OTP (código = últimos 4).
 */

const PULLMAN_HASH = process.env.E2E_PULLMAN_HASH ?? process.env.E2E_PARTNER_HASH ?? '3e67eade';
const BYPASS_PHONE = process.env.E2E_OTP_BYPASS_PHONE ?? '3131010101';
const BACKEND = 'http://127.0.0.1:80';
const HOST = 'legacy-backend.inertia-develop';
const LOCAL_ENV = { ...process.env, E2E_TARGET: 'local' };

/** flow_id persistido del user_request (vía dbops, target local). */
function flowIdOf(userRequestId: string): number | null {
    const out = execSync(`node bin/dbops.ts flow-id ${userRequestId}`, { env: LOCAL_ENV }).toString();
    return (JSON.parse(out).flowId ?? null) as number | null;
}

/** code del trigger de buró: RKV24029 = Experian OMITIDO porque el flujo ya trae pre-aprobados. */
function experianTriggerCode(userRequestId: string): string {
    const out = execSync(
        `curl -s -H 'Host: ${HOST}' ${BACKEND}/api/v2/risk/check-hard-rules-trigger/experian-acierta/${userRequestId}`,
    ).toString();
    return JSON.parse(out).code as string;
}

/** Recorre monto→(Sí/No)→teléfono→OTP (flujo clásico) y devuelve el user_request id (de la URL post-OTP). */
async function driveUntilAfterOtp(page: Page, confirmQuota: 'yes' | 'no'): Promise<string> {
    // Cliente fresco para el teléfono bypass → register limpio → OTP = últimos 4.
    execSync(`node bin/dbops.ts scrubphone ${BYPASS_PHONE}`, { env: LOCAL_ENV, stdio: 'ignore' });

    await page.goto(`/self-service/${PULLMAN_HASH}/solicitar`);
    await fillAmountStep(page, '1500000', confirmQuota); // llena monto + elige Sí/No + "Iniciar solicitud"

    // Paso teléfono (clásico, sin testid → locators semánticos).
    await page.getByPlaceholder('3001234567').fill(BYPASS_PHONE);
    await page.getByRole('button', { name: /continuar/i }).click();

    // OTP (código bypass = últimos 4 del teléfono). El POST del flow-signature se dispara en el action del OTP.
    await expect(page.getByText(/ingresa el código/i)).toBeVisible({ timeout: 20_000 });
    await page.locator('input[name="otp"]').fill(BYPASS_PHONE.slice(-4));
    await page.getByRole('button', { name: /confirmar/i }).click();

    await page.waitForURL(/\/\d+\/(?:personal-info|employment-info|lenders)/, { timeout: 30_000 });
    const id = page.url().match(/\/(\d+)\/(?:personal-info|employment-info|lenders)/)?.[1];
    expect(id, `no encontré loanRequestId en la URL: ${page.url()}`).toBeTruthy();
    return id as string;
}

test.describe('Pullman · "Sí" guarda flow_id=2 y el buró (Experian) se salta', () => {
    test.describe.configure({ mode: 'serial' });

    test('"Sí" → GUARDA flow_id=2 en DB → el buró LEE la DB y lo OMITE (RKV24029)', async ({ page }) => {
        test.setTimeout(90_000);
        const id = await driveUntilAfterOtp(page, 'yes');
        // 1) se guardó en DB
        expect(flowIdOf(id), 'al elegir "Sí" el POST debe persistir user_requests.flow_id = 2').toBe(2);
        // 2) la validación de buró lee ese flow_id y salta Experian
        expect(experianTriggerCode(id), 'con flow_id=2 el buró se omite (leído de DB)').toBe('RKV24029');
    });

    test('"No" → flujo estándar (flow_id≠2) → el buró NO se salta', async ({ page }) => {
        test.setTimeout(90_000);
        const id = await driveUntilAfterOtp(page, 'no');
        expect(flowIdOf(id), 'con "No" no se firma el flujo pre-aprobado').not.toBe(2);
        expect(experianTriggerCode(id), 'sin pre-aprobado el buró NO se omite por flujo').not.toBe('RKV24029');
    });
});
