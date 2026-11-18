/* Abre una página de wally/pruebas en un Chromium sin ventana y dice, EN TEXTO, lo que un modelo por la web no puede
 * ver: errores de consola y de JavaScript, recursos que no cargaron, el esquema de lo que quedó en pantalla y si se
 * desborda en un teléfono. Deja además una captura de escritorio y otra de teléfono para la persona.
 *   node wally/sandbox-check.mjs <url> <base de las capturas, sin extensión>
 * Sale 0 si no hubo errores, 1 si los hubo. Lo corre el comando `probar` de Wally (server/sandbox.go). */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [url, shotBase] = process.argv.slice(2);
if (!url) { console.error('uso: sandbox-check.mjs <url> [base de capturas]'); process.exit(2); }
const { chromium } = createRequire(join(root, 'harness/package.json'))('playwright');

const browser = await chromium.launch();
const problems = [];
const out = [];
try {
  for (const view of [{ name: 'escritorio', width: 1280, height: 800 }, { name: 'teléfono', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`consola: ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => errors.push(`JavaScript: ${String(e.message || e).slice(0, 300)}`));
    page.on('requestfailed', (r) => errors.push(`no cargó: ${r.url().replace(/^https?:\/\/[^/]+/, '')} (${r.failure()?.errorText || '?'})`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 20_000 }).catch((e) => { errors.push(`no abrió: ${e.message.split('\n')[0]}`); return null; });
    await page.waitForTimeout(800);
    if (view.name === 'escritorio') {
      const info = await page.evaluate(() => {
        const text = (document.body?.innerText || '').replace(/\s+\n/g, '\n').trim();
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return {
          title: document.title,
          lang: document.documentElement.lang || '(sin lang)',
          headings: [...document.querySelectorAll('h1,h2,h3')].filter(vis).slice(0, 25).map((h) => `${h.tagName.toLowerCase()}: ${h.innerText.trim().slice(0, 80)}`),
          links: document.querySelectorAll('a[href]').length,
          buttons: [...document.querySelectorAll('button,[role=button],input[type=submit]')].filter(vis).slice(0, 15).map((b) => (b.innerText || b.value || b.getAttribute('aria-label') || '(sin texto)').trim().slice(0, 40)),
          images: [...document.images].map((i) => ({ src: i.getAttribute('src')?.slice(0, 60), ok: i.complete && i.naturalWidth > 0, alt: i.alt })),
          inputs: document.querySelectorAll('input,select,textarea').length,
          chars: text.length,
          start: text.slice(0, 500),
          height: document.documentElement.scrollHeight,
        };
      });
      out.push(`Página: ${url.replace(/^https?:\/\/[^/]+/, '')} · HTTP ${resp?.status() ?? '—'}`);
      out.push(`Título: ${info.title || '(vacío)'} · lang ${info.lang} · alto ${info.height}px · ${info.chars} caracteres de texto visible`);
      out.push(`Encabezados (${info.headings.length}):\n${info.headings.map((h) => '  ' + h).join('\n') || '  (ninguno)'}`);
      out.push(`Enlaces: ${info.links} · campos: ${info.inputs} · botones: ${info.buttons.join(' | ') || 'ninguno'}`);
      const broken = info.images.filter((i) => !i.ok);
      out.push(`Imágenes: ${info.images.length}${broken.length ? ` · ROTAS: ${broken.map((i) => i.src).join(', ')}` : ''}${info.images.some((i) => !i.alt) ? ' · hay imágenes sin alt' : ''}`);
      if (broken.length) problems.push(`${broken.length} imagen(es) rota(s)`);
      if (!info.chars) problems.push('la página no muestra texto');
      out.push(`Empieza así:\n${info.start}`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 2) { problems.push(`en ${view.name} (${view.width}px) se desborda ${overflow}px a lo ancho`); }
    out.push(`En ${view.name} (${view.width}px): ${overflow > 2 ? `SE DESBORDA ${overflow}px a lo ancho` : 'no se desborda'} · ${errors.length ? errors.length + ' error(es)' : 'sin errores'}`);
    for (const e of [...new Set(errors)].slice(0, 12)) { out.push('  ✗ ' + e); problems.push(e); }
    if (shotBase) await page.screenshot({ path: `${shotBase}-${view.width}.png`, fullPage: true }).catch(() => {});
    await page.close();
  }
} finally { await browser.close(); }
out.push(problems.length ? `\nRESULTADO: ${problems.length} problema(s) para corregir.` : '\nRESULTADO: sin errores.');
console.log(out.join('\n'));
process.exit(problems.length ? 1 : 0);
