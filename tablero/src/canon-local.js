/* El texto de canon, para la pestaña «Canon» de una tarea. Sale de la copia local (`tablero/canon`) por
 * `/api/canon/topic` y se pinta acá.
 *
 * Dos cosas distintas del documento de una tarea: (1) lo escribe el equipo entero, así que el HTML crudo
 * que traiga se ESCAPA en vez de pintarse; y (2) canon enlaza sus temas entre sí con `[[tema/context#ancla|texto]]`,
 * que se convierten en enlaces que abren esa sección en la misma pestaña (`data-canon`), sin salir del
 * tablero. */
import { marked } from 'marked';

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// canonRef normaliza una referencia: `kyc` → `kyc/context`, conservando el ancla.
export function canonRef(ref) {
  const [node, anchor] = String(ref || '').split('#', 2);
  const full = node.includes('/') ? node : `${node}/context`;
  return anchor ? `${full}#${anchor}` : full;
}

// canonTopic: el tema de una referencia, sin capa ni ancla (`kyc/context#x` → `kyc`).
export const canonTopic = (ref) => String(ref || '').split('#')[0].split('/')[0];

// Las anclas de canon a veces llegan con prefijo de tipo (`s=…`, como en las citas estables): se quita.
const plainAnchor = (anchor) => (anchor || '').replace(/^s=/, '');

// sectionID: la referencia de una sección tal como la trae la copia (`tema/context#ancla`).
export function sectionID(ref) {
  const full = canonRef(ref);
  const [node, anchor] = full.split('#', 2);
  return anchor ? `${node}#${plainAnchor(anchor)}` : node;
}

// renderCanon pasa un texto de canon a HTML seguro, con los enlaces entre temas listos para abrirse acá.
export function renderCanon(markdown) {
  const text = String(markdown || '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_, target, label) => `[${label || target}](canon:${target.trim()})`);
  const renderer = new marked.Renderer();
  const defaultLink = renderer.link.bind(renderer);
  renderer.link = (token) => {
    const href = token.href || '';
    if (href.startsWith('canon:')) {
      const ref = sectionID(href.slice(6));
      const label = renderer.parser.parseInline(token.tokens);
      return `<a class="ref ref-canon" href="#" data-canon="${escape(ref)}" title="canon · ${escape(ref)}">${label}</a>`;
    }
    if (!/^https?:\/\//.test(href)) return renderer.parser.parseInline(token.tokens);
    return defaultLink({ ...token }).replace('<a ', '<a target="_blank" rel="noopener" ');
  };
  renderer.html = (token) => escape(token.text || token.raw || '');
  return marked.parse(text, { gfm: true, renderer });
}
