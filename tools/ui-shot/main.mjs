/* UI-SHOT: una captura de una interfaz del playground, para que un agente VEA lo que cambió sin depender del navegador
 * embebido de la sesión (con el pane oculto, sus capturas salen viejas, y bloquea los iframes con `src`). Abre la app en
 * un Chromium sin ventana, en la ruta, con el tamaño y el tema pedidos, hace los clics, y deja un PNG; además dice qué
 * errores dejó la consola y qué pedidos fallaron, que es lo primero que hay que mirar antes de mirar la imagen.
 *
 *   make ui-shot APP=tablero ROUTE='#/tareas/core-800?vista=artifacts' CLICK='.artifact-row:has-text("guia")'
 *
 * Con COCKPIT=1 captura en cambio la ventana de Cockpit, que es lo que ve Miguel (ver `cockpit-window.swift`).
 *
 * NO levanta servidores: si la app no contesta, lo dice y sale 1 (los levanta Cockpit, o su `make`). Sólo lee: no
 * escribe en ninguna API más allá de lo que hagan los clics que le pidas. Las apps y sus URL salen de `APPS` de Cockpit
 * (cockpit/src-tauri/src/main.rs), que es la única lista. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;

function fail(message) {
  console.error(`ui-shot: ${message}`);
  process.exit(1);
}

// Las apps de Cockpit: id → URL, leídas de su registro.
function cockpitApps() {
  const source = readFileSync(join(root, 'cockpit/src-tauri/src/main.rs'), 'utf8');
  const apps = {};
  for (const m of source.matchAll(/id: "([a-z-]+)",[\s\S]*?url: "([^"]+)"/g)) {
    const url = new URL(m[2]);
    url.searchParams.delete('cockpit'); // el chat se adapta a Cockpit con este parámetro: acá va como en el navegador
    apps[m[1]] = url.href;
  }
  return apps;
}

// La URL final: la de la app con la ruta (`#…` cambia el hash; `/…` el camino, como el harness).
function targetURL(base, route) {
  const url = new URL(base);
  if (!route) return url.href;
  if (route.startsWith('#')) url.hash = route;
  else if (route.startsWith('/')) {
    const next = new URL(route, url.origin);
    url.pathname = next.pathname;
    url.hash = next.hash;
    for (const [k, v] of next.searchParams) url.searchParams.set(k, v);
  } else fail(`ROUTE va con # o con /: ${route}`);
  return url.href;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const outFor = (name) => {
  const out = resolve(root, env('OUT', join('tools/ui-shot/shots', `${name}-${stamp()}.png`)));
  mkdirSync(dirname(out), { recursive: true });
  return out;
};

// ── COCKPIT=1: la ventana de Cockpit, tal como la ve Miguel ──────────────────────────────────────────────────────
function shootCockpit(app, route) {
  if (app) {
    try {
      execFileSync(join(root, 'bin/cockpit'), ['open', app, ...(route ? [route] : [])], { stdio: 'ignore' });
    } catch {
      fail('Cockpit no está abierto (make cockpit lo instala y lo abre)');
    }
    execFileSync('/bin/sleep', [env('WAIT', '2000') / 1000 + '']);
  }
  let id = '';
  try {
    id = execFileSync('/usr/bin/swift', [join(root, 'tools/ui-shot/cockpit-window.swift')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* se informa abajo */ }
  if (!id || id === '0') fail('no encontré la ventana de Cockpit en pantalla (¿está escondida o minimizada?)');
  const out = outFor(`cockpit-${app || 'window'}`);
  execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', id, out]);
  // La pantalla es retina (el doble): a 1600 de ancho se lee igual y pesa la cuarta parte.
  execFileSync('/usr/bin/sips', ['-Z', env('WIDTH', '1600'), out], { stdio: 'ignore' });
  console.log(out);
}

// ── la app en un Chromium sin ventana ────────────────────────────────────────────────────────────────────────────
async function shootHeadless(app, route) {
  const apps = cockpitApps();
  const base = env('URL') || apps[app];
  if (!base) fail(`no hay app «${app}»: ${Object.keys(apps).join(', ')} (o URL=http://…)`);
  const url = targetURL(base, route);
  const width = Number(env('WIDTH', '1440'));
  const height = Number(env('HEIGHT', '900'));
  const theme = env('THEME', 'dark');
  if (!['dark', 'light'].includes(theme)) fail('THEME es dark o light');

  // Si no contesta no se sigue: una captura de «no se puede conectar» se confunde con un error de la app.
  try {
    await fetch(new URL(url).origin, { signal: AbortSignal.timeout(3000) });
  } catch {
    fail(`${new URL(url).origin} no contesta: levantala con \`bin/cockpit open ${app || '<app>'}\` o su \`make\``);
  }

  const require = createRequire(join(root, 'harness/package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1 });
    // El tema de las herramientas se guarda en `ui.theme` (tools/ui/workbench.js): sin esto, cada app abre con el suyo.
    await page.addInitScript((t) => { try { localStorage.setItem('ui.theme', t); } catch {} }, theme);
    // La paleta de color (`ui.palette`, los bloques `data-palette` de theme.css): PALETTE=nord, catppuccin…
    const palette = env('PALETTE');
    if (palette) await page.addInitScript((p) => { try { localStorage.setItem('ui.palette', p); } catch {} }, palette);
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`consola: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`excepción: ${e.message}`));
    // ERR_ABORTED es un pedido que el navegador cancela él mismo (una navegación, el cierre): no es un error de la app.
    page.on('requestfailed', (r) => {
      const why = r.failure()?.errorText || '';
      if (!why.includes('ERR_ABORTED')) errors.push(`pedido fallido: ${r.method()} ${r.url()} (${why})`);
    });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`); });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const waitFor = env('WAIT_FOR');
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 30_000 }).catch(() => fail(`no apareció ${waitFor}`));
    await page.waitForTimeout(Number(env('WAIT', '1500')));
    // Varios clics, en orden, separados por «;;» (un selector de Playwright puede llevar «;»).
    for (const selector of env('CLICK').split(';;').map((s) => s.trim()).filter(Boolean)) {
      await page.locator(selector).first().click({ timeout: 15_000 }).catch((e) => fail(`no pude hacer clic en ${selector}: ${e.message.split('\n')[0]}`));
      await page.waitForTimeout(Number(env('WAIT', '1500')));
    }
    const out = outFor(app || new URL(url).host.replace(/[^a-z0-9]+/gi, '-'));
    const selector = env('SELECTOR');
    if (selector) await page.locator(selector).first().screenshot({ path: out });
    else await page.screenshot({ path: out, fullPage: env('FULL') === '1' });
    console.log(out);
    if (errors.length) {
      console.log(`  ▲ ${errors.length} error(es) en la página:`);
      for (const e of [...new Set(errors)].slice(0, 15)) console.log(`    ${e}`);
    }
  } finally {
    await browser.close();
  }
}

const app = env('APP');
const route = env('ROUTE');
if (env('COCKPIT') === '1') shootCockpit(app, route);
else if (!app && !env('URL')) fail('falta APP=<app de Cockpit> (o URL=http://…); COCKPIT=1 captura la ventana de Cockpit');
else await shootHeadless(app, route);
