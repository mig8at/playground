/* EL MARKDOWN DE UN TEMA (knowledge/<tema>/rules.md), para leerlo. Primero se escapa TODO el HTML y recién después se
   reconocen las piezas que usan los temas: párrafos, listas, bloques ```, citas (>), tablas (| … |), subtítulos (###),
   **negrita**, *cursiva*, `código` y enlaces. Un enlace `knowledge:tema#ancla` navega dentro de la app; uno https abre
   afuera; cualquier otro (una ruta relativa) queda como texto. Devuelve HTML para `v-html`. */

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function link(text, href) {
  const k = href.match(/^knowledge:([a-z][a-z0-9-]*)(?:#([a-z0-9-]+))?$/)
  if (k) return `<a href="#/${k[1]}${k[2] ? `/${k[2]}` : ''}">${text}</a>`
  if (/^https:\/\/[^\s"]+$/.test(href)) return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`
  return text
}

function inline(s) {
  // El código va primero y se aparta, para que lo de adentro no se lea como negrita ni como enlace.
  const codes = []
  let out = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, text, href) => link(text, href.replace(/&amp;/g, '&')))
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`)
}

const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function renderMarkdown(text) {
  const lines = escapeHtml(String(text || '')).replace(/\r/g, '').split('\n')
  const html = []
  let list = null // 'ul' | 'ol'
  let para = []
  let quote = []
  let table = []
  let fence = null
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = [] } }
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null } }
  const flushQuote = () => { if (quote.length) { html.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`); quote = [] } }
  const flushTable = () => {
    if (!table.length) return
    const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r))
    const [head, ...body] = rows
    html.push(`<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
      body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
    table = []
  }
  const flushAll = () => { flushPara(); closeList(); flushQuote(); flushTable() }

  for (const raw of lines) {
    if (fence) {
      if (/^\s*```/.test(raw)) { html.push(`<pre><code>${fence.join('\n')}</code></pre>`); fence = null } else fence.push(raw)
      continue
    }
    if (/^\s*```/.test(raw)) { flushAll(); fence = []; continue }
    if (/^\s*\|/.test(raw)) { flushPara(); closeList(); flushQuote(); table.push(raw); continue }
    if (table.length) flushTable()
    const q = raw.match(/^\s*&gt;\s?(.*)$/)
    if (q) { flushPara(); closeList(); quote.push(q[1]); continue }
    if (quote.length) flushQuote()
    const heading = raw.match(/^\s*(#{2,6})\s+(.*)$/)
    if (heading) { flushAll(); const level = Math.min(heading[1].length + 1, 6); html.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue }
    const bullet = raw.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = raw.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushPara()
      const kind = bullet ? 'ul' : 'ol'
      if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind }
      html.push(`<li>${inline((bullet || numbered)[1])}</li>`)
      continue
    }
    if (!raw.trim()) { flushAll(); continue }
    // Una línea con sangría debajo de un ítem sigue ese ítem.
    if (list && /^\s{2,}\S/.test(raw)) { html[html.length - 1] = html[html.length - 1].replace(/<\/li>$/, ` ${inline(raw.trim())}</li>`); continue }
    closeList()
    para.push(raw.trim())
  }
  if (fence) html.push(`<pre><code>${fence.join('\n')}</code></pre>`)
  flushAll()
  return html.join('')
}
