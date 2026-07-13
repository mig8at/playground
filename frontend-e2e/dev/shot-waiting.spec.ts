import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * shot-waiting — PRUEBA aislada de la pantalla de POLLING/espera con DOS navegadores.
 * Abre `waiting-validation` ("Estamos validando tus datos…") en dos contextos (A y B) sobre una solicitud
 * que YA existe, y deja ambos PARADOS ahí (linger) + screenshot. Sirve para validar la pantalla de espera
 * sin depender del entry (monto→tel→OTP). Pensado para correr headed para verlo, o headless para capturar.
 *   E2E_UREQ=<id> E2E_ASESOR_HASH=<hash> npx playwright test dev/shot-waiting.spec.ts --headed
 */
const FE = process.env.E2E_FE_BASE_URL ?? 'http://localhost:5174';
const HASH = process.env.E2E_ASESOR_HASH ?? '13874eb6';
const UREQ = process.env.E2E_UREQ ?? '464204';
const LINGER = Number(process.env.E2E_LINGER_MS ?? 8_000);
const AUTH = join(process.cwd(), '.auth');
const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const waitingTxt = /validando tus datos|ya casi est|estamos juntos|procesando|esperando/i;

test('dos navegadores PARADOS en la pantalla de espera (polling)', async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(AUTH, { recursive: true });
    const url = `${FE}/ecommerce/${HASH}/${UREQ}/waiting-validation/${UREQ}`;
    console.log(`  ▸ waiting-validation: ${new URL(url).pathname}`);

    const open = async (tag: string) => {
        const ctx = await browser.newContext({ userAgent: IPHONE_UA });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        const seen = await page.getByText(waitingTxt).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
        await page.screenshot({ path: join(AUTH, `waiting-${tag}.png`), fullPage: true }).catch(() => {});
        console.log(`  📸 waiting-${tag}.png  (texto de espera ${seen ? 'VISIBLE ✓' : 'no detectado'})`);
        return page;
    };

    const A = await open('A');   // dispositivo 1 esperando
    const B = await open('B');   // dispositivo 2 (mismo crédito) esperando
    // ambos quedan en el polling, visible
    await A.waitForTimeout(LINGER).catch(() => {});
    await B.waitForTimeout(Math.round(LINGER / 2)).catch(() => {});
});
