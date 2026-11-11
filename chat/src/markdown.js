/* MARKDOWN SEGURO para lo que contesta un agente: primero se escapa TODO el HTML y recién después se reconoce una lista
   corta —**negrita**, *cursiva*, `código`, bloques ```, listas con - o 1. y párrafos—. Sin enlaces ni HTML libre: lo que
   escribe un agente (o alguien a través de él) no puede meter nada en la página. Devuelve HTML para `v-html`. */

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function inline(s) {
  // El código va primero y se aparta, para que lo de adentro no se lea como negrita.
  const codes = []
  let out = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`)
}

export function renderMarkdown(text) {
  const lines = escapeHtml(String(text || '')).replace(/\r/g, '').split('\n')
  const html = []
  let list = null // 'ul' | 'ol'
  let paragraph = []
  let fence = null
  const flushParagraph = () => { if (paragraph.length) { html.push(`<p>${inline(paragraph.join('<br>'))}</p>`); paragraph = [] } }
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null } }

  for (const raw of lines) {
    if (fence) {
      if (/^\s*```/.test(raw)) { html.push(`<pre><code>${fence.join('\n')}</code></pre>`); fence = null } else fence.push(raw)
      continue
    }
    if (/^\s*```/.test(raw)) { flushParagraph(); closeList(); fence = []; continue }
    const bullet = raw.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = raw.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushParagraph()
      const kind = bullet ? 'ul' : 'ol'
      if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind }
      html.push(`<li>${inline((bullet || numbered)[1])}</li>`)
      continue
    }
    if (!raw.trim()) { flushParagraph(); closeList(); continue }
    const heading = raw.match(/^\s*#{1,6}\s+(.*)$/)
    if (heading) { flushParagraph(); closeList(); html.push(`<p><strong>${inline(heading[1])}</strong></p>`); continue }
    closeList()
    paragraph.push(raw)
  }
  if (fence) html.push(`<pre><code>${fence.join('\n')}</code></pre>`)
  flushParagraph()
  closeList()
  return html.join('')
}
