import { test, expect } from '@playwright/test';
import { join } from 'node:path';

/**
 * check-amount-button — VALIDA si "Activar mi crédito" del step de monto queda disabled o se habilita.
 * Hipótesis: el botón arranca disabled (SSR, react-hook-form isValid=false) y se habilita tras hidratar,
 * cuando el useEffect corre amountForm.trigger() sobre el monto prellenado. Mide el timeline.
 *   E2E_CHECKOUT_URL=<url> npx playwright test dev/check-amount-button.spec.ts
 */
const URL = process.env.E2E_CHECKOUT_URL ?? '';
const AUTH = join(process.cwd(), '.auth');
const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

test('amount button: timeline disabled→enabled', async ({ browser }) => {
    test.setTimeout(90_000);
    expect(URL, 'E2E_CHECKOUT_URL requerido (node bin/dbops.ts ecommerce-url pullman)').toBeTruthy();
    const ctx = await browser.newContext({ userAgent: IPHONE_UA });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await page.waitForURL(/\/solicitar(\?|$)/, { timeout: 40_000 }).catch(() => {});
    const amt = page.getByTestId('amount-input').or(page.getByRole('textbox', { name: /monto/i })).first();
    await amt.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    const t0 = Date.now();   // empieza a medir RECIÉN cuando el step de monto está montado

    const btn = page.getByTestId('amount-submit').or(page.getByRole('button', { name: /activar mi cr[ée]dito/i })).first();
    await btn.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});

    let firstDisabled: boolean | null = null;
    let enabledAt: number | null = null;
    let errSeen = '';
    for (let i = 0; i < 75; i++) {
        const disabled = await btn.isDisabled().catch(() => null);
        if (firstDisabled === null) {
            firstDisabled = disabled;
            await page.screenshot({ path: join(AUTH, 'amountbtn-00-inicial.png'), fullPage: true }).catch(() => {});
        }
        if (!errSeen) errSeen = (await page.locator('[role="alert"], .text-destructive, p.text-sm').first().textContent({ timeout: 200 }).catch(() => '')) || '';
        if (disabled === false) {
            enabledAt = Date.now() - t0;
            await page.screenshot({ path: join(AUTH, 'amountbtn-01-habilitado.png'), fullPage: true }).catch(() => {});
            break;
        }
        await page.waitForTimeout(500);
    }
    console.log(`AMOUNT_BTN  errMsg="${errSeen.trim().slice(0, 80)}"`);
    const amtVal = await page.getByTestId('amount-input').or(page.getByRole('textbox', { name: /monto/i })).first().inputValue().catch(() => '?');
    console.log(`AMOUNT_BTN  monto="${amtVal}"  firstDisabled=${firstDisabled}  enabledAt=${enabledAt === null ? 'NUNCA (stuck ~16s)' : enabledAt + 'ms'}`);
});
