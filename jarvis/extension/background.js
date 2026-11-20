/* Jarvis: el puente entre este Chrome y el navegador de my-tools (jarvis/server/chrome.go).
 *
 * Se conecta a ws://127.0.0.1:5203/api/chrome/bridge y hace de manos: engancha el depurador (chrome.debugger) a
 * las pestañas PERMITIDAS y reenvía el protocolo de depuración en las dos direcciones. Permitidas son sólo dos
 * clases: las que la persona compartió desde la pestaña Jarvis y las que abrió el navegador. Cualquier pedido sobre
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
// lectura asíncrona por evento los podría desordenar. Se guardan también en storage.LOCAL, que sobrevive a que el
// service worker se duerma y a RECARGAR la extensión (con storage.session, que se borra al recargar, las pestañas que
// Jarvis había abierto pasaban a parecer de la persona y nadie las cerraba). Al arrancar Chrome los ids de pestaña
// empiezan de nuevo: ahí se vacían (onStartup), y al cargar se descartan los que ya no existen.
// groupTitles: los nombres de grupo que puso Jarvis. Una huérfana tiene que estar en uno de ésos: así un id viejo
// nunca apunta a una pestaña de un grupo tuyo.

const lists = { shared: [], opened: [], groupTitles: [] }
const loaded = chrome.storage.local.get(['shared', 'opened', 'groupTitles']).then(async (s) => {
  const alive = new Set((await chrome.tabs.query({})).map((t) => t.id))
  lists.shared = (s.shared || []).filter((id) => alive.has(id))
  lists.opened = (s.opened || []).filter((id) => alive.has(id))
  lists.groupTitles = s.groupTitles || []
})

function allowedIds() {
  return [...new Set([...lists.shared, ...lists.opened])]
}

function isAllowed(tabId) {
  return lists.shared.includes(tabId) || lists.opened.includes(tabId)
}

async function setLists(next) {
  Object.assign(lists, next)
  await chrome.storage.local.set({ shared: lists.shared, opened: lists.opened, groupTitles: lists.groupTitles })
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
      if (props.newWindow) {
        const tab = await createInAsideWindow(props.url || 'about:blank', !!props.background)
        await setLists({ opened: [...lists.opened, tab.id] })
        await keepAlive(tab.id)
        return { id: tab.id }
      }
      const tab = await chrome.tabs.create({ url: props.url || 'about:blank', active: props.active !== false })
      await setLists({ opened: [...lists.opened, tab.id] })
      await keepAlive(tab.id)
      await addToGroup(tab)
      return { id: tab.id }
    }
    case 'chrome.tabs.activate': {
      // La trae al frente DENTRO de su ventana, sin robarle el foco a la ventana en la que esté trabajando la persona.
      const [tabId] = params
      guard(tabId)
      await chrome.tabs.update(tabId, { active: true })
      return {}
    }
    case 'chrome.tabs.listOpened': {
      // Las pestañas que abrió Jarvis y siguen en un grupo suyo: el servidor decide cuáles quedaron huérfanas.
      await loaded
      const out = []
      for (const id of lists.opened) {
        let tab
        try { tab = await chrome.tabs.get(id) } catch { continue }
        if (tab.groupId === -1) continue
        let title = ''
        try { title = (await chrome.tabGroups.get(tab.groupId)).title || '' } catch { continue }
        if (!lists.groupTitles.includes(title)) continue
        out.push({ id, groupId: tab.groupId, group: title, title: tab.title || '', url: tab.url || '' })
      }
      return out
    }
    case 'chrome.tabs.sendBehind': {
      // Deja la pestaña detrás de verdad, para medir si el sitio anda de fondo (bin/jarvis focus check): al frente
      // de su ventana va la pestaña Jarvis de esa ventana; si no hay, otra cualquiera de la ventana; si es la única,
      // se abre la pestaña Jarvis ahí. No se toca el contenido de ninguna.
      const [tabId] = params
      guard(tabId)
      const tab = await chrome.tabs.get(tabId)
      const url = chrome.runtime.getURL('control.html')
      const [control] = await chrome.tabs.query({ url, windowId: tab.windowId })
      const others = (await chrome.tabs.query({ windowId: tab.windowId })).filter((t) => t.id !== tabId)
      const target = control || others[0]
      if (target) await chrome.tabs.update(target.id, { active: true })
      else await chrome.tabs.create({ url, windowId: tab.windowId, pinned: true, index: 0, active: true })
      return { active: (await chrome.tabs.get(tabId)).active }
    }
    case 'chrome.tabs.setGroup': {
      // La sesión tiene un grupo propio (bin/jarvis start --group): su pestaña sale del «Jarvis» y va al de su tarea.
      const [tabId, title, color] = params
      guard(tabId)
      const tab = await chrome.tabs.get(tabId)
      // En la ventana aparte (start --aside), el grupo se arma ahí: no se la muda a la ventana de la persona aunque
      // ahí haya un grupo con el mismo nombre (sería sacarla de donde se pidió que trabaje).
      const { asideWindowId } = await chrome.storage.session.get('asideWindowId')
      await addToGroup(tab, title || 'Jarvis', title ? color : 'purple', tab.windowId !== asideWindowId)
      return {}
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

// keepAlive: que Chrome no DESCARTE la pestaña de una sesión cuando está de fondo (el ahorro de memoria descarta las
// pestañas que no se miran; Claude trabaja justamente en ésas). Una descartada pierde la página y la sesión con ella.
// Lo que sigue pudiendo pasar: el ahorro de energía congela las de fondo que gastan mucho CPU (Chrome 133+), y eso
// no tiene llave para una extensión.
async function keepAlive(tabId) {
  try { await chrome.tabs.update(tabId, { autoDiscardable: false }) } catch { /* la pestaña ya se cerró */ }
}

// ── la ventana aparte: trabajo que la persona no necesita ver (el pool de AI Studio de Wally) ──
// Una sola ventana, que se reusa mientras exista (su id vive en storage.session: sobrevive a que el service worker
// se duerma, no a reiniciar Chrome). Con `minimized` nace minimizada; si no, normal pero sin robar el foco. Cada
// pestaña nueva va activa DENTRO de esa ventana: Chrome frena las pestañas de fondo.
async function createInAsideWindow(url, minimized) {
  const { asideWindowId } = await chrome.storage.session.get('asideWindowId')
  if (asideWindowId) {
    try {
      await chrome.windows.get(asideWindowId)
      return await chrome.tabs.create({ windowId: asideWindowId, url, active: true })
    } catch { /* la cerraron: se abre otra */ }
  }
  const win = await chrome.windows.create(minimized ? { url, state: 'minimized' } : { url, focused: false })
  await chrome.storage.session.set({ asideWindowId: win.id })
  return win.tabs[0]
}

// ── los grupos: las pestañas que abre Claude, juntas y de un color, para no confundirlas con las tuyas ──
// Por defecto van al grupo «Jarvis» (violeta); una sesión con grupo propio (bin/jarvis start --group 'VTEX') va al de
// su tarea, con el color que le dio el servidor.

async function addToGroup(tab, title = 'Jarvis', color = 'purple', allowMove = true) {
  try {
    if (!lists.groupTitles.includes(title)) await setLists({ groupTitles: [...lists.groupTitles, title] })
    // El grupo se busca por su nombre, no por un id guardado: un id se pierde al recargar la extensión (o al reiniciar
    // Chrome). Primero en la ventana de la pestaña; si está en OTRA ventana, la pestaña se muda a ésa: antes se
    // armaba un segundo grupo con el mismo nombre.
    let [group] = await chrome.tabGroups.query({ title, windowId: tab.windowId })
    if (!group && allowMove) {
      const [elsewhere] = await chrome.tabGroups.query({ title })
      if (elsewhere) {
        await chrome.tabs.move(tab.id, { windowId: elsewhere.windowId, index: -1 })
        group = elsewhere
      }
    }
    if (group && tab.groupId === group.id) {
      if (color && group.color !== color) await chrome.tabGroups.update(group.id, { color })
      return
    }
    const groupId = await chrome.tabs.group(group ? { tabIds: [tab.id], groupId: group.id } : { tabIds: [tab.id], createProperties: { windowId: tab.windowId } })
    if (!group) await chrome.tabGroups.update(groupId, { title, color: color || 'purple' })
    else if (color && group.color !== color) await chrome.tabGroups.update(groupId, { color })
  } catch {
    /* sin grupo la pestaña funciona igual */
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

// ── la pestaña Jarvis (control.html) ──

async function statusPayload() {
  await loaded
  return { type: 'status', status, shared: lists.shared, opened: lists.opened }
}

async function broadcastStatus() {
  chrome.runtime.sendMessage(await statusPayload()).catch(() => { /* la pestaña Jarvis está cerrada */ })
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

// El ícono abre el panel lateral (side-panel.html: los grupos abiertos y sus pestañas). La pestaña Jarvis ya no se abre
// sola (2026-11-20, decisión de Miguel: lo de ver está en Cockpit).
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

chrome.alarms.create('navegador-keepalive', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'navegador-keepalive') connect() })
// Chrome arrancó: los ids de pestaña empiezan de nuevo, así que las listas de antes ya no nombran nada nuestro.
chrome.runtime.onStartup.addListener(async () => {
  await loaded
  await setLists({ shared: [], opened: [] })
  connect()
})
chrome.runtime.onInstalled.addListener(connect)
connect()
