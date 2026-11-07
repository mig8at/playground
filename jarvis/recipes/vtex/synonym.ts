// CASO REVERSIBLE SIN CLICS · un sinónimo del buscador de VTEX: crearlo, comprobarlo y borrarlo.
//
//   make jarvis-recipe APP=vtex RECIPE=synonym [ARGS='--terms "a,b" | --keep']
//
// Los sinónimos de Intelligent Search no tienen API con la llave de la cuenta (la documentación de VTEX sólo da el
// admin y la importación por CSV; probado el 2026-11-07: 404 en las rutas candidatas). El camino rápido es el del
// admin: sus operaciones de GraphQL (`createSynonym`, `getSynonyms`, `deleteSynonym`) mandadas con la SESIÓN de la
// persona desde una pestaña del admin en su Chrome. Las operaciones salen de la grabación del caso por pantalla
// (`synonym-screen.ts` → `jarvis/maps/vtex/cases/synonym.json`).
// ⚠ VTEX avisa que un sinónimo borrado no se puede volver a crear con los mismos términos: por eso los términos por
// defecto son nuevos en cada corrida («jarvisa<n>», «jarvisb<n>»).
// ESCRIBE en el buscador de la cuenta de pruebas `creditop` (y lo deshace).
import '../args.ts';
import { graphqlInPage, openChrome, recordedOperation } from '../recorder.ts';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const KEEP = argv.includes('--keep');
const n = Date.now().toString(36);
const terms = flag('terms')?.split(',').map((t) => t.trim()).filter(Boolean) ?? [`jarvisa${n}`, `jarvisb${n}`];
const say = (s: string) => console.log(`  ${s}`);

const create = recordedOperation('vtex', 'synonym', 'createSynonym');
const list = recordedOperation('vtex', 'synonym', 'getSynonyms');
const remove = recordedOperation('vtex', 'synonym', 'deleteSynonym');

const { page, close } = await openChrome();
let failed = false;
try {
    // Una pestaña del admin, sólo para tener la sesión y el origen: no se toca nada en pantalla.
    await page.goto('https://creditop.myvtex.com/admin/search/v4/synonyms', { waitUntil: 'domcontentloaded', timeout: 90_000 });

    const c = await graphqlInPage(page, create, 'createSynonym', { searchSynonym: { left: terms, right: [], active: true, locales: [] } });
    const id = c.body?.data?.createSynonym?.data?.body?.id;
    if (!id) throw new Error(`crear el sinónimo: ${c.status} ${JSON.stringify(c.body).slice(0, 300)}`);
    say(`creado: ${terms.join(' ⇄ ')} · id ${id}`);

    // La lista filtrada por el término, como la pide el admin al buscar.
    const found = async () => {
        const r = await graphqlInPage(page, list, 'getSynonyms', { pagination: { page: 1, itemsPerPage: 15, orderBy: ['createdAt:desc'], filters: { left: terms[0] } } });
        return JSON.stringify(r.body).includes(id);
    };
    if (!(await found())) throw new Error(`creé el sinónimo ${id} pero no aparece en la lista`);
    say('comprobado: está en la lista');

    if (!KEEP) {
        const d = await graphqlInPage(page, remove, 'deleteSynonym', { searchSynonym: { id, left: terms } });
        if (d.body?.data?.deleteSynonym?.status !== 'success') throw new Error(`borrar el sinónimo: ${d.status} ${JSON.stringify(d.body).slice(0, 300)}`);
        if (await found()) throw new Error(`borré el sinónimo ${id} pero sigue en la lista`);
        say('borrado: ya no está en la lista');
    }
} catch (e) {
    failed = true;
    console.error(`  ✗ ${(e as Error).message}`);
} finally {
    await close();
}
if (failed) process.exit(1);
