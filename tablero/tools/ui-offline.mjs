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
const sample = {
  '/api/sprints': { sprints: [sprint] },
  '/api/sprint': { sprint, issues: [{ Key: 'UI-1', Summary: 'Validar el espacio de trabajo', Status: 'En curso',
    StatusCategory: 'indeterminate', Points: 3, HasPoints: true, OriginSprint: 'Sprint UI', SpentSecs: 5400 }] },
  '/api/efforts': { efforts: [{ id: 1, title: 'Validar interfaz', stage: 'work', techNotes,
    pending: [{ what: 'Hecho', section: 'Pendientes', done: true }, { what: 'Confirmar la interfaz', section: 'Pendientes', done: false }],
    artifacts: [{ file: 'validar/validar.html', label: 'prototipo' }, { file: 'validar/casos.sql', label: 'casos' }] }] },
  '/api/task-locals': { taskLocals: { 'UI-1': { taskKey: 'UI-1', effortId: 1 } } },
  '/api/task-context': { events: [{ schema: 'tablero.task-context/v1', id: 'ctx_ui', at: new Date().toISOString(),
    kind: 'checkpoint', goal: 'Probar la interfaz.', summary: 'Resumen del hito.', state: 'Estable.', next: 'Seguir.' }] },
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
