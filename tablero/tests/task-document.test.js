import test from 'node:test';
import assert from 'node:assert/strict';
import { organizeDocument } from '../src/task-document.js';
import { highlightSQL, isSQLQuery } from '../src/sql-highlight.js';
import { groupTasks, readPreference, savePreference } from '../src/ui-state.js';

test('retoma, pendientes y decisiones preceden al material; historial al final', () => {
  const sections = organizeDocument('## Registro\nPasado\n### Día uno\nDetalle\n\n## Enlaces\nReferencia\n\n## Objetivo\nPlan\n\n## Decisiones\nElegido\n\n## Pendientes\n- [ ] Acción\n\n## 1 · Si retomás esto sin contexto\nActual');
  assert.deepEqual(sections.map(s => s.title), ['1 · Si retomás esto sin contexto', 'Pendientes', 'Decisiones', 'Objetivo', 'Enlaces', 'Registro']);
  assert.equal(sections.at(-1).history, true);
  assert.match(sections.at(-1).html, /Día uno/);
  assert.match(sections.at(-1).html, /Detalle/);
});

test('el historial cuenta los DÍAS que registra, que es lo que muestra su pestaña', () => {
  const sections = organizeDocument('## Objetivo\nPlan\n\n## Registro\n### 2026-09-18\nUno\n### 2026-09-17\nDos\n### 2026-09-16\nTres');
  const hist = sections.find(s => s.history);
  assert.equal(hist.entries, 3);
  // Una sección que no es historial no aporta al contador de la pestaña.
  assert.equal(sections.find(s => !s.history).entries, 0);
  // Y un registro sin días partidos cuenta cero: la pestaña dice «0» en vez de inventar una entrada.
  assert.equal(organizeDocument('## Registro\nTodo junto, sin fechas').find(s => s.history).entries, 0);
});

test('código y citas con encabezados permanecen en su sección; enlaces por referencia siguen funcionando', () => {
  const sections = organizeDocument('## Objetivo\n[Consulta][ref]\n\n~~~sh\n## Registro\necho ejemplo\n~~~\n\n> ## Pendientes\n> Una cita\n\n## Enlaces\n[ref]: https://example.com\n');
  assert.equal(sections.length, 2);
  assert.match(sections[0].html, /href="https:\/\/example.com"/);
  assert.match(sections[0].html, /language-sh/);
  assert.match(sections[0].html, /blockquote/);
  assert.equal(sections.some(s => s.history), false);
});

test('las consultas SQL de Markdown y la evidencia se resaltan sin inyectar su contenido', () => {
  const document = organizeDocument('## Material\n```sql\nSELECT count(*) FROM requests WHERE status = \'open\'\n```');
  assert.match(document[0].html, /class="sql-block"/);
  assert.match(document[0].html, /sql-keyword">SELECT/);
  assert.match(document[0].html, /sql-function">count/);
  assert.match(document[0].html, /sql-string">&#39;open&#39;/);
  assert.equal(isSQLQuery('WITH latest AS (SELECT 1) SELECT * FROM latest'), true);
  assert.equal(isSQLQuery('curl https://api.example.com'), false);
  assert.match(highlightSQL('SELECT "<script>"'), /&lt;script&gt;/);
});

test('títulos repetidos conservan destinos únicos y los nombres históricos se reconocen', () => {
  const sections = organizeDocument('## Bitácora\nUno\n\n## Registro\nDos\n\n## Registro\nTres\n\n## Objetivo\nCuatro');
  assert.equal(new Set(sections.map(s => s.id)).size, sections.length);
  assert.equal(sections.filter(s => s.history).length, 3);
  assert.match(sections.at(-1).html, /Tres/);
  assert.deepEqual(organizeDocument(''), []);
});

test('pendientes se muestran una sola vez y conservan continuaciones, enlaces y sublistas', () => {
  const sections = organizeDocument('## Pendientes\nNota de entrega.\n\n- [ ] Preparar [PR](https://example.com)\n  Continuación necesaria.\n  - revisar primero\n\n## Plan\nExplicación vigente.\n\n- [x] Trabajo hecho\n- Material de referencia\n');
  const pending = sections.map(s => s.pendingHtml).join('');
  const summary = sections.map(s => s.summaryHtml).join('');
  assert.match(pending, /Nota de entrega/);
  assert.match(pending, /Continuación necesaria/);
  assert.match(pending, /revisar primero/);
  assert.match(pending, /href="https:\/\/example.com"/);
  assert.match(pending, /Trabajo hecho/);
  assert.doesNotMatch(summary, /Preparar|Trabajo hecho|Nota de entrega/);
  assert.match(summary, /Explicación vigente/);
  assert.match(summary, /Material de referencia/);
});

test('hallazgos marcados salen del resumen, las citas normales y el código se conservan', () => {
  const sections = organizeDocument('## Decisiones\n> **DECISIÓN · 2026-09-18** — Acuerdo\n> Evidencia\n\n> Una cita normal\n\n~~~md\n- [ ] Ejemplo de código\n~~~\n');
  assert.doesNotMatch(sections[0].summaryHtml, /Acuerdo|Evidencia/);
  assert.match(sections[0].summaryHtml, /Una cita normal/);
  assert.match(sections[0].summaryHtml, /Ejemplo de código/);
  assert.equal(sections[0].pendingHtml, '');
  assert.match(sections[0].html, /Acuerdo/); // la representación completa sigue disponible
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

/* ⚠ Acá vivía «ancho se limita al viewport, incluso en móvil y con preferencias inválidas», que
   probaba `panelWidth`. Se fue con el cajón: la tarea vive en el `editor` del workbench y su ancho lo
   decide el grid de `taller.css`, no una preferencia guardada. Borrar el helper sin borrar su prueba
   dejaba la suite entera sin arrancar (`does not provide an export named 'panelWidth'`), que es la
   forma más cara de enterarse. */

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
