import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as state from '../src/ui-state.js';

// Ejecuta el componente real con un renderer en memoria: no abre un navegador ni llama a las APIs.
//
// ⚠ Este archivo ya reemplazó una vez a `task-panel.test.js` (el cajón) y ahora se recorta otra vez:
// el editor TENÍA ocho pestañas y ya no tiene ninguna — las siete que no son el documento viven en el
// acordeón del sidebar derecho. Probar su teclado sería congelar una decisión revertida.
//
// Queda lo que el componente sigue siendo: un encabezado con la identidad de la tarea, un cuerpo que
// scrollea y vuelve al tope al CAMBIAR DE TAREA (si no, entrás a una tarea nueva a mitad del
// documento porque venías scrolleado en la anterior), Escape que la cierra, y la comprobación de que
// no es un modal — que es lo que lo distingue del cajón que fue.
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

test('editor de la tarea: encabezado, Escape, scroll al tope y que NO es un modal', async () => {
  const opener = node('button');
  globalThis.document = { activeElement: opener };
  const clave = Vue.ref('CORE-1');
  let closeCount = 0;
  const root = node('root');
  const app = renderer.createApp({ setup: () => () => Vue.h(TaskEditor, {
    title: 'Tarea de prueba', taskKey: clave.value, onClose: () => { closeCount++; },
  }) });
  app.mount(root);
  const find = predicate => descendants(root).find(predicate);
  const seccion = find(n => n.props['aria-label'] === 'Tarea CORE-1');
  const cuerpo = find(n => n.props.class === 'te-body region-body');
  const key = key => ({ key, preventDefault() {}, stopPropagation() {} });

  // ── no es un modal, y no quedó nada del cajón ni de las pestañas ─────────────────────────────
  assert.ok(seccion, 'la sección lleva el aria-label con la clave');
  assert.equal(seccion.props['aria-modal'], undefined, 'no es un modal');
  assert.equal(seccion.props.role, undefined, 'no es un dialog');
  assert.equal(find(n => n.props.role === 'separator'), undefined, 'no tiene manija de ancho');
  assert.equal(find(n => n.props.role === 'tab'), undefined, 'ya no tiene pestañas');
  assert.equal(find(n => n.props.role === 'tablist'), undefined, 'ni su barra');

  // ── el cuerpo vuelve al tope al cambiar DE TAREA ─────────────────────────────────────────────
  assert.ok(cuerpo, 'el cuerpo existe');
  cuerpo.scrollTop = 900;
  clave.value = 'CORE-2';
  await Vue.nextTick();
  assert.equal(cuerpo.scrollTop, 0);

  // ── Escape cierra ────────────────────────────────────────────────────────────────────────────
  seccion.props.onKeydown(key('Escape'));
  assert.equal(closeCount, 1);
  seccion.props.onKeydown(key('a'));
  assert.equal(closeCount, 1, 'cualquier otra tecla no cierra');

  app.unmount();
  delete globalThis.document;
});
