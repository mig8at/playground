/* EL ESTADO DE CHAT — las conversaciones, quién está y si estás escuchando.
 *
 * Lo que llega lo tiene `playground listen` (en memoria, los últimos cien) y lo que se manda sale por el
 * CLI: la API en Go sólo los acerca. Lo que el CLI NO guarda es el historial, y eso lo pone esta app: cada
 * conversación vive en el navegador (`localStorage`, `chat:conversations:v1`), así que sobrevive a una
 * recarga y a un `listen` reiniciado, y no sale de esta máquina. Borrar el almacenamiento del sitio la borra.
 *
 * Un mensaje recibido se reconoce por hora + quién + texto: el listener no da ids, y así lo que ya está en
 * el historial no se duplica cada vez que se le pregunta.
 *
 * ⚠ El texto de un mensaje lo escribió otra persona: se guarda y se pinta como texto, nunca se interpreta.
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'chat:conversations:v1'
const POLL_STATE_MS = 2500
const POLL_ONLINE_MS = 15000

const keyOf = (email) => String(email || '').trim().toLowerCase()
const receivedId = (m) => `${m.time}|${keyOf(m.from?.email)}|${m.text}`

function readStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

export const useChatStore = defineStore('chat', () => {
  // email → { person: {email, name, github}, messages: [{id, dir, text, time, status?, error?}], readAt }
  const conversations = ref(readStored())
  const activeKey = ref('')
  const state = ref(null)        // la última respuesta de /api/state
  const stateError = ref('')
  const online = ref([])
  const onlineError = ref('')
  const listenBusy = ref(false)
  const listenError = ref('')

  watch(conversations, (value) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* sin almacenamiento: vive mientras la pestaña */ }
  }, { deep: true })

  const me = computed(() => state.value?.me || null)
  const meKey = computed(() => keyOf(me.value?.email))
  const onlineKeys = computed(() => new Set(online.value.map((p) => keyOf(p.email))))

  function ensure(person) {
    const key = keyOf(person.email)
    if (!conversations.value[key]) conversations.value[key] = { person: { ...person, email: key }, messages: [], readAt: '' }
    else if (person.name) conversations.value[key].person = { ...conversations.value[key].person, ...person, email: key }
    return conversations.value[key]
  }

  // Las conversaciones, la de actividad más reciente primero.
  const list = computed(() => Object.values(conversations.value)
    .map((c) => {
      const last = c.messages.at(-1) || null
      const unread = c.messages.filter((m) => m.dir === 'in' && m.time > (c.readAt || '')).length
      return { ...c, last, unread, online: onlineKeys.value.has(c.person.email) }
    })
    .sort((a, b) => (b.last?.time || '').localeCompare(a.last?.time || '')))

  const active = computed(() => conversations.value[activeKey.value] || null)
  const unreadTotal = computed(() => list.value.reduce((n, c) => n + c.unread, 0))

  function absorb(messages) {
    for (const m of messages || []) {
      if (!m?.from?.email || !m.time) continue
      const c = ensure(m.from)
      const id = receivedId(m)
      if (c.messages.some((x) => x.id === id)) continue
      c.messages.push({ id, dir: 'in', text: String(m.text ?? ''), time: m.time })
      c.messages.sort((a, b) => a.time.localeCompare(b.time))
    }
    markActiveRead()
  }

  // La conversación abierta se da por leída sólo si la pestaña está a la vista.
  function markActiveRead() {
    const c = active.value
    if (!c || document.visibilityState !== 'visible') return
    const latest = c.messages.at(-1)?.time || ''
    if (latest > (c.readAt || '')) c.readAt = latest
  }

  async function loadState() {
    try {
      state.value = await api('/api/state')
      stateError.value = ''
      absorb(state.value.messages)
    } catch (e) { stateError.value = `no pude hablar con la API de chat: ${e.message}` }
  }

  async function loadOnline() {
    if (!state.value?.installed) return
    try {
      online.value = (await api('/api/online')).online || []
      onlineError.value = ''
      for (const p of online.value) if (conversations.value[keyOf(p.email)]) ensure(p)
    } catch (e) { onlineError.value = e.message }
  }

  async function startListening() {
    listenBusy.value = true; listenError.value = ''
    try { await api('/api/listen', { method: 'POST' }); await loadState() }
    catch (e) { listenError.value = e.message }
    finally { listenBusy.value = false }
  }

  function open(person) {
    const c = ensure(person)
    activeKey.value = c.person.email
    markActiveRead()
  }

  async function send(text) {
    const c = active.value
    const body = String(text || '').trim()
    if (!c || !body) return
    const message = { id: `out|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, dir: 'out', text: body,
                      time: new Date().toISOString(), status: 'sending' }
    c.messages.push(message)
    const stored = () => c.messages.find((m) => m.id === message.id)
    try {
      const r = await api('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' },
                                         body: JSON.stringify({ to: c.person.email, text: body }) })
      Object.assign(stored(), { status: 'sent', delivered: r.delivered })
    } catch (e) {
      Object.assign(stored(), { status: 'error', error: e.message })
    }
  }

  // Reintentar es mandar el mismo texto de nuevo: el que falló se va, para no dejar dos.
  async function retry(id) {
    const c = active.value
    const failed = c?.messages.find((m) => m.id === id)
    if (!failed) return
    c.messages.splice(c.messages.indexOf(failed), 1)
    await send(failed.text)
  }

  function forget(key) {
    delete conversations.value[key]
    if (activeKey.value === key) activeKey.value = ''
  }

  let stateTimer = null
  let onlineTimer = null
  function start() {
    const tickState = async () => {
      if (document.visibilityState === 'visible') await loadState()
      stateTimer = setTimeout(tickState, POLL_STATE_MS)
    }
    const tickOnline = async () => {
      if (document.visibilityState === 'visible') await loadOnline()
      onlineTimer = setTimeout(tickOnline, POLL_ONLINE_MS)
    }
    loadState().then(loadOnline)
    stateTimer = setTimeout(tickState, POLL_STATE_MS)
    onlineTimer = setTimeout(tickOnline, POLL_ONLINE_MS)
    document.addEventListener('visibilitychange', markActiveRead)
  }
  function stop() {
    clearTimeout(stateTimer); clearTimeout(onlineTimer)
    document.removeEventListener('visibilitychange', markActiveRead)
  }

  return {
    conversations, activeKey, state, stateError, online, onlineError, listenBusy, listenError,
    me, meKey, list, active, unreadTotal, onlineKeys,
    loadState, loadOnline, startListening, open, send, retry, forget, start, stop,
  }
})
