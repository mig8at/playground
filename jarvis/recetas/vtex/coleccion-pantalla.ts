// CASO REVERSIBLE · una colección: crearla y borrarla por el admin de VTEX, en el Chrome de la persona, grabando lo
// que el admin escribe (nivel 3 de jarvis/GUIA.md). De esa grabación sale la receta por API (`coleccion.ts`).
//
//   make jarvis-receta APP=vtex RECETA=coleccion-pantalla [ARGS='--dejar']
//
// Crea «Jarvis <fecha y hora>» (Catalog › Collections › CREATE COLLECTION), la busca en la lista para saber su id y
// la borra con el tacho de SU fila (DELETE). Sólo borra la que creó: busca por el nombre exacto. Con `--dejar` no la
// borra. Lo grabado queda en `jarvis/mapas/vtex/casos/coleccion.json`.
// ESCRIBE en el catálogo de la cuenta de pruebas `creditop` (y lo deshace).
import { openChrome, recordWrites, saveCase } from '../red.ts';

const KEEP = process.argv.includes('--dejar');
const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
const name = `Jarvis ${stamp}`;
const say = (s: string) => console.log(`  ${s}`);

const { page, close } = await openChrome();
const rec = recordWrites(page);
const io = page.frameLocator('iframe[title="IO iframe container"]');
const result: Record<string, unknown> = { nombre: name };
try {
    await page.goto('https://creditop.myvtex.com/admin/collections', { waitUntil: 'commit', timeout: 90_000 });
    await io.getByRole('button', { name: 'CREATE COLLECTION' }).waitFor({ timeout: 60_000 });

    rec.step('crear');
    await io.getByRole('button', { name: 'CREATE COLLECTION' }).click();
    await io.getByRole('textbox', { name: 'Collection Name*', exact: true }).fill(name);
    await io.getByLabel(/^Simple description/).fill('Colección de prueba de Jarvis: se borra al terminar.');
    await io.getByTestId('vtex-btn-save-collection').click();
    say(`creo «${name}»`);
    // Al crear, el admin abre la colección: el id está en la URL (/admin/collections/<id>).
    await page.waitForURL(/collections\/\d+/, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    result.urlTrasCrear = page.url();
    const fromUrl = /collections\/(\d+)/.exec(page.url())?.[1];

    rec.step('buscar');
    await page.goto('https://creditop.myvtex.com/admin/collections', { waitUntil: 'commit', timeout: 90_000 });
    const search = io.getByRole('textbox', { name: 'Search…' }).or(io.getByPlaceholder('Search…'));
    await search.first().waitFor({ timeout: 60_000 });
    await search.first().fill(name);
    await search.first().press('Enter');
    const row = io.locator('tr', { has: io.getByRole('link', { name, exact: true }) });
    await row.waitFor({ timeout: 30_000 });
    const id = Number((await row.locator('td').nth(2).innerText()).trim()) || Number(fromUrl);
    result.id = id;
    say(`está en la lista: id ${id}`);

    if (!KEEP) {
        rec.step('borrar');
        await row.locator('td').last().getByRole('button').click();
        await io.getByRole('button', { name: 'DELETE' }).click();
        await row.waitFor({ state: 'detached', timeout: 30_000 });
        say('borrada: ya no está en la lista');
        result.borrada = true;
    }
} catch (e) {
    result.error = String((e as Error).message).split('\n')[0];
    console.error(`  ✗ ${result.error}`);
    await page.screenshot({ path: '/tmp/jarvis-coleccion-error.png' }).catch(() => {});
} finally {
    await page.waitForTimeout(1500); // que lleguen las últimas respuestas
    await close();
}
const file = saveCase('vtex', 'coleccion', { ...result, red: rec.calls });
for (const c of rec.calls) say(`[${c.paso}] ${c.metodo} ${c.url.replace(/^https:\/\/[^/]+/, '').slice(0, 90)}${c.operacion ? ' ' + c.operacion : ''} → ${c.status ?? '?'}`);
say(`→ ${file}`);
if (result.error) process.exit(1);
