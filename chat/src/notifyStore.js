/* LOS AVISOS: la configuración vive en el servidor del chat (server/notify.go), no en el navegador, porque es él quien
   avisa también con la pestaña cerrada. Acá se lee, se cambia y se le cuenta qué estás mirando, para que no te
   avise de la conversación que tenés al frente. */
import { reactive } from 'vue'

export const notify = reactive({
  settings: null,
  // Por dónde sale un aviso ahora: `tab` (esta pestaña, con permiso) o `mac` (osascript o terminal-notifier).
  status: { via: 'mac', macTool: 'osascript', tabs: 0, tabsWithPermission: 0 },
  error: '',
})

const LEGACY_KEY = 'chat.group-notify' // lo de antes: sólo menciones por grupo, guardado en este navegador

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}

export async function loadNotify() {
  try {
    const d = await call('GET', '/api/notify/settings')
    notify.settings = d.settings
    notify.status = d.status || notify.status
    notify.error = ''
    await migrateLegacy()
  } catch (e) { notify.error = e.message }
}

export async function saveNotify(patch) {
  const next = { ...notify.settings, ...patch }
  notify.settings = next // se ve enseguida; si el servidor no lo guarda, vuelve lo que tiene
  try {
    const d = await call('PUT', '/api/notify/settings', next)
    notify.settings = d.settings
    notify.status = d.status || notify.status
    notify.error = ''
  } catch (e) { notify.error = e.message; await loadNotify() }
}

// El ajuste de UNA conversación: `all`, `mentions`, `off`, o '' para que siga el de su tipo.
export function conversationMode(key) { return notify.settings?.conversations?.[key] || '' }
export function setConversationMode(key, mode) {
  const conversations = { ...(notify.settings?.conversations || {}) }
  if (mode) conversations[key] = mode
  else delete conversations[key]
  return saveNotify({ conversations })
}

// Lo que había quedado en el navegador (la campana de antes) pasa al servidor una vez.
async function migrateLegacy() {
  let legacy = null
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null') } catch { /* nada que pasar */ }
  if (!legacy || typeof legacy !== 'object') return
  const conversations = { ...(notify.settings.conversations || {}) }
  for (const [k, v] of Object.entries(legacy)) if (v === 'mentions' && !conversations[k]) conversations[k] = 'mentions'
  try { localStorage.removeItem(LEGACY_KEY) } catch { /* queda */ }
  await saveNotify({ conversations })
}

export async function testNotify(via = '') {
  try { notify.status = await call('POST', `/api/notify/test${via ? `?via=${via}` : ''}`); notify.error = '' } catch (e) { notify.error = e.message }
}

// Qué estás mirando: la conversación abierta y si la pestaña está al frente. Al cerrar, sale con sendBeacon.
let lastView = ''
// El servidor la da por vieja a los 10 minutos: con la pestaña al frente se repite cada minuto (`force`).
export function reportView(key, focused, { beacon = false, force = false } = {}) {
  const body = JSON.stringify({ key: key || '', focused: !!focused })
  if (body === lastView && !beacon && !force) return
  lastView = body
  if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/notify/view', body); return }
  fetch('/api/notify/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
}
