import { expect, test } from '@playwright/test';
import { seedAndOfferLender } from './close';

/**
 * Cierre Creditop X (rt=2) por UI — eje LENDER. Espejo de backend-e2e `asesor 3e67eade 77`.
 * ✅ VERDE: la base (sembrar perfil → el marketplace OFRECE el lender rt=2 #77, seleccionable por UI).
 * ⏸️ El cierre completo (Validar Pre aprobado → … → loan-approved) queda en fixme (ver lender/close.ts).
 */

const PULLMAN_HASH = '3e67eade';
const CREDIPULLMAN_ID = 77; // rt=2 Creditop X

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 150 } });

test('Creditop X: sembrar perfil → marketplace OFRECE CrediPullman #77 (rt=2) seleccionable por UI', async ({
    page,
}) => {
    test.setTimeout(90_000);
    await seedAndOfferLender(page, PULLMAN_HASH, CREDIPULLMAN_ID, { score: 800, reportado: false });
    // #77 ofrecido = el seed hizo que el Perfilador lo ofrezca (con perfil de onboarding NO aparece).
    await expect(page.getByTestId(`lender-action-${CREDIPULLMAN_ID}`)).toBeVisible();
});

test.fixme('Creditop X: cierre completo por UI hasta loan-approved (pendiente Grupo B/C + pre-aprobación)', async () => {
    // Ver lender/close.ts::creditopXClose. Tras "Validar Pre aprobado" el wizard queda en /lenders;
    // resolver ese paso + driver las pantallas de cierre con los testids del Grupo B/C.
    // Cierre ya validado en backend-e2e: `go run . asesor 3e67eade 77` → Estado 11.
});
