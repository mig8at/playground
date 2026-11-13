const escapeHTML = text => String(text || '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);

// Los colores del documento de Jira. El iframe no hereda los tokens del tablero (es otro documento, sin
// scripts): quien lo arma le pasa los tokens ya resueltos (`tokens`), que siguen al tema Y a la paleta.
// Estas dos paletas quedan de respaldo, una por tema, para cuando no hay de dónde leerlos.
const PALETTES = {
  dark:  { scheme: 'dark',  ink: '#ededed', link: '#93c5fd', line: '#333', quote: '#555', head: '#b8b8b8' },
  light: { scheme: 'light', ink: '#1f2433', link: '#1d4ed8', line: '#e2e5ea', quote: '#c5cad3', head: '#4b5263' },
};

// Sólo datos del issue recibido de Jira: el borrador privado nunca es respaldo del publicado.
// El HTML externo se muestra dentro de un iframe sin scripts, formularios ni acceso al tablero.
// Un token entra al CSS del iframe sólo si tiene forma de color (`#hex`, `oklch(…)`, `color-mix(…)`):
// nada que cierre la regla o la etiqueta.
const COLOR = /^[\w\s#%.,()/+-]+$/;
const color = (value, fallback) => (typeof value === 'string' && value && COLOR.test(value) ? value : fallback);

export function jiraPreview(issue, theme = 'dark', tokens = null) {
  const base = PALETTES[theme] || PALETTES.dark;
  const c = {
    scheme: base.scheme,
    ink: color(tokens?.ink, base.ink), link: color(tokens?.link, base.link), line: color(tokens?.line, base.line),
    quote: color(tokens?.quote, base.quote), head: color(tokens?.head, base.head),
  };
  if (!issue || issue._local) return '';
  const body = issue.DescriptionHTML || (issue.Description ? `<pre>${escapeHTML(issue.Description)}</pre>` : '');
  if (!body) return '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer"><base target="_blank">
<style>
:root { color-scheme: ${c.scheme} } * { box-sizing: border-box }
body { margin: 0; padding: 16px; background: transparent; color: ${c.ink}; font: 13px/1.65 system-ui, sans-serif; overflow-wrap: anywhere }
h1,h2,h3,h4 { font-size: 15px; line-height: 1.4; margin: 22px 0 8px }
body > :first-child { margin-top: 0 } p { margin: 0 0 12px }
a { color: ${c.link} } ul,ol { padding-left: 22px }
pre { white-space: pre-wrap; padding: 10px 0; border-block: 1px solid ${c.line}; margin: 12px 0 }
pre,code { font-family: ui-monospace, monospace; font-size: 12px }
blockquote { margin: 12px 0; padding: 2px 0 2px 12px; border-left: 2px solid ${c.quote} }
table { border-collapse: collapse; max-width: 100%; display: block; overflow: auto }
th,td { border-bottom: 1px solid ${c.line}; padding: 7px 10px 7px 0; text-align: left } th { color: ${c.head} }
img { max-width: 100%; height: auto } hr { border: 0; border-top: 1px solid ${c.line} }
</style></head><body>${body}</body></html>`;
}
