import { expect, test } from '@playwright/test';
import { cognitoStorageState } from '../pkg/cognito';
import { config } from '../pkg/config';
import { IPHONE_UA, openA } from '../pkg/windows';

/**
 * Código de preaprobado de la app — entrada de asesor que reemplaza el tramo equivalente de
 * legacy-application. El código se siembra antes con `make harness-codigo`; el mock de códigos
 * corre en otro proceso para que esta prueba ejercite exactamente el contrato HTTP del backend.
 *
 * Ejemplo (local):
 *   make harness-codes
 *   make harness-codigo COMERCIO=pullman CODIGO=0101
 *   make harness-codigo-prueba HASH=13874eb6 CODIGO=0101 LENDER='Sistecrédito'
 */
const HASH = process.env.E2E_CLIENT_CODE_HASH ?? '';
const CODE = process.env.E2E_CLIENT_CODE ?? '';
const LENDER = process.env.E2E_CLIENT_CODE_LENDER ?? '';

test.skip(!HASH || !CODE || !LENDER, 'client-code: pide HASH, CODIGO y LENDER (ver make harness-codigo-prueba)');

test('asesor · redime código de app y muestra sólo su entidad', async ({ browser }) => {
    test.setTimeout(120_000);

    const { context, page } = await openA(browser, {
        baseURL: config.feBaseUrl,
        userAgent: IPHONE_UA,
        storageState: cognitoStorageState(),
    });

    await page.goto(`/merchant/${HASH}/codigo`, { waitUntil: 'domcontentloaded' });
    expect(page.url(), 'la sesión de asesor caducó — corré dev/warm-session.spec.ts y reintentá').not.toContain('/login');

    // CardTitle no renderiza un `heading` semántico; el texto sí es el contrato visible de la pantalla.
    await expect(page.getByText('Ingresa el código del cliente', { exact: true })).toBeVisible();
    await page.getByRole('textbox').fill(CODE);
    await expect(page.getByRole('button', { name: /confirmar código/i })).toBeEnabled();

    await page.getByRole('button', { name: /confirmar código/i }).click();
    await page.waitForURL(new RegExp(`/merchant/${HASH}/\\d+/lenders`), { timeout: 45_000 });
    await expect(page.getByText(LENDER, { exact: true })).toBeVisible({ timeout: 30_000 });

    // Las cards exponen su lender como h3 (recomendada) o h5 (colapsable). Una sola card prueba que
    // el `lender_id` no se perdió al pasar por la sesión ni dejó el marketplace completo visible.
    const visibleLenders = (await page.locator('main h3, main h5').allTextContents()).map((name) => name.trim()).filter(Boolean);
    expect(visibleLenders, 'el código debe dejar visible exclusivamente su entidad').toEqual([LENDER]);

    const lenderButtons = await page.locator('button').allTextContents();
    console.log(`CÓDIGO APP · ${CODE} · ${LENDER} · ${new URL(page.url()).pathname} · lenders: ${visibleLenders.join(' | ')} · botones: ${lenderButtons.filter(Boolean).join(' | ')}`);

    await context.close();
});
