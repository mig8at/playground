// CASO REVERSIBLE · un sinónimo del buscador: crearlo y borrarlo por el admin de VTEX (Storefront › Synonyms), en el
// Chrome de la persona, grabando lo que el admin escribe (nivel 3 de jarvis/GUIA.md).
//
//   make jarvis-receta APP=vtex RECETA=sinonimo-pantalla [ARGS='--dejar']
//
// Crea un sinónimo bidireccional y activo entre dos palabras que no existen en la tienda («jarvisa<n>» y
// «jarvisb<n>»), lo busca en la lista y lo borra desde SU fila. Sólo toca el que creó. Lo grabado queda en
// `jarvis/mapas/vtex/casos/sinonimo.json`. ESCRIBE en el buscador de la cuenta de pruebas `creditop` (y lo deshace).
import { openChrome, recordWrites, saveCase } from '../red.ts';

const argv = process.argv.slice(2);
const KEEP = argv.includes('--dejar');
// `--solo-borrar <término>`: borra el sinónimo de un término que quedó de una corrida cortada (sólo «jarvis…»).
const onlyDelete = argv.includes('--solo-borrar') ? argv[argv.indexOf('--solo-borrar') + 1] : '';
if (onlyDelete && !/^jarvis/.test(onlyDelete)) { console.error('  ✗ --solo-borrar sólo borra términos «jarvis…»'); process.exit(2); }
const n = Date.now().toString(36);
const terms = onlyDelete ? [onlyDelete] : [`jarvisa${n}`, `jarvisb${n}`];
const say = (s: string) => console.log(`  ${s}`);
const URL_LIST = 'https://creditop.myvtex.com/admin/search/v4/synonyms';

const { page, close } = await openChrome();
const rec = recordWrites(page);
const io = page.frameLocator('iframe[title="IO iframe container"]');
const result: Record<string, unknown> = { terminos: terms };
try {
    await page.goto(URL_LIST, { waitUntil: 'commit', timeout: 90_000 });
    await io.getByRole('button', { name: 'Create Synonym' }).waitFor({ timeout: 60_000 });

    if (!onlyDelete) {
        rec.step('crear');
        await io.getByRole('button', { name: 'Create Synonym' }).click();
        const input = io.locator('#terms-input');
        for (const t of terms) { await input.fill(t); await input.press('Enter'); }
        await io.getByRole('button', { name: 'Publish', exact: true }).click();
        say(`creo el sinónimo ${terms.join(' ⇄ ')}`);
        await page.waitForTimeout(3000);
    }

    rec.step('buscar');
    await page.goto(URL_LIST, { waitUntil: 'commit', timeout: 90_000 });
    const search = io.getByRole('textbox', { name: 'Buscar' }).or(io.getByPlaceholder('Buscar'));
    await search.first().waitFor({ timeout: 60_000 });
    await search.first().fill(terms[0]);
    await search.first().press('Enter');
    const row = io.locator('tr', { has: io.getByText(terms[0], { exact: true }) }).first();
    await row.waitFor({ timeout: 30_000 });
    say('está en la lista');
    result.fila = (await row.innerText()).replace(/\s+/g, ' ').trim();

    if (!KEEP) {
        rec.step('borrar');
        // El tacho aparece recién con el mouse encima de la fila, en su última celda, y no es un botón (un ícono con
        // tabindex): el análisis de Jarvis no lo ve. Abrir la fila lleva a «Edit», que no tiene borrar.
        await row.hover();
        const trash = row.locator('td').last().locator('[tabindex], button, svg').first();
        await trash.click();
        await page.waitForTimeout(800);
        result.confirmacion = (await io.getByRole('dialog').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        await io.getByRole('dialog').getByRole('button', { name: /delete|eliminar|confirm|yes/i }).last().click();
        await row.waitFor({ state: 'detached', timeout: 30_000 });
        say('borrado: ya no está en la lista');
        result.borrado = true;
    }
} catch (e) {
    result.error = String((e as Error).message).split('\n')[0];
    console.error(`  ✗ ${result.error}`);
    await page.screenshot({ path: '/tmp/jarvis-sinonimo-error.png' }).catch(() => {});
} finally {
    await page.waitForTimeout(1500);
    await close();
}
const file = saveCase('vtex', 'sinonimo', { ...result, red: rec.calls });
for (const c of rec.calls) say(`[${c.paso}] ${c.metodo} ${c.url.replace(/^https:\/\/[^/]+/, '').slice(0, 70)}${c.operacion ? ' ' + c.operacion : ''} → ${c.status ?? '?'}`);
say(`→ ${file}`);
if (result.error) process.exit(1);
