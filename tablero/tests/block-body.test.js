import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlockBody, inlineParts, repoHref, visorHref } from '../src/block-body.js';

const body = [
  'La guarda vive en [CreatesApplication](repo:legacy-backend@cfc577218f2d/tests/CreatesApplication.php#L12)',
  'y corre antes de `setUpTraits()`.',
  '',
  '```harness',
  "make harness-caso TARGET=local CASOS='ingreso=0'",
  '```',
  'Resultado: salen 7 entidades;',
  'con ingreso, 6.',
  '',
  '- [CORE-431](jira:CORE-431)',
  '- el [PR](pr:legacy-backend#1140)',
  '',
  '```sql prod',
  'SELECT 1',
  '```',
  'Resultado: 1.',
  '',
  '```json',
  '{"a": 1}',
  '```',
].join('\n');

test('la descripción se separa en párrafos, comandos con su resultado, listas y material', () => {
  const parts = parseBlockBody(body);
  assert.deepEqual(parts.map(p => p.type), ['paragraph', 'command', 'list', 'command', 'code']);
  assert.equal(parts[0].text, 'La guarda vive en [CreatesApplication](repo:legacy-backend@cfc577218f2d/tests/CreatesApplication.php#L12) y corre antes de `setUpTraits()`.');
  assert.equal(parts[1].label, 'Harness · local');
  assert.equal(parts[1].result, 'salen 7 entidades; con ingreso, 6.', 'el resultado es su párrafo entero');
  assert.deepEqual(parts[2].items, ['[CORE-431](jira:CORE-431)', 'el [PR](pr:legacy-backend#1140)']);
  assert.equal(parts[3].label, 'DB · prod');
  assert.equal(parts[4].code, '{"a": 1}');
});

test('el ambiente del rótulo sale también de E2E_TARGET', () => {
  const [part] = parseBlockBody("```harness\nE2E_TARGET=local make harness-codigo-prueba HASH=x\n```\nResultado: pasó.");
  assert.equal(part.label, 'Harness · local');
});

test('una línea se separa en texto, código y enlaces con tipo, y nada es HTML', () => {
  const parts = inlineParts('Ver <b>esto</b> en [el tema](canon:kyc#identidad), `x.php` y **ojo**.');
  assert.deepEqual(parts.map(p => p.type), ['text', 'link', 'text', 'code', 'text', 'strong', 'text']);
  assert.equal(parts[0].value, 'Ver <b>esto</b> en ', 'el HTML queda como texto');
  assert.deepEqual({ kind: parts[1].kind, ref: parts[1].ref }, { kind: 'canon', ref: 'kyc#identidad' });
});

test('un archivo enlaza a GitHub en el commit fijado, dentro de su carpeta si la tiene', () => {
  const repos = {
    'legacy-backend': { web: 'https://github.com/Creditop-SAS/legacy-backend', prefix: '' },
    harness: { web: 'https://github.com/mig8at/playground', prefix: 'harness/' },
  };
  assert.equal(repoHref(inlineParts('[x](repo:legacy-backend@cfc577218f2d/tests/CreatesApplication.php#L12)')[0], repos),
    'https://github.com/Creditop-SAS/legacy-backend/blob/cfc577218f2d/tests/CreatesApplication.php#L12');
  assert.equal(repoHref(inlineParts('[db](repo:harness@e304fc8cda97/pkg/db.ts)')[0], repos),
    'https://github.com/mig8at/playground/blob/e304fc8cda97/harness/pkg/db.ts');
  assert.equal(repoHref(inlineParts('[PR](pr:legacy-backend#1140)')[0], repos),
    'https://github.com/Creditop-SAS/legacy-backend/pull/1140');
  assert.equal(repoHref(inlineParts('[x](repo:desconocido@abc1234/a.go)')[0], repos), '', 'sin la URL del repo no hay href');
});

test('un material de texto que es una tabla de Markdown se pinta como tabla; uno que no, queda como texto', () => {
  const table = parseBlockBody('```text\n| llamada | tiempo |\n|---|---|\n| `lenders-v2` | **31,6 s** |\n```');
  assert.deepEqual(table, [{ type: 'table', rows: [['llamada', 'tiempo'], ['`lenders-v2`', '**31,6 s**']] }]);
  const text = parseBlockBody('```text\n| una línea suelta con barras |\nuna que no\n```');
  assert.equal(text[0].type, 'code');
  assert.equal(parseBlockBody('```json\n| a | b |\n| c | d |\n```')[0].type, 'code');
});

test('una pantalla del diseño (visor:) abre el visor en esa pantalla, con la huella con que se enlazó', () => {
  const [part] = inlineParts('[Completa tu solicitud](visor:credifamilia/381-1052@52065d0ce692)');
  assert.equal(part.kind, 'visor');
  assert.equal(visorHref(part), 'http://localhost:5193/credifamilia/381-1052?huella=52065d0ce692');
  assert.equal(visorHref(inlineParts('[x](visor:motai-renting/1176-2003)')[0]), 'http://localhost:5193/motai-renting/1176-2003');
  assert.equal(inlineParts('[x](visor:credifamilia/381-1052@nohuella)')[0].kind, 'text', 'una huella mal escrita no es un enlace');
});
