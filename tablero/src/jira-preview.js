const escapeHTML = text => String(text || '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);

// Sólo datos del issue recibido de Jira: el borrador privado nunca es respaldo del publicado.
// El HTML externo se muestra dentro de un iframe sin scripts, formularios ni acceso al tablero.
export function jiraPreview(issue) {
  if (!issue || issue._local) return '';
  const body = issue.DescriptionHTML || (issue.Description ? `<pre>${escapeHTML(issue.Description)}</pre>` : '');
  if (!body) return '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer"><base target="_blank">
<style>
:root { color-scheme: dark } * { box-sizing: border-box }
body { margin: 0; padding: 16px; background: #111; color: #ededed; font: 13px/1.65 system-ui, sans-serif; overflow-wrap: anywhere }
h1,h2,h3,h4 { font-size: 15px; line-height: 1.4; margin: 22px 0 8px }
body > :first-child { margin-top: 0 } p { margin: 0 0 12px }
a { color: #93c5fd } ul,ol { padding-left: 22px }
pre { white-space: pre-wrap } pre,code { font-family: ui-monospace, monospace; font-size: 12px }
pre,blockquote { background: #181818; padding: 12px; border: 1px solid #333; border-radius: 6px; margin: 12px 0 }
table { border-collapse: collapse; max-width: 100%; display: block; overflow: auto }
th,td { border: 1px solid #333; padding: 7px 10px; text-align: left } th { background: #181818 }
img { max-width: 100%; height: auto } hr { border: 0; border-top: 1px solid #333 }
</style></head><body>${body}</body></html>`;
}
