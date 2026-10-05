import type { Locator, Page } from '../auth/browser.ts';

async function fillChecked(field: Locator, value: string): Promise<void> {
    await field.waitFor({ state: 'visible', timeout: 15_000 });
    await field.click();
    await field.fill('');
    await field.pressSequentially(value, { delay: 60 });
    if (await field.inputValue() !== value) {
        await field.fill('');
        await field.pressSequentially(value, { delay: 90 });
    }
    if (await field.inputValue() !== value) throw new Error('el formulario no recibió el valor del campo de login');
}

/** Espera el host real de retorno, no su aparición dentro de redirect_uri. No persiste sesiones de prueba. */
export async function loginOnPage(page: Page, user: string, pass: string, returnHost: string): Promise<boolean> {
    const username = page.locator('input[name=username]:visible').first();
    try { await username.waitFor({ state: 'visible', timeout: 15_000 }); }
    catch {
        if (new URL(page.url()).host !== returnHost) throw new Error('el login no mostró el formulario de usuario');
        return false; // ya estaba autenticada; no atribuir esa sesión a otra cuenta
    }
    if (!user || !pass) throw new Error('faltan ADVISOR_USER y ADVISOR_PASS en connectors/.env.<ambiente>');
    const classic = await page.locator('input[name=password]:visible').count() > 0;
    await fillChecked(username, user);
    if (classic) {
        await fillChecked(page.locator('input[name=password]:visible').first(), pass);
        await page.locator('input[name=signInSubmitButton]:visible, button[name=signInSubmitButton]:visible, button[type=submit]:visible').first().click();
    } else {
        await page.getByRole('button', { name: /siguiente|next/i }).click();
        await fillChecked(page.locator('input[name=password]:visible').first(), pass);
        await page.getByRole('button', { name: /continuar|continue|sign\s*in|iniciar/i }).click();
    }
    await page.waitForURL(url => url.host === returnHost, { timeout: 30_000 });
    await page.waitForURL(url => url.host === returnHost && !/^\/(auth\/callback|merchant)\/?$/.test(url.pathname), { timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    return true;
}
