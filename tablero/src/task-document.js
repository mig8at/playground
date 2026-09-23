import { marked } from 'marked';
import { highlightSQL } from './sql-highlight.js';

const normalize = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const sectionName = text => normalize(text).replace(/^[\d.·\s]+/, '').trim();
const slug = text => normalize(text).replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'seccion';
const pendingTitle = title => /^(pendientes|por hacer|tareas pendientes)\b/.test(sectionName(title));

// Las listas se proyectan completas, con sus continuaciones y sublistas. Cortar líneas perdería
// las explicaciones de cada pendiente. Código y citas se conservan como material: hasta el 2026-09-23
// las anotaciones (`> **MEDICIÓN · fecha**`) se sacaban de acá porque se pintaban aparte, en
// «Hallazgos»; ese día pasaron a la pila, y la que quede en un documento viejo se lee en su lugar.
function summaryTokens(tokens, pending) {
  return tokens.flatMap(token => {
    if (token.type !== 'list') return [token];
    const items = [];
    for (const item of token.items) {
      if (item.task) pending.push({ ...token, items: [item] });
      else {
        const children = summaryTokens(item.tokens, pending);
        if (children.length) items.push({ ...item, tokens: children });
      }
    }
    return items.length ? [{ ...token, items }] : [];
  });
}

function render(tokens, links) {
  const copy = [...tokens];
  copy.links = links;
  const renderer = new marked.Renderer();
  const defaultCode = renderer.code.bind(renderer);
  renderer.code = (token) => {
    if (token.lang?.trim().toLowerCase() !== 'sql') return defaultCode(token);
    return `<pre class="sql-block"><code class="language-sql">${highlightSQL(token.text)}</code></pre>\n`;
  };
  return marked.parser(copy, { gfm: true, renderer });
}

// La retoma arriba y el Registro al final son de los documentos de antes de la pila (2026-09-23): las
// tareas abiertas ya no los tienen, y la única que conserva una «Bitácora» es una archivada (#67), que
// no se migra; se sigue leyendo en ese orden.
function sectionOrder(title) {
  const name = sectionName(title);
  if (/^si retomas|^estado actual|^(el )?proximo paso/.test(name)) return 0;
  if (/^pendientes|^por hacer|^lo que esta bloqueado/.test(name)) return 1;
  if (/^lo que esta decidido|^decisiones|^riesgos/.test(name)) return 2;
  if (/^contextos|^referencias|^enlaces|^rutas del codigo/.test(name)) return 4;
  if (/^(registro|bitacora|historial)\b/.test(name)) return 5;
  return 3; // Plan y material conservan su orden relativo y todo su contenido.
}

// Se separa por tokens: los títulos dentro de código o citas nunca delimitan secciones.
// Sólo cambia la presentación. El Markdown original sigue siendo lo que se copia y se edita.
export function organizeDocument(markdown) {
  const tokens = marked.lexer(markdown || '', { gfm: true });
  const sections = [];
  let current = { title: '', tokens: [], order: -1 };
  for (const token of tokens) {
    if (token.type === 'heading' && token.depth <= 2) {
      if (current.tokens.length) sections.push(current);
      current = { title: token.text, tokens: [], order: sectionOrder(token.text) };
    }
    current.tokens.push(token);
  }
  if (current.tokens.length) sections.push(current);
  const ids = new Map();
  for (const section of sections) {
    const base = slug(section.title), n = (ids.get(base) || 0) + 1;
    ids.set(base, n);
    section.id = `doc-${base}${n > 1 ? '-' + n : ''}`;
    section.html = render(section.tokens, tokens.links);
    const pending = [];
    const summary = summaryTokens(section.tokens, pending);
    section.pendingHtml = pendingTitle(section.title) ? section.html : render(pending, tokens.links);
    const hasContent = summary.some(t => !['heading', 'space', 'def'].includes(t.type)
      && !(t.type === 'html' && /^\s*<!--[\s\S]*-->\s*$/.test(t.raw)));
    section.summaryHtml = !pendingTitle(section.title) && hasContent ? render(summary, tokens.links) : '';
    delete section.tokens;
  }
  return sections.sort((a, b) => a.order - b.order);
}
