import { test, expect } from '@playwright/test';
import { runHappyPathUntilLenders } from '../channel/steps';

/**
 * Pullman → CrediPullman por UI, contra el LEGACY-BACKEND REAL en modo mock.
 *
 * Pullman (allied_id 94, hash `3e67eade` = Amoblando Pullman): en personal-info el backend corre Experian
 * Acierta+Quanto y **auto-inyecta el ingreso** (field 87) → el wizard salta employment-info y va a /lenders.
 * Eso es lo que se valida verde aquí (el diferenciador Pullman funciona por UI).
 *
 * ⚠️ Hallazgo (consistente con backend-e2e): el **marketplace NO ofrece CrediPullman (#77)** para este branch
 * con el perfil que produce el onboarding. `go run . offer 3e67eade` devuelve solo #39 Meddipay (rt=1) y #6
 * Credifamilia-addi (rt=0). CrediPullman solo aparece con un perfil que califique a sus reglas/categoría
 * (en el backend, `perfilador 3e67eade 77` lo ofrece con score 800 + reportado=no). Por eso el cierre
 * Creditop X de CrediPullman se validó en backend FORZANDO el lender (`go run . asesor 3e67eade 77` → Estado 11):
 * por UI no se puede seleccionar lo que el marketplace no ofrece.
 */

const PULLMAN_HASH = '3e67eade';

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 200 } });

test('Pullman por UI: Quanto auto-inyecta → salta a /lenders y el marketplace responde', async ({ page }) => {
    test.setTimeout(60_000);
    await runHappyPathUntilLenders(page, PULLMAN_HASH);
    expect(page.url()).toMatch(/\/lenders/);
    // El marketplace real para Pullman ofrece Meddipay (rt=1). Que aparezca = el flujo Pullman
    // (Quanto → perfil → marketplace) llegó y pintó entidades por UI.
    await expect(page.getByText(/meddipay/i).first()).toBeVisible({ timeout: 15_000 });
});

test.fixme('Pullman → CrediPullman: el marketplace OFRECE CrediPullman (#77) y cierra in-platform por UI', async () => {
    // El marketplace no ofrece #77 con el perfil de onboarding (gap de config; ver `offer 3e67eade`).
    // Para validarlo por UI hay que sembrar un perfil que califique a las reglas/categoría de #77
    // (como `perfilador 3e67eade 77`: score 800 + reportado=no) ANTES de /lenders, luego seleccionar
    // CrediPullman → sign-documents (pagaré, PdfMapper fake en stash) → OTP firma → authorize → aprobado.
    // El cierre ya está validado a nivel backend: `go run . asesor 3e67eade 77` → Estado 11.
});
