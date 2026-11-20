/* El panel lateral de Jarvis en Chrome: los grupos de pestañas abiertos, con sus pestañas. Se lee directo de Chrome
 * (chrome.tabGroups y chrome.tabs) y se pinta de nuevo cada vez que algo cambia; un clic en una pestaña la trae.
 * Es lo mínimo a propósito: lo que se sume, se suma después de verlo.
 *
 * VISTA PREVIA: abierto fuera de la extensión, muestra grupos de ejemplo. */

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

// Los colores de los grupos, como los pinta Chrome (chrome.tabGroups.Color).
const GROUP_COLORS = { grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038', pink: '#d01884',
  purple: '#9334e6', cyan: '#007b83', orange: '#fa903e' }

// El tema del sistema (el panel no tiene botón: sigue a Chrome).
const dark = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => {
  document.documentElement.classList.toggle('dark', dark.matches)
  document.documentElement.style.colorScheme = dark.matches ? 'dark' : 'light'
}
applyTheme()
dark.addEventListener('change', applyTheme)

const host = (url) => {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return '' }
}

// El botón de cerrar un grupo: el primer clic pide confirmar («Cerrar N»), el segundo cierra. Si no se confirma en
// 4 s, vuelve a ser la cruz. Cerrar un grupo cierra sus pestañas (Chrome las deja en «Recientes» por si acaso).
function closeButton(g, onClose) {
  const btn = el('button', 'btn btn-xs btn-ghost btn-icon sp-close')
  btn.type = 'button'
  const n = g.tabs.length
  const idle = () => {
    btn.replaceChildren(el('span', 'ui-icon'))
    btn.firstChild.dataset.icon = 'close'
    btn.firstChild.setAttribute('aria-hidden', 'true')
    btn.classList.remove('armed', 'btn-icon')
    btn.classList.add('btn-icon')
    btn.title = `Cerrar el grupo «${g.title || 'Sin nombre'}» y ${n === 1 ? 'su pestaña' : `sus ${n} pestañas`}`
    btn.setAttribute('aria-label', btn.title)
    delete btn.dataset.armed
  }
  let timer
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1'
      btn.classList.remove('btn-icon')
      btn.classList.add('armed')
      btn.textContent = n === 1 ? 'Cerrar 1 pestaña' : `Cerrar ${n} pestañas`
      btn.setAttribute('aria-label', `Confirmar: ${btn.textContent}`)
      clearTimeout(timer)
      timer = setTimeout(idle, 4000)
      return
    }
    clearTimeout(timer)
    onClose(g)
  })
  idle()
  return btn
}

// groups: [{ id, title, color, tabs: [{ id, title, url, active }] }]
function render(groups, onPick, onClose) {
  const tabs = groups.reduce((n, g) => n + g.tabs.length, 0)
  // Las que necesitan a la persona llevan 🔔 en el título (server/attention.go): se cuentan arriba.
  const need = groups.reduce((n, g) => n + g.tabs.filter((t) => (t.title || '').startsWith('🔔')).length, 0)
  $('summary').textContent = `${groups.length} grupo(s) · ${tabs} pestaña(s)` + (need ? ` · 🔔 ${need} te necesitan` : '')
  if (!groups.length) {
    $('groups').replaceChildren(el('p', 'sp-empty', 'Ningún grupo abierto en esta ventana.'))
    return
  }
  $('groups').replaceChildren(...groups.map((g) => {
    const box = el('div', 'sp-group')
    const head = el('div', 'sp-group-head')
    const sw = el('span', 'sp-swatch')
    sw.style.setProperty('--group-color', GROUP_COLORS[g.color] || GROUP_COLORS.grey)
    head.append(sw, el('span', 'name', g.title || 'Sin nombre'), el('span', 'count', String(g.tabs.length)), closeButton(g, onClose))
    box.append(head)
    for (const t of g.tabs) {
      const row = el('button', 'row' + (t.active ? ' on' : ''))
      row.type = 'button'
      row.title = t.url
      row.append(el('span', '', t.title || t.url), el('span', 'row-meta', host(t.url)))
      row.addEventListener('click', () => onPick(t))
      box.append(row)
    }
    return box
  }))
}

// ── en la extensión: lo que hay en Chrome, en la ventana de este panel ──

async function load() {
  const win = await chrome.windows.getCurrent()
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({ windowId: win.id }), chrome.tabs.query({ windowId: win.id })])
  // En el orden en que están en la barra: el de la primera pestaña de cada grupo.
  const out = groups.map((g) => ({ id: g.id, title: g.title, color: g.color, tabs: tabs.filter((t) => t.groupId === g.id) }))
    .filter((g) => g.tabs.length)
    .sort((a, b) => a.tabs[0].index - b.tabs[0].index)
  render(out, (t) => chrome.tabs.update(t.id, { active: true }), (g) => chrome.tabs.remove(g.tabs.map((t) => t.id)).catch(() => {}))
}

const inExtension = typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.tabGroups
if (inExtension) {
  let timer
  const refresh = () => { clearTimeout(timer); timer = setTimeout(() => load().catch(() => {}), 80) }
  for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved, chrome.tabs.onActivated,
    chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved]) {
    ev.addListener(refresh)
  }
  load().catch(() => {})
} else {
  // La vista previa: tres grupos de ejemplo.
  const demo = [
    { title: 'Reembolso #1036', color: 'orange', tabs: [
      { title: 'Pedido #1036 · Shopify', url: 'https://admin.shopify.com/store/creditop-dev-store/orders/1036', active: true },
      { title: 'Pedidos · Shopify', url: 'https://admin.shopify.com/store/creditop-dev-store/orders' } ] },
    { title: 'VTEX', color: 'blue', tabs: [
      { title: 'Pedidos · VTEX', url: 'https://autoonb--creditop.myvtex.com/admin/orders' } ] },
    { title: 'Calendario', color: 'green', tabs: [
      { title: 'Google Calendar · Semana', url: 'https://calendar.google.com/calendar/u/0/r/week' },
      { title: 'Evento · Entrenamiento', url: 'https://calendar.google.com/calendar/u/0/r/eventedit' },
      { title: 'Recibidos (1.935) · Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' } ] },
  ]
  const show = () => render(demo, () => {}, (g) => { demo.splice(demo.indexOf(g), 1); show() })
  show()
}
