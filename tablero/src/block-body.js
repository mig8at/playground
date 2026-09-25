// LA DESCRIPCIÓN DE UN BLOQUE — de texto a partes que la vista pinta sin v-html.
//
// Un bloque se guarda como prosa con enlaces tipados y bloques de código etiquetados; lo valida al
// entrar `server/internal/taskcontext/block.go`. Acá no se valida nada: se separa en párrafos,
// listas, comandos con su resultado y material, y cada línea en texto, código, negrita y enlaces.
// Nada se interpreta como HTML: el texto viaja como texto hasta el template.

const FENCE = /^```(\S*)(?:[ \t]+(\S+))?[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const COMMANDS = new Set(['harness', 'trazador', 'sql', 'sh']);
const RESULT = /^Resultado:\s*/;
const ITEM = /^[-*]\s+(.*)$/;
const TABLE_ROW = /^\|.*\|$/;

// Un material ` ```text ` que es una tabla de Markdown se pinta como tabla: así quedaron las tablas del
// Registro y de las anotaciones que el 2026-09-23 pasaron a la pila, y en una caja monoespaciada el
// `**negrita**` de sus celdas se leía crudo. Las celdas pasan por el mismo parser de línea que la prosa.
function tableOf(code) {
  const lines = code.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every(l => TABLE_ROW.test(l))) return null;
  const rows = lines
    .filter(l => !/^\|[\s:|-]+\|$/.test(l))
    .map(l => l.slice(1, -1).split('|').map(c => c.trim()));
  return rows.length ? rows : null;
}

// El rótulo de un comando dice con qué se corrió y contra qué: el ambiente sale de su TARGET=, que el
// validador exige, o del ambiente de la consulta. También vale `E2E_TARGET=`, la variable con que se
// corre un target del harness que no recibe TARGET= (y que sin ella pega contra dev).
export function commandLabel(lang, arg, code) {
  const target = (String(code).match(/TARGET=(\w+)/) || [])[1];
  if (lang === 'harness') return target ? `Harness · ${target}` : 'Harness';
  if (lang === 'trazador') return target ? `Trazador · ${target}` : 'Trazador';
  if (lang === 'sql') return `DB · ${arg}`;
  return 'Comando';
}

export function parseBlockBody(body) {
  const lines = String(body || '').split('\n');
  const parts = [];
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (paragraph.length) parts.push({ type: 'paragraph', text: paragraph.join(' ') });
    if (list) parts.push({ type: 'list', items: list });
    paragraph = [];
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = line.startsWith('```') ? line.match(FENCE) : null;
    if (open) {
      flush();
      let end = i + 1;
      while (end < lines.length && !FENCE_CLOSE.test(lines[end])) end++;
      const [, lang, arg = ''] = open;
      const code = lines.slice(i + 1, end).join('\n').trim();
      if (!COMMANDS.has(lang)) {
        const rows = lang === 'text' ? tableOf(code) : null;
        parts.push(rows ? { type: 'table', rows } : { type: 'code', lang, code });
        i = end;
        continue;
      }
      // El resultado es el párrafo que sigue al comando, entero: hasta la próxima línea vacía.
      let next = end + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      const result = [];
      if (next < lines.length && RESULT.test(lines[next].trim())) {
        while (next < lines.length && lines[next].trim() && !lines[next].startsWith('```')) {
          result.push(lines[next].trim());
          next++;
        }
        end = next - 1;
      }
      parts.push({
        type: 'command', lang, arg, code,
        label: commandLabel(lang, arg, code),
        result: result.join(' ').replace(RESULT, ''),
      });
      i = end;
      continue;
    }
    const text = line.trim();
    if (!text) {
      flush();
      continue;
    }
    const item = text.match(ITEM);
    if (item) {
      if (paragraph.length) parts.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
      (list ||= []).push(item[1]);
    } else if (list) {
      // una línea pegada a un ítem, sin ser otro, lo continúa
      list[list.length - 1] += ` ${text}`;
    } else {
      paragraph.push(text);
    }
  }
  flush();
  return parts;
}

const INLINE = /\[([^[\]\n]+)\]\(([^()\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
const REPO = /^repo:([a-z0-9][a-z0-9-]*)(?:@([0-9a-f]{7,40}))?\/([^#\s]+?)(#L\d+(?:-L\d+)?)?$/;
// Una pantalla de un diseño en el visor (`make visor`): `visor:<proyecto>/<pantalla>[@<huella>]`.
const VISOR = /^visor:([A-Za-z0-9][A-Za-z0-9-]*)\/([0-9]+-[0-9]+)(?:@([0-9a-f]{12}))?$/;
// Dónde corre el visor. Es local, como el tablero: el enlace lo abre la misma máquina.
export const VISOR_ORIGIN = 'http://localhost:5193';

export function parseTarget(target) {
  let m;
  if ((m = target.match(/^canon:(.+)$/))) return { kind: 'canon', ref: m[1] };
  if ((m = target.match(REPO))) return { kind: 'repo', repo: m[1], sha: m[2] || '', path: m[3], anchor: m[4] || '' };
  if ((m = target.match(/^pr:([a-z0-9][a-z0-9-]*)#(\d+)$/))) return { kind: 'pr', repo: m[1], number: m[2] };
  if ((m = target.match(/^jira:([A-Z][A-Z0-9]+-\d+)$/))) return { kind: 'jira', key: m[1] };
  if ((m = target.match(/^bloque:(blk_[\w.-]+)$/))) return { kind: 'block', id: m[1] };
  if ((m = target.match(VISOR))) return { kind: 'visor', project: m[1], screen: m[2], print: m[3] || '' };
  if (/^https:\/\/\S+$/.test(target)) return { kind: 'web', url: target };
  return { kind: 'text' };
}

export function inlineParts(text) {
  const source = String(text || '');
  const parts = [];
  let from = 0;
  for (const m of source.matchAll(INLINE)) {
    if (m.index > from) parts.push({ type: 'text', value: source.slice(from, m.index) });
    if (m[1] !== undefined) parts.push({ type: 'link', label: m[1], ...parseTarget(m[2]) });
    else if (m[3] !== undefined) parts.push({ type: 'code', value: m[3] });
    else parts.push({ type: 'strong', value: m[4] });
    from = m.index + m[0].length;
  }
  if (from < source.length || !parts.length) parts.push({ type: 'text', value: source.slice(from) });
  return parts;
}

// El enlace al visor: la pantalla, con la huella del momento en que se enlazó. Abrirlo dice en el visor si
// el diseño cambió desde entonces.
export function visorHref(part) {
  return `${VISOR_ORIGIN}/${part.project}/${part.screen}${part.print ? `?huella=${part.print}` : ''}`;
}

// visor: en el documento de la tarea (Markdown), lo mismo que en un bloque.
export function visorURL(target) {
  const p = parseTarget(target);
  return p.kind === 'visor' ? visorHref(p) : '';
}

// El enlace a GitHub de un archivo —en el commit que el bloque dejó fijado— o de un PR. Sin la URL del
// repo, porque la lista de repos no respondió, no hay href: el enlace se muestra igual, como texto.
export function repoHref(part, repos) {
  const web = repos?.[part.repo];
  if (!web?.web) return '';
  if (part.kind === 'pr') return `${web.web}/pull/${part.number}`;
  return `${web.web}/blob/${part.sha || 'main'}/${web.prefix || ''}${part.path}${part.anchor || ''}`;
}
