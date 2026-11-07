/* El panel lateral: la conexión con el navegador, compartir la pestaña, la sesión en vivo y los flujos.
 *
 * Los flujos se leen del servidor (navegador/flujos, versionados en git: ésa es la fuente) y se guardan además en el
 * IndexedDB de la extensión, para mostrarlos aunque el servidor esté apagado. La copia nunca se edita: sólo se lee.
 */

const API = 'http://127.0.0.1:5203'
const $ = (id) => document.getElementById(id)

let state = { status: 'desconectado', shared: [], opened: [] }
let activeTab = null

// ── IndexedDB: la copia de los flujos ──

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('navegador', 1)
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

// ── la conexión y la pestaña ──

function renderStatus() {
  const conn = $('conn')
  conn.textContent = state.status
  conn.className = 'pill ' + (state.status === 'conectado' ? 'ok' : 'warn')
  const shareBtn = $('share')
  if (!activeTab) {
    shareBtn.disabled = true
    return
  }
  $('tab-url').textContent = activeTab.url || ''
  // Las páginas internas de Chrome (y las de otras extensiones) no dejan enganchar el depurador.
  if (!/^https?:/.test(activeTab.url || '')) {
    shareBtn.disabled = true
    shareBtn.textContent = 'Esta página no se puede compartir'
    shareBtn.className = 'ghost'
    return
  }
  const opened = state.opened.includes(activeTab.id)
  const shared = state.shared.includes(activeTab.id) || opened
  shareBtn.disabled = false
  shareBtn.textContent = shared ? (opened ? 'Abierta por el navegador · soltar' : 'Dejar de compartir') : 'Compartir con el navegador'
  shareBtn.className = shared ? 'ghost' : ''
}

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  activeTab = tab || null
  renderStatus()
}

$('share').addEventListener('click', async () => {
  if (!activeTab) return
  const shared = state.shared.includes(activeTab.id) || state.opened.includes(activeTab.id)
  state = await chrome.runtime.sendMessage({ type: shared ? 'unshare' : 'share', tabId: activeTab.id })
  renderStatus()
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    state = msg
    renderStatus()
  }
})
chrome.tabs.onActivated.addListener(refreshTab)
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') refreshTab() })

// ── la sesión en vivo ──

async function refreshLive() {
  let st
  try {
    const r = await fetch(API + '/api/live/state')
    if (!r.ok) throw new Error(String(r.status))
    st = await r.json()
  } catch {
    $('live').textContent = 'El navegador no está levantado (make navegador).'
    $('steps').replaceChildren()
    return
  }
  if (!st.active) {
    $('live').textContent = 'Sin sesión.'
    $('steps').replaceChildren()
    return
  }
  const where = st.device === 'chrome' ? 'en este Chrome' : 'en el Chromium del navegador'
  $('live').textContent = `${st.title || st.url} · ${where} · ${st.steps.length} paso(s)`
  const items = st.steps.slice(-10).map((s) => {
    const li = document.createElement('li')
    li.textContent = s.target ? `${s.target}` : s.code
    li.title = s.code + (s.error ? `\n${s.error}` : '')
    if (!s.ok) li.className = 'bad'
    return li
  })
  $('steps').replaceChildren(...items)
}

// ── los flujos ──

function renderFlows(flows, note) {
  $('flows-note').textContent = note
  const byApp = {}
  for (const f of flows) (byApp[f.app] ||= []).push(f)
  const nodes = []
  for (const app of Object.keys(byApp).sort()) {
    const h = document.createElement('div')
    h.className = 'app'
    h.textContent = app
    nodes.push(h)
    for (const f of byApp[app]) {
      const card = document.createElement('div')
      card.className = 'flow'
      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = f.nombre || f.id
      const meta = document.createElement('div')
      meta.className = 'meta'
      const when = f.creado ? new Date(f.creado).toLocaleDateString('es-CO') : ''
      meta.textContent = `${f.pasos} paso(s)${f.datos ? ` · ${f.datos} dato(s)` : ''}${f.dispositivo === 'chrome' ? ' · Chrome' : ''} · ${when}`
      card.append(name, meta)
      nodes.push(card)
    }
  }
  if (!nodes.length) {
    const p = document.createElement('p')
    p.className = 'muted'
    p.textContent = 'Todavía no hay flujos.'
    nodes.push(p)
  }
  $('flows').replaceChildren(...nodes)
}

async function refreshFlows() {
  try {
    const r = await fetch(API + '/api/flows')
    if (!r.ok) throw new Error(String(r.status))
    const flows = await r.json()
    await cacheSet('flows', { at: Date.now(), flows })
    renderFlows(flows, `${flows.length} flujo(s) en navegador/flujos`)
  } catch {
    const cached = await cacheGet('flows')
    if (cached) {
      renderFlows(cached.flows, `Sin servidor: la copia guardada del ${new Date(cached.at).toLocaleString('es-CO')}`)
    } else {
      renderFlows([], 'Sin servidor y sin copia guardada todavía.')
    }
  }
}

$('reload').addEventListener('click', refreshFlows)

;(async () => {
  state = await chrome.runtime.sendMessage({ type: 'status' })
  await refreshTab()
  refreshFlows()
  refreshLive()
  setInterval(refreshLive, 2000)
  setInterval(refreshFlows, 30000)
})()
