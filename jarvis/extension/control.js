/* La pestaña Jarvis: el centro de control. Las sesiones que corren en este Chrome (cada una es una pestaña real, en
 * el grupo «Jarvis»), los flujos, y tus pestañas para compartirlas con Claude. Las demás pestañas quedan limpias.
 *
 * Los flujos se leen del servidor (jarvis/flujos, versionados en git: ésa es la fuente) y se guardan además en el
 * IndexedDB de la extensión, para mostrarlos aunque el servidor esté apagado. La copia nunca se edita: sólo se lee.
 */

const API = 'http://127.0.0.1:5203'
const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

let state = { status: 'desconectado', shared: [], opened: [] }

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
  conn.textContent = state.status
  conn.className = 'pill ' + (state.status === 'conectado' ? 'ok' : 'warn')
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    state = msg
    renderStatus()
    refreshTabs()
  }
})

// ── las sesiones ──

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
    $('sessions').replaceChildren(el('p', 'muted', 'El navegador del playground no está levantado (make jarvis).'))
    return
  }
  const inChrome = (tabs || []).filter((t) => t.active && t.device === 'chrome')
  if (!inChrome.length) {
    $('sessions').replaceChildren(el('p', 'muted', 'Ninguna sesión en Chrome. Pedile a Claude que arranque una (empezar --chrome).'))
    return
  }
  const cards = await Promise.all(inChrome.map(async (t) => {
    let last = null
    try {
      const st = await (await fetch(`${API}/api/live/state?tab=${encodeURIComponent(t.id)}`)).json()
      last = (st.steps || []).slice(-1)[0] || null
    } catch { /* sin el último paso */ }
    const btn = el('button', 'card session')
    btn.type = 'button'
    const body = el('span', 'body')
    body.append(
      el('div', 'goal', t.meta || t.title || t.url),
      el('div', 'meta', `sesión ${t.id} · ${t.busy ? 'Claude trabajando' : idleText(t.sinUsoSeg || 0)} · ${state.opened.includes(t.chromeTab) ? 'la abrió Claude' : 'compartida por vos'} · ${t.title || t.url}`),
    )
    if (last) body.append(el('div', 'last' + (last.ok ? '' : ' bad'), `último paso: ${last.target || last.code}`))
    btn.append(el('span', 'dot' + (t.busy ? ' busy' : '')), body)
    btn.title = 'Ir a la pestaña'
    btn.disabled = !t.chromeTab
    btn.addEventListener('click', () => { if (t.chromeTab) chrome.tabs.update(t.chromeTab, { active: true }) })
    return btn
  }))
  $('sessions').replaceChildren(...cards)
}

// ── tus pestañas: compartir o dejar de compartir ──

async function refreshTabs() {
  const all = await chrome.tabs.query({})
  const own = all.filter((t) => /^https?:/.test(t.url || '') && !state.opened.includes(t.id))
  if (!own.length) {
    $('tabs').replaceChildren(el('p', 'muted small', 'No hay pestañas de páginas web abiertas.'))
    return
  }
  $('tabs').replaceChildren(...own.map((t) => {
    const shared = state.shared.includes(t.id)
    const row = el('div', 'card tab')
    const body = el('div', 'body')
    body.append(el('div', 'title', t.title || t.url), el('div', 'url', t.url))
    const btn = el('button', shared ? 'ghost' : '', shared ? 'Dejar de compartir' : 'Compartir')
    btn.type = 'button'
    btn.addEventListener('click', async () => {
      state = await chrome.runtime.sendMessage({ type: shared ? 'unshare' : 'share', tabId: t.id })
      renderStatus()
      refreshTabs()
    })
    row.append(body, btn)
    return row
  }))
}

chrome.tabs.onCreated.addListener(refreshTabs)
chrome.tabs.onRemoved.addListener(refreshTabs)
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.title || info.status === 'complete') refreshTabs() })

// ── los flujos ──

function renderFlows(flows, note) {
  $('flows-note').textContent = note
  const byApp = {}
  for (const f of flows) (byApp[f.app] ||= []).push(f)
  const nodes = []
  for (const app of Object.keys(byApp).sort()) {
    nodes.push(el('div', 'app', app))
    for (const f of byApp[app]) {
      const card = el('div', 'card flow')
      const when = f.creado ? new Date(f.creado).toLocaleDateString('es-CO') : ''
      card.append(
        el('div', 'name', f.nombre || f.id),
        el('div', 'meta', `${f.pasos} paso(s)${f.datos ? ` · ${f.datos} dato(s)` : ''}${f.dispositivo === 'chrome' ? ' · Chrome' : ''} · ${when}`),
      )
      nodes.push(card)
    }
  }
  if (!nodes.length) nodes.push(el('p', 'muted', 'Todavía no hay flujos.'))
  $('flows').replaceChildren(...nodes)
}

async function refreshFlows() {
  try {
    const r = await fetch(API + '/api/flows')
    if (!r.ok) throw new Error(String(r.status))
    const flows = await r.json()
    await cacheSet('flows', { at: Date.now(), flows })
    renderFlows(flows, `${flows.length} flujo(s) en jarvis/flujos`)
  } catch {
    const cached = await cacheGet('flows')
    if (cached) renderFlows(cached.flows, `Sin servidor: la copia guardada del ${new Date(cached.at).toLocaleString('es-CO')}`)
    else renderFlows([], 'Sin servidor y sin copia guardada todavía.')
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
