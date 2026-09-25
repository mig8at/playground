// ¿La base pinta lo que dice su especificación? Arma una página con tema.css, taller.css y el marcado de
// cada componente de tools/ui/spec.json, y compara lo que pinta el navegador —alto, ancho, padding,
// letra, peso, interlineado, radio, gap, icono— contra los números de la especificación. Sale ≠0 si
// uno no coincide: la base no puede decir una medida y pintar otra.
//
//   make estilo-componentes
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../harness/package.json', import.meta.url));
const { chromium } = require('playwright');
const ui = fileURLToPath(new URL('./ui/', import.meta.url));
const spec = JSON.parse(readFileSync(join(ui, 'spec.json'), 'utf8'));

const fixture = `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(join(ui, 'tema.css'))}">
<link rel="stylesheet" href="${pathToFileURL(join(ui, 'taller.css'))}">
<style>body{margin:0;padding:24px;background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:var(--text-base)}
.case{width:320px;margin-bottom:24px}</style></head><body>
${spec.components.map((c) => `<div class="case" data-case="${c.id}">${c.html}</div>`).join('\n')}
</body></html>`;
const dir = mkdtempSync(join(tmpdir(), 'ui-spec-'));
const file = join(dir, 'fixture.html');
writeFileSync(file, fixture);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
await page.goto(pathToFileURL(file).href);
await page.waitForTimeout(200);

// Lo que pinta el navegador, con el mismo nombre que usa la especificación.
const measured = await page.evaluate((components) => {
  const px = (v) => Number.parseFloat(v);
  function read(el, want) {
    const cs = getComputedStyle(el), box = el.getBoundingClientRect(), out = {};
    for (const [k, w] of Object.entries(want)) {
      if (typeof w === 'string') out[k] = cs[k];
      else if (k === 'height') out[k] = box.height;
      else if (k === 'width') out[k] = box.width;
      else if (k === 'iconSize') { const i = el.querySelector('.ui-icon'); out[k] = i ? i.getBoundingClientRect().width : null; }
      else if (k === 'borderRadius') out[k] = px(cs.borderTopLeftRadius);
      else if (k === 'borderWidth') out[k] = px(cs.borderTopWidth);
      else if (k === 'gap') out[k] = Math.max(px(cs.rowGap) || 0, px(cs.columnGap) || 0);
      else if (k === 'fontWeight') out[k] = Number(cs.fontWeight);
      else out[k] = px(cs[k]);
    }
    return out;
  }
  const res = {};
  for (const c of components) {
    const root = document.querySelector(`[data-case="${c.id}"]`);
    const el = c.target ? root.querySelector(c.target) : root.firstElementChild;
    res[c.id] = { main: el ? read(el, c.measure) : null, parts: {} };
    for (const [sel, m] of Object.entries(c.parts || {})) {
      const p = root.querySelector(sel);
      res[c.id].parts[sel] = p ? read(p, m) : null;
    }
  }
  return res;
}, spec.components);
await browser.close();

// ⚠ El radio «completo» de una píldora se declara como 999 y el navegador lo recorta a la mitad del
// alto: cualquier valor ≥ la mitad del alto es la misma píldora.
const same = (key, want, got, height) => {
  if (typeof want === 'string') return got === want;
  if (got === null || got === undefined || Number.isNaN(got)) return false;
  if (key === 'borderRadius' && want >= 999) return got >= (height || 0) / 2;
  return Math.abs(got - want) <= 0.5;
};
let bad = 0, checked = 0;
const lines = [];
for (const c of spec.components) {
  const m = measured[c.id];
  const errs = [];
  if (!m.main) errs.push('no se encontró el elemento');
  else for (const [k, want] of Object.entries(c.measure)) {
    checked++;
    if (!same(k, want, m.main[k], m.main.height)) errs.push(`${k} ${want} → pinta ${m.main[k] === null ? 'nada' : typeof m.main[k] === 'string' ? m.main[k] : Math.round(m.main[k] * 10) / 10}`);
  }
  for (const [sel, want] of Object.entries(c.parts || {})) {
    const got = m.parts[sel];
    if (!got) { errs.push(`${sel}: no está`); continue; }
    for (const [k, v] of Object.entries(want)) {
      checked++;
      if (!same(k, v, got[k], got.height)) errs.push(`${sel} ${k} ${v} → pinta ${typeof got[k] === 'string' ? got[k] : Math.round(got[k] * 10) / 10}`);
    }
  }
  if (errs.length) { bad++; lines.push(`  ✗  ${c.name.padEnd(22)} ${c.cls}\n       ${errs.join('\n       ')}`); }
  else lines.push(`  ✓  ${c.name.padEnd(22)} ${c.cls}`);
}
console.log(lines.join('\n'));
console.log(`\n  ${spec.components.length} componentes · ${checked} medidas · ${bad ? `${bad} no coinciden` : 'todas coinciden'}`);
process.exit(bad ? 1 : 0);
