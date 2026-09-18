import { marked } from 'marked';

const normalize = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const sectionName = text => normalize(text).replace(/^[\d.·\s]+/, '').trim();
const slug = text => normalize(text).replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'seccion';

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
    section.history = section.order === 5;
    section.tokens.links = tokens.links;
    section.html = marked.parser(section.tokens, { gfm: true });
    delete section.tokens;
  }
  return sections.sort((a, b) => a.order - b.order);
}
