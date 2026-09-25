/* Prueba de disposición: servidores locales encendidos, navegador aislado y datos
 * de ejemplo para Jira. Nunca ejecuta corridas ni escribe en las APIs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../harness/package.json', import.meta.url));
const { chromium } = require('playwright');
// `SOLO=tablero,trazador` corre sólo esas, como `make estilo-contraste`: el panel del harness deshabilita
// su configuración mientras hay una corrida en curso, y ahí sus pruebas de foco no pueden pasar.
const only = (process.env.SOLO || '').split(',').map((x) => x.trim()).filter(Boolean);
const apps = [
  ['harness', 'http://localhost:5195'],
  ['tablero', 'http://localhost:5191'], ['trazador', 'http://localhost:5192'],
].filter(([name]) => !only.length || only.includes(name));
const sprint = { id: 1, name: 'Sprint UI', state: 'active', startDate: '2026-09-14', endDate: '2026-09-28' };
const sample = {
  '/api/sprints': { sprints: [sprint] },
  '/api/sprint': { sprint, issues: [
    { Key: 'UI-1', Summary: 'Validar el espacio de trabajo', Status: 'En revisión', StatusCategory: 'indeterminate',
      Points: 3, HasPoints: true, OriginSprint: 'Sprint UI', SpentSecs: 5400,
      Description: 'Datos de prueba de interfaz.' },
    { Key: 'UI-2', Summary: 'Tarea todavía sin ramas', Status: 'En curso', StatusCategory: 'indeterminate', Points: 2,
      Description: 'Comprueba el estado vacío.' },
  ] },
  '/api/efforts': { efforts: [
    { id: 1, title: 'Validar interfaz', stage: 'work', canon: 'arquitectura, onboarding',
      techNotes: '# Interfaz\n\n## Criterios\n\n' + Array(60).fill('- El documento conserva su scroll independiente.').join('\n')
        + '\n\n## Pendientes\n\n- [ ] Confirmar la interfaz',
      pending: [{ what: 'Confirmar la interfaz', section: 'Pendientes', done: false }] },
    { id: 2, title: 'Tarea sin ramas', stage: 'work', techNotes: '' },
  ] },
  '/api/task-locals': { taskLocals: { 'UI-1': { effortId: 1 }, 'UI-2': { effortId: 2 } } },
  '/api/transitions': { transitions: [
    { id: '31', name: 'Finalizar', to: 'Terminado' },
    { id: '41', name: 'Enviar a pruebas', to: 'En pruebas' },
  ], testing: 'pruebas' },
  '/api/ramas': { measuredAt: '2026-09-19T20:00:00-05:00', tasks: { '1': { pattern: 'ui', measuredAt: '2026-09-19T20:00:00-05:00', branches: [
    { repo: 'playground', branch: 'feat/ui', commit: 'abc1234', subject: 'Validar consola',
      in: { qa: true, main: false }, own: { qa: 0, main: 1 }, how: { qa: 'patch', main: 'no' },
      pr: { number: 10, state: 'OPEN', base: 'main', url: 'https://example.test/pr/10', revision: 'REVIEW_REQUIRED' } },
    { repo: 'tablero-api', branch: 'feat/ui-api', commit: 'def5678', subject: 'Agregar rutas',
      in: { qa: true, main: true }, own: { qa: 0, main: 0 }, how: { qa: 'patch', main: 'pr' } },
  ] } } },
};
// La prueba de interfaz no consulta Redash ni necesita una solicitud real. Este esqueleto conserva
// nombres largos y tres ramales para detectar el fallo visual más fácil de reintroducir: que las
// etiquetas se monten cuando el mapa se queda angosto.
const trazadorFixture = {
  stages: [
    { id: 'origen', label: 'Origen' },
    { id: 'registro', label: 'Registro' },
    { id: 'formulario', label: 'Formulario' },
    { id: 'cupo', label: 'Cupo' },
    { id: 'listado', label: 'Listado' },
    { id: 'seleccion', label: 'Selección' },
    { id: 'respuesta-lender', label: 'Respuesta del lender' },
    { id: 'biometria', label: 'Biometría' },
    { id: 'desembolso', label: 'Desembolso' },
  ],
  lanes: [
    { id: 'creditopx', label: 'CreditopX · decide el crédito', steps: [
      { id: 'biometria', required: false }, { id: 'desembolso', required: true },
    ] },
    { id: 'agregador', label: 'Agregador · decide la entidad', steps: [
      { id: 'respuesta-lender', required: true }, { id: 'desembolso', required: true },
    ] },
    { id: 'redirect', label: 'Redirect / UTM · el comercio decide', steps: [] },
    { id: 'credifamilia', label: 'Credifamilia · KYC V2', steps: [
      { id: 'respuesta-lender', required: false }, { id: 'biometria', required: false },
      { id: 'desembolso', required: true },
    ] },
  ],
  check: [],
};
const tracerFullFixture = {
  ureq: 987001, target: 'prod', outcome: 'aprobado', stages: [
    { id: 'origen', label: 'Origen', status: 'ok', source: 'db', at: '10:01', subs: [
      { label: 'Recepción de la solicitud', status: 'ok', source: 'loki', eventsOf: 2, events: [
        { at: '10:01', level: 'info', msg: 'Se creó la solicitud 987001.' },
        { at: '10:02', level: 'info', msg: 'Se identificó el comercio de prueba.' },
      ] },
      { label: 'Datos de solicitud', status: 'ok', source: 'db', evidence: {
        source: 'user_requests', rows: ['estado: aprobado', 'monto: 100000'], sql: 'SELECT status, amount FROM user_requests WHERE id = 987001',
      } },
    ] },
  ],
  merchant: 'Comercio de prueba', branch: 'Sucursal de prueba', lender: 'Entidad de prueba', rt: 1,
  amount: 100000, profiling: 'PerfiladorNuevo · 2 entidades mostradas · recomendada: Entidad de prueba',
  quotaProfiles: [{ category: 'Premium', entity: 'Entidad de prueba', quota: 1353200 }],
  personKey: 'p-prod-2a', document: '38612965', phone: '3001234567', origin: 'web', derivedOrigin: true,
};
const tracerResultsFixture = {
  target: 'prod', source: 'fixture', as: ['teléfono → 1'],
  history: { total: 2 },
  people: [{ personKey: 'p-prod-2a', document: '38612965', phone: '3001234567' }],
  items: [
    { ureq: 987001, personKey: 'p-prod-2a', date: '2026-09-19', time: '11:48', statusN: 'En curso', merchant: 'Comercio A', outcome: 'en-curso', direct: false },
    { ureq: 987000, personKey: 'p-prod-2a', date: '2025-12-20', time: '09:32', statusN: 'En curso', merchant: 'Comercio B', outcome: 'en-curso', direct: false },
  ],
};
const browser = await chromium.launch();
const screenshotDir = process.env.UI_SCREENSHOTS;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const paint = (page) => page.evaluate(() => new Promise(requestAnimationFrame));
async function openMenu(page, title) {
  const trigger = page.getByRole('button', { name: title, exact: true });
  await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((button) =>
    button.getAttribute('aria-label') === label && button.getAttribute('aria-haspopup') === 'menu'), title);
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
    let requestedTraces = 0;
    let requestedSearches = 0;
    let blockJira = false;
    page.on('pageerror', (e) => errors.push(e.message));
    if (name === 'trazador') {
      await page.addInitScript(() => {
        if (localStorage.getItem('trazador.recent') === null) {
          // Formato previo: al abrirlo se migra a una consulta-grupo con sus solicitudes.
          localStorage.setItem('trazador.recent', JSON.stringify(['prod:3001234567']));
        }
      });
    }
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET') return route.abort();
      if (name === 'tablero') {
        if (blockJira && (path === '/api/sprints' || path === '/api/sprint')) return new Promise(() => {});
        return route.fulfill({ json: sample[path] || {} });
      }
      if (name === 'trazador') {
        if (path === '/api/mapa') return route.fulfill({ json: trazadorFixture });
        if (path === '/api/buscar') {
          requestedSearches += 1;
          const q = new URL(route.request().url()).searchParams.get('q');
          const isLoanRequest = /^987\d+$/.test(q || '');
          const direct = isLoanRequest && !tracerResultsFixture.items.some((item) => String(item.ureq) === q)
            ? { ...tracerResultsFixture.items[0], ureq: Number(q), direct: true }
            : null;
          return route.fulfill({ json: {
            ...tracerResultsFixture,
            as: [isLoanRequest ? 'número de solicitud → 1' : 'teléfono → 1'],
            items: [...(direct ? [direct] : []), ...tracerResultsFixture.items
              .map((item) => ({ ...item, direct: String(item.ureq) === q }))],
          } });
        }
        if (path === '/api/traza') {
          requestedTraces += 1;
          const ureq = Number(new URL(route.request().url()).searchParams.get('ureq'));
          return route.fulfill({ json: { ...tracerFullFixture, ureq } });
        }
        return route.fulfill({ json: {} });
      }
      return route.continue();
    });
    await page.goto(url);
    await page.locator('.statusbar').waitFor();
    if (name === 'tablero') {
      assert.match(await page.locator('.tree-row').first().textContent(), /1\s*pend\./,
        'Tablero: el conteo del árbol explica que se trata de pendientes');
      await page.locator('.tree-row').first().click();
      await page.locator('.auxiliarybar').waitFor();
      assert.equal(await page.locator('.branch-panel').isVisible(), true,
        'Tablero: la consola de ramas de la tarea está abierta al enfocarla');
      assert.equal(await page.getByRole('table', { name: 'Ramas de playground para Validar el espacio de trabajo', exact: true }).isVisible(), true,
        'Tablero: la consola muestra como tabla las ramas del repo seleccionado');
      assert.equal(await page.getByRole('listbox', { name: 'Repositorios trabajados en la tarea' }).getByRole('option').count(), 2,
        'Tablero: el sidebar lista sólo los repos asociados a la tarea');
      assert.match(await page.locator('.split-side .region-head').textContent(), /Repos de esta tarea/,
        'Tablero: el encabezado deja explícito el alcance del selector');
      assert.match(await page.locator('.repo-branches > .region-head').textContent(), /medido hace|medido recién/,
        'Tablero: la medición se presenta como antigüedad legible');
      assert.equal(await page.getByLabel('Leyenda de ambientes: llegó, pendiente, no aplica').isVisible(), true,
        'Tablero: la consola explica los tres símbolos de ambientes');
      assert.equal(await page.locator('.auxiliarybar').getByRole('button', { name: 'Ramas', exact: true }).count(), 0,
        'Tablero: ramas ya no se duplica en el sidebar derecho');
      assert.match(await page.locator('.task-head-facts').textContent(), /Sprint UI.*3 pts.*1h 30m en Jira/s,
        'Tablero: sprint, puntos y tiempo de Jira viven en la cabecera');
      assert.equal(await page.locator('.auxiliarybar').getByRole('button', { name: 'Detalle', exact: true }).count(), 0,
        'Tablero: el sidebar derecho ya no repite una ficha de detalle');
      // El default del sidebar derecho es JIRA (`activeAuxView`, y así lo dice tablero/CLAUDE.md). Hasta el
      // 2026-09-24 esto esperaba una pestaña «Retomar» que se fue con la retoma, y el chequeo se frenaba
      // acá sin llegar a nada de lo que sigue: la misma lección de antes, una aserción vieja que nadie corrió.
      const jiraTab = page.locator('.auxiliarybar').getByRole('tab', { name: 'Jira', exact: true });
      assert.equal(await jiraTab.getAttribute('aria-selected'), 'true',
        'Tablero: Jira ocupa por defecto el cuerpo único del sidebar derecho');
      assert.equal(await page.locator('.auxiliarybar .view-tog').count(), 0,
        'Tablero: las vistas derechas son pestañas y no encabezados de acordeón');
      const jiraPanel = await page.locator('.jira-tab-panel').evaluate((panel) => {
        const frame = panel.querySelector('.jira-preview');
        const style = getComputedStyle(frame);
        const panelBox = panel.getBoundingClientRect();
        const frameBox = frame.getBoundingClientRect();
        return {
          border: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
          alto: frameBox.height,
          llena: Math.abs(frameBox.bottom - panelBox.bottom) <= 1,
        };
      });
      assert.equal(jiraPanel.border, '0px', 'Tablero: Jira no conserva el marco de tarjeta');
      assert.equal(jiraPanel.radius, '0px', 'Tablero: Jira no conserva esquinas de tarjeta');
      assert.equal(jiraPanel.llena, true, 'Tablero: Jira usa el alto completo de la pestaña');
      assert(jiraPanel.alto > 250, 'Tablero: la descripción Jira conserva un área de lectura amplia');
      assert.equal(await page.locator('.editor-tabs').getByRole('button', { name: 'Mostrar u ocultar vistas', exact: true }).count(), 0,
        'Tablero: el editor no duplica el control de regiones que ya vive en el pie');
      const state = page.getByRole('button', { name: 'Avanzar UI-1 al siguiente estado', exact: true });
      assert.equal(await state.isVisible(), true, 'Tablero: cada tarea Jira ofrece el siguiente estado en su fila');
      await state.click();
      const menuState = page.getByRole('menu', { name: 'Avanzar UI-1', exact: true });
      await menuState.getByRole('menuitem', { name: 'Terminado', exact: true }).waitFor();
      assert.equal(await menuState.getByRole('menuitem').count(), 1,
        'Tablero: el acceso rápido ofrece sólo el paso siguiente, no todas las salidas de Jira');
      await escapeMenu(page, state);
      assert.equal(new URL(page.url()).hash, '#/tareas/ui-1',
        'Tablero: enfocar una tarea deja una ruta copiable');
    }
    if (name === 'trazador') {
      await page.locator('.map svg').waitFor();
      assert.equal(await page.locator('.sidebar').isVisible(), true, 'Trazador: persona abierta al iniciar');
      assert.equal(await page.locator('.auxiliarybar').isVisible(), true, 'Trazador: inspector abierto al iniciar');
      assert.equal(await page.locator('.recent-panel').isVisible(), true, 'Trazador: recientes abierto en la consola al iniciar');
      const personCard = await page.locator('.person-panel > .region-head').evaluate((el) => {
        const style = getComputedStyle(el);
        return { border: style.borderTopWidth, radio: style.borderTopLeftRadius };
      });
      assert.equal(personCard.border, '0px', 'Trazador: cabecera de persona sin borde exterior');
      assert.equal(personCard.radio, '0px', 'Trazador: cabecera de persona sin radio de tarjeta');
      // La banda de la consola son sus pestañas (En curso · Todas), y arranca en «En curso».
      const recentInitial = page.locator('.recent-panel').getByRole('tab', { name: /En curso/ });
      assert.equal(await recentInitial.getAttribute('aria-selected'), 'true',
        'Trazador: la consola arranca en las solicitudes en curso antes de seleccionar una solicitud');
      assert.equal(await page.locator('.recent-row').count(), 1, 'Trazador: muestra las consultas guardadas');
    }
    const separator = name === 'trazador'
      ? page.locator('.handle-detail')
      : page.locator('[role="separator"][tabindex="0"]').first();
    await separator.waitFor();
    await separator.focus();
    const before = Number(await separator.getAttribute('aria-valuenow'));
    await separator.press(name === 'trazador' ? 'ArrowLeft' : 'ArrowRight');
    const after = Number(await separator.getAttribute('aria-valuenow'));
    assert.equal(after, before + 16, `${name}: ajuste con teclado`);
    if (name === 'tablero') {
      await page.waitForFunction(() => localStorage.getItem('tablero:bootstrap:v1') !== null);
      blockJira = true; // la recarga tiene que pintar aun si Jira todavía no respondió
    }
    await page.reload();
    const restored = name === 'trazador'
      ? page.locator('.handle-detail')
      : page.locator('[role="separator"][tabindex="0"]').first();
    await restored.waitFor();
    assert.equal(Number(await restored.getAttribute('aria-valuenow')), after, `${name}: persistencia`);
    assert.equal(await page.getByRole('button', { name: /Restablecer/ }).count(), 0,
      `${name}: no ofrece acciones de restablecer`);
    if (name === 'tablero') {
      await page.locator('.task-editor').waitFor({ timeout: 1000 });
      assert.equal(await page.getByText('Cargando el sprint…', { exact: true }).count(), 0,
        'Tablero: una recarga pinta el cache sin bloquearse en Jira');
      assert.equal(await page.getByText('actualizando Jira…', { exact: true }).isVisible(), true,
        'Tablero: la revalidación remota ocurre en segundo plano');
      assert.equal(new URL(page.url()).hash, '#/tareas/ui-1',
        'Tablero: la recarga restaura la tarea desde su ruta');
    }
    if (name === 'harness') {
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
      const pending = page.locator('.auxiliarybar').getByRole('tab', { name: /Pendientes/ });
      await pending.click();
      assert.equal(await pending.getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('.auxiliarybar').getByRole('tab', { name: 'Jira', exact: true }).getAttribute('aria-selected'), 'false');
    }
    if (name === 'trazador') {
      const handle = page.locator('.handle-detail');
      const box = await handle.boundingBox();
      const mapWidth = await page.locator('.editor-map').evaluate((e) => e.clientWidth);
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x - 80, box.y + 100, { steps: 6 });
      await page.mouse.up();
      assert(await page.locator('.editor-map').evaluate((e) => e.clientWidth) < mapWidth,
        'Trazador: el editor cede espacio al ensanchar los logs');
      assert.equal(await page.locator('body').evaluate((e) => e.classList.contains('resizing')), false);
      const stageMap = await page.locator('.map').evaluate((el) => {
        const labels = [...el.querySelectorAll('.node-label')].map((node) => {
          const box = node.getBBox();
          return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
        });
        const svg = el.querySelector('svg').getBBox();
        const mounted = labels.some((a, i) => labels.slice(i + 1).some((b) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
        return { dentro: labels.every((l) => l.left >= svg.x && l.right <= svg.x + svg.width), seMontan: mounted,
          rieles: el.querySelectorAll('.edge').length };
      });
      assert.equal(stageMap.dentro, true, 'Trazador: las etiquetas quedan dentro del lienzo');
      assert.equal(stageMap.seMontan, false, 'Trazador: las etiquetas no se montan');
      assert(stageMap.rieles > 0, 'Trazador: el recorrido conserva rieles visibles');

      const card = page.locator('.handle-person');
      await card.press('Home'); await paint(page);
      assert.equal(await page.locator('.person-panel').isVisible(), false,
        'Trazador: la ficha se pliega al llegar al borde');
      await card.press('Enter'); await paint(page);
      assert.equal(await page.locator('.person-panel').isVisible(), true,
        'Trazador: la ficha vuelve desde su tirador');

      const consolePanel = page.locator('.handle-panel');
      await consolePanel.press('Home'); await paint(page);
      assert.equal(await page.locator('.recent-panel').isVisible(), false,
        'Trazador: recientes se pliega al borde inferior');
      await consolePanel.press('Enter'); await paint(page);
      assert.equal(await page.locator('.recent-panel').isVisible(), true,
        'Trazador: recientes vuelve desde su tirador');
    }
    if (name === 'harness') {
      const { trigger, menu } = await openMenu(page, 'Opciones de consola');
      const filter = menu.getByRole('menuitemcheckbox', { name: 'Sólo eventos importantes' });
      await filter.click();
      assert.equal(await filter.getAttribute('aria-checked'), 'true');
      assert(await page.locator('#consoleFilterState').isVisible());
      await escapeMenu(page, trigger);
      await page.locator('#tabSsr').click();
      assert.equal(await page.locator('#consoleFilterState').isVisible(), false, 'Filtros independientes por consola');
      await openMenu(page, 'Opciones de consola');
      await menu.getByRole('menuitemcheckbox', { name: 'Sólo llamadas salientes' }).click();
      assert(await page.locator('#consoleFilterState').isVisible());
      await menu.getByRole('menuitem', { name: 'Ocultar consola', exact: true }).click();
      assert.equal(await page.locator('#bottomPanel').isVisible(), false);
      const consoleToggle = page.getByRole('button', { name: 'Mostrar u ocultar consola', exact: true });
      assert.equal(await consoleToggle.getAttribute('aria-pressed'), 'false');
      assert(await consoleToggle.evaluate((el) => el === document.activeElement), 'Ocultar devuelve el foco al alternador');
      await consoleToggle.click(); await paint(page);
      assert.equal(await page.locator('#bottomPanel').isVisible(), true, 'La consola vuelve desde el pie');
      const merchants = await openMenu(page, 'Opciones de comercios');
      await merchants.menu.getByRole('menuitem', { name: 'Buscar o agregar comercio' }).click();
      assert(await page.locator('#merchantSearch').evaluate((el) => el === document.activeElement));
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
      await escapeMenu(page, doc.trigger);
      const detail = page.locator('.statusbar').getByRole('button', { name: 'Mostrar u ocultar vistas', exact: true });
      await detail.click(); await paint(page);
      assert.equal(await page.locator('.auxiliarybar').isVisible(), false);
      assert.equal(await detail.getAttribute('aria-pressed'), 'false');
      await detail.click(); await paint(page);
      assert.equal(await page.locator('.auxiliarybar').isVisible(), true, 'Las vistas vuelven desde el pie');
      assert(await page.locator('.task-editor').isVisible(), 'Escape en menú no cierra la tarea');
      await page.getByRole('button', { name: 'Ocultar ramas', exact: true }).click(); await paint(page);
      assert.equal(await page.locator('.branch-panel').isVisible(), false,
        'Tablero: se puede cerrar la consola de la tarea');
      const branches = page.getByRole('button', { name: 'Mostrar u ocultar ramas', exact: true });
      assert.equal(await branches.getAttribute('aria-pressed'), 'false');
      assert.match(await branches.textContent(), /Ramas\s*2/,
        'Tablero: el footer conserva un acceso textual con el total de ramas');
      await branches.click(); await paint(page);
      assert.equal(await page.locator('.branch-panel').isVisible(), true,
        'Tablero: la consola de la tarea vuelve desde el footer');
      await page.locator('.tree-row').nth(1).click(); await paint(page);
      const emptyHeight = await page.locator('.branch-panel').evaluate((panel) => panel.getBoundingClientRect().height);
      assert(emptyHeight <= 80, 'Tablero: una tarea sin ramas usa una consola compacta');
      assert.equal(await page.locator('.split-side').count(), 0,
        'Tablero: una tarea sin ramas no inventa un selector de repositorios');
      await page.locator('.tree-row').first().click();
      await page.getByRole('table', { name: 'Ramas de playground para Validar el espacio de trabajo', exact: true }).waitFor();
    }
    if (name === 'trazador') {
      await page.getByRole('button', { name: 'Ocultar logs', exact: true }).click();
      assert.equal(await page.locator('.auxiliarybar').evaluate((el) => el.getBoundingClientRect().width), 0);
      const logs = page.getByRole('button', { name: 'Mostrar u ocultar los logs', exact: true });
      assert.equal(await logs.getAttribute('aria-pressed'), 'false');
      assert(await logs.evaluate((el) => el === document.activeElement), 'Ocultar devuelve el foco al alternador');
      await logs.click(); await paint(page);
      assert(await page.locator('.auxiliarybar').evaluate((el) => el.getBoundingClientRect().width > 0), 'Los logs vuelven desde el pie');
      const consolePanel = page.locator('.handle-panel');
      const consoleHeight = Number(await consolePanel.getAttribute('aria-valuenow'));
      await consolePanel.press('ArrowUp');
      assert.equal(Number(await consolePanel.getAttribute('aria-valuenow')), consoleHeight + 16,
        'Trazador: la consola de recientes ajusta su altura con teclado');
      await page.getByRole('button', { name: 'Ocultar recientes', exact: true }).click();
      assert.equal(await page.locator('.recent-panel').isVisible(), false, 'Trazador: se puede ocultar la consola');
      const recentToggle = page.getByRole('button', { name: 'Mostrar u ocultar recientes', exact: true });
      assert.equal(await recentToggle.getAttribute('aria-pressed'), 'false');
      await recentToggle.click(); await paint(page);
      assert.equal(await page.locator('.recent-panel').isVisible(), true, 'Trazador: la consola vuelve desde el pie');
      await page.locator('.recent-open').click();
      await page.locator('.request-row').first().waitFor();
      assert.equal(requestedSearches, 1, 'Trazador: consulta la búsqueda una sola vez antes de guardarla');
      assert.equal(await page.locator('.request-row').count(), 2,
        'Trazador: la consola muestra las solicitudes en curso de la búsqueda');
      const inProgressItems = await page.locator('.request-id').allTextContents();
      assert.deepEqual(inProgressItems, ['987001', '987000'],
        'Trazador: ordena las solicitudes en curso de más reciente a más antigua');
      const recentGroup = await page.evaluate(() => JSON.parse(localStorage.getItem('trazador.recent')));
      assert.deepEqual(recentGroup, [{ target: 'prod', q: '3001234567', personKey: 'p-prod-2a', kind: 'Teléfono', document: '38612965', phone: '3001234567', total: 2, requests: ['987001', '987000'], queries: ['3001234567'] }],
        'Trazador: un teléfono se guarda como un grupo de solicitudes');
      assert.equal(await page.locator('.recent-kind').textContent(), 'Cédula',
        'Trazador: el sidebar muestra la cédula de la persona');
      assert.equal(await page.locator('.person-panel .meta').getByText('38612965').isVisible(), true,
        'Trazador: la ficha lateral se completa antes de elegir una solicitud');
      await page.locator('.request-row').first().click();
      await page.locator('.log-toolbar').waitFor();
      assert.equal(requestedSearches, 1, 'Trazador: abrir una solicitud del grupo no repite la búsqueda');
      assert.equal(await page.locator('.recent-open').count(), 1,
        'Trazador: abrir una solicitud del grupo no crea otro reciente');
      assert.equal(await page.locator('.person-panel .meta').getByText('38612965').isVisible(), true,
        'Trazador: la ficha lateral muestra la cédula completa');
      assert.equal(await page.locator('.person-panel .meta').getByText('PerfiladorNuevo · 2 entidades mostradas · recomendada: Entidad de prueba').isVisible(), true,
        'Trazador: la ficha lateral muestra el resultado compacto del perfilamiento');
      assert.equal(await page.locator('.person-panel .quota-profiles').getByText('Premium').isVisible(), true,
        'Trazador: la ficha lateral muestra la categoría efectiva y el cupo de la entidad');
      const searchLog = page.getByRole('searchbox', { name: 'Buscar en todo el registro', exact: true });
      assert.equal(await page.locator('.log-line').count(), 2,
        'Trazador: el inspector muestra todas las líneas en un único registro');
      const copyLog = page.getByRole('button', { name: 'Copiar registro visible', exact: true });
      assert.equal(await copyLog.isVisible(), true,
        'Trazador: el registro completo se puede copiar desde el inspector');
      await searchLog.fill('comercio de prueba');
      assert.equal(await page.locator('.log-line').count(), 1,
        'Trazador: el buscador filtra todo el registro, no sólo una etapa');
      await searchLog.fill('');
      await page.locator('.stage-head').first().click();
      assert.equal(await page.locator('.stage-head').first().getAttribute('aria-current'), 'step',
        'Trazador: una sección del registro conserva la sincronía con el mapa');
      await page.getByRole('textbox', { name: 'Buscar' }).fill('987001');
      await page.getByRole('textbox', { name: 'Buscar' }).press('Enter');
      await page.locator('.request-row').first().waitFor();
      assert.equal(requestedSearches, 2, 'Trazador: permite buscar una solicitud directa');
      assert.equal(await page.locator('.recent-open').count(), 1,
        'Trazador: la solicitud directa se une al grupo existente de su persona');
      const allDirect = page.getByRole('tab', { name: /Todas/ });
      assert.equal(await allDirect.getAttribute('aria-selected'), 'true',
        'Trazador: una búsqueda por solicitud abre todas las solicitudes de la persona');
      assert.equal(await page.locator('.request-row').count(), 2,
        'Trazador: la consulta directa muestra los otros intentos sin ocultarlos');
      assert.equal(await page.locator('.request-row.on .request-id').textContent(), '987001',
        'Trazador: mantiene resaltada la solicitud que se buscó');
      assert.equal(new URL(page.url()).pathname, '/traza/prod/38612965/987001/origen',
        'Trazador: guarda la corrida y la etapa en una ruta dinámica legible');
      const groupByRequest = await page.evaluate(() => JSON.parse(localStorage.getItem('trazador.recent'))[0]);
      assert.deepEqual(groupByRequest.queries, ['987001', '3001234567'],
        'Trazador: el grupo conserva las consultas que lo resolvieron');
      assert.equal(await page.locator('.person-panel .history').count(), 0,
        'Trazador: el sidebar izquierdo no mezcla la historia con la ficha');
      const all = page.getByRole('tab', { name: /Todas/ });
      await all.click();
      assert.equal(await all.getAttribute('aria-selected'), 'true', 'Trazador: conserva todas las solicitudes dentro de la consola');
      assert.equal(await page.locator('.log-toolbar').isVisible(), true,
        'Trazador: abre el inspector al elegir una solicitud');
      await page.goto(`${url}/traza/prod/38612965`);
      await page.locator('.request-row').first().waitFor();
      assert.equal(await page.locator('.request-row').count(), 2,
        'Trazador: una ruta por cédula carga todas las solicitudes de la persona');
      assert.equal(await page.locator('.request-row.on').count(), 0,
        'Trazador: una ruta por cédula no inventa cuál solicitud abrir');
      assert.equal(new URL(page.url()).pathname, '/traza/prod/38612965',
        'Trazador: conserva la ruta canónica de la cédula');
      assert.equal(requestedSearches, 2,
        'Trazador: una cédula reutiliza el grupo que ya se guardó al abrir la solicitud');
      await page.goto(`${url}/traza/prod/3001234567`);
      await page.locator('.request-row').first().waitFor();
      assert.equal(new URL(page.url()).pathname, '/traza/prod/38612965',
        'Trazador: un celular se normaliza a la cédula de la persona');
      assert.equal(requestedSearches, 2,
        'Trazador: reutiliza la búsqueda de celular guardada en IndexedDB');
      await page.goto(`${url}/traza/prod/987001`);
      await page.locator('.log-toolbar').waitFor();
      assert.equal(await page.locator('.request-row').count(), 2,
        'Trazador: una ruta breve de solicitud expande la historia de la persona');
      assert.equal(new URL(page.url()).pathname, '/traza/prod/38612965/987001/origen',
        'Trazador: una solicitud se normaliza a cédula, solicitud y etapa');
      assert.equal(requestedSearches, 2,
        'Trazador: reutiliza la búsqueda inversa de solicitud guardada');
      const regions = await page.locator('.workspace').evaluate((area) => {
        const consolePanel = area.querySelector('.recent-panel').getBoundingClientRect();
        const stageMap = area.querySelector('.editor-map').getBoundingClientRect();
        const scenario = area.querySelector('.split-main').getBoundingClientRect();
        const headless = area.querySelector('.split-side').getBoundingClientRect();
        return {
          consolaTop: consolePanel.top, mapaBottom: stageMap.bottom, mismoAncho: consolePanel.width === stageMap.width,
          railDerecho: headless.left >= scenario.right - 1,
        };
      });
      assert(regions.consolaTop >= regions.mapaBottom - 1 && regions.mismoAncho && regions.railDerecho,
        'Trazador: recientes usa la consola inferior como un navegador vertical a la derecha');
      await page.goto(`${url}/traza/prod/38612965/987002`);
      await page.locator('.log-toolbar').waitFor();
      assert.equal(requestedTraces, 2, 'Trazador: consulta una traza ausente de caché');
      assert.equal(requestedSearches, 3, 'Trazador: una ruta completa repone primero el grupo de solicitudes');
      await page.reload();
      await page.locator('.log-toolbar').waitFor();
      assert.equal(requestedTraces, 2, 'Trazador: restaura la traza completa desde IndexedDB');
      await page.evaluate(async () => {
        // Una corrida guardada antes de sumar el perfil de cupo se actualiza una sola vez: no se puede
        // inferir de forma segura su categoría efectiva desde el resumen antiguo.
        await new Promise((resolve, reject) => {
          const open = indexedDB.open('trazador-queries', 2);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('trazas', 'readwrite');
            tx.objectStore('trazas').put({
              id: 'prod:987003', target: 'prod', ureq: '987003', savedAt: Date.now(),
              trace: { ureq: 987003, target: 'prod', outcome: 'aprobado', stages: [], merchant: 'Antigua' },
              results: null,
            });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        });
      });
      await page.goto(`${url}/traza/prod/987003`);
      await page.locator('.log-toolbar').waitFor();
      assert.equal(requestedTraces, 3, 'Trazador: actualiza una vez la caché anterior para guardar el perfil de cupo');
      await page.reload();
      await page.locator('.log-toolbar').waitFor();
      assert.equal(requestedTraces, 3, 'Trazador: reutiliza la corrida ya actualizada desde IndexedDB');
      await page.locator('.recent-open').click();
      await page.locator('.request-row').first().waitFor();
      assert.equal(requestedSearches, 4, 'Trazador: restaura la búsqueda completa desde IndexedDB');
      assert.equal(requestedTraces, 3, 'Trazador: restaura también la traza al abrir un reciente');
      await page.getByRole('button', { name: 'Borrar consulta 38612965', exact: true }).click();
      await paint(page);
      assert.equal(await page.locator('.recent-open').count(), 0, 'Trazador: quita la corrida de recientes');
      assert.equal(await page.evaluate(() => localStorage.getItem('trazador.recent')), '[]',
        'Trazador: persiste el borrado de la lista');
      await page.goto(`${url}/traza/prod/38612965/987001`);
      await page.locator('.log-toolbar').waitFor();
      assert.equal(requestedTraces, 4, 'Trazador: borra también la caché de la corrida');
      await page.evaluate(() => localStorage.setItem('trazador.recent', JSON.stringify({ formato: 'antiguo' })));
      await page.reload();
      await page.locator('.statusbar').waitFor();
      assert.equal(await page.locator('.recent-open').count(), 1,
        'Trazador: ignora el formato antiguo y guarda como reciente la consulta válida de la ruta');
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
      if (name === 'tablero') {
        // El sidebar interno de repos es el de la base: con la consola por debajo de 600 se pliega solo, y
        // entonces el repo se elige con el select de la subbanda. Las dos formas cuentan como «se puede elegir».
        const consolePanel = await page.locator('.branch-panel').evaluate((panel) => {
          const table = panel.querySelector('.split-main').getBoundingClientRect();
          const repos = panel.querySelector('.split-side').getBoundingClientRect();
          const picker = panel.querySelector('.repo-picker');
          const branch = getComputedStyle(panel.querySelector('tbody td:first-child'));
          const pr = getComputedStyle(panel.querySelector('tbody td:nth-child(2)'));
          const pickerShown = !!picker && getComputedStyle(picker).display !== 'none';
          return {
            tabla: table.width, repos: repos.width || (pickerShown ? 1 : 0), reposALaDerecha: !repos.width || repos.left >= table.right - 1,
            columnasFijas: branch.position === 'sticky' && pr.position === 'sticky',
          };
        });
        assert(consolePanel.tabla > 0 && consolePanel.repos > 0 && consolePanel.reposALaDerecha && consolePanel.columnasFijas,
          `tablero: tabla y sidebar de repos a la derecha a ${width}px`);
        const vistas = page.locator('.auxiliarybar');
        if (width === 1440) assert.equal(await vistas.isVisible(), true, 'tablero: las vistas acompañan al documento en ancho grande');
        if (width === 1024) {
          assert.equal(await vistas.isVisible(), false, 'tablero: las vistas se pliegan al entrar en ancho mediano');
          const toggle = page.locator('.statusbar').getByRole('button', { name: 'Mostrar u ocultar vistas', exact: true });
          await toggle.click(); await paint(page);
          assert.equal(await vistas.isVisible(), true, 'tablero: las vistas se recuperan desde el pie en ancho mediano');
          await toggle.click(); await paint(page);
        }
        if (width === 768) assert.equal(await vistas.isVisible(), false, 'tablero: el documento conserva el ancho en ventana angosta');
      }
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
      if (name === 'trazador') {
        const recentWithoutOverflow = await page.locator('.recent-panel .recent-row').evaluateAll((rows) =>
          rows.every((row) => row.scrollWidth <= row.clientWidth + 1));
        assert.equal(recentWithoutOverflow, true, `trazador: recientes completos a ${width}px`);
      }
      if (screenshotDir && width !== 1024) await page.screenshot({ path: `${screenshotDir}/${name}-${width}.png` });
    }
    if (name !== 'trazador') {
      const menuTitle = { harness: 'Opciones de consola', tablero: 'Opciones del documento' }[name];
      const compactMenu = await openMenu(page, menuTitle);
      await page.locator('.statusbar').click({ position: { x: 5, y: 5 } });
      assert.equal(await compactMenu.trigger.getAttribute('aria-expanded'), 'false', 'Clic fuera cierra el menú');
    }
    assert.deepEqual(errors, [], `${name}: errores de ejecución`);
    console.log(`✓ ${name}: menús, teclado, persistencia, paneles y disposición a 1440/1024/768px`);
    await page.close();
  }
} finally { await browser.close(); }
