// Lo que corre ADENTRO de la página para describir cómo está construida. Devuelve un JSON en texto.
// ⚠ Lee atributos y textos visibles, NUNCA el valor de un campo: una contraseña o un token tipeado no sale de acá.
() => {
  const clean = (s, n = 120) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n)
  const uniq = (xs) => [...new Set(xs.filter(Boolean))]

  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (l) return clean(l.textContent, 80)
    }
    const wrap = el.closest('label')
    if (wrap) return clean(wrap.textContent, 80)
    return clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '', 80)
  }
  const fieldOf = (el) => ({
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    name: el.getAttribute('name') || '',
    id: el.id || '',
    label: labelOf(el),
    placeholder: el.getAttribute('placeholder') || '',
    required: el.required || el.getAttribute('aria-required') === 'true',
    options: el.tagName === 'SELECT' ? [...el.options].slice(0, 20).map((o) => clean(o.textContent, 40)) : [],
  })
  const FIELDS = 'input:not([type=hidden]), select, textarea'

  const forms = [...document.forms].slice(0, 30).map((f) => ({
    action: f.getAttribute('action') ? new URL(f.getAttribute('action'), location.href).href : '',
    method: (f.getAttribute('method') || 'get').toLowerCase(),
    fields: [...f.querySelectorAll(FIELDS)].slice(0, 60).map(fieldOf),
    submits: uniq([...f.querySelectorAll('button, input[type=submit]')].map((b) => clean(b.textContent || b.value, 40))),
  }))
  // En una SPA los campos casi nunca viven en un <form>: se agrupan aparte para que no se pierdan.
  const loose = [...document.querySelectorAll(FIELDS)].filter((el) => !el.form).slice(0, 60).map(fieldOf)
  if (loose.length) forms.push({ action: '', method: '', fields: loose, submits: [], loose: true })

  const links = []
  const seen = new Set()
  for (const a of document.querySelectorAll('a[href]')) {
    let href
    try { href = new URL(a.getAttribute('href'), location.href).href } catch { continue }
    if (!/^https?:/.test(href) || seen.has(href)) continue
    seen.add(href)
    links.push({ text: clean(a.textContent || a.getAttribute('aria-label') || a.title, 80), href })
    if (links.length >= 400) break
  }

  const buttons = uniq([...document.querySelectorAll('button, [role=button], input[type=button]')]
    .map((b) => clean(b.textContent || b.value || b.getAttribute('aria-label') || b.title, 60))).slice(0, 80)
  const headings = [...document.querySelectorAll('h1, h2, h3')].slice(0, 40)
    .map((h) => ({ level: Number(h.tagName[1]), text: clean(h.textContent, 100) })).filter((h) => h.text)

  const stack = []
  const w = window
  if (w.__NUXT__ || w.$nuxt) stack.push('Nuxt')
  if (w.__NEXT_DATA__ || document.getElementById('__next')) stack.push('Next.js')
  if (w.__VUE__ || document.querySelector('[data-v-app]') || [...document.querySelectorAll('*')].slice(0, 400).some((e) => e.__vue_app__ || e.__vue__)) stack.push('Vue')
  if (document.querySelector('[ng-version]')) stack.push('Angular ' + document.querySelector('[ng-version]').getAttribute('ng-version'))
  if ([...document.querySelectorAll('body *')].slice(0, 400).some((e) => Object.keys(e).some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer')))) stack.push('React')
  if (document.querySelector('[data-page]') && document.querySelector('#app[data-page]')) stack.push('Inertia')
  if (w.Livewire) stack.push('Livewire')
  if (w.jQuery) stack.push('jQuery ' + (w.jQuery.fn?.jquery || ''))
  if (document.querySelector('[data-svelte-h], [class*="svelte-"]')) stack.push('Svelte')
  if (w.Shopify) stack.push('Shopify')
  if (w.vtex || w.__RUNTIME__) stack.push('VTEX')
  if (document.querySelector('link[href*="wp-content"], script[src*="wp-content"]')) stack.push('WordPress')
  const generator = document.querySelector('meta[name=generator]')?.content
  if (generator) stack.push(clean(generator, 40))

  // ── la página simplificada, en Markdown: lo que se lee, sin el maquillaje ──
  // Se recorre el contenido principal (o el body si no hay <main>), saltando lo invisible, y cada elemento se
  // traduce a su equivalente: encabezados, párrafos, listas, tablas, enlaces, código, campos y botones.
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'HEAD', 'LINK', 'META'])
  const visible = (el) => {
    if (el.checkVisibility) return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
    const cs = getComputedStyle(el)
    return cs.display !== 'none' && cs.visibility !== 'hidden'
  }
  const md = (s) => s.replace(/([\\`*_[\]|])/g, '\\$1')
  const abs = (h) => { try { return new URL(h, location.href).href } catch { return '' } }
  function inlineOf(node) {
    let out = ''
    for (const n of node.childNodes) out += inlineOne(n)
    return out
  }
  function inlineOne(n) {
    let out = ''
    {
      if (n.nodeType === 3) return md(n.textContent.replace(/\s+/g, ' '))
      if (n.nodeType !== 1 || SKIP.has(n.tagName.toUpperCase()) || !visible(n)) return ''
      const t = n.tagName
      const inner = () => inlineOf(n).trim()
      if (t === 'BR') out += '  \n'
      else if (t === 'A') { const txt = inner() || md(clean(n.getAttribute('aria-label') || n.title, 80)); const h = abs(n.getAttribute('href') || ''); out += h && /^https?:/.test(h) ? ` [${txt || h}](${h}) ` : ` ${txt} ` }
      else if (t === 'STRONG' || t === 'B') { const x = inner(); if (x) out += ` **${x}** ` }
      else if (t === 'EM' || t === 'I') { const x = inner(); if (x) out += ` _${x}_ ` }
      else if (t === 'CODE' || t === 'KBD' || t === 'SAMP') out += ` \`${n.textContent.replace(/`/g, "'").trim()}\` `
      else if (t === 'IMG') { const alt = clean(n.alt || n.title, 80); if (alt) out += ` ![${md(alt)}](${abs(n.currentSrc || n.src)}) ` }
      else if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') out += ` ${fieldMd(n)} `
      else if (t === 'BUTTON') { const x = clean(n.textContent || n.getAttribute('aria-label') || n.title, 40); if (x) out += ` **[${md(x)}]** ` }
      else out += inlineOf(n)
    }
    return out
  }
  function fieldMd(el) {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase()
    if (type === 'hidden') return ''
    if (type === 'submit' || type === 'button') return `**[${md(clean(el.value, 40) || 'Enviar')}]**`
    const label = md(labelOf(el) || el.getAttribute('name') || type)
    if (type === 'checkbox' || type === 'radio') return `☐ ${label}`
    if (el.tagName === 'SELECT') return `⟨${label} ▾ ${[...el.options].slice(0, 6).map((o) => md(clean(o.textContent, 30))).join(' / ')}⟩`
    return `⟨${label}${type !== 'text' && type !== 'textarea' ? ' · ' + type : ''}⟩`
  }
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'FORM', 'FIELDSET', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'ADDRESS', 'LABEL', 'BODY', 'CENTER'])
  const lines = []
  const push = (s) => { s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(); if (s) lines.push(s) }
  function listMd(list, depth) {
    let i = 1
    for (const li of list.children) {
      if (li.tagName !== 'LI' || !visible(li)) continue
      const own = document.createElement('div')
      for (const c of li.childNodes) if (!(c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL'))) own.appendChild(c.cloneNode(true))
      const mark = list.tagName === 'OL' ? `${i++}.` : '-'
      const text = inlineOf(own).replace(/\s+/g, ' ').trim()
      if (text) lines.push(`${'  '.repeat(depth)}${mark} ${text}`)
      for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') listMd(sub, depth + 1)
    }
  }
  function tableMd(table) {
    const rows = [...table.rows].slice(0, 40).map((r) => [...r.cells].map((c) => inlineOf(c).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')))
    if (!rows.length) return
    const width = Math.max(...rows.map((r) => r.length))
    const fill = (r) => [...r, ...Array(width - r.length).fill('')]
    lines.push('| ' + fill(rows[0]).join(' | ') + ' |', '| ' + Array(width).fill('---').join(' | ') + ' |')
    for (const r of rows.slice(1)) lines.push('| ' + fill(r).join(' | ') + ' |')
    if (table.rows.length > 40) lines.push(`_… ${table.rows.length - 40} filas más_`)
  }
  // ¿Este elemento arma bloques adentro? Si no, se lee de corrido con sus vecinos (texto, <b>, <a>, <span>…).
  const isBlock = (n) => {
    if (/^(H[1-6]|UL|OL|TABLE|PRE|BLOCKQUOTE|HR)$/.test(n.tagName) || BLOCK.has(n.tagName)) return true
    const d = getComputedStyle(n).display
    return d === 'block' || d.includes('flex') || d.includes('grid') || d === 'list-item' || d === 'table'
  }
  function blockMd(el) {
    let run = ''
    const flush = () => { if (run.trim()) { lines.push(''); push(run); lines.push('') } run = '' }
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { run += inlineOne(n); continue }
      if (n.nodeType !== 1 || SKIP.has(n.tagName.toUpperCase()) || !visible(n)) continue
      if (!isBlock(n)) { run += inlineOne(n); continue }
      flush()
      const t = n.tagName
      if (/^H[1-6]$/.test(t)) { const x = inlineOf(n).replace(/\s+/g, ' ').trim(); if (x) lines.push('', '#'.repeat(Number(t[1])) + ' ' + x, '') }
      else if (t === 'UL' || t === 'OL') { lines.push(''); listMd(n, 0); lines.push('') }
      else if (t === 'TABLE') { lines.push(''); tableMd(n); lines.push('') }
      else if (t === 'PRE') lines.push('', '```', n.textContent.replace(/\n+$/, ''), '```', '')
      else if (t === 'BLOCKQUOTE') { const x = inlineOf(n).replace(/\s+/g, ' ').trim(); if (x) lines.push('', '> ' + x, '') }
      else if (t === 'HR') lines.push('', '---', '')
      else if (t === 'P' || t === 'FIGCAPTION' || t === 'SUMMARY' || t === 'DT' || t === 'DD' || t === 'LABEL') {
        if ([...n.children].some((c) => /^(DIV|UL|OL|TABLE|P|H[1-6]|SECTION)$/.test(c.tagName))) blockMd(n)
        else { lines.push(''); push(inlineOf(n)); lines.push('') }
      }
      else blockMd(n)
    }
    flush()
  }
  let markdown = ''
  try {
    const root = document.querySelector('main, [role=main]') || document.querySelector('article') || document.body
    blockMd(root)
    markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (markdown.length > 80000) markdown = markdown.slice(0, 80000) + '\n\n_… recortado_'
  } catch (e) {
    markdown = `_No se pudo simplificar la página: ${e.message}_`
  }

  const count = (sel) => document.querySelectorAll(sel).length
  return JSON.stringify({
    markdown,
    title: clean(document.title, 160),
    lang: document.documentElement.lang || '',
    stack: uniq(stack.map((s) => s.trim())),
    headings, links, forms, buttons,
    landmarks: {
      header: count('header, [role=banner]'), nav: count('nav, [role=navigation]'), main: count('main, [role=main]'),
      aside: count('aside, [role=complementary]'), footer: count('footer, [role=contentinfo]'),
      table: count('table'), iframe: count('iframe'), dialog: count('dialog, [role=dialog]'),
      script: count('script[src]'), stylesheet: count('link[rel=stylesheet]'),
    },
  })
}
