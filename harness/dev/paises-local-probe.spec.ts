import { test } from '@playwright/test';

/**
 * Sonda países en LOCAL: entra al flujo dinámico del comercio asignado al asesor,
 * pasa la pantalla de monto y reporta qué PREFIJO quedó preseleccionado en request-phone.
 * No asevera: imprime, para que el humano juzgue. Screenshot como evidencia.
 */
const HASH = process.env.PROBE_HASH ?? '1bfb8cd0';
const TAG  = process.env.PROBE_TAG  ?? 'rd';

test.use({ storageState: '.auth/cognito-state.dev.json' });

test(`prefijo del pais (${TAG})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/merchant/${HASH}/request-amount`);
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log(`\n### [${TAG}] request-amount aterrizo en: ${page.url()}`);

    // el schema del mock trae selector de equipo: elegir uno primero
    const buscador = page.getByRole('textbox', { name: /buscar celular/i });
    if (await buscador.count()) {
        const equipo = page.getByRole('button', { name: /motorola|samsung|honor|xiaomi|funda|odontolog|rehabilitaci|ortodoncia|general|implante/i });
        for (let intento = 0; intento < 4 && !(await equipo.count()); intento++) {
            await buscador.click();
            await buscador.fill('');
            await buscador.pressSequentially('a', { delay: 80 });
            await equipo.first().waitFor({ timeout: 4000 }).catch(() => {});
        }
        if (await equipo.count()) await equipo.first().click();
        else console.log('    (no aparecieron equipos en el buscador)');
    }
    // monto: MoneyInput pierde fill() por hidratación → click + teclear
    const monto = page.getByRole('textbox', { name: /monto a solicitar/i });
    await monto.click();
    await monto.pressSequentially('20000', { delay: 40 });
    await page.getByRole('button', { name: /iniciar solicitud/i }).click();
    await page.waitForURL('**/request-phone**', { timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log(`### [${TAG}] tras el monto: ${page.url()}`);

    const sel = page.locator('select#countryCode, select[name="countryCode"]').first();
    if (await sel.count()) {
        console.log(`### [${TAG}] PREFIJO preseleccionado: +${await sel.inputValue()}`);
    } else {
        const txt = (await page.locator('body').innerText().catch(() => '')).split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12);
        console.log(`### [${TAG}] sin select countryCode; texto:`, JSON.stringify(txt));
    }
    await page.screenshot({ path: `.auth/paises-local-${TAG}.png`, fullPage: false });
});
