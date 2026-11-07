/* El puente entre este Chrome y el navegador del playground (navegador/server/chrome.go).
 *
 * Se conecta a ws://127.0.0.1:5203/api/chrome/bridge y hace de manos: engancha el depurador (chrome.debugger) a
 * las pestañas PERMITIDAS y reenvía el protocolo de depuración en las dos direcciones. Permitidas son sólo dos
 * clases: las que la persona compartió desde el panel lateral y las que abrió el navegador. Cualquier pedido sobre
 * otra pestaña se niega acá, aunque el servidor lo pida.
 *
 * Un service worker de MV3 se duerme a los 30 s sin actividad: el socket abierto con tráfico lo mantiene despierto
 * (un latido cada 20 s), y una alarma cada minuto lo levanta y reconecta si el servidor no estaba.
 */

const SERVER = 'ws://127.0.0.1:5203/api/chrome/bridge'

let ws = null
let status = 'desconectado' // desconectado · conectando · conectado
let heartbeat = null

// ── las pestañas permitidas ──
// En memoria, para mirarlas SIN esperar: los eventos de depuración tienen que salir en el orden en que llegan, y una
// lectura asíncrona por evento los podría desordenar. Se guardan también en storage.session, que sobrevive a que el
// service worker se duerma (y se borra al cerrar Chrome).

const lists = { shared: [], opened: [] }
const loaded = chrome.storage.session.get(['shared', 'opened']).then((s) => {
  lists.shared = s.shared || []
  lists.opened = s.opened || []
})

function allowedIds() {
  return [...new Set([...lists.shared, ...lists.opened])]
}

function isAllowed(tabId) {
  return lists.shared.includes(tabId) || lists.opened.includes(tabId)
}

async function setLists(next) {
  Object.assign(lists, next)
  await chrome.storage.session.set({ shared: lists.shared, opened: lists.opened })
  notifyShared()
  broadcastStatus()
}

function notifyShared() {
  send({ method: 'tabs.shared', params: [allowedIds()] })
}

async function share(tabId) {
  await setLists({ shared: [...new Set([...lists.shared, tabId])] })
}

async function unshare(tabId) {
  await setLists({ shared: lists.shared.filter((id) => id !== tabId), opened: lists.opened.filter((id) => id !== tabId) })
  try { await chrome.debugger.detach({ tabId }) } catch { /* no estaba enganchada */ }
}

// ── la conexión ──

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  status = 'conectando'
  broadcastStatus()
  try {
    ws = new WebSocket(SERVER)
  } catch {
    status = 'desconectado'
    broadcastStatus()
    return
  }
  ws.onopen = async () => {
    status = 'conectado'
    await loaded
    // Un servidor nuevo (o reiniciado) arranca de cero: si quedó el depurador enganchado de la conexión anterior,
    // con el estado que le dejó aquel Playwright, se suelta antes.
    for (const target of await chrome.debugger.getTargets()) {
      if (target.attached && target.tabId !== undefined && isAllowed(target.tabId)) {
        try { await chrome.debugger.detach({ tabId: target.tabId }) } catch { /* ya suelta */ }
      }
    }
    send({ method: 'extension.hello', params: [{ version: chrome.runtime.getManifest().version, userAgent: navigator.userAgent }] })
    notifyShared()
    clearInterval(heartbeat)
    heartbeat = setInterval(() => send({ method: 'extension.ping', params: [] }), 20000)
    broadcastStatus()
  }
  ws.onclose = () => {
    status = 'desconectado'
    clearInterval(heartbeat)
    ws = null
    broadcastStatus()
    setTimeout(connect, 3000)
  }
  ws.onerror = () => { /* onclose reintenta */ }
  ws.onmessage = async (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (!msg.id) return
    try {
      const result = await handle(msg.method, msg.params || [])
      send({ id: msg.id, result: result ?? {} })
    } catch (e) {
      send({ id: msg.id, error: String(e && e.message || e) })
    }
  }
}

// ── lo que pide el servidor ──

function guard(tabId) {
  if (!isAllowed(tabId)) throw new Error(`la pestaña ${tabId} no está compartida con el navegador`)
}

async function handle(method, params) {
  switch (method) {
    case 'chrome.debugger.attach': {
      const [target, version] = params
      guard(target.tabId)
      try {
        await chrome.debugger.attach({ tabId: target.tabId }, version || '1.3')
      } catch (e) {
        // Ya enganchada por nosotros (el servidor se reinició): sirve igual.
        if (!/already attached/i.test(String(e.message))) throw e
      }
      return {}
    }
    case 'chrome.debugger.detach': {
      const [target] = params
      try { await chrome.debugger.detach({ tabId: target.tabId }) } catch { /* ya suelta */ }
      return {}
    }
    case 'chrome.debugger.sendCommand': {
      const [target, cdpMethod, cdpParams] = params
      guard(target.tabId)
      const debuggee = target.sessionId ? { tabId: target.tabId, sessionId: target.sessionId } : { tabId: target.tabId }
      return await chrome.debugger.sendCommand(debuggee, cdpMethod, cdpParams || {})
    }
    case 'chrome.tabs.create': {
      const [props] = params
      const tab = await chrome.tabs.create({ url: props.url || 'about:blank', active: props.active !== false })
      await setLists({ opened: [...lists.opened, tab.id] })
      return { id: tab.id }
    }
    case 'chrome.tabs.remove': {
      const [tabId] = params
      guard(tabId)
      await chrome.tabs.remove(tabId)
      return {}
    }
    default:
      throw new Error(`no sé hacer ${method}`)
  }
}

// ── lo que pasa en Chrome ──

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId === undefined || !isAllowed(source.tabId)) return
  send({ method: 'chrome.debugger.onEvent', params: [source, method, params] })
})

chrome.debugger.onDetach.addListener((source, reason) => {
  send({ method: 'chrome.debugger.onDetach', params: [source, reason] })
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!isAllowed(tabId)) return
  send({ method: 'chrome.tabs.onRemoved', params: [tabId] })
  setLists({ shared: lists.shared.filter((id) => id !== tabId), opened: lists.opened.filter((id) => id !== tabId) })
})

// ── el panel lateral ──

async function statusPayload() {
  await loaded
  return { type: 'status', status, shared: lists.shared, opened: lists.opened }
}

async function broadcastStatus() {
  chrome.runtime.sendMessage(await statusPayload()).catch(() => { /* el panel está cerrado */ })
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  ;(async () => {
    if (msg.type === 'share') await share(msg.tabId)
    if (msg.type === 'unshare') await unshare(msg.tabId)
    if (msg.type === 'reconnect') connect()
    reply(await statusPayload())
  })()
  return true
})

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

chrome.alarms.create('navegador-keepalive', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'navegador-keepalive') connect() })
chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
connect()
