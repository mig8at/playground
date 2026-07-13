import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../pkg/config';

/**
 * PROBE de diagnóstico del login de asesor (dev): navega /merchant/{hash}/solicitar → /login →
 * Cognito Hosted UI y SACA SCREENSHOT + dumpea la estructura del form en cada etapa, para ver
 * exactamente qué selectores tiene el Managed Login y a dónde aterriza. NO es parte de la suite.
 *
 * Creds por env (NO se logean): E2E_COGNITO_USER / E2E_COGNITO_PASS.
 * Artefactos en .auth/ (gitignored): probe-*.png.
 */

const HASH = process.env.E2E_ASESOR_HASH ?? config.partnerHash;
const USER = process.env.E2E_COGNITO_USER ?? '';
const PASS = process.env.E2E_COGNITO_PASS ?? '';
const AUTH = join(process.cwd(), '.auth');

test.skip(!USER || !PASS, 'probe: pasá E2E_COGNITO_USER / E2E_COGNITO_PASS');

async function dumpForm(page: import('@playwright/test').Page, tag: string) {
    const inputs = await page.locator('input').evaluateAll((els) =>
        els.map((e) => {
            const i = e as HTMLInputElement;
            return { name: i.name, type: i.type, id: i.id, placeholder: i.placeholder, visible: i.offsetParent !== null };
        }),
    );
    const buttons = await page
        .locator('button, input[type=submit]')
        .evaluateAll((els) => els.map((e) => (e.textContent || (e as HTMLInputElement).value || '').trim()).filter(Boolean));
    console.log(`\n── ${tag} · url=${page.url()}`);
    console.log('   inputs :', JSON.stringify(inputs));
    console.log('   buttons:', JSON.stringify(buttons));
}

test('probe asesor login (dev): screenshots por etapa + dump de selectores', async ({ page }) => {
    test.setTimeout(90_000);
    mkdirSync(AUTH, { recursive: true });

    // 1. Entrar al espacio /merchant/* → cadena de redirects hasta Cognito.
    await page.goto(`/merchant/${HASH}/solicitar`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: join(AUTH, 'probe-01-landing.png'), fullPage: true }).catch(() => {});
    await dumpForm(page, '01 landing (post-redirect)');

    // 2. Asegurar que estamos en el Hosted UI de Cognito.
    if (!/login\.creditop\.com|amazoncognito\.com/.test(page.url())) {
        console.log('⚠ no aterrizó en Cognito; revisá probe-01-landing.png');
    }

    // 3. Usuario → Siguiente/Next.
    const username = page.locator('input[name=username], input[type=email], input[autocomplete=username]').first();
    await expect(username, 'debe haber un campo de usuario en Cognito').toBeVisible({ timeout: 15_000 });
    await username.fill(USER);
    await page.screenshot({ path: join(AUTH, 'probe-02-username.png'), fullPage: true }).catch(() => {});
    await page.getByRole('button', { name: /siguiente|next|continuar|continue|sign\s*in/i }).first().click();

    // 4. Contraseña → Continuar/Sign in.
    const pwd = page.locator('input[name=password], input[type=password]').first();
    await expect(pwd, 'debe aparecer el campo de contraseña').toBeVisible({ timeout: 15_000 });
    await dumpForm(page, '03 password step');
    await pwd.fill(PASS);
    await page.screenshot({ path: join(AUTH, 'probe-03-password.png'), fullPage: true }).catch(() => {});
    await page.getByRole('button', { name: /continuar|continue|sign\s*in|iniciar|submit/i }).first().click();

    // 5. Aterrizaje tras el callback.
    await page.waitForURL(/localhost:5174/, { timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: join(AUTH, 'probe-04-after-login.png'), fullPage: true }).catch(() => {});
    await dumpForm(page, '04 after login');

    console.log(`\nPROBE_FINAL_URL=${page.url()}`);
    console.log('  screenshots: .auth/probe-01-landing.png … probe-04-after-login.png');
});
