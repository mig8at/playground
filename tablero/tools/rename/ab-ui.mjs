// ab-ui.mjs <dist> <puerto-api> <salida.json> — la HUELLA de la interfaz del tablero: texto y clases de
// cada región, en una secuencia fija de tareas y pestañas. `ab-ui.sh` la toma dos veces —la UI vieja con
// su server y la nueva con el suyo, sobre los mismos datos— y las compara. Un rename correcto no cambia
// ni un carácter de lo que se ve; una clave que la UI dejó de encontrar sale como un campo vacío.
//
// El `dist/` se sirve desde disco por `route` y cada GET a la API se reenvía al server del puerto dado;
// cualquier otro verbo se aborta: esto mira, no escribe. No hace falta Vite ni el panel de previews.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLERO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(TABLERO, '..', 'harness', 'package.json'))('playwright');
const [DIST, PORT, OUT] = process.argv.slice(2);
const APP = 'http://tablero.test';
const TASKS = ['tablero', 'playground', 'context', 'cuadrilla', 'trazador', 'core-258', 'core-317', 'core-420', 'core-265'];
const TABS = ['jira', 'pendientes', 'artifacts'];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// Lo que cambia solo entre dos corridas separadas por un minuto: el reloj del pulso y el estado de la
// sincronización con Jira. No es el rename, así que se aplana.
const volatile = (t) => t.replace(/actualizando Jira…?/g, '').replace(/hace \d+ (min|h|d)/g, 'hace N');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.route(`${APP}/**`, async (route) => {
  let p = new URL(route.request().url()).pathname;
  if (p === '/') p = '/index.html';
  try { await route.fulfill({ body: await readFile(path.join(DIST, p)), contentType: types[path.extname(p)] || 'application/octet-stream' }); }
  catch { await route.fulfill({ status: 404, body: '' }); }
});
await page.route('http://localhost:8787/**', async (route) => {
  if (route.request().method() !== 'GET') return route.abort();
  const u = new URL(route.request().url());
  const r = await fetch(`http://localhost:${PORT}${u.pathname}${u.search}`);
  await route.fulfill({ status: r.status, body: Buffer.from(await r.arrayBuffer()),
    headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'access-control-allow-origin': '*' } });
});
await page.route(/^https?:\/\/(?!tablero\.test|localhost:8787)/, (route) => route.abort());

// texto de una región y las clases de todo lo que contiene (conteo por combinación de clases)
const region = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const classes = {};
  for (const n of el.querySelectorAll('[class]')) {
    const c = [...n.classList].sort().join('.');
    classes[c] = (classes[c] || 0) + 1;
  }
  return { text: el.innerText, classes };
}, sel);
const settle = async () => {
  await page.waitForFunction(() => !/actualizando Jira|trayendo los sprints/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
};

const print = {};
try {
  await page.goto(`${APP}/`);
  await settle();
  print.home = { sidebar: await region('.sidebar') };
  for (const slug of TASKS) {
    await page.goto(`${APP}/#/tareas/${slug}`);
    await settle();
    const shot = { editor: await region('.editor'), branches: await region('.ramas-panel') };
    for (const tab of TABS) {
      const t = page.locator(`.aux-tab[data-vista="${tab}"]`);
      if (await t.count()) { await t.click(); await page.waitForTimeout(250); shot['aux-' + tab] = await region('#task-views'); }
    }
    print[slug] = shot;
  }
} finally {
  await browser.close();
}
const json = JSON.stringify({ errors, print }, (k, v) => (k === 'text' && typeof v === 'string' ? volatile(v) : v), 1);
await writeFile(OUT, json);
console.log(`${OUT}: ${Object.keys(print).length} pantallas, ${errors.length} errores de consola`);
