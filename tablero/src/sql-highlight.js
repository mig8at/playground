// Resaltado mínimo, local y seguro para las consultas que quedan como evidencia de una tarea.
// No intenta validar SQL ni ejecutar nada: sólo escapa el texto antes de envolver sus partes visibles.
const escapeHTML = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const KEYWORDS = new Set([
  'select', 'from', 'where', 'with', 'as', 'distinct', 'join', 'inner', 'left', 'right', 'cross', 'on',
  'group', 'by', 'having', 'order', 'limit', 'offset', 'union', 'all', 'case', 'when', 'then', 'else', 'end',
  'and', 'or', 'not', 'in', 'is', 'null', 'like', 'between', 'asc', 'desc', 'exists', 'over', 'partition',
]);
const FUNCTIONS = new Set(['count', 'sum', 'avg', 'min', 'max', 'coalesce', 'ifnull', 'date_format', 'date', 'cast']);
const TOKEN = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|\b(?:select|from|where|with|as|distinct|join|inner|left|right|cross|on|group|by|having|order|limit|offset|union|all|case|when|then|else|end|and|or|not|in|is|null|like|between|asc|desc|exists|over|partition|count|sum|avg|min|max|coalesce|ifnull|date_format|date|cast|true|false)\b|\b\d+(?:\.\d+)?\b/gi;

export const isSQLQuery = (value) => /^\s*(?:select|with|explain)\b/i.test(String(value || ''));

export function highlightSQL(value) {
  const source = String(value || '');
  let html = '';
  let from = 0;
  for (const match of source.matchAll(TOKEN)) {
    const token = match[0];
    const index = match.index ?? 0;
    html += escapeHTML(source.slice(from, index));
    const lower = token.toLowerCase();
    const kind = token.startsWith('--') || token.startsWith('/*') ? 'comment'
      : token.startsWith("'") || token.startsWith('"') ? 'string'
        : token.startsWith('`') ? 'identifier'
          : KEYWORDS.has(lower) ? 'keyword'
            : FUNCTIONS.has(lower) ? 'function'
              : lower === 'true' || lower === 'false' || lower === 'null' ? 'literal' : 'number';
    html += `<span class="sql-token sql-${kind}">${escapeHTML(token)}</span>`;
    from = index + token.length;
  }
  return html + escapeHTML(source.slice(from));
}
