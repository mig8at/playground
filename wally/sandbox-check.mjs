/* Abre una página de wally/pruebas en un Chromium sin ventana y dice, EN TEXTO, lo que un modelo por la web no puede
 * ver: errores de consola y de JavaScript, recursos que no cargaron, el esquema de lo que quedó en pantalla y si se
 * desborda en un teléfono. Deja además una captura de escritorio y otra de teléfono para la persona.
 *   node wally/sandbox-check.mjs <url> <base de las capturas, sin extensión> [criterios.json]
 * Con el archivo de criterios, además USA la página: por cada criterio la abre de nuevo y corre sus pasos (tocar,
 * escribir, elegir, marcar, ver, no_ver), y dice cuál pasa y cuál no. Sin eso sólo se sabe que no hay errores, no que
 * la página haga lo pedido (2026-11-17: un formulario que no validaba pasó `probar` sin un solo error).
 * Sale 0 si no hubo errores, 1 si los hubo. Lo corre el comando `probar` de Wally (server/sandbox.go). */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [url, shotBase, criteriaFile] = process.argv.slice(2);
if (!url) { console.error('uso: sandbox-check.mjs <url> [base de capturas]'); process.exit(2); }
const { chromium } = createRequire(join(root, 'harness/package.json'))('playwright');

const browser = await chromium.launch();
const problems = [];
const out = [];
// Lo mismo, en datos, para la tarjeta de la interfaz (queda al lado de las capturas, en <base>.json).
const report = { errors: [], overflow: [], criteria: [], note: '' };
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
    if (overflow > 2) { problems.push(`en ${view.name} (${view.width}px) se desborda ${overflow}px a lo ancho`); report.overflow.push(`${view.name} (${view.width}px): ${overflow}px`); }
    out.push(`En ${view.name} (${view.width}px): ${overflow > 2 ? `SE DESBORDA ${overflow}px a lo ancho` : 'no se desborda'} · ${errors.length ? errors.length + ' error(es)' : 'sin errores'}`);
    for (const e of [...new Set(errors)].slice(0, 12)) { out.push('  ✗ ' + e); problems.push(e); if (!report.errors.includes(e)) report.errors.push(e); }
    if (shotBase) await page.screenshot({ path: `${shotBase}-${view.width}.png`, fullPage: true }).catch(() => {});
    await page.close();
  }
  // LOS CRITERIOS: lo que la página tiene que HACER, comprobado usándola.
  if (criteriaFile) {
    const { readFileSync, existsSync } = await import('node:fs');
    const FORM = `[
  { "criterio": "lo que tiene que pasar, en una línea",
    "pasos": [ { "tocar": "Texto del botón" }, { "escribir": { "en": "Etiqueta del campo", "texto": "Ana" } },
               { "elegir": { "en": "Etiqueta del desplegable", "opcion": "Texto de la opción" } },
               { "marcar": "Etiqueta de la casilla" }, { "ver": "texto que tiene que aparecer" }, { "no_ver": "texto que NO" } ] }
]`;
    if (!existsSync(criteriaFile)) {
      problems.push('falta criterios.json'); report.note = 'falta criterios.json';
      out.push(`\nCRITERIOS: falta el archivo criterios.json del proyecto. Sin él no se sabe si la página HACE lo pedido. Escribilo (un criterio por cada cosa que te pidieron), con esta forma:\n${FORM}`);
    } else {
      let list = null;
      try { list = JSON.parse(readFileSync(criteriaFile, 'utf8')); } catch (e) { problems.push('criterios.json no es JSON válido'); report.note = 'criterios.json no es JSON válido'; out.push(`\nCRITERIOS: criterios.json no es JSON válido (${e.message}). La forma:\n${FORM}`); }
      if (list && (!Array.isArray(list) || !list.length)) { problems.push('criterios.json está vacío'); report.note = 'criterios.json está vacío'; out.push(`\nCRITERIOS: criterios.json tiene que ser una lista con al menos un criterio. La forma:\n${FORM}`); list = null; }
      if (list) {
        out.push(`\nCRITERIOS (${Math.min(list.length, 25)}):`);
        const base = url.replace(/[^/]*$/, '');
        for (const [i, c] of list.slice(0, 25).entries()) {
          const name = String(c?.criterio || `criterio ${i + 1}`).slice(0, 140);
          const steps = Array.isArray(c?.pasos) ? c.pasos.slice(0, 20) : [];
          if (!steps.length || !steps.some((s) => s && ('ver' in s || 'no_ver' in s))) {
            problems.push(`criterio sin comprobación: ${name}`);
            out.push(`  ✗ ${name} — no tiene ningún paso «ver» o «no_ver»: no comprueba nada`);
            report.criteria.push({ name, ok: false, detail: 'no tiene ningún paso «ver» o «no_ver»: no comprueba nada' });
            continue;
          }
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          const errors = [];
          page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
          let failed = '';
          try {
            await page.goto(c.pagina ? base + String(c.pagina).replace(/^\/+/, '') : url, { waitUntil: 'load', timeout: 15_000 });
            for (const [k, s] of steps.entries()) {
              const T = { timeout: 4000 };
              const field = (label) => page.getByLabel(label, { exact: false }).or(page.getByPlaceholder(label)).or(page.getByRole('textbox', { name: label })).first();
              try {
                if ('tocar' in s) await page.getByRole('button', { name: s.tocar }).or(page.getByRole('link', { name: s.tocar })).or(page.getByText(s.tocar, { exact: true })).first().click(T);
                else if ('escribir' in s) await field(s.escribir.en).fill(String(s.escribir.texto ?? ''), T);
                else if ('elegir' in s) await page.getByLabel(s.elegir.en, { exact: false }).first().selectOption({ label: s.elegir.opcion }, T).catch(() => page.getByLabel(s.elegir.en, { exact: false }).first().selectOption(s.elegir.opcion, T));
                else if ('marcar' in s) await page.getByLabel(s.marcar, { exact: false }).first().check(T);
                else if ('ver' in s) await page.getByText(s.ver, { exact: false }).first().waitFor({ state: 'visible', ...T });
                else if ('no_ver' in s) { await page.waitForTimeout(300); if (await page.getByText(s.no_ver, { exact: false }).first().isVisible().catch(() => false)) throw new Error('está a la vista'); }
                else throw new Error('paso desconocido: usá tocar, escribir, elegir, marcar, ver o no_ver');
              } catch (e) {
                const seen = (await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim()).catch(() => '')).slice(0, 260);
                failed = `paso ${k + 1} ${JSON.stringify(s)}: ${String(e.message || e).split('\n')[0].slice(0, 160)}. Lo que se ve: «${seen}»`;
                break;
              }
            }
            if (!failed && errors.length) failed = `error de JavaScript al usarla: ${errors[0]}`;
          } catch (e) { failed = `no abrió: ${String(e.message || e).split('\n')[0]}`; }
          await page.close();
          if (failed) { problems.push(`criterio: ${name}`); out.push(`  ✗ ${name} — ${failed}`); } else out.push(`  ✓ ${name}`);
          report.criteria.push({ name, ok: !failed, detail: failed });
        }
      }
    }
  }
} finally { await browser.close(); }
out.push(problems.length ? `\nRESULTADO: ${problems.length} problema(s) para corregir.` : '\nRESULTADO: sin errores.');
if (shotBase) { const { writeFileSync } = await import('node:fs'); try { writeFileSync(`${shotBase}.json`, JSON.stringify({ ...report, problems: problems.length })); } catch { /* sin el resumen en datos: queda el texto */ } }
console.log(out.join('\n'));
process.exit(problems.length ? 1 : 0);
