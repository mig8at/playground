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

  // ── los controles: cada elemento con el que se interactúa, con los localizadores candidatos para llegar a él ──
  // Cada uno queda marcado con data-navegador-id (sólo en este navegador, no en el sitio): el servidor prueba cada
  // candidato con Playwright y se queda con los que encuentran UN elemento y es ESTE. Acá sólo se proponen; el
  // orden es el que recomienda Playwright: por rol y nombre, por etiqueta, por placeholder, por test id, por
  // texto, y CSS al final.
  const isVisible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    const cs = getComputedStyle(el)
    return cs.display !== 'none' && cs.visibility !== 'hidden'
  }
  const roleOf = (el) => {
    const explicit = (el.getAttribute('role') || '').split(/\s+/)[0]
    if (explicit) return explicit
    const t = el.tagName
    const type = (el.getAttribute('type') || 'text').toLowerCase()
    if (t === 'BUTTON' || (t === 'INPUT' && ['submit', 'button', 'reset', 'image'].includes(type))) return 'button'
    if (t === 'A') return el.hasAttribute('href') ? 'link' : ''
    if (t === 'SELECT') return el.multiple || el.size > 1 ? 'listbox' : 'combobox'
    if (t === 'TEXTAREA') return 'textbox'
    if (t === 'INPUT') {
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      if (type === 'number') return 'spinbutton'
      if (type === 'search') return el.getAttribute('list') ? 'combobox' : 'searchbox'
      if (['text', 'email', 'tel', 'url'].includes(type)) return el.getAttribute('list') ? 'combobox' : 'textbox'
      return '' // password, date, file, color…: sin rol ARIA, getByRole no los encuentra
    }
    return ''
  }
  const nameOf = (el) => {
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const txt = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
      if (clean(txt)) return clean(txt, 100)
    }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'), 100)
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const type = (el.getAttribute('type') || '').toLowerCase()
      if (['submit', 'button', 'reset'].includes(type)) return clean(el.value || (type === 'submit' ? 'Submit' : ''), 100)
      if (type === 'image') return clean(el.alt || el.value, 100)
      const lbl = el.labels && el.labels[0] ? clean(el.labels[0].textContent, 100) : ''
      return lbl || clean(el.getAttribute('title') || el.getAttribute('placeholder') || '', 100)
    }
    const txt = clean(el.innerText || el.textContent, 100)
    if (txt) return txt
    const img = el.querySelector('img[alt]')
    return clean(img?.alt || el.getAttribute('title') || '', 100)
  }
  const q = (s) => JSON.stringify(s).slice(1, -1).replace(/'/g, "\\'")
  const cssPath = (el) => {
    const parts = []
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
        parts.unshift('#' + CSS.escape(node.id))
        break
      }
      let part = node.tagName.toLowerCase()
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : []
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`
      parts.unshift(part)
    }
    return parts.join(' > ')
  }
  const CONTROL = 'input:not([type=hidden]), select, textarea, button, a[href], [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=switch], [role=combobox], [role=textbox], [contenteditable=""], [contenteditable=true]'
  const controls = []
  const formIndex = new Map([...document.forms].map((f, i) => [f, i]))
  let linkControls = 0
  for (const el of document.querySelectorAll(CONTROL)) {
    if (controls.length >= 160 || !isVisible(el)) continue
    const role = roleOf(el)
    if (role === 'link' && ++linkControls > 60) continue // en una página de documentación son cientos: con 60 alcanza para ver el patrón
    const id = controls.length
    el.setAttribute('data-navegador-id', String(id))
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute('type') || '').toLowerCase()
    const name = nameOf(el)
    const label = el.labels && el.labels[0] ? clean(el.labels[0].textContent, 100) : ''
    const placeholder = el.getAttribute('placeholder') || ''
    const cands = []
    const testId = el.getAttribute('data-testid')
    if (testId) cands.push({ kind: 'testid', value: testId, code: `page.getByTestId('${q(testId)}')` })
    for (const attr of ['data-test', 'data-test-id', 'data-cy', 'data-qa']) {
      const v = el.getAttribute(attr)
      if (v) cands.push({ kind: 'css', value: `[${attr}="${v.replace(/"/g, '\\"')}"]`, code: `page.locator('[${attr}="${q(v)}"]')` })
    }
    if (role && name) {
      cands.push({ kind: 'role', role, value: name, exact: true, code: `page.getByRole('${role}', { name: '${q(name)}', exact: true })` })
      // Sin exact: el nombre accesible incluye texto que innerText no ve (el ícono de una fuente, un ::before).
      cands.push({ kind: 'role', role, value: name, exact: false, code: `page.getByRole('${role}', { name: '${q(name)}' })` })
    }
    if (label) cands.push({ kind: 'label', value: label, code: `page.getByLabel('${q(label)}', { exact: true })` })
    if (placeholder) cands.push({ kind: 'placeholder', value: placeholder, code: `page.getByPlaceholder('${q(placeholder)}', { exact: true })` })
    const text = /^(BUTTON|A)$/.test(el.tagName) || role === 'button' || role === 'link' ? clean(el.innerText, 80) : ''
    if (text) cands.push({ kind: 'text', value: text, code: `page.getByText('${q(text)}', { exact: true })` })
    if (el.id && /^[A-Za-z][\w:.-]*$/.test(el.id)) cands.push({ kind: 'css', value: '#' + CSS.escape(el.id), code: `page.locator('#${q(CSS.escape(el.id))}')` })
    const nameAttr = el.getAttribute('name')
    if (nameAttr) cands.push({ kind: 'css', value: `${tag}[name="${nameAttr.replace(/"/g, '\\"')}"]`, code: `page.locator('${tag}[name="${q(nameAttr)}"]')` })
    const path = cssPath(el)
    cands.push({ kind: 'css', value: path, code: `page.locator('${q(path)}')` })
    const unique = cands.filter((c, i) => cands.findIndex((o) => o.code === c.code) === i)

    // Qué se le hace: llenar, marcar, elegir o hacer clic.
    let action = '.click()'
    if (tag === 'select') {
      const opt = [...el.options].find((o) => o.value && !o.disabled)
      action = `.selectOption('${q(opt ? opt.value : '')}')`
    } else if (type === 'checkbox' || type === 'radio' || role === 'checkbox' || role === 'radio' || role === 'switch') action = '.check()'
    else if (type === 'file') action = ".setInputFiles('archivo.pdf')"
    else if (tag === 'textarea' || el.isContentEditable || role === 'textbox' || role === 'searchbox' || role === 'spinbutton' ||
      (tag === 'input' && !['submit', 'button', 'reset', 'image', 'range', 'color'].includes(type))) {
      const sample = { email: 'prueba@example.com', tel: '3001234567', number: '1', date: '2026-01-31', url: 'https://example.com', password: '<contraseña>', search: 'texto' }[type]
      action = `.fill('${q(sample || '<' + (label || placeholder || nameAttr || 'texto') + '>')}')`
    }
    const kind = action.startsWith('.fill') || action.startsWith('.setInputFiles') ? 'field'
      : action.startsWith('.select') ? 'select' : action.startsWith('.check') ? 'check' : role === 'link' ? 'link' : 'button'
    const r = el.getBoundingClientRect()
    controls.push({
      id, kind, tag, type, role, name: name || label || placeholder || nameAttr || el.id || tag, action,
      form: el.form && formIndex.has(el.form) ? formIndex.get(el.form) : -1,
      box: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      locators: unique,
    })
  }

  const count = (sel) => document.querySelectorAll(sel).length
  return JSON.stringify({
    controls,
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
