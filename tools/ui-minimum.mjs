// «Mínimo o nada», medido en las cuatro UIs ENCENDIDAS: ninguna región redimensionable puede medir
// entre 0 y su mínimo, ni con la ventana en cuatro anchos ni en ningún paso del teclado sobre sus
// manijas. Los mínimos se leen de los tokens de taller.css (`--sidebar-min`, `--panel-min`) de cada
// app, así que el chequeo no tiene una copia de los números.
//
// No levanta servidores —los puertos son tuyos—: lo que no responde sale SIN VERIFICAR y el comando
// termina con 2, nunca en verde. Toda petición que no sea GET se bloquea en este navegador.
//
//   make estilo-minimo            las cuatro
//   make estilo-minimo SOLO=visor una o varias, separadas por coma
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../harness/package.json', import.meta.url));
const { chromium } = require('playwright');

const only = (process.env.SOLO || '').split(',').map((x) => x.trim()).filter(Boolean);
const apps = [
  ['harness', 'http://localhost:5195'], ['tablero', 'http://localhost:5191'],
  ['trazador', 'http://localhost:5192'], ['visor', 'http://localhost:5193'],
].filter(([name]) => !only.length || only.includes(name));
const WIDTHS = [1440, 1024, 768, 640];

// Qué mide cada región visible, y contra qué mínimo. El panel se mide en alto.
function measure() {
  const root = getComputedStyle(document.documentElement);
  const token = (n) => Number.parseFloat(root.getPropertyValue(n));
  const out = [];
  // `data-size="fixed"` declara una región que no se redimensiona (el estado vacío de la consola del
  // tablero, una franja sin manija): la desviación se ve en el markup, no en una lista de acá.
  for (const el of document.querySelectorAll('.sidebar, .auxiliarybar, .panel')) {
    if (el.dataset.size === 'fixed') continue;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const shown = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    const vertical = el.classList.contains('panel');
    const size = shown ? Math.round(vertical ? box.height : box.width) : 0;
    out.push({
      name: `${el.className.split(' ')[0]}${el.id ? '#' + el.id : ''}`,
      size, min: token(vertical ? '--panel-min' : '--sidebar-min'),
    });
  }
  return out;
}

const browser = await chromium.launch();
let unverified = 0;
try {
  for (const [name, url] of apps) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', (route) => (route.request().method() === 'GET' ? route.continue() : route.abort()));
    try {
      await page.goto(url, { timeout: 5000 });
    } catch {
      console.log(`  ?  ${name.padEnd(9)} SIN VERIFICAR: no responde en ${url}`);
      unverified++;
      await page.close();
      continue;
    }
    await page.waitForTimeout(1200);
    // El tablero muestra las vistas y la consola sólo con una tarea abierta.
    if (name === 'tablero') await page.locator('.tree-row').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);

    // 1 · la ventana: en cada ancho, 0 o al menos el mínimo
    const seen = new Set();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      for (const r of await page.evaluate(measure)) {
        seen.add(r.name);
        assert(r.size === 0 || r.size >= r.min - 1,
          `${name}: ${r.name} mide ${r.size}px a ${width}px de ventana, entre 0 y su mínimo de ${r.min}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(250);

    // 2 · el teclado: achicar paso a paso hasta plegar, sin pasar nunca por el medio; Enter reabre
    // ⚠ Por referencia y todas de entrada: una región plegada puede sacar su manija del DOM (la consola
    // del tablero), y un `nth(i)` pasaría a apuntar a la manija de al lado.
    const handles = await page.locator('[role="separator"][tabindex="0"]').elementHandles();
    let folded = 0;
    for (const handle of handles) {
      if (!(await handle.isVisible())) continue;
      const min = Number(await handle.getAttribute('aria-valuemin'));
      const label = await handle.getAttribute('aria-label');
      const vertical = (await handle.getAttribute('aria-orientation')) === 'horizontal';
      const start = Number(await handle.getAttribute('aria-valuenow'));
      if (!start) continue;
      const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      await handle.focus();
      await handle.press(keys[0]);
      let shrink = keys[0];
      if (Number(await handle.getAttribute('aria-valuenow')) > start) { shrink = keys[1]; await handle.press(shrink); }
      const regionMin = await page.evaluate((v) => Number.parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue(v ? '--panel-min' : '--sidebar-min')), vertical);
      let last = start;
      for (let step = 0; step < 60; step++) {
        const value = Number(await handle.getAttribute('aria-valuenow'));
        assert(value === 0 || value >= regionMin, `${name}: «${label}» pasó por ${value}px (mínimo ${regionMin})`);
        if (value === 0) break;
        last = value;
        // Una región que se pliega puede llevarse su manija: si ya no está, se plegó.
        if (!(await handle.evaluate((el) => el.isConnected))) break;
        await handle.press(shrink);
      }
      assert.equal(Number(await handle.getAttribute('aria-valuenow')), 0, `${name}: «${label}» no se pliega con el teclado`);
      assert.equal(min, 0, `${name}: «${label}» anuncia un mínimo de ${min} y se pliega: aria-valuemin tiene que ser 0`);
      // Si la manija se fue con su región, se vuelve por el botón del pie, que prueba `make estilo-ui`.
      if (await handle.isVisible()) {
        await handle.press('Enter');
        const back = Number(await handle.getAttribute('aria-valuenow'));
        assert(back >= regionMin, `${name}: «${label}» no reabre con Enter (quedó en ${back}, la última abierta era ${last})`);
      }
      folded++;
    }
    console.log(`  ✓  ${name.padEnd(9)} ${[...seen].length} regiones en ${WIDTHS.join('/')}px · ${folded} manijas pliegan con el teclado`);
    await page.close();
  }
} finally {
  await browser.close();
}
if (unverified) process.exit(2);
