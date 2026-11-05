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

  const count = (sel) => document.querySelectorAll(sel).length
  return JSON.stringify({
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
