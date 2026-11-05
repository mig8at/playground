/* MARKDOWN SEGURO para la página simplificada. El texto viene de un sitio AJENO, así que primero se escapa TODO el
   HTML y recién después se reconoce lo que produce analyze.js: encabezados, párrafos, listas anidadas, tablas,
   bloques de código, citas, separadores, **negrita**, _cursiva_, `código`, enlaces e imágenes. Un enlace sólo
   sale si es http(s), y lleva `data-href` para que la interfaz lo abra dentro de la herramienta si la página
   está en el mapa. Las imágenes NO se cargan (sería pedirle al sitio desde acá): quedan como su texto
   alternativo. Mismo criterio que chat/src/markdown.js. Devuelve HTML para `v-html`. */

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const safeURL = (u) => (/^https?:\/\//i.test(u) ? u : '')

function inline(s) {
  // El código y los escapes se apartan primero, para que lo de adentro no se lea como marca.
  const keep = []
  const stash = (html) => { keep.push(html); return `\u0000${keep.length - 1}\u0000` }
  let out = s.replace(/`([^`\n]+)`/g, (_, c) => stash(`<code>${c}</code>`))
  out = out.replace(/\\([\\`*_[\]|])/g, (_, c) => stash(c))
  out = out.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_, alt) => stash(`<span class="md-img" title="Imagen">${alt || 'imagen'}</span>`))
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const url = safeURL(href.replace(/&amp;/g, '&'))
    return url ? stash(`<a href="${escapeHtml(url)}" data-href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`) : text
  })
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  for (let i = 0; i < 3 && out.includes('\u0000'); i++) out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[Number(n)])
  return out
}

const cells = (row) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim()))

export function renderMarkdown(text) {
  const lines = escapeHtml(String(text || '')).replace(/\r/g, '').split('\n')
  const html = []
  let para = []
  let fence = null
  const stack = [] // listas abiertas: { kind, indent }
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = [] } }
  const closeLists = (indent = -1) => {
    while (stack.length && stack[stack.length - 1].indent > indent) html.push(`</li></${stack.pop().kind}>`)
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (fence) {
      if (/^\s*```/.test(raw)) { html.push(`<pre><code>${fence.join('\n')}</code></pre>`); fence = null } else fence.push(raw)
      continue
    }
    if (/^\s*```/.test(raw)) { flushPara(); closeLists(); fence = []; continue }

    const item = raw.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
    if (item) {
      flushPara()
      const indent = item[1].length
      const kind = /\d/.test(item[2]) ? 'ol' : 'ul'
      closeLists(indent)
      const top = stack[stack.length - 1]
      if (!top || top.indent < indent) { html.push(`<${kind}><li>`); stack.push({ kind, indent }) }
      else html.push('</li><li>')
      html.push(inline(item[3]))
      continue
    }
    if (!raw.trim()) { flushPara(); continue }
    closeLists()

    const heading = raw.match(/^(#{1,6})\s+(.*)$/)
    if (heading) { flushPara(); html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue }
    if (/^---+\s*$/.test(raw)) { flushPara(); html.push('<hr>'); continue }
    const quote = raw.match(/^&gt;\s?(.*)$/)
    if (quote) { flushPara(); html.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue }
    if (/^\|.*\|\s*$/.test(raw) && /^\|\s*---/.test(lines[i + 1] || '')) {
      flushPara()
      const head = cells(raw)
      const body = []
      i += 2
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]))
      i--
      html.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    para.push(raw.replace(/ {2}$/, ''))
  }
  if (fence) html.push(`<pre><code>${fence.join('\n')}</code></pre>`)
  flushPara()
  closeLists()
  return html.join('')
}
