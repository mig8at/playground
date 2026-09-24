import { test, expect } from '@playwright/test';
import { runHappyPathUntilLenders } from '../channel/steps';

/**
 * UI test del flujo Cupo Rotativo (response_type=3) contra el LEGACY-BACKEND REAL en modo mock.
 *
 * Lo distintivo de rt=3 (lender con `response_type:3`, CTA "Validar Pre aprobado", pantalla
 * `RevolvingCreditIntro`, Pagaré Maestro 1ª compra / dedup 2ª) depende de que el MARKETPLACE OFREZCA
 * un lender rt=3, lo que requiere config/seed de oferta (territorio del Perfilador). Eso ya está
 * validado a nivel backend en `backend-e2e` (`go run . asesor 3e67eade 71` → Estado 11 + Pagaré Maestro).
 * Por UI aquí solo aseguramos que el flujo del partner llega a /lenders; las aserciones de oferta rt=3
 * quedan `fixme` hasta sembrar un branch que ofrezca rt=3 por la UI.
 *
 * ⚠️ El hash viejo `cup0r0t01` y los nombres de lender ("Cupo Rotativo Creditop", "Credipullman X",
 * "Medipay") eran del `partner-registry.ts` del mock-server :4000 (ELIMINADO). Usamos un hash real.
 */

const PARTNER_HASH = '3e67eade'; // Pullman (allied 94) real

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 200 } });

test('Cupo Rotativo — flujo del partner llega a /lenders (real stack)', async ({ page }) => {
    test.setTimeout(60_000);
    await runHappyPathUntilLenders(page, PARTNER_HASH);
    expect(page.url()).toMatch(/\/lenders/);
});

test.fixme('Cupo Rotativo: el marketplace ofrece un lender rt=3 + RevolvingCreditIntro (sembrar oferta rt=3)', async () => {
    // Requiere un branch que OFREZCA un lender rt=3 (seed de lenders_by_allieds + perfil que califique).
    // El cierre rt=3 (Pagaré Maestro / dedup) está validado en backend-e2e (`asesor 3e67eade 71`).
});

test.fixme('Cupo Rotativo API: shapes de partner/lenders (reescribir vs mock-server :4000)', async () => {
    // Antes asertaba partner.name~'Cupo Rotativo' y lenders con rt 1/2/3 del partner-registry inventado.
});
