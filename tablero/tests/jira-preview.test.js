import test from 'node:test';
import assert from 'node:assert/strict';
import { jiraPreview } from '../src/jira-preview.js';

test('vista Jira conserva el HTML recibido y sus tablas', () => {
  const html = '<h2>Criterios</h2><table><tr><td>Validar compra</td></tr></table>';
  const preview = jiraPreview({ DescriptionHTML: html, Description: 'texto alternativo', techNotes: 'PRIVADO' });
  assert.ok(preview.includes(html));
  assert.doesNotMatch(preview, /PRIVADO|texto alternativo/);
  assert.match(preview, /default-src 'none'/);
});

test('sin HTML se muestra texto escapado, sin inventar una descripción publicada', () => {
  assert.match(jiraPreview({ Description: '<script>alert(1)</script> & texto' }), /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; texto/);
  assert.equal(jiraPreview({ techNotes: 'Privado', jiraDescription: 'Borrador' }), '');
  assert.equal(jiraPreview({ _local: true, Description: 'Contenido local' }), '');
});

test('la vista previa sigue al tema del tablero', () => {
  const issue = { Description: 'texto' };
  assert.match(jiraPreview(issue), /color-scheme: dark/, 'sin tema, oscuro, como hasta ahora');
  const light = jiraPreview(issue, 'light');
  assert.match(light, /color-scheme: light/);
  assert.match(light, /color: #1f2433/, 'tinta oscura sobre el fondo claro');
  assert.doesNotMatch(light, /#ededed/, 'no queda nada de la paleta oscura');
});


test('con los tokens resueltos del tablero, la vista previa usa esos colores y no la paleta de respaldo', () => {
  const tokens = { ink: 'oklch(0.21 0.03 264)', link: '#1d4ed8', line: 'color-mix(in oklab, oklch(0.2 0 0) 78%, oklch(1 0 0))', quote: '#abc', head: '#def' };
  const preview = jiraPreview({ Description: 'texto' }, 'light', tokens);
  assert.match(preview, /color: oklch\(0\.21 0\.03 264\)/);
  assert.match(preview, /border-block: 1px solid color-mix\(in oklab/);
  assert.doesNotMatch(preview, /#1f2433/, 'la tinta de respaldo no se usa');
});

test('un token vacío o que no tiene forma de color cae a la paleta de respaldo', () => {
  const preview = jiraPreview({ Description: 'texto' }, 'light', { ink: '', link: 'red } </style><script>' });
  assert.match(preview, /color: #1f2433/);
  assert.match(preview, /a \{ color: #1d4ed8 \}/);
  assert.doesNotMatch(preview, /<script>/);
});
