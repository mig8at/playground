import { test, expect } from '@playwright/test';
import { runHappyPathUntilLenders } from '../channel/steps';

/**
 * UI test del flujo Corbeta (allied ∈ corbeta_allieds = [24,209,210,211]) contra el LEGACY-BACKEND REAL
 * en modo mock. Verificado vía curl con teléfono FRESCO: Corbeta → `otp-validate` devuelve `success:true`
 * (Pullman/estándar → `success:false`). El wizard ve `success:true` → va directo a /lenders.
 *
 * Mecanismo (otp-verification.tsx:77): el salto a /lenders ocurre cuando el usuario es **NO-temporal**
 * (`success:true`), no por "ser corbeta". Corbeta auto-inyecta el perfil en el OTP → no-temporal de una;
 * un usuario que REGRESA (cualquier partner) con perfil completo también salta a /lenders por lo mismo.
 *
 * Hash real: `a1c0b15d` = Alkosto (allied_id 209), presente en el setting `corbeta_allieds`.
 *
 * ⚠️ Las pruebas de "contrato" viejas (partner.name='Corbeta', colors '#DC2626', flow 'CORBETA',
 * isCorbetaAllied) asertaban el shape inventado por el `partner-registry.ts` del mock-server :4000
 * (ELIMINADO). El backend real expone otro shape (el comercio es "Alkosto"). Quedan en `fixme` hasta
 * reescribirlas contra la respuesta real de `/api/loans/allied/{hash}` y `/lenders`.
 */

const CORBETA_HASH = 'a1c0b15d';

test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { slowMo: 200 } });

test('Corbeta E2E (UI): amount → phone → otp → [auto-inyecta perfil] → lenders', async ({ page }) => {
    test.setTimeout(60_000);
    // El helper maneja la variación por partner: para Corbeta, tras OTP salta directo a /lenders
    // (no pasa por personal-info ni employment-info). Que llegue = el auto-inject del backend funcionó.
    await runHappyPathUntilLenders(page, CORBETA_HASH);
    expect(page.url()).toMatch(/\/lenders/);
    expect(page.url()).toContain(CORBETA_HASH);
});

test.fixme('Corbeta API: shape real de /api/loans/allied/:hash (reescribir vs mock-server :4000)', async () => {
    // Antes asertaba colors.primary_color='#DC2626' y lender.flow='CORBETA' (partner-registry del :4000).
    // Reescribir contra el shape real del legacy-backend.
});

test.fixme('Corbeta API: corbeta_onboarding=true + ONB006 en otp-validate (verificar vs backend real)', async () => {
    // El FE consume corbeta_onboarding=true + ONB006 para derivar a Bancolombia (handleCorbetaFlow).
    // Verificar que el backend real lo emite con el hash real y assertarlo.
});

test.fixme('Corbeta API: isCorbetaAllied / allied_id en /lenders (shape real)', async () => {
    // Antes asertaba data.isCorbetaAllied y data.userRequest.allied_id=209 (contrato del mock-server).
});
