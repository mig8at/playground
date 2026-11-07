/* La pestaña Jarvis: el centro de control, con el mismo workbench que las herramientas del playground (theme.css y
 * workbench.css, copias de tools/ui). A la izquierda las sesiones que corren en este Chrome (cada una es una pestaña
 * real, en el grupo «Jarvis») y tus pestañas para compartirlas; al medio los pasos de la sesión elegida; a la
 * derecha los flujos. Las demás pestañas quedan limpias.
 *
 * Los flujos se leen del servidor (jarvis/flows, versionados en git: ésa es la fuente) y se guardan además en el
 * IndexedDB de la extensión, para mostrarlos aunque el servidor esté apagado. La copia nunca se edita: sólo se lee.
 */

const API = 'http://127.0.0.1:5203'
const THEME_KEY = 'ui.theme' // la misma clave que workbench.js
const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

let state = { status: 'desconectado', shared: [], opened: [] }
let sessions = []
let selected = null // el id de la sesión que muestra el editor

// El estilo «Paneles» de la base, como chat y la interfaz web de Jarvis: cada región, un panel sobre el lienzo.
document.documentElement.setAttribute('data-style', 'panels')

// ── el tema: el mismo arranque que THEME_BOOT de workbench.js (MV3 no deja scripts en línea) ──

function applyTheme(theme) {
  let t = theme
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', t === 'dark')
  document.documentElement.style.colorScheme = t
  return t
}
let theme = (() => { try { return localStorage.getItem(THEME_KEY) } catch { return null } })()
theme = applyTheme(theme)
$('theme').addEventListener('click', () => {
  theme = applyTheme(theme === 'dark' ? 'light' : 'dark')
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* preferencia opcional */ }
})

// ── IndexedDB: la copia de los flujos ──

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jarvis', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('cache')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function cacheSet(key, value) {
  const d = await db()
  return new Promise((resolve) => {
    const tx = d.transaction('cache', 'readwrite')
    tx.objectStore('cache').put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

async function cacheGet(key) {
  const d = await db()
  return new Promise((resolve) => {
    const req = d.transaction('cache').objectStore('cache').get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(undefined)
  })
}

// ── la conexión ──

function renderStatus() {
  const conn = $('conn')
  conn.textContent = state.status === 'conectado' ? '● Jarvis conectado' : `○ Jarvis ${state.status}`
  conn.className = state.status === 'conectado' ? 'ok' : ''
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    state = msg
    renderStatus()
    refreshTabs()
  }
})

// ── las sesiones (sidebar) y la elegida (editor) ──

function idleText(sec) {
  return sec < 60 ? 'activa' : `sin uso hace ${Math.round(sec / 60)} min`
}

async function refreshSessions() {
  let tabs
  try {
    const r = await fetch(API + '/api/tabs')
    if (!r.ok) throw new Error(String(r.status))
    tabs = await r.json()
  } catch {
    sessions = []
    $('sessions-count').textContent = '0'
    $('sessions').replaceChildren(el('p', 'note', 'Jarvis no está levantado en tu Mac (make jarvis).'))
    renderSession()
    return
  }
  sessions = (tabs || []).filter((t) => t.active && t.device === 'chrome')
  $('sessions-count').textContent = String(sessions.length)
  if (!sessions.some((s) => s.id === selected)) selected = sessions.length ? sessions[sessions.length - 1].id : null
  if (!sessions.length) {
    $('sessions').replaceChildren(el('p', 'note', 'Ninguna sesión en Chrome. Pedile a Claude que arranque una.'))
  } else {
    $('sessions').replaceChildren(...sessions.map((s) => {
      const row = el('button', 'row stacked' + (s.id === selected ? ' on' : ''))
      row.type = 'button'
      row.setAttribute('aria-selected', String(s.id === selected))
      const who = state.opened.includes(s.chromeTab) ? 'la abrió Claude' : 'compartida por vos'
      row.append(
        el('span', '', s.meta || s.title || s.url),
        el('span', 'row-desc', `${s.busy ? 'Claude trabajando' : idleText(s.sinUsoSeg || 0)} · ${who} · ${s.title || s.url}`),
      )
      row.addEventListener('click', () => { selected = s.id; refreshSessions() })
      row.addEventListener('dblclick', () => goTo(s))
      return row
    }))
  }
  renderSession()
}

function goTo(s) {
  if (s && s.chromeTab) chrome.tabs.update(s.chromeTab, { active: true })
}

async function renderSession() {
  const s = sessions.find((x) => x.id === selected)
  const sub = $('session-sub')
  const go = $('go-tab')
  if (!s) {
    $('session-title').textContent = 'Jarvis'
    sub.hidden = true
    go.hidden = true
    const empty = el('div', 'empty')
    const head = el('div', 'empty-head')
    head.append(
      el('p', 'empty-title', 'Sin sesiones en Chrome'),
      el('p', 'empty-desc', 'Cuando Claude trabaje en este Chrome, cada sesión aparece a la izquierda y sus pasos acá. Las pestañas que abre van al grupo «Jarvis».'),
    )
    empty.append(head)
    $('steps').replaceChildren(empty)
    return
  }
  $('session-title').textContent = s.meta || s.title || `Sesión ${s.id}`
  go.hidden = !s.chromeTab
  go.onclick = () => goTo(s)
  sub.hidden = false
  sub.querySelector('.grow').textContent = s.url
  let st
  try {
    st = await (await fetch(`${API}/api/live/state?tab=${encodeURIComponent(s.id)}`)).json()
  } catch {
    return
  }
  const steps = st.steps || []
  sub.querySelector('.count').textContent = `${steps.length} paso(s)`
  if (!steps.length) {
    $('steps').replaceChildren(el('p', 'note', 'Todavía sin pasos.'))
    return
  }
  $('steps').replaceChildren(...steps.map((p) => {
    const line = el('div', 'log-line' + (p.ok ? '' : ' bad'))
    const at = p.at ? new Date(p.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''
    line.title = p.code + (p.error ? `\n${p.error}` : '')
    line.append(el('span', 'log-time', at), el('span', '', stepText(p)))
    return line
  }))
}

// Qué hizo un paso, en palabras: la acción de su línea de Playwright y sobre qué.
const VERBS = { click: 'clic en', dblclick: 'doble clic en', fill: 'escribir en', check: 'marcar', uncheck: 'desmarcar', selectOption: 'elegir en', hover: 'pasar por', goto: 'ir a', press: 'tecla en' }
function stepText(p) {
  const m = /\.(\w+)\(([^)]*)\)\s*;?\s*$/.exec(p.code || '')
  const verb = m && VERBS[m[1]]
  if (!verb) return p.target || p.code
  if (m[1] === 'goto') return `ir a ${m[2].replace(/^'|'$/g, '')}`
  const value = (m[1] === 'fill' || m[1] === 'selectOption') && m[2] ? ` · ${m[2]}` : ''
  return `${verb} «${p.target || '…'}»${value}`
}

// ── tus pestañas: compartir o dejar de compartir ──

async function refreshTabs() {
  const all = await chrome.tabs.query({})
  const own = all.filter((t) => /^https?:/.test(t.url || '') && !state.opened.includes(t.id))
  $('tabs-count').textContent = String(own.length)
  if (!own.length) {
    $('tabs').replaceChildren(el('p', 'note', 'No hay pestañas de páginas web abiertas.'))
    return
  }
  $('tabs').replaceChildren(...own.map((t) => {
    const shared = state.shared.includes(t.id)
    const row = el('div', 'row')
    row.title = t.url
    const btn = el('button', 'btn btn-xs ' + (shared ? 'btn-ghost' : 'btn-outline'), shared ? 'Dejar de compartir' : 'Compartir')
    btn.type = 'button'
    btn.addEventListener('click', async () => {
      state = await chrome.runtime.sendMessage({ type: shared ? 'unshare' : 'share', tabId: t.id })
      renderStatus()
      refreshTabs()
    })
    row.append(el('span', '', t.title || t.url), btn)
    return row
  }))
}

chrome.tabs.onCreated.addListener(refreshTabs)
chrome.tabs.onRemoved.addListener(refreshTabs)
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.title || info.status === 'complete') refreshTabs() })

// ── los flujos (sidebar secundario) ──

function renderFlows(flows, note) {
  $('flows-note').textContent = note
  $('flows-count').textContent = String(flows.length)
  const byApp = {}
  for (const f of flows) (byApp[f.app] ||= []).push(f)
  const nodes = []
  for (const app of Object.keys(byApp).sort()) {
    const head = el('div', 'region-head group')
    head.append(el('span', '', app), el('span', 'count', String(byApp[app].length)))
    nodes.push(head)
    for (const f of byApp[app]) {
      const row = el('div', 'row stacked')
      const when = f.creado ? new Date(f.creado).toLocaleDateString('es-CO') : ''
      row.title = f.meta || f.nombre
      row.append(
        el('span', '', f.nombre || f.id),
        el('span', 'row-desc', `${f.pasos} paso(s)${f.datos ? ` · ${f.datos} dato(s)` : ''}${f.dispositivo === 'chrome' ? ' · Chrome' : ''} · ${when}`),
      )
      nodes.push(row)
    }
  }
  if (!nodes.length) nodes.push(el('p', 'note', 'Todavía no hay flujos.'))
  $('flows').replaceChildren(...nodes)
}

async function refreshFlows() {
  try {
    const r = await fetch(API + '/api/flows')
    if (!r.ok) throw new Error(String(r.status))
    const flows = await r.json()
    await cacheSet('flows', { at: Date.now(), flows })
    renderFlows(flows, '')
  } catch {
    const cached = await cacheGet('flows')
    if (cached) renderFlows(cached.flows, `Sin servidor: flujos de la copia del ${new Date(cached.at).toLocaleString('es-CO')}`)
    else renderFlows([], 'Sin servidor y sin copia de los flujos todavía.')
  }
}

$('reload').addEventListener('click', refreshFlows)

;(async () => {
  state = await chrome.runtime.sendMessage({ type: 'status' })
  renderStatus()
  refreshTabs()
  refreshFlows()
  refreshSessions()
  setInterval(refreshSessions, 2000)
  setInterval(refreshFlows, 30000)
})()
