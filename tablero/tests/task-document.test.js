import test from 'node:test';
import assert from 'node:assert/strict';
import { organizeDocument } from '../src/task-document.js';
import { groupTasks, panelWidth, readPreference, savePreference } from '../src/ui-state.js';

test('retoma, pendientes y decisiones preceden al material; historial al final', () => {
  const sections = organizeDocument('## Registro\nPasado\n### Día uno\nDetalle\n\n## Enlaces\nReferencia\n\n## Objetivo\nPlan\n\n## Decisiones\nElegido\n\n## Pendientes\n- [ ] Acción\n\n## 1 · Si retomás esto sin contexto\nActual');
  assert.deepEqual(sections.map(s => s.title), ['1 · Si retomás esto sin contexto', 'Pendientes', 'Decisiones', 'Objetivo', 'Enlaces', 'Registro']);
  assert.equal(sections.at(-1).history, true);
  assert.match(sections.at(-1).html, /Día uno/);
  assert.match(sections.at(-1).html, /Detalle/);
});

test('código y citas con encabezados permanecen en su sección; enlaces por referencia siguen funcionando', () => {
  const sections = organizeDocument('## Objetivo\n[Consulta][ref]\n\n~~~sh\n## Registro\necho ejemplo\n~~~\n\n> ## Pendientes\n> Una cita\n\n## Enlaces\n[ref]: https://example.com\n');
  assert.equal(sections.length, 2);
  assert.match(sections[0].html, /href="https:\/\/example.com"/);
  assert.match(sections[0].html, /language-sh/);
  assert.match(sections[0].html, /blockquote/);
  assert.equal(sections.some(s => s.history), false);
});

test('títulos repetidos conservan destinos únicos y los nombres históricos se reconocen', () => {
  const sections = organizeDocument('## Bitácora\nUno\n\n## Registro\nDos\n\n## Registro\nTres\n\n## Objetivo\nCuatro');
  assert.equal(new Set(sections.map(s => s.id)).size, sections.length);
  assert.equal(sections.filter(s => s.history).length, 3);
  assert.match(sections.at(-1).html, /Tres/);
  assert.deepEqual(organizeDocument(''), []);
});

test('agrupar conserva todas las tareas y el orden dentro de cada estado', () => {
  const tasks = [{ id: 1, bucket: 'terminada' }, { id: 2, bucket: 'iniciada' },
    { id: 3, bucket: 'bloqueada' }, { id: 4, bucket: 'iniciada' }, { id: 5, bucket: 'pruebas' }, { id: 6, bucket: 'sin-iniciar' }];
  const groups = groupTasks(tasks, t => t.bucket);
  assert.deepEqual(groups.map(g => g.id), ['iniciada', 'bloqueada', 'pruebas', 'sin-iniciar', 'terminada']);
  assert.deepEqual(groups[0].tasks.map(t => t.id), [2, 4]);
  assert.equal(groups.flatMap(g => g.tasks).length, tasks.length);
  assert.deepEqual(groupTasks([], t => t.bucket), []);
});

test('ancho se limita al viewport, incluso en móvil y con preferencias inválidas', () => {
  assert.equal(panelWidth(100, 1200), 340);
  assert.equal(panelWidth(2000, 1200), 1152);
  assert.equal(panelWidth(820, 320), 307);
  assert.equal(panelWidth('corrupto', 1200), 820);
});

test('preferencias sobreviven a recargas y toleran almacenamiento bloqueado o corrupto', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  savePreference('journey-open', false);
  assert.equal(readPreference('journey-open', true), false);
  values.set('tablero:panel-width', '{invalid');
  assert.equal(readPreference('panel-width', 820), 820);
  globalThis.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.equal(readPreference('panel-width', 820), 820);
  assert.doesNotThrow(() => savePreference('panel-width', 600));
  delete globalThis.localStorage;
});
