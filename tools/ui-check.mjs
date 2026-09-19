/* Prueba de disposición: servidores locales encendidos, navegador aislado y datos
 * de ejemplo para Jira. Nunca ejecuta corridas ni escribe en las APIs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../harness/package.json', import.meta.url));
const { chromium } = require('playwright');
const apps = [
  ['context', 'http://localhost:5193'], ['harness', 'http://localhost:5195'],
  ['tablero', 'http://localhost:5191'], ['trazador', 'http://localhost:5192'],
];
const sprint = { id: 1, name: 'Sprint UI', state: 'active', startDate: '2026-09-14', endDate: '2026-09-28' };
const sample = {
  '/api/sprints': { sprints: [sprint] },
  '/api/sprint': { sprint, issues: [{ Key: 'UI-1', Summary: 'Validar el espacio de trabajo',
    Status: 'En curso', StatusCategory: 'indeterminate', Points: 3, Description: 'Datos de prueba de interfaz.' }] },
  '/api/efforts': { efforts: [{ id: 1, title: 'Validar interfaz', stage: 'work',
    techNotes: '# Interfaz\n\n## Criterios\n\n' + Array(60).fill('- El documento conserva su scroll independiente.').join('\n') }] },
  '/api/task-locals': { taskLocals: { 'UI-1': { effortId: 1 } } },
};
const browser = await chromium.launch();
const screenshotDir = process.env.UI_SCREENSHOTS;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const paint = (page) => page.evaluate(() => new Promise(requestAnimationFrame));
async function openMenu(page, title) {
  const trigger = page.getByRole('button', { name: title, exact: true });
  await trigger.focus();
  await trigger.press('ArrowDown');
  const menu = page.getByRole('menu', { name: title, exact: true });
  await menu.waitFor();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
    `${title}: menú dentro de la ventana`);
  assert(await menu.evaluate((el) => el.contains(document.activeElement)), `${title}: foco dentro del menú`);
  if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${title.replaceAll(' ', '-')}.png` });
  return { trigger, menu };
}
async function escapeMenu(page, trigger) {
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(), 0);
  assert(await trigger.evaluate((el) => el === document.activeElement), 'Escape devuelve el foco');
}
try {
  for (const [name, url] of apps) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      if (name === 'tablero') return route.fulfill({ json: sample[new URL(route.request().url()).pathname] || {} });
      return route.continue();
    });
    await page.goto(url);
    await page.locator('.layout-controls button').first().waitFor();
    if (name === 'tablero') {
      await page.locator('.tree-row').first().click();
      await page.locator('.auxiliarybar').waitFor();
    }
    if (name === 'trazador') await page.locator('.mapa svg').waitFor();
    const separator = page.locator('[role="separator"][tabindex="0"]').first();
    await separator.waitFor();
    await separator.focus();
    const before = Number(await separator.getAttribute('aria-valuenow'));
    await separator.press(name === 'trazador' ? 'ArrowLeft' : 'ArrowRight');
    const after = Number(await separator.getAttribute('aria-valuenow'));
    assert.equal(after, before + 16, `${name}: ajuste con teclado`);
    await page.reload();
    const restored = page.locator('[role="separator"][tabindex="0"]').first();
    await restored.waitFor();
    assert.equal(Number(await restored.getAttribute('aria-valuenow')), after, `${name}: persistencia`);
    await page.getByRole('button', { name: 'Restablecer disposición', exact: true }).click();
    const toggle = page.locator('.layout-controls button').first();
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false', `${name}: ocultar`);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', `${name}: recuperar`);
    if (name === 'harness') {
      await page.getByRole('button', { name: 'Ocultar consola', exact: true }).click();
      assert.equal(await page.locator('#toggleConsole').getAttribute('aria-pressed'), 'false');
      await page.locator('#toggleConsole').click();
      const bottom = page.locator('#rszB');
      const height = Number(await bottom.getAttribute('aria-valuenow'));
      await bottom.press('ArrowUp');
      assert.equal(Number(await bottom.getAttribute('aria-valuenow')), height + 16);
    }
    if (name === 'tablero') {
      await page.locator('.tree-row').first().click();
      const right = page.locator('.rsz-aux');
      const width = Number(await right.getAttribute('aria-valuenow'));
      await right.press('ArrowLeft');
      assert.equal(Number(await right.getAttribute('aria-valuenow')), width + 16);
      await page.locator('.auxiliarybar .view-tog').nth(1).click();
      assert.equal(await page.locator('.auxiliarybar .view-tog').nth(1).getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.auxiliarybar .view-tog').first().getAttribute('aria-expanded'), 'false');
    }
    if (name === 'trazador') {
      const handle = page.locator('.tirador');
      const box = await handle.boundingBox();
      const mapWidth = await page.locator('.editor-mapa').evaluate((e) => e.clientWidth);
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x - 80, box.y + 100, { steps: 6 });
      await page.mouse.up();
      assert.equal(await page.locator('.editor-mapa').evaluate((e) => e.clientWidth), mapWidth, 'El arrastre de logs no mueve el mapa');
      assert.equal(await page.locator('body').evaluate((e) => e.classList.contains('redimensionando')), false);
    }
    if (name === 'context') {
      await page.getByRole('searchbox', { name: 'Buscar en el contexto' }).fill('solicitud');
      const { trigger, menu } = await openMenu(page, 'Opciones del explorador');
      const neighbors = menu.getByRole('menuitemcheckbox', { name: 'Incluir nodos vecinos' });
      assert.equal(await neighbors.getAttribute('aria-checked'), 'true');
      await neighbors.click(); await paint(page);
      assert.equal(await neighbors.getAttribute('aria-checked'), 'false');
      assert(await trigger.evaluate((el) => el.classList.contains('has-options')));
      await escapeMenu(page, trigger);
      await page.getByRole('searchbox', { name: 'Buscar en el contexto' }).fill('');
      await openMenu(page, 'Opciones del explorador');
      assert.equal(await page.locator(':focus').getAttribute('data-menu-id'), 'ocultar', 'Salta opciones deshabilitadas');
      await page.keyboard.press('End');
      assert.equal(await page.locator(':focus').getAttribute('data-menu-id'), 'restablecer');
      await page.keyboard.press('Home');
      assert.equal(await page.locator(':focus').getAttribute('data-menu-id'), 'ocultar');
      await page.keyboard.press('Enter'); await paint(page);
      assert(await page.getByRole('button', { name: 'Mostrar u ocultar el explorador' }).evaluate((el) => el === document.activeElement));
      await page.getByRole('button', { name: 'Mostrar u ocultar el explorador' }).click();
    }
    if (name === 'harness') {
      const { trigger, menu } = await openMenu(page, 'Opciones de consola');
      const filter = menu.getByRole('menuitemcheckbox', { name: 'Sólo eventos importantes' });
      await filter.click();
      assert.equal(await filter.getAttribute('aria-checked'), 'true');
      assert(await page.locator('#consoleFilterState').isVisible());
      await escapeMenu(page, trigger);
      await page.locator('#pestSsr').click();
      assert.equal(await page.locator('#consoleFilterState').isVisible(), false, 'Filtros independientes por consola');
      await openMenu(page, 'Opciones de consola');
      await menu.getByRole('menuitemcheckbox', { name: 'Sólo llamadas salientes' }).click();
      assert(await page.locator('#consoleFilterState').isVisible());
      await menu.getByRole('menuitem', { name: 'Ocultar consola', exact: true }).click();
      assert.equal(await page.locator('#toggleConsole').getAttribute('aria-pressed'), 'false');
      assert(await page.locator('#toggleConsole').evaluate((el) => el === document.activeElement));
      await page.locator('#toggleConsole').click();
      const merchants = await openMenu(page, 'Opciones de comercios');
      await merchants.menu.getByRole('menuitem', { name: 'Buscar o agregar comercio' }).click();
      assert(await page.locator('#buscom').evaluate((el) => el === document.activeElement));
    }
    if (name === 'tablero') {
      const { trigger, menu } = await openMenu(page, 'Qué tareas se ven');
      const first = menu.locator('[role="menuitemcheckbox"]:not(:disabled)').first();
      await first.click(); await paint(page);
      assert.equal(await first.getAttribute('aria-checked'), 'false');
      assert(await trigger.evaluate((el) => el.classList.contains('has-options')));
      await first.click(); await paint(page);
      await escapeMenu(page, trigger);
      assert(await page.getByRole('button', { name: 'Copiar para compartir', exact: true }).isVisible());
      const doc = await openMenu(page, 'Opciones del documento');
      assert(await doc.menu.getByRole('menuitem', { name: 'Copiar completo para retomar' }).isEnabled());
      await doc.menu.getByRole('menuitemcheckbox', { name: 'Mostrar detalle de la tarea' }).click(); await paint(page);
      assert.equal(await page.locator('.auxiliarybar').isVisible(), false);
      await doc.menu.getByRole('menuitemcheckbox', { name: 'Mostrar detalle de la tarea' }).click(); await paint(page);
      await escapeMenu(page, doc.trigger);
      assert(await page.locator('.task-editor').isVisible(), 'Escape en menú no cierra la tarea');
    }
    if (name === 'trazador') {
      const { trigger, menu } = await openMenu(page, 'Opciones de la etapa');
      const why = menu.getByRole('menuitemcheckbox', { name: 'Mostrar explicación de la etapa' });
      if (await why.isEnabled()) {
        await why.click(); await paint(page);
        assert.equal(await why.getAttribute('aria-checked'), 'true');
      }
      await escapeMenu(page, trigger);
      await page.getByRole('button', { name: 'Ocultar logs', exact: true }).click();
      const toggleLogs = page.locator('.layout-controls button').filter({ has: page.locator('[data-icon="detail"]') });
      assert.equal(await toggleLogs.getAttribute('aria-pressed'), 'false');
      assert(await toggleLogs.evaluate((el) => el === document.activeElement));
      await toggleLogs.click();
    }
    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        footer: Math.round(document.querySelector('.statusbar').getBoundingClientRect().bottom),
        editor: Math.round(document.querySelector('.editor').getBoundingClientRect().width),
      }));
      assert.equal(layout.overflow, false, `${name}: desborde a ${width}px`);
      assert.equal(layout.footer, 800, `${name}: pie visible a ${width}px`);
      assert(layout.editor >= 220, `${name}: editor usable a ${width}px`);
      if (name === 'harness') {
        const clipped = await page.locator('.stagehead').evaluate((head) => {
          const bounds = head.getBoundingClientRect();
          return [...head.querySelectorAll('button')].filter((el) => el.getClientRects().length).some((el) => {
            const box = el.getBoundingClientRect();
            return box.left < bounds.left || box.right > bounds.right + 1 || box.bottom > bounds.bottom + 1;
          });
        });
        assert.equal(clipped, false, `harness: controles completos a ${width}px`);
      }
      if (screenshotDir && width !== 1024) await page.screenshot({ path: `${screenshotDir}/${name}-${width}.png` });
    }
    const menuTitle = { context: 'Opciones del explorador', harness: 'Opciones de consola', tablero: 'Opciones del documento', trazador: 'Opciones de la etapa' }[name];
    const compactMenu = await openMenu(page, menuTitle);
    await page.locator('.statusbar').click({ position: { x: 5, y: 5 } });
    assert.equal(await compactMenu.trigger.getAttribute('aria-expanded'), 'false', 'Clic fuera cierra el menú');
    assert.deepEqual(errors, [], `${name}: errores de ejecución`);
    console.log(`✓ ${name}: menús, teclado, persistencia, paneles y disposición a 1440/1024/768px`);
    await page.close();
  }
} finally { await browser.close(); }
