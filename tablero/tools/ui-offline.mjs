/* Prueba de la interfaz del tablero SIN servidores. El `dist/` compilado se sirve desde disco por
 * `route` y la API se simula dentro del mismo Chromium, así que corre en cualquier máquina y no toca
 * datos: ni el server Go ni Vite tienen que estar levantados (`tools/ui-check.mjs`, en la raíz, sí los
 * necesita, y audita las cuatro UIs).
 *
 * Cada chequeo nació de un defecto medido el 2026-09-23, y se probó contra el código viejo: tiene que
 * FALLAR ahí, o no prueba nada.
 *   1. el avance de pendientes abre la región lateral también plegada (a ≤1050px arranca así, y el clic
 *      cambiaba la pestaña de algo oculto);
 *   2. los rótulos de los hitos llevan su espacio (un `<span> </span>` lo borraba el compilador);
 *   3. los enlaces del documento no quedan con el azul del navegador;
 *   4. una casilla de pendiente no lleva además la viñeta de la lista;
 *   5. Artifacts lista cada archivo con su tipo;
 *   y, de paso, que no haya errores de consola ni pedidos a rutas que el server ya no sirve.
 *
 *   make tablero-ui-offline        (compila y corre)
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLERO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(TABLERO, '..', 'harness', 'package.json'))('playwright');
const DIST = process.env.TABLERO_DIST || path.join(TABLERO, 'dist');   // otro build, para probar el chequeo al revés
const APP = 'http://tablero.test';
const API = 'http://localhost:8787';

// Las rutas que el server sirve hoy. Una que no esté acá y la UI la pida es una ruta retirada que
// quedó llamándose — o una nueva que hay que sumar.
const LIVE = new Set(['/api/config', '/api/sprints', '/api/sprint', '/api/ramas', '/api/ramas/refresh', '/api/efforts',
  '/api/task-locals', '/api/jira-inbox', '/api/jira-import', '/api/qa-notice',
  '/api/transitions', '/api/entries', '/api/task-context', '/api/pulse']);

const sprint = { id: 1, name: 'Sprint UI', state: 'active', startDate: '2026-09-14', endDate: '2026-09-28' };
const techNotes = [
  '## Estado', '', 'El PR [#1175](https://example.test/pr/1175) sigue abierto.', '',
  '## Pendientes', '', '- [x] Hecho', '- [ ] Confirmar la interfaz',
].join('\n');
// La fecha LOCAL con su huso, como la escribe `tarea-context-add`: la línea de tiempo agrupa por los diez
// primeros caracteres, así que un `toISOString()` (UTC) de noche caía en el día de mañana.
const localDay = (daysAgo) => {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00:00-05:00`;
};
// Ocho hitos hoy y uno ayer: hace falta un día más alto que el cuerpo para probar que su encabezado se pega.
const contextEvent = (n, daysAgo) => ({ schema: 'tablero.task-context/v1', id: `ctx_ui_${n}`, at: localDay(daysAgo),
  kind: 'checkpoint', goal: 'Probar la interfaz.', summary: 'Resumen del hito. '.repeat(30), state: 'Estable.', next: 'Seguir.' });
const sample = {
  '/api/sprints': { sprints: [sprint] },
  '/api/sprint': { sprint, issues: [{ Key: 'UI-1', Summary: 'Validar el espacio de trabajo', Status: 'En curso',
    StatusCategory: 'indeterminate', Points: 3, HasPoints: true, OriginSprint: 'Sprint UI', SpentSecs: 5400 }] },
  '/api/efforts': { efforts: [{ id: 1, title: 'Validar interfaz', stage: 'work', techNotes,
    pending: [{ what: 'Hecho', section: 'Pendientes', done: true }, { what: 'Confirmar la interfaz', section: 'Pendientes', done: false }],
    artifacts: [{ file: 'validar/validar.html', label: 'prototipo' }, { file: 'validar/casos.sql', label: 'casos' }] }] },
  '/api/task-locals': { taskLocals: { 'UI-1': { taskKey: 'UI-1', effortId: 1 } } },
  '/api/task-context': { events: [...Array.from({ length: 8 }, (_, n) => contextEvent(n, 0)), contextEvent(8, 1)] },
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const browser = await chromium.launch();
const asked = new Set();
const failures = [];
async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${String(e.message).split('\n')[0]}`); }
}
async function openTablero(viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(`${APP}/**`, async (route) => {
    let p = new URL(route.request().url()).pathname;
    if (p === '/') p = '/index.html';
    try { await route.fulfill({ body: await readFile(path.join(DIST, p)), contentType: types[path.extname(p)] || 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  await page.route(`${API}/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    asked.add(p);
    return route.fulfill({ json: sample[p] || {}, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route(new RegExp(`^https?://(?!${new URL(APP).host}|${new URL(API).host})`), (route) => route.abort());
  await page.goto(`${APP}/`);
  await page.locator('.tree-row').first().click();
  await page.locator('.task-completion').waitFor();
  return { page, errors };
}
// Para los chequeos que no son el de abrir: la región se muestra desde el pie, que no depende del arreglo
// 1 — así cada chequeo falla por su propia causa y no en cascada.
async function showAuxTab(page, id) {
  if (!await page.locator('#task-views').count()) await page.getByRole('button', { name: 'Mostrar u ocultar vistas' }).click();
  await page.locator(`.aux-tab[data-vista="${id}"]`).click();
}
async function pendingOpensAux(page) {
  assert.equal(await page.locator('#task-views').count(), 0, 'la región tenía que arrancar oculta');
  await page.locator('.task-completion').click();
  await page.locator('#task-views').waitFor({ timeout: 3000 });
  assert.equal(await page.locator('.aux-tab[aria-selected="true"]').getAttribute('data-vista'), 'pendientes');
}

try {
  await readFile(path.join(DIST, 'index.html')).catch(() => { throw new Error('falta dist/: compilá antes (make tablero-ui-offline lo hace)'); });
  console.log('\n  TABLERO · la interfaz compilada, sin servidores\n');

  const narrow = await openTablero({ width: 1000, height: 760 });
  await check('a 1000px el avance de pendientes abre la región lateral', () => pendingOpensAux(narrow.page));

  const { page, errors } = await openTablero({ width: 1440, height: 900 });
  await check('con la región ocultada desde el pie, también', async () => {
    await page.getByRole('button', { name: 'Mostrar u ocultar vistas' }).click();
    await pendingOpensAux(page);
  });
  await check('los rótulos de los hitos llevan su espacio', async () => {
    const texts = await page.locator('.task-context-entry p').allInnerTexts();
    const labeled = texts.filter((t) => /^(Objetivo|Estado|Siguiente paso)\./.test(t));
    assert(labeled.length >= 3, `se esperaban 3 rótulos, hubo ${labeled.length}`);
    assert.deepEqual(labeled.filter((t) => /^[^.]+\.\S/.test(t)), [], 'rótulo pegado al texto');
  });
  // Tres cosas que se rompieron al hacerlo: el `top: 0` de taller.css lo pegaba debajo del padding del
  // cuerpo y el texto se asomaba por encima; un encabezado sacado de su sección no deja que el día
  // siguiente lo empuje; y plegar un día pegado dejaba el scroll apuntando lejos de donde se leía.
  await check('el día se pega arriba sin dejar asomar el texto, el siguiente lo reemplaza y plegarlo no pierde el lugar', async () => {
    const r = await page.locator('.te-body').evaluate(async (body) => {
      const frame = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const rel = (el) => el.getBoundingClientRect().top - body.getBoundingClientRect().top;
      const [today, yesterday] = body.querySelectorAll('.task-context-day');
      const [todayHead, yesterdayHead] = [today, yesterday].map((s) => s.querySelector('.context-day'));
      const covered = () => {
        const el = document.elementFromPoint(todayHead.getBoundingClientRect().left + 30, body.getBoundingClientRect().top + 1);
        return Boolean(el?.closest('.context-day'));
      };
      body.scrollTop = 300; await frame();
      const middle = { head: rel(todayHead), covered: covered() };
      body.scrollTop += today.getBoundingClientRect().bottom - body.getBoundingClientRect().top + 20; await frame();
      const next = { today: rel(todayHead), yesterday: rel(yesterdayHead) };
      body.scrollTop = 300; await frame();
      todayHead.click(); await frame();
      return { middle, next, folded: { head: rel(todayHead), expanded: todayHead.getAttribute('aria-expanded') } };
    });
    assert(Math.abs(r.middle.head) <= 1, `a mitad del día el encabezado tenía que estar arriba, estaba a ${r.middle.head}px`);
    assert(r.middle.covered, 'por encima del día pegado se asoma el texto');
    assert(r.next.today < 0 && Math.abs(r.next.yesterday) <= 1, `pasado el día, el siguiente tenía que reemplazarlo: ${JSON.stringify(r.next)}`);
    assert(r.folded.expanded === 'false' && Math.abs(r.folded.head) <= 1, `plegado, el día tenía que quedar arriba: ${JSON.stringify(r.folded)}`);
  });
  // El sidebar se arrastra hasta 200px, el mínimo de `WIDTHS` en App.vue. El campo medía 190px fijos y el
  // grupo, con la lupa y el padding, 230: a ese ancho se salía 40px por el borde.
  await check('a su ancho mínimo, el buscador no se sale del sidebar', async () => {
    const r = await page.evaluate(async () => {
      const wb = document.querySelector('.workbench');
      const before = wb.style.getPropertyValue('--sidebar-w');
      wb.style.setProperty('--sidebar-w', '200px');
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      // Y lo de ADENTRO: con el grupo encogido y el campo con ancho fijo, el grupo cabe y el campo se sale.
      const inner = Math.max(...[...document.querySelectorAll('.fbusca *')].map((el) => el.getBoundingClientRect().right));
      const out = { width: box('.sidebar').width, sidebar: box('.sidebar').right, search: box('.fbusca').right, inner };
      wb.style.setProperty('--sidebar-w', before);
      return out;
    });
    assert(Math.abs(r.width - 200) <= 1, `el sidebar tenía que medir 200px, midió ${r.width}`);
    assert(r.search <= r.sidebar, `el buscador termina en ${r.search}px y el sidebar en ${r.sidebar}px`);
    assert(r.inner <= r.search, `el campo termina en ${r.inner}px, fuera de su borde (${r.search}px)`);
  });
  await check('los enlaces del documento no quedan con el azul del navegador', async () => {
    const color = await page.locator('.cuerpo-md a').first().evaluate((a) => getComputedStyle(a).color);
    assert.notEqual(color, 'rgb(0, 0, 238)');
  });
  await check('una casilla de pendiente no lleva además la viñeta', async () => {
    await showAuxTab(page, 'pendientes');
    const styles = await page.locator('.pending-document li').evaluateAll((lis) => lis.map((li) => getComputedStyle(li).listStyleType));
    assert(styles.length >= 2, `se esperaban 2 pendientes, hubo ${styles.length}`);
    assert.deepEqual([...new Set(styles)], ['none']);
  });
  await check('Artifacts lista cada archivo con su tipo', async () => {
    await showAuxTab(page, 'artifacts');
    assert.deepEqual(await page.locator('.artifact-type').allInnerTexts(), ['HTML', 'SQL']);
  });
  await check('sin errores de consola', () => assert.deepEqual([...errors, ...narrow.errors], []));
  await check('la UI sólo pide rutas que el server sirve', () => assert.deepEqual([...asked].filter((p) => !LIVE.has(p)), []));
} finally {
  await browser.close();
}
console.log(failures.length ? `\n  ✗ ${failures.length} chequeo(s) fallaron\n` : '\n  ✓ todo en orden\n');
process.exit(failures.length ? 1 : 0);
