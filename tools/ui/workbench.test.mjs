// Pruebas de «mínimo o nada»: la lógica que decide cuánto mide una región. Corren sin navegador
// (`node --test tools/ui/workbench.test.mjs`); lo que pasa en las cuatro apps encendidas lo mide
// `make estilo-ui`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionSize, reopenSize, fitRegions, bindResize, preferredTheme, setTheme, bindThemeToggle, THEME_KEY, THEME_BOOT } from './workbench.js';

test('regionSize: 0 o al menos el mínimo', () => {
  assert.equal(regionSize(300, 240), 300);
  assert.equal(regionSize(240, 240), 240);
  assert.equal(regionSize(239, 240), 0, 'un píxel debajo del mínimo pliega');
  assert.equal(regionSize(500, 240, 400), 400, 'el máximo corta');
  assert.equal(regionSize(300, 240, 200), 0, 'sin lugar para el mínimo, pliega: no se achica a 200');
  assert.equal(regionSize(NaN, 240), 0);
});

test('reopenSize: vuelve la última medida abierta, nunca menos que el mínimo', () => {
  assert.equal(reopenSize(320, 240, 800), 320);
  assert.equal(reopenSize(0, 240, 800, 300), 300, 'sin última medida, la de fábrica');
  assert.equal(reopenSize(100, 240, 800), 240, 'una medida vieja chica sube al mínimo');
  assert.equal(reopenSize(320, 240, 280), 280, 'si ya no entra, abre en lo que hay');
  assert.equal(reopenSize(320, 240, 200), 0, 'si no entra el mínimo, no abre');
});

test('fitRegions: achica hasta el mínimo, después pliega en orden', () => {
  const regions = (ax, sb) => [{ size: ax, min: 240 }, { size: sb, min: 240 }];
  assert.deepEqual(fitRegions(700, regions(340, 300)), [340, 300], 'entra');
  assert.deepEqual(fitRegions(580, regions(340, 300)), [280, 300], 'se achica primero el secundario');
  assert.deepEqual(fitRegions(480, regions(340, 300)), [240, 240], 'las dos en su mínimo');
  assert.deepEqual(fitRegions(470, regions(340, 300)), [0, 300],
    'se pliega el secundario y el sidebar recupera su medida: no queda achicado de más');
  assert.deepEqual(fitRegions(250, regions(340, 300)), [0, 250]);
  assert.deepEqual(fitRegions(200, regions(340, 300)), [0, 0], 'nada entra: el editor se queda con todo');
  assert.deepEqual(fitRegions(600, regions(0, 300)), [0, 300], 'una plegada no ocupa');
  assert.deepEqual(fitRegions(600, regions(120, 300)), [0, 300], 'una preferencia debajo del mínimo no se pinta');
});

// Un separador de mentira: lo justo del DOM que usa bindResize.
function fakeHandle() {
  const listeners = {}, attrs = {};
  return {
    attrs,
    setAttribute: (k, v) => { attrs[k] = v; },
    addEventListener: (k, f) => { listeners[k] = f; },
    removeEventListener: (k) => { delete listeners[k]; },
    press: (key, extra = {}) => listeners.keydown({ key, preventDefault() {}, ...extra }),
  };
}
function region(initial, options = {}) {
  const state = { size: initial, commits: [] };
  const handle = fakeHandle();
  const controller = bindResize(handle, {
    label: 'prueba', min: 240, max: 600, defaultValue: 300,
    get: () => state.size, set: (v) => { state.size = v; }, commit: (v) => state.commits.push(v),
    ...options,
  });
  return { state, handle, controller };
}

test('teclado: la flecha que cruza el mínimo pliega, y la que agranda reabre en la última medida', () => {
  const { state, handle } = region(256);
  handle.press('ArrowLeft');
  assert.equal(state.size, 240);
  handle.press('ArrowLeft');
  assert.equal(state.size, 0, 'de 240 a 224 no existe: pliega');
  assert.equal(handle.attrs['aria-valuetext'], 'Oculto');
  handle.press('ArrowRight');
  assert.equal(state.size, 240, 'reabre en la última medida abierta');
});

test('teclado: Home pliega, End lleva al máximo, Enter alterna recordando la medida', () => {
  const { state, handle } = region(320);
  handle.press('Home');
  assert.equal(state.size, 0);
  handle.press('Enter');
  assert.equal(state.size, 320);
  handle.press('End');
  assert.equal(state.size, 600);
  handle.press('Enter');
  assert.equal(state.size, 0);
  handle.press('Enter');
  assert.equal(state.size, 600);
});

test('plegar es lo normal: sin `collapsible` también pliega; `collapsible: false` se declara', () => {
  const plain = region(250);
  plain.handle.press('ArrowLeft');
  assert.equal(plain.state.size, 0);
  const fixed = region(250, { collapsible: false });
  fixed.handle.press('ArrowLeft');
  assert.equal(fixed.state.size, 240, 'la excepción declarada se queda en el mínimo');
});

test('el mínimo no se achica para caber: sin lugar para él, pliega', () => {
  const { state, handle } = region(300, { max: 200 });
  handle.press('ArrowLeft');
  assert.equal(state.size, 0, 'antes quedaba en 200 con un mínimo de 240');
});

test('`reopen()` del consumidor gana a la memoria del módulo', () => {
  const { state, handle } = region(0, { reopen: () => 420 });
  handle.press('Enter');
  assert.equal(state.size, 420);
});

test('`toggle()` del controlador es el mismo plegado que el del teclado', () => {
  const { state, controller } = region(330);
  controller.toggle();
  assert.equal(state.size, 0);
  controller.toggle();
  assert.equal(state.size, 330);
  assert.deepEqual(state.commits, [0, 330], 'cada cambio se guarda');
});

// ── el tema ──────────────────────────────────────────────────────────────────────────────────────
// Lo justo del navegador: un <html> con clases, un localStorage, la preferencia del sistema y eventos.
function fakeBrowser({ systemDark = true, stored = null } = {}) {
  const classes = new Set(), store = new Map(stored ? [[THEME_KEY, stored]] : []), target = new EventTarget();
  const mediaListeners = [];
  const media = { get matches() { return systemDark; }, addEventListener: (_, f) => mediaListeners.push(f), removeEventListener() {} };
  Object.assign(globalThis, {
    document: {
      documentElement: { classList: { contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }, style: {} },
      createElement: () => ({ dataset: {}, setAttribute() {} }),
    },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    matchMedia: () => media,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
  return { classes, store, setSystem(dark) { systemDark = dark; mediaListeners.forEach((f) => f()); } };
}
function fakeButton() {
  const icon = { dataset: {}, setAttribute() {} }, attrs = {}; let onClick = null;
  return { icon, attrs, title: '', querySelector: () => icon, setAttribute: (k, v) => { attrs[k] = v; },
    addEventListener: (_, f) => { onClick = f; }, removeEventListener() {}, click: () => onClick() };
}

test('tema: sin elección sigue al sistema; con elección, gana lo elegido', () => {
  fakeBrowser({ systemDark: true });
  assert.equal(preferredTheme(), 'dark');
  fakeBrowser({ systemDark: false });
  assert.equal(preferredTheme(), 'light');
  fakeBrowser({ systemDark: true, stored: 'light' });
  assert.equal(preferredTheme(), 'light', 'lo que eligió la persona le gana al sistema');
  fakeBrowser({ systemDark: false, stored: 'cualquiera' });
  assert.equal(preferredTheme(), 'light', 'un valor guardado raro se ignora');
});

test('tema: el botón muestra el tema actual y su etiqueta dice lo que hace el clic', () => {
  const b = fakeBrowser({ systemDark: true });
  const button = fakeButton();
  bindThemeToggle(button);
  assert.equal(b.classes.has('dark'), true);
  assert.equal(document.documentElement.style.colorScheme, 'dark');
  assert.equal(button.icon.dataset.icon, 'moon', 'oscuro se ve como luna');
  assert.equal(button.attrs['aria-label'], 'Cambiar a tema claro');
  button.click();
  assert.equal(b.classes.has('dark'), false);
  assert.equal(button.icon.dataset.icon, 'sun');
  assert.equal(button.attrs['aria-label'], 'Cambiar a tema oscuro');
  assert.equal(b.store.get(THEME_KEY), 'light', 'elegir se guarda');
});

test('tema: sin elección acompaña al sistema; elegido, el sistema ya no manda', () => {
  const b = fakeBrowser({ systemDark: false });
  bindThemeToggle(fakeButton());
  assert.equal(b.classes.has('dark'), false);
  b.setSystem(true);
  assert.equal(b.classes.has('dark'), true, 'el modo nocturno del sistema se sigue mientras nadie eligió');
  setTheme('light');
  b.setSystem(true);
  assert.equal(b.classes.has('dark'), false, 'después de elegir, no');
});

test('tema: el renglón del <head> decide igual que el módulo', () => {
  const b = fakeBrowser({ systemDark: true, stored: 'light' });
  new Function(THEME_BOOT)();
  assert.equal(b.classes.has('dark'), false);
  assert.equal(document.documentElement.style.colorScheme, 'light');
  const c = fakeBrowser({ systemDark: true });
  new Function(THEME_BOOT)();
  assert.equal(c.classes.has('dark'), true);
});
