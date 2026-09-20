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
  '/api/sprint': { sprint, issues: [
    { Key: 'UI-1', Summary: 'Validar el espacio de trabajo', Status: 'En revisión', StatusCategory: 'indeterminate',
      Points: 3, HasPoints: true, OriginSprint: 'Sprint UI', SpentSecs: 5400,
      Description: 'Datos de prueba de interfaz.' },
    { Key: 'UI-2', Summary: 'Tarea todavía sin ramas', Status: 'En curso', StatusCategory: 'indeterminate', Points: 2,
      Description: 'Comprueba el estado vacío.' },
  ] },
  '/api/efforts': { efforts: [
    { id: 1, title: 'Validar interfaz', stage: 'work', contextNodes: 'architecture, onboarding',
      techNotes: '# Interfaz\n\n## Criterios\n\n' + Array(60).fill('- El documento conserva su scroll independiente.').join('\n')
        + '\n\n## Pendientes\n\n- [ ] Confirmar la interfaz',
      pendientes: [{ texto: 'Confirmar la interfaz', seccion: 'Pendientes', hecho: false }] },
    { id: 2, title: 'Tarea sin ramas', stage: 'work', techNotes: '' },
  ] },
  '/api/task-locals': { taskLocals: { 'UI-1': { effortId: 1 }, 'UI-2': { effortId: 2 } } },
  '/api/transitions': { transitions: [
    { id: '31', name: 'Finalizar', to: 'Terminado' },
    { id: '41', name: 'Enviar a pruebas', to: 'En pruebas' },
  ], testing: 'pruebas' },
  '/api/ramas': { medidoEn: '2026-09-19T20:00:00-05:00', tareas: { '1': { patron: 'ui', medidoEn: '2026-09-19T20:00:00-05:00', ramas: [
    { repo: 'playground', rama: 'feat/ui', commit: 'abc1234', asunto: 'Validar consola',
      en: { qa: true, main: false }, propios: { qa: 0, main: 1 }, como: { qa: 'patch', main: 'no' },
      pr: { numero: 10, estado: 'OPEN', base: 'main', url: 'https://example.test/pr/10', revision: 'REVIEW_REQUIRED' } },
    { repo: 'tablero-api', rama: 'feat/ui-api', commit: 'def5678', asunto: 'Agregar rutas',
      en: { qa: true, main: true }, propios: { qa: 0, main: 0 }, como: { qa: 'patch', main: 'pr' } },
  ] } } },
};
// La prueba de interfaz no consulta Redash ni necesita una solicitud real. Este esqueleto conserva
// nombres largos y tres ramales para detectar el fallo visual más fácil de reintroducir: que las
// etiquetas se monten cuando el mapa se queda angosto.
const trazadorFixture = {
  etapas: [
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
  ramales: [
    { id: 'creditopx', label: 'CreditopX · decide el crédito', pasos: [
      { id: 'biometria', obligatorio: false }, { id: 'desembolso', obligatorio: true },
    ] },
    { id: 'agregador', label: 'Agregador · decide la entidad', pasos: [
      { id: 'respuesta-lender', obligatorio: true }, { id: 'desembolso', obligatorio: true },
    ] },
    { id: 'redirect', label: 'Redirect / UTM · el comercio decide', pasos: [] },
    { id: 'credifamilia', label: 'Credifamilia · KYC V2', pasos: [
      { id: 'respuesta-lender', obligatorio: false }, { id: 'biometria', obligatorio: false },
      { id: 'desembolso', obligatorio: true },
    ] },
  ],
  chequeo: [],
};
const trazadorCompletoFixture = {
  ureq: 987001, target: 'prod', outcome: 'aprobado', etapas: [
    { id: 'origen', label: 'Origen', status: 'ok', source: 'db', at: '10:01', subs: [] },
  ],
  comercio: 'Comercio de prueba', sucursal: 'Sucursal de prueba', lender: 'Entidad de prueba', rt: 1,
  monto: 100000, documento: '***001', origen: 'web', origenDerivado: true,
};
const trazadorResultadosFixture = {
  target: 'prod', fuente: 'fixture', como: ['número de solicitud'],
  historia: { total: 2, desde: '2025-12-20', hasta: '2026-09-19', enCurso: 2, comercios: 2, aprobadas: 0, rotas: 0, abandonadas: 0 },
  items: [
    { ureq: 987001, fecha: '2026-09-19', hora: '11:48', estadoN: 'En curso', comercio: 'Comercio A', desenlace: 'en-curso', directa: false },
    { ureq: 987000, fecha: '2025-12-20', hora: '09:32', estadoN: 'En curso', comercio: 'Comercio B', desenlace: 'en-curso', directa: false },
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
    let trazasPedidas = 0;
    let busquedasPedidas = 0;
    let bloquearJira = false;
    page.on('pageerror', (e) => errors.push(e.message));
    if (name === 'trazador') {
      await page.addInitScript(() => {
        if (localStorage.getItem('trazador.recientes') === null) {
          // Formato previo: al abrirlo se migra a una consulta-grupo con sus solicitudes.
          localStorage.setItem('trazador.recientes', JSON.stringify(['prod:3001234']));
        }
      });
    }
    await page.route('**/api/**', (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      const path = new URL(route.request().url()).pathname;
      if (name === 'tablero') {
        if (bloquearJira && (path === '/api/sprints' || path === '/api/sprint')) return new Promise(() => {});
        return route.fulfill({ json: sample[path] || {} });
      }
      if (name === 'trazador') {
        if (path === '/api/mapa') return route.fulfill({ json: trazadorFixture });
        if (path === '/api/buscar') {
          busquedasPedidas += 1;
          return route.fulfill({ json: trazadorResultadosFixture });
        }
        if (path === '/api/traza') {
          trazasPedidas += 1;
          const ureq = Number(new URL(route.request().url()).searchParams.get('ureq'));
          return route.fulfill({ json: { ...trazadorCompletoFixture, ureq } });
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
      assert.equal(await page.locator('.ramas-panel').isVisible(), true,
        'Tablero: la consola de ramas de la tarea está abierta al enfocarla');
      assert.equal(await page.getByRole('table', { name: 'Ramas de playground para Validar el espacio de trabajo', exact: true }).isVisible(), true,
        'Tablero: la consola muestra como tabla las ramas del repo seleccionado');
      assert.equal(await page.getByRole('listbox', { name: 'Repositorios trabajados en la tarea' }).getByRole('option').count(), 2,
        'Tablero: el sidebar lista sólo los repos asociados a la tarea');
      assert.match(await page.locator('.repo-sidebar > header').textContent(), /Repos de esta tarea/,
        'Tablero: el encabezado deja explícito el alcance del selector');
      assert.match(await page.locator('.console-head').textContent(), /medido hace|medido recién/,
        'Tablero: la medición se presenta como antigüedad legible');
      assert.equal(await page.getByLabel('Leyenda de ambientes: llegó, pendiente, no aplica').isVisible(), true,
        'Tablero: la consola explica los tres símbolos de ambientes');
      assert.equal(await page.locator('.auxiliarybar').getByRole('button', { name: 'Ramas', exact: true }).count(), 0,
        'Tablero: ramas ya no se duplica en el sidebar derecho');
      assert.match(await page.locator('.task-head-facts').textContent(), /Sprint UI.*3 pts.*1h 30m en Jira/s,
        'Tablero: sprint, puntos y tiempo de Jira viven en la cabecera');
      assert.match(await page.locator('.task-head-context').textContent(), /Contexto local:.*architecture.*onboarding/s,
        'Tablero: la cabecera muestra los nodos de contexto local');
      assert.equal(await page.locator('.auxiliarybar').getByRole('button', { name: 'Detalle', exact: true }).count(), 0,
        'Tablero: el sidebar derecho ya no repite una ficha de detalle');
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
      const estado = page.getByRole('button', { name: 'Avanzar UI-1 al siguiente estado', exact: true });
      assert.equal(await estado.isVisible(), true, 'Tablero: cada tarea Jira ofrece el siguiente estado en su fila');
      await estado.click();
      const menuEstado = page.getByRole('menu', { name: 'Avanzar UI-1', exact: true });
      await menuEstado.getByRole('menuitem', { name: 'Terminado', exact: true }).waitFor();
      assert.equal(await menuEstado.getByRole('menuitem').count(), 1,
        'Tablero: el acceso rápido ofrece sólo el paso siguiente, no todas las salidas de Jira');
      await escapeMenu(page, estado);
      assert.equal(new URL(page.url()).hash, '#/tareas/ui-1',
        'Tablero: enfocar una tarea deja una ruta copiable');
    }
    if (name === 'trazador') {
      await page.locator('.mapa svg').waitFor();
      assert.equal(await page.locator('.sidebar').isVisible(), true, 'Trazador: persona abierta al iniciar');
      assert.equal(await page.locator('.auxiliarybar').isVisible(), true, 'Trazador: inspector abierto al iniciar');
      assert.equal(await page.locator('.recientes-console').isVisible(), true, 'Trazador: recientes abierto en la consola al iniciar');
      const personaCard = await page.locator('.persona-panel > .region-head').evaluate((el) => {
        const style = getComputedStyle(el);
        return { border: style.borderTopWidth, radio: style.borderTopLeftRadius };
      });
      assert.notEqual(personaCard.border, '0px', 'Trazador: cabecera de persona con borde');
      assert.notEqual(personaCard.radio, '0px', 'Trazador: cabecera de persona con radio');
      const recientesInicial = page.getByRole('tab', { name: /Recientes/ });
      assert.equal(await recientesInicial.getAttribute('aria-selected'), 'true',
        'Trazador: muestra recientes en la consola antes de seleccionar una solicitud');
      assert.equal(await page.locator('.reciente').count(), 1, 'Trazador: muestra las consultas guardadas');
    }
    const separator = name === 'trazador'
      ? page.locator('.tirador:not(.tirador-consola)')
      : page.locator('[role="separator"][tabindex="0"]').first();
    await separator.waitFor();
    await separator.focus();
    const before = Number(await separator.getAttribute('aria-valuenow'));
    await separator.press(name === 'trazador' ? 'ArrowLeft' : 'ArrowRight');
    const after = Number(await separator.getAttribute('aria-valuenow'));
    assert.equal(after, before + 16, `${name}: ajuste con teclado`);
    if (name === 'tablero') {
      await page.waitForFunction(() => localStorage.getItem('tablero:bootstrap:v1') !== null);
      bloquearJira = true; // la recarga tiene que pintar aun si Jira todavía no respondió
    }
    await page.reload();
    const restored = name === 'trazador'
      ? page.locator('.tirador:not(.tirador-consola)')
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
      const pendientes = page.locator('.auxiliarybar').getByRole('tab', { name: /Pendientes/ });
      await pendientes.click();
      assert.equal(await pendientes.getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('.auxiliarybar').getByRole('tab', { name: 'Jira', exact: true }).getAttribute('aria-selected'), 'false');
    }
    if (name === 'trazador') {
      const handle = page.locator('.tirador:not(.tirador-consola)');
      const box = await handle.boundingBox();
      const mapWidth = await page.locator('.editor-mapa').evaluate((e) => e.clientWidth);
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x - 80, box.y + 100, { steps: 6 });
      await page.mouse.up();
      assert(await page.locator('.editor-mapa').evaluate((e) => e.clientWidth) < mapWidth,
        'Trazador: el editor cede espacio al ensanchar los logs');
      assert.equal(await page.locator('body').evaluate((e) => e.classList.contains('redimensionando')), false);
      const mapa = await page.locator('.mapa').evaluate((el) => {
        const labels = [...el.querySelectorAll('.nlbl')].map((node) => {
          const box = node.getBBox();
          return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
        });
        const svg = el.querySelector('svg').getBBox();
        const seMontan = labels.some((a, i) => labels.slice(i + 1).some((b) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
        return { dentro: labels.every((l) => l.left >= svg.x && l.right <= svg.x + svg.width), seMontan,
          rieles: el.querySelectorAll('.arista').length };
      });
      assert.equal(mapa.dentro, true, 'Trazador: las etiquetas quedan dentro del lienzo');
      assert.equal(mapa.seMontan, false, 'Trazador: las etiquetas no se montan');
      assert(mapa.rieles > 0, 'Trazador: el recorrido conserva rieles visibles');
    }
    if (name === 'context') {
      assert.equal(await page.locator('.ramas-console').isVisible(), true,
        'Context: la consola de ramas está abierta al iniciar');
      assert(await page.locator('.ramas-console .repo').count() > 1,
        'Context: el sidebar de la consola lista los repos indexados');
      assert(await page.locator('.ramas-console .rama-dato').count() > 0,
        'Context: el área principal muestra las ramas del repo seleccionado');
      const backendRepo = page.getByRole('option', { name: /legacy-backend/ });
      await backendRepo.click(); await paint(page);
      assert.equal(await backendRepo.getAttribute('aria-selected'), 'true');
      assert(await page.getByRole('table', { name: 'Ramas de legacy-backend', exact: true }).isVisible(),
        'Context: cambiar de repo cambia la tabla de ramas');
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
      assert.equal(await page.locator(':focus').getAttribute('data-menu-id'), 'ocultar');
      await page.keyboard.press('Home');
      assert.equal(await page.locator(':focus').getAttribute('data-menu-id'), 'ocultar');
      await page.keyboard.press('Enter'); await paint(page);
      assert.equal(await page.locator('#context-sidebar').isVisible(), false);
      const explorer = page.getByRole('button', { name: 'Mostrar u ocultar el explorador', exact: true });
      assert.equal(await explorer.getAttribute('aria-pressed'), 'false');
      assert(await explorer.evaluate((el) => el === document.activeElement), 'Ocultar devuelve el foco al alternador');
      await explorer.click(); await paint(page);
      assert.equal(await page.locator('#context-sidebar').isVisible(), true, 'El explorador vuelve desde el pie');
      await page.getByRole('button', { name: 'Ocultar ramas', exact: true }).click(); await paint(page);
      assert.equal(await page.locator('.ramas-console').isVisible(), false);
      const branches = page.getByRole('button', { name: 'Mostrar u ocultar ramas', exact: true });
      assert.equal(await branches.getAttribute('aria-pressed'), 'false');
      assert(await branches.evaluate((el) => el === document.activeElement), 'Ocultar ramas devuelve el foco al alternador');
      await branches.click(); await paint(page);
      assert.equal(await page.locator('.ramas-console').isVisible(), true, 'La consola de ramas vuelve desde el pie');
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
      assert.equal(await page.locator('#bottomPanel').isVisible(), false);
      const consoleToggle = page.getByRole('button', { name: 'Mostrar u ocultar consola', exact: true });
      assert.equal(await consoleToggle.getAttribute('aria-pressed'), 'false');
      assert(await consoleToggle.evaluate((el) => el === document.activeElement), 'Ocultar devuelve el foco al alternador');
      await consoleToggle.click(); await paint(page);
      assert.equal(await page.locator('#bottomPanel').isVisible(), true, 'La consola vuelve desde el pie');
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
      await escapeMenu(page, doc.trigger);
      const detail = page.locator('.statusbar').getByRole('button', { name: 'Mostrar u ocultar vistas', exact: true });
      await detail.click(); await paint(page);
      assert.equal(await page.locator('.auxiliarybar').isVisible(), false);
      assert.equal(await detail.getAttribute('aria-pressed'), 'false');
      await detail.click(); await paint(page);
      assert.equal(await page.locator('.auxiliarybar').isVisible(), true, 'Las vistas vuelven desde el pie');
      assert(await page.locator('.task-editor').isVisible(), 'Escape en menú no cierra la tarea');
      await page.getByRole('button', { name: 'Ocultar ramas', exact: true }).click(); await paint(page);
      assert.equal(await page.locator('.ramas-panel').isVisible(), false,
        'Tablero: se puede cerrar la consola de la tarea');
      const branches = page.getByRole('button', { name: 'Mostrar u ocultar ramas', exact: true });
      assert.equal(await branches.getAttribute('aria-pressed'), 'false');
      assert.match(await branches.textContent(), /Ramas\s*2/,
        'Tablero: el footer conserva un acceso textual con el total de ramas');
      await branches.click(); await paint(page);
      assert.equal(await page.locator('.ramas-panel').isVisible(), true,
        'Tablero: la consola de la tarea vuelve desde el footer');
      await page.locator('.tree-row').nth(1).click(); await paint(page);
      const altoVacio = await page.locator('.ramas-panel').evaluate((panel) => panel.getBoundingClientRect().height);
      assert(altoVacio <= 80, 'Tablero: una tarea sin ramas usa una consola compacta');
      assert.equal(await page.locator('.repo-sidebar').count(), 0,
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
      const consola = page.locator('.tirador-consola');
      const altoConsola = Number(await consola.getAttribute('aria-valuenow'));
      await consola.press('ArrowUp');
      assert.equal(Number(await consola.getAttribute('aria-valuenow')), altoConsola + 16,
        'Trazador: la consola de recientes ajusta su altura con teclado');
      await page.getByRole('button', { name: 'Ocultar recientes', exact: true }).click();
      assert.equal(await page.locator('.recientes-console').isVisible(), false, 'Trazador: se puede ocultar la consola');
      const recientesToggle = page.getByRole('button', { name: 'Mostrar u ocultar recientes', exact: true });
      assert.equal(await recientesToggle.getAttribute('aria-pressed'), 'false');
      await recientesToggle.click(); await paint(page);
      assert.equal(await page.locator('.recientes-console').isVisible(), true, 'Trazador: la consola vuelve desde el pie');
      await page.locator('.abrir-reciente').click();
      await page.locator('.curso-dato').first().waitFor();
      assert.equal(busquedasPedidas, 1, 'Trazador: consulta la búsqueda una sola vez antes de guardarla');
      assert.equal(await page.locator('.curso-dato').count(), 2,
        'Trazador: la consola muestra las solicitudes en curso de la búsqueda');
      const cursos = await page.locator('.curso-ureq').allTextContents();
      assert.deepEqual(cursos, ['987001', '987000'],
        'Trazador: ordena las solicitudes en curso de más reciente a más antigua');
      const recienteGrupo = await page.evaluate(() => JSON.parse(localStorage.getItem('trazador.recientes')));
      assert.deepEqual(recienteGrupo, [{ target: 'prod', q: '3001234', total: 2, solicitudes: ['987001', '987000'] }],
        'Trazador: un teléfono se guarda como un grupo de solicitudes');
      await page.locator('.curso-dato').first().click();
      await page.locator('.detail-toolbar').waitFor();
      assert.equal(busquedasPedidas, 1, 'Trazador: abrir una solicitud del grupo no repite la búsqueda');
      assert.equal(await page.locator('.abrir-reciente').count(), 1,
        'Trazador: abrir una solicitud del grupo no crea otro reciente');
      assert.equal(await page.locator('.persona-panel .historia').count(), 0,
        'Trazador: el sidebar izquierdo no mezcla la historia con la ficha');
      const historial = page.getByRole('tab', { name: /Historial/ });
      await historial.click();
      assert.equal(await historial.getAttribute('aria-selected'), 'true', 'Trazador: conserva el historial dentro de la consola');
      assert.equal(await page.locator('.detail-toolbar').isVisible(), true,
        'Trazador: abre el inspector al elegir una solicitud');
      const regiones = await page.locator('.workspace-main').evaluate((area) => {
        const consola = area.querySelector('.recientes-console').getBoundingClientRect();
        const mapa = area.querySelector('.editor-mapa').getBoundingClientRect();
        const escenario = area.querySelector('.console-stage').getBoundingClientRect();
        const navegador = area.querySelector('.console-sidebar').getBoundingClientRect();
        return {
          consolaTop: consola.top, mapaBottom: mapa.bottom, mismoAncho: consola.width === mapa.width,
          railDerecho: navegador.left >= escenario.right - 1,
        };
      });
      assert(regiones.consolaTop >= regiones.mapaBottom - 1 && regiones.mismoAncho && regiones.railDerecho,
        'Trazador: recientes usa la consola inferior como un navegador vertical a la derecha');
      await page.goto(`${url}?target=prod&ureq=987002`);
      await page.locator('.detail-toolbar').waitFor();
      assert.equal(trazasPedidas, 2, 'Trazador: consulta una traza ausente de caché');
      await page.reload();
      await page.locator('.detail-toolbar').waitFor();
      assert.equal(trazasPedidas, 2, 'Trazador: restaura la traza completa desde IndexedDB');
      await page.locator('.abrir-reciente').click();
      await page.locator('.curso-dato').first().waitFor();
      assert.equal(busquedasPedidas, 1, 'Trazador: restaura la búsqueda completa desde IndexedDB');
      assert.equal(trazasPedidas, 2, 'Trazador: restaura también la traza al abrir un reciente');
      await page.getByRole('button', { name: 'Borrar consulta 3001234', exact: true }).click();
      await paint(page);
      assert.equal(await page.locator('.abrir-reciente').count(), 0, 'Trazador: quita la corrida de recientes');
      assert.equal(await page.evaluate(() => localStorage.getItem('trazador.recientes')), '[]',
        'Trazador: persiste el borrado de la lista');
      await page.goto(`${url}?target=prod&ureq=987001`);
      await page.locator('.detail-toolbar').waitFor();
      assert.equal(trazasPedidas, 3, 'Trazador: borra también la caché de la corrida');
      await page.evaluate(() => localStorage.setItem('trazador.recientes', JSON.stringify({ formato: 'antiguo' })));
      await page.reload();
      await page.locator('.statusbar').waitFor();
      assert.equal(await page.locator('.abrir-reciente').count(), 0,
        'Trazador: ignora un formato antiguo de recientes sin romper la consulta');
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
        const consola = await page.locator('.ramas-panel').evaluate((panel) => {
          const tabla = panel.querySelector('.console-main').getBoundingClientRect();
          const repos = panel.querySelector('.repo-sidebar').getBoundingClientRect();
          const rama = getComputedStyle(panel.querySelector('tbody td:first-child'));
          const pr = getComputedStyle(panel.querySelector('tbody td:nth-child(2)'));
          return {
            tabla: tabla.width, repos: repos.width, reposALaDerecha: repos.left >= tabla.right - 1,
            columnasFijas: rama.position === 'sticky' && pr.position === 'sticky',
          };
        });
        assert(consola.tabla > 0 && consola.repos > 0 && consola.reposALaDerecha && consola.columnasFijas,
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
        const recientesSinDesborde = await page.locator('.recientes-console .reciente').evaluateAll((filas) =>
          filas.every((fila) => fila.scrollWidth <= fila.clientWidth + 1));
        assert.equal(recientesSinDesborde, true, `trazador: recientes completos a ${width}px`);
      }
      if (screenshotDir && width !== 1024) await page.screenshot({ path: `${screenshotDir}/${name}-${width}.png` });
    }
    if (name !== 'trazador') {
      const menuTitle = { context: 'Opciones del explorador', harness: 'Opciones de consola', tablero: 'Opciones del documento' }[name];
      const compactMenu = await openMenu(page, menuTitle);
      await page.locator('.statusbar').click({ position: { x: 5, y: 5 } });
      assert.equal(await compactMenu.trigger.getAttribute('aria-expanded'), 'false', 'Clic fuera cierra el menú');
    }
    assert.deepEqual(errors, [], `${name}: errores de ejecución`);
    console.log(`✓ ${name}: menús, teclado, persistencia, paneles y disposición a 1440/1024/768px`);
    await page.close();
  }
} finally { await browser.close(); }
