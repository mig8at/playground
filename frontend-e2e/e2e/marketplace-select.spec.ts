import { expect, test } from '@playwright/test';
import { runHappyPathUntilLenders } from '../channel/steps';

/**
 * Verifica el testid del marketplace `lender-action-{id}` (Grupo A del PLAN-PRUEBAS) — el bloqueador #1
 * para seleccionar un lender por UI. Pullman (3e67eade) ofrece Meddipay (#39); seleccionamos por testid
 * y aseveramos que el wizard AVANZA fuera de /lenders. Es la base de `lender/close.ts::selectLenderAndClose`.
 */

const PULLMAN_HASH = '3e67eade';
const OFFERED_LENDER_ID = 39; // Meddipay (lo que el marketplace ofrece para Pullman, verificado con `offer 3e67eade`)

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 150 } });

test('marketplace: el testid lender-action-{id} expone el CTA del lender de forma seleccionable', async ({
    page,
}) => {
    test.setTimeout(60_000);
    await runHappyPathUntilLenders(page, PULLMAN_HASH);
    // El testid del Grupo A hace seleccionable cada lender por id. (El destino al hacer click depende del
    // tipo: rt=1 Meddipay abre modal en /lenders; rt=2 navega al cierre — ver lender/creditopx-close.spec.ts.)
    const action = page.getByTestId(`lender-action-${OFFERED_LENDER_ID}`);
    await expect(action).toBeVisible({ timeout: 15_000 });
    await expect(action).toBeEnabled();
});
