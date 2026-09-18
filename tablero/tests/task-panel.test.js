import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as state from '../src/ui-state.js';

// Ejecuta el componente real con un renderer en memoria: no abre un navegador ni llama a las APIs.
const { descriptor } = parse(readFileSync(new URL('../src/TaskPanel.vue', import.meta.url), 'utf8'));
const compiled = compileScript(descriptor, { id: 'panel-test', inlineTemplate: true }).content
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, source) =>
    `const {${names.replace(/\s+as\s+/g, ':')}} = ${source === 'vue' ? 'Vue' : 'state'};`)
  .replace('export default', 'return');
const TaskPanel = new Function('Vue', 'state', compiled)(Vue, state);

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

test('panel: pestañas, teclado, ancho persistente, cancelación y devolución del foco', async () => {
  const listeners = new Map(), preferences = new Map();
  globalThis.window = { innerWidth: 1200,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type),
  };
  globalThis.localStorage = { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) };
  const opener = node('button');
  globalThis.document = { activeElement: opener, body: { style: { overflow: 'auto' } } };
  const selected = Vue.ref('trabajo');
  let closeCount = 0;
  const root = node('root');
  const app = renderer.createApp({ setup: () => () => Vue.h(TaskPanel, {
    title: 'Tarea de prueba', taskKey: 'CORE-1', tab: selected.value,
    tabs: [{ id: 'trabajo', label: 'Trabajo' }, { id: 'pendientes', label: 'Pendientes', count: 3 }],
    'onUpdate:tab': value => { selected.value = value; }, onClose: () => { closeCount++; },
  }) });
  app.mount(root);
  const find = predicate => descendants(root).find(predicate);
  const handle = find(n => n.props.role === 'separator');
  const panel = find(n => n.props.role === 'dialog');
  const tabs = descendants(root).filter(n => n.props.role === 'tab');
  const key = key => ({ key, preventDefault() {}, stopPropagation() {} });
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement, panel);
  assert.equal(panel.props.style.width, '820px');
  await tabs[0].props.onKeydown(key('ArrowRight'));
  assert.equal(selected.value, 'pendientes');
  assert.equal(document.activeElement, tabs[1]);
  assert.equal(tabs[1].props['aria-selected'], true);
  handle.props.onKeydown(key('ArrowLeft'));
  await Vue.nextTick();
  assert.equal(panel.props.style.width, '844px');
  assert.equal(state.readPreference('panel-width', 0), 844);
  handle.props.onDblclick();
  await Vue.nextTick();
  assert.equal(panel.props.style.width, '820px');
  handle.props.onPointerdown({ button: 0, clientX: 380, currentTarget: handle, preventDefault() {} });
  listeners.get('pointermove')({ clientX: 200 });
  listeners.get('pointercancel')();
  await Vue.nextTick();
  assert.equal(panel.props.style.width, '1000px');
  assert.equal(state.readPreference('panel-width', 0), 1000);
  assert.equal(listeners.has('pointermove'), false);
  window.innerWidth = 320;
  listeners.get('resize')();
  await Vue.nextTick();
  assert.equal(panel.props.style.width, '307px');
  panel.props.onKeydown(key('Escape'));
  assert.equal(closeCount, 1);
  app.unmount();
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(document.activeElement, opener);
  assert.equal(listeners.size, 0);
  delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
});
