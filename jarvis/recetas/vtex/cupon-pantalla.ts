// CASO REVERSIBLE · un cupón: crearlo y archivarlo por el admin de VTEX (Promotions › Coupons), en el Chrome de la
// persona, grabando lo que el admin escribe (nivel 3 de jarvis/GUIA.md).
//
//   make jarvis-receta APP=vtex RECETA=cupon-pantalla [ARGS='--dejar']
//
// Crea el cupón «JARVIS<n>» (utm_source «jarvis»), sin promoción ligada: así no descuenta nada. Un cupón en VTEX no
// se borra: se ARCHIVA, y eso es la vuelta de este caso. Sólo toca el que creó. Lo grabado queda en
// `jarvis/mapas/vtex/casos/cupon.json`. ESCRIBE en las promociones de la cuenta de pruebas `creditop`.
import { openChrome, recordWrites, saveCase } from '../red.ts';

const argv = process.argv.slice(2);
const KEEP = argv.includes('--dejar');
// `--solo-archivar <código jarvis…>`: archiva el cupón que quedó de una corrida cortada.
const onlyArchive = argv.includes('--solo-archivar') ? argv[argv.indexOf('--solo-archivar') + 1].toLowerCase() : '';
if (onlyArchive && !/^jarvis/.test(onlyArchive)) { console.error('  ✗ --solo-archivar sólo archiva cupones «jarvis…»'); process.exit(2); }
// VTEX guarda el código en minúsculas (se escribe «JARVIS…» y la lista dice «jarvis…»).
const code = onlyArchive || `jarvis${Date.now().toString(36)}`;
const say = (s: string) => console.log(`  ${s}`);

const { page, close } = await openChrome();
const rec = recordWrites(page);
const io = page.frameLocator('iframe[title="IO iframe container"]');
const result: Record<string, unknown> = { codigo: code };
try {
    await page.goto('https://creditop.myvtex.com/admin/coupons', { waitUntil: 'commit', timeout: 90_000 });
    await io.getByRole('button', { name: 'Create coupon' }).waitFor({ timeout: 60_000 });

    if (!onlyArchive) {
        rec.step('crear');
        await io.getByRole('button', { name: 'Create coupon' }).click();
        await io.getByRole('textbox', { name: 'Coupon code' }).fill(code);
        await io.getByRole('textbox', { name: 'UTM source' }).fill('jarvis');
        await io.getByRole('textbox', { name: 'UTM campaign' }).fill('pruebas-jarvis');
        await io.getByRole('button', { name: 'Save', exact: true }).click();
        say(`creo el cupón ${code}`);
        await page.waitForTimeout(4000);
    }

    rec.step('buscar');
    await page.goto('https://creditop.myvtex.com/admin/coupons', { waitUntil: 'commit', timeout: 90_000 });
    const search = io.getByRole('textbox', { name: 'Search' });
    await search.waitFor({ timeout: 60_000 });
    await search.fill(code);
    await search.press('Enter');
    const row = io.locator('tr', { has: io.getByText(code, { exact: true }) }).first();
    await row.waitFor({ timeout: 60_000 });
    result.fila = (await row.innerText()).replace(/\s+/g, ' ').trim();
    say('está en la lista');

    if (!KEEP) {
        rec.step('archivar');
        // El menú ⋮ de SU fila: Edit · Archive · View usage details.
        await row.getByRole('button', { name: 'More actions' }).click();
        await io.getByRole('menuitem', { name: 'Archive', exact: true }).click();
        await page.waitForTimeout(800);
        const dialog = io.getByRole('dialog');
        if (await dialog.count()) {
            result.confirmacion = (await dialog.innerText()).replace(/\s+/g, ' ').trim();
            await dialog.getByRole('button', { name: /archive|confirm|yes/i }).last().click();
        }
        await row.waitFor({ state: 'detached', timeout: 30_000 });
        say('archivado: ya no está en la lista de activos');
        result.archivado = true;
    }
} catch (e) {
    result.error = String((e as Error).message).split('\n')[0];
    console.error(`  ✗ ${result.error}`);
} finally {
    await page.waitForTimeout(1500);
    await close();
}
const file = saveCase('vtex', 'cupon', { ...result, red: rec.calls });
for (const c of rec.calls) say(`[${c.paso}] ${c.metodo} ${c.url.replace(/^https:\/\/[^/]+/, '').slice(0, 70)}${c.operacion ? ' ' + c.operacion : ''} → ${c.status ?? '?'}`);
say(`→ ${file}`);
if (result.error) process.exit(1);
