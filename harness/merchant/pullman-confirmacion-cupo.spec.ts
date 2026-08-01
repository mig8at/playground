import { expect, test } from '@playwright/test';

/**
 * Pullman → selector "Confirmación de cupo" (flujo pre-aprobado / omit-Experian) por UI.
 *
 * Contraparte FRONTEND de la rama backend de Jose
 * (feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage): en la pantalla de MONTO
 * del flujo CLÁSICO (phone-number.tsx, paso "amount"), el loader llama server-side
 *     GET /api/v2/risk/check-if-able-to-omit/experian-acierta/{branchHash}
 * y, SOLO si el comercio está habilitado (envelope code === "RKV26000"), renderiza el bloque
 * "Confirmación de cupo" (radios Sí/No). La elección se firma después del OTP con
 *     POST /api/v1/user-request/{id}/flow-signature/{alias}
 * — eso NO se ejerce acá; este spec cubre lo que pidió negocio: que el SELECTOR APAREZCA.
 *
 * PRE-REQS (stack local, igual que el resto de merchant/*):
 *   1) make up                          → legacy local (rama de Jose; ya trae el endpoint RiskV2)
 *   2) sembrar el setting `allowed_to_omit_experian_allieds` con el allied de Pullman (allied 94/121):
 *        settings(code='setting', key='allowed_to_omit_experian_allieds', value='{"experianAcierta":[94,121]}')
 *      Sin esto el backend devuelve RKV26001/RKV26003 y el selector NO aparece (fail-safe del front).
 *   3) wizard :5174 apuntando a LOCAL (VITE_API_URL=http://localhost)  →  make wizard
 *
 * Correr:  npx playwright test merchant/pullman-confirmacion-cupo.spec.ts
 * (Negativo — comercio NO habilitado → selector ausente — se puede agregar con un branch cuyo
 *  allied no esté en la allow-list; el backend ahí responde RKV26001.)
 */

// allied 94 (Amoblando Pullman) — hash canónico de la suite (= default de E2E_PARTNER_HASH).
const PULLMAN_HASH = process.env.E2E_PULLMAN_HASH ?? process.env.E2E_PARTNER_HASH ?? '3e67eade';
const AMOUNT_PATH = `/self-service/${PULLMAN_HASH}/solicitar`;

test.describe('Pullman · Confirmación de cupo (flujo pre-aprobado)', () => {
    test('el selector Sí/No aparece en la pantalla de monto', async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto(AMOUNT_PATH);

        // Estamos en el paso "amount" del flujo clásico.
        await expect(page.getByText(/ingresa el monto a solicitar/i)).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Confirmación de cupo')).toBeVisible();

        // El grupo de radios y sus dos opciones (Sí / No). Es el único radiogroup de la pantalla.
        // exact:true evita chocar con los <input type=radio> ocultos de Radix (accesibles como "yes"/"no").
        const group = page.getByRole('radiogroup');
        await expect(group).toBeVisible();
        const si = page.getByRole('radio', { name: 'Sí', exact: true });
        const no = page.getByRole('radio', { name: 'No', exact: true });
        await expect(si).toBeVisible();
        await expect(no).toBeVisible();

        // Obligatorio: "Iniciar solicitud" arranca deshabilitado (sin monto ni elección).
        const submit = page.getByRole('button', { name: /iniciar solicitud/i });
        await expect(submit).toBeDisabled();

        // Es interactivo: elegir "Sí" lo deja marcado.
        await si.click();
        await expect(si).toBeChecked();

        await page.screenshot({ path: '.auth/pullman-confirmacion-cupo.png', fullPage: true });
    });
});
