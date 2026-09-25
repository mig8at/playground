// Pruebas de «mínimo o nada»: la lógica que decide cuánto mide una región. Corren sin navegador
// (`node --test tools/ui/workbench.test.mjs`); lo que pasa en las cuatro apps encendidas lo mide
// `make estilo-ui`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionSize, reopenSize, fitRegions, bindResize } from './workbench.js';

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
