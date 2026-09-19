import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as state from '../src/ui-state.js';

// Ejecuta el componente real con un renderer en memoria: no abre un navegador ni llama a las APIs.
//
// ⚠ Este archivo reemplaza a `task-panel.test.js`. Aquel probaba el CAJÓN, y la mitad de lo que
// probaba —ancho persistente, `body.overflow`, devolución del foco, limpieza de listeners— existía
// porque flotaba encima de la página. La tarea vive ahora en el `editor` del workbench y nada de eso
// aplica: probarlo sería congelar una decisión que ya se revirtió.
//
// Lo que SÍ se prueba es lo que sigue siendo del componente y no del cajón: la navegación por teclado
// de las pestañas (con su `roving tabindex`), que Escape suelte la tarea, y que el cuerpo vuelva al
// tope al cambiar de pestaña — si no, entrás a «ramas» a mitad de tabla porque venías de otra.
const { descriptor } = parse(readFileSync(new URL('../src/TaskEditor.vue', import.meta.url), 'utf8'));
const compiled = compileScript(descriptor, { id: 'editor-test', inlineTemplate: true }).content
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, source) =>
    `const {${names.replace(/\s+as\s+/g, ':')}} = ${source === 'vue' ? 'Vue' : 'state'};`)
  .replace('export default', 'return');
const TaskEditor = new Function('Vue', 'state', compiled)(Vue, state);

function node(type, text = '') {
  return Vue.markRaw({ type, text, props: {}, children: [], style: {}, isConnected: true,
    focus() { document.activeElement = this; },
    get tabIndex() { return Number(this.props.tabindex ?? (this.type === 'button' ? 0 : -1)); },
    getClientRects() { return [1]; },
    querySelectorAll(selector) {
      return descendants(this).filter(n => selector === '[role=tab]' ? n.props.role === 'tab'
        : n.type === 'button' || n.props.tabindex !== undefined);
    },
  });
}
function descendants(root) { return root.children.flatMap(child => [child, ...descendants(child)]); }
const renderer = Vue.createRenderer({
  createElement: node, createText: text => node('text', text), createComment: text => node('comment', text),
  setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; n.children = []; },
  patchProp: (n, key, previous, next) => { n.props[key] = next; },
  insert(n, parent, anchor) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(n); else parent.children.splice(index, 0, n);
  },
  remove(n) { n.parent?.children.splice(n.parent.children.indexOf(n), 1); },
  parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
  setScopeId() {},
});

test('editor de la tarea: pestañas por teclado, roving tabindex, Escape y scroll al tope', async () => {
  const opener = node('button');
  globalThis.document = { activeElement: opener };
  const selected = Vue.ref('trabajo');
  let closeCount = 0;
  const root = node('root');
  const tabs3 = [{ id: 'trabajo', label: 'Trabajo' },
                 { id: 'pendientes', label: 'Pendientes', count: 3 },
                 { id: 'ramas', label: 'Ramas', count: 2 }];
  const app = renderer.createApp({ setup: () => () => Vue.h(TaskEditor, {
    title: 'Tarea de prueba', taskKey: 'CORE-1', tab: selected.value, tabs: tabs3,
    'onUpdate:tab': value => { selected.value = value; }, onClose: () => { closeCount++; },
  }) });
  app.mount(root);
  const find = predicate => descendants(root).find(predicate);
  const seccion = find(n => n.props['aria-label'] === 'Tarea CORE-1');
  const tabs = descendants(root).filter(n => n.props.role === 'tab');
  const cuerpo = find(n => n.props.role === 'tabpanel');
  const key = key => ({ key, preventDefault() {}, stopPropagation() {} });

  // ── no hace NADA de lo que hacía el cajón ────────────────────────────────────────────────────
  assert.equal(seccion.props['aria-modal'], undefined, 'no es un modal');
  assert.equal(seccion.props.role, undefined, 'no es un dialog');
  assert.equal(find(n => n.props.role === 'separator'), undefined, 'no tiene manija de ancho');
  assert.equal(seccion.props.style?.width, undefined, 'el ancho lo decide el grid, no el componente');

  // ── pestañas: ←/→ circulan, Home y End van a los extremos ────────────────────────────────────
  assert.equal(tabs.length, 3);
  await tabs[0].props.onKeydown(key('ArrowRight'));
  assert.equal(selected.value, 'pendientes');
  assert.equal(document.activeElement, tabs[1]);
  assert.equal(tabs[1].props['aria-selected'], true);
  // roving tabindex: sólo la activa es tabulable
  assert.equal(tabs[1].props.tabindex, 0);
  assert.equal(tabs[0].props.tabindex, -1);
  await tabs[1].props.onKeydown(key('End'));
  assert.equal(selected.value, 'ramas');
  await tabs[2].props.onKeydown(key('ArrowRight'));
  assert.equal(selected.value, 'trabajo', 'desde la última, → vuelve a la primera');
  await tabs[0].props.onKeydown(key('Home'));
  assert.equal(selected.value, 'trabajo');

  // ── el cuerpo vuelve al tope al cambiar de pestaña Y al cambiar de tarea ──────────────────────
  cuerpo.scrollTop = 900;
  selected.value = 'ramas';
  await Vue.nextTick();
  assert.equal(cuerpo.scrollTop, 0, 'cambiar de pestaña vuelve al tope');

  // ── Escape suelta la tarea ───────────────────────────────────────────────────────────────────
  seccion.props.onKeydown(key('Escape'));
  assert.equal(closeCount, 1);

  app.unmount();
  delete globalThis.document;
});
