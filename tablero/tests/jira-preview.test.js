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

