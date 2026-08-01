import { expect, test } from '@playwright/test';
import { seedAndOfferLender } from './close';
import { mockWompiHostedCheckout } from '../pkg/wompi-mock';
import { query } from '../pkg/db';

/**
 * Cierre Creditop X (rt=2) por UI — con el MURO DE CONFIG VOLTEADO.
 *
 * PRE: sembrar el lender sintético `cierre-x-test` (rt=2, min_initial_fee>0 en TODAS las categorías):
 *      `bin/close-lender`   (borrar: `bin/close-lender --clean`)
 * Y el wizard local arriba contra el stack local (`CFE_TARGET=local bin/asesor pullman`).
 *
 * QUÉ DESBLOQUEA (vs el viejo `creditopXClose` que LANZABA "walled"):
 *   El muro no era Wompi (`pkg/wompi-mock.ts` ya lo intercepta) sino el MOTOR DE SCORING: a un perfil
 *   aprobado el motor SQL asignaba una categoría con min_initial_fee=0 → cuota $0 → botón "Pagar cuota
 *   inicial" DISABLED → el redirect a Wompi nunca se disparaba. El lender sintético tiene fee>0 en TODAS
 *   las categorías → la asignada da >0 → el botón se HABILITA → llega a Wompi → mock → down-payment-validation.
 *
 * Espejo por UI del cierre backend `../backend-e2e: go run . asesor 3e67eade 77` (que forzaba initial_fee=0).
 */

const PULLMAN_HASH = '3e67eade';

async function synthLenderId(): Promise<number> {
    const rows = await query<{ id: number }>("SELECT id FROM lenders WHERE slug='cierre-x-test' LIMIT 1");
    if (!rows.length) throw new Error("falta el lender sintético — corré `bin/close-lender` primero");
    return rows[0].id;
}

test('rt=2 por UI: el lender sintético fee>0 llega a la cuota inicial (botón habilitado)', async ({ page }) => {
    test.setTimeout(120_000);
    const id = await synthLenderId();
    await mockWompiHostedCheckout(page);
    await seedAndOfferLender(page, PULLMAN_HASH, id, { score: 800, reportado: false });

    // Seleccionar plazo (combobox sin testid) + "Validar Pre aprobado" → la card expande la cuota inicial.
    const combo = page.getByRole('combobox').first();
    if (await combo.count()) {
        await combo.selectOption({ index: 1 }).catch(async () => {
            await combo.click().catch(() => {});
            await page.getByRole('option').first().click().catch(() => {});
        });
    }
    await page.getByTestId(`lender-action-${id}`).click();
    await page.waitForTimeout(1500);

    // EL DESBLOQUEO: con fee>0 el input de cuota inicial aparece con un mínimo > 0 (antes: $0 → deshabilitado).
    const fee = page.getByTestId('initial-fee-input');
    await expect(fee).toBeVisible({ timeout: 15_000 });
    await fee.fill('225000');
    const pay = page.getByRole('button', { name: /pagar|continuar|validar|siguiente/i }).last();
    await expect(pay).toBeEnabled(); // ← lo que #77 NO lograba (botón disabled por cuota $0)
    await pay.click();

    // Con el botón habilitado, el flujo dispara el redirect a Wompi → mock lo intercepta → down-payment-validation.
    await page.waitForURL(/\/(initial-fee-payment|down-payment-validation)/, { timeout: 20_000 });
    expect(page.url()).toMatch(/initial-fee-payment|down-payment-validation/);
});

/**
 * Cierre COMPLETO hasta loan-approved: bloqueado ya NO por config sino por los testids del Grupo B/C
 * (first-payment-date/payment-schedule/sign-documents/signature-otp/loan-approved) que faltan agregar al
 * stash del frontend-monorepo. La cadena post-pago está cableada (ver lender/close.ts) — es el paso 2 del
 * PLAN-PRUEBAS.md, ahora desbloqueado por close-lender.
 */
test.fixme('rt=2 por UI: cierre completo hasta loan-approved (pend. testids Grupo B/C)', async () => {});
