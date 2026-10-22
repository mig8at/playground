/* EL ESTADO DE CHAT — las conversaciones, quién está, los agentes del equipo y si estás escuchando.
 *
 * Lo que llega lo tiene `playground listen` (en memoria, los últimos cien) y lo que se manda sale por el
 * CLI: la API en Go sólo los acerca. Lo que el CLI NO guarda es el historial, y eso lo pone esta app: cada
 * conversación vive en el navegador (`localStorage`, `chat:conversations:v1`), así que sobrevive a una
 * recarga y a un `listen` reiniciado, y no sale de esta máquina. Borrar el almacenamiento del sitio la borra.
 *
 * Cada mensaje trae el id que le puso el home (`sid`), y una respuesta trae `re`: el id del que contesta.
 * Con eso se cita el mensaje original y se contesta a uno en particular (`--re` del CLI).
 *
 * Hay tres clases de conversación:
 *   - con una persona (su correo es la clave);
 *   - con un agente del equipo (`agent:<correo del dueño>/<agente>`): las preguntas salen con `playground ask`
 *     y la respuesta vuelve ahí mismo, o después, como mensaje con `re` = la pregunta;
 *   - y lo que alguien le pregunta a TUS agentes, que se anota en la conversación con esa persona, aparte de
 *     sus mensajes (`kind: 'asked'`): tu listen ya le contestó, acá sólo se ve que preguntó.
 *
 * ⚠ El texto de un mensaje lo escribió otra persona: se guarda y se pinta como texto, nunca se interpreta.
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'chat:conversations:v1'
const POLL_STATE_MS = 2500
const POLL_ONLINE_MS = 15000

const keyOf = (email) => String(email || '').trim().toLowerCase()
// Lo recibido antes de que el home pusiera ids se reconocía por hora + quién + texto: se sigue mirando, para
// no duplicar lo que ya está en el historial.
const legacyId = (m) => `${m.time}|${keyOf(m.from?.email)}|${m.text}`
export const agentKey = (owner, agent) => `agent:${keyOf(owner)}/${agent}`
const isAgentKey = (key) => String(key).startsWith('agent:')
const firstName = (p) => String(p?.name || p?.email || '').split(/\s+/)[0]

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
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const useChatStore = defineStore('chat', () => {
  // clave → { person: {email, name, github, agent?, owner?, agentName?, detail?}, messages: [...], readAt }
  // mensaje: { id, sid?, re?, dir: 'in'|'out', kind?: 'asked', agent?, text, time, status?, error? }
  const conversations = ref(readStored())
  const activeKey = ref('')
  const state = ref(null)        // la última respuesta de /api/state
  const stateError = ref('')
  const online = ref([])
  const onlineError = ref('')
  const listenBusy = ref(false)
  const listenError = ref('')
  // Los agentes del equipo (`playground agents`): [{ email, name, github, agents: [{ name, description }] }].
  const teamAgents = ref([])
  const teamAgentsError = ref('')

  watch(conversations, (value) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* sin almacenamiento: vive mientras la pestaña */ }
  }, { deep: true })

  const me = computed(() => state.value?.me || null)
  const meKey = computed(() => keyOf(me.value?.email))
  const onlineKeys = computed(() => new Set(online.value.map((p) => keyOf(p.email))))

  function ensure(person) {
    const key = isAgentKey(person.email) ? person.email : keyOf(person.email)
    if (!conversations.value[key]) conversations.value[key] = { person: { ...person, email: key }, messages: [], readAt: '' }
    else if (person.name) conversations.value[key].person = { ...conversations.value[key].person, ...person, email: key }
    return conversations.value[key]
  }

  // Lo no leído: lo que llegó después de la última vez que se miró. Que alguien le pregunte a tu agente no
  // cuenta: tu listen ya le contestó.
  const summarize = (c) => {
    const visible = c.messages
    const last = visible.at(-1) || null
    const unread = visible.filter((m) => m.dir === 'in' && m.kind !== 'asked' && m.time > (c.readAt || '')).length
    return { ...c, last, unread, online: onlineKeys.value.has(c.person.email) }
  }
  // Las conversaciones con personas (los agentes van en su propia sección).
  const list = computed(() => Object.values(conversations.value)
    .filter((c) => !isAgentKey(c.person.email))
    .map(summarize)
    .sort((a, b) => (b.last?.time || '').localeCompare(a.last?.time || '')))

  // Los agentes del equipo, uno por fila, con su conversación si ya hubo una. Los tuyos primero.
  const agentList = computed(() => {
    const rows = []
    for (const p of teamAgents.value) {
      for (const a of p.agents || []) {
        const key = agentKey(p.email, a.name)
        const c = conversations.value[key]
        rows.push({ key, agentName: a.name, description: a.description, owner: p, mine: keyOf(p.email) === meKey.value,
                    ...(c ? summarize(c) : { last: null, unread: 0 }) })
      }
    }
    return rows.sort((x, y) => Number(y.mine) - Number(x.mine) || firstName(x.owner).localeCompare(firstName(y.owner)))
  })
  const active = computed(() => conversations.value[activeKey.value] || null)
  const unreadTotal = computed(() => list.value.reduce((n, c) => n + c.unread, 0) + agentList.value.reduce((n, a) => n + a.unread, 0))

  // Un mensaje por su id del home, en cualquier conversación: para citar el que se contesta.
  function findBySid(sid) {
    if (!sid) return null
    for (const c of Object.values(conversations.value)) {
      const m = c.messages.find((x) => x.sid === sid)
      if (m) return { message: m, conversation: c }
    }
    return null
  }

  function push(c, message) {
    if (c.messages.some((x) => x.id === message.id || (message.sid && x.sid === message.sid))) return false
    c.messages.push(message)
    c.messages.sort((a, b) => a.time.localeCompare(b.time))
    return true
  }

  /* Lo que tiene el listen, repartido en su conversación:
     - recibido con agente y sin `re`: alguien le preguntó a uno de tus agentes → su conversación, aparte;
     - recibido con agente y con `re`: la respuesta tardía del agente de otro → la conversación con ese agente;
     - mandado desde la terminal (`dir: out`): con agente, la pregunta que quedó esperando; si no, un mensaje. */
  function absorb(messages) {
    for (const m of messages || []) {
      if (!m?.time) continue
      const sid = m.id || ''
      if (m.dir === 'out') {
        if (!m.to) continue
        if (m.agent) {
          const c = ensure({ email: agentKey(m.to, m.agent), name: m.agent, agent: true, owner: { email: keyOf(m.to) }, agentName: m.agent })
          // La que mandó esta app puede llegar acá antes de que su pedido vuelva con el id: es la misma.
          const own = c.messages.find((x) => x.dir === 'out' && !x.sid && x.status === 'sending' && x.text === m.text)
          if (own) { own.sid = sid; continue }
          push(c, { id: `cli|${sid}`, sid, dir: 'out', text: String(m.text ?? ''), time: m.time, status: 'pending' })
        } else {
          const c = ensure({ email: m.to, name: m.to.split('@')[0] })
          push(c, { id: `cli|${sid}`, sid, re: m.re || '', dir: 'out', text: String(m.text ?? ''), time: m.time, status: 'sent' })
        }
        continue
      }
      if (!m.from?.email) continue
      if (m.agent && m.re) {
        const c = ensure({ email: agentKey(m.from.email, m.agent), name: m.agent, agent: true, owner: m.from, agentName: m.agent })
        if (push(c, { id: sid || legacyId(m), sid, re: m.re, dir: 'in', text: String(m.text ?? ''), time: m.time })) {
          const asked = c.messages.find((x) => x.sid === m.re)
          if (asked) asked.status = 'answered'
        }
        continue
      }
      const c = ensure(m.from)
      // Lo que se guardó antes de los ids: se le pone el suyo y, si era una pregunta a tu agente, se marca así.
      const legacy = c.messages.find((x) => x.id === legacyId(m))
      if (legacy) {
        if (sid && !legacy.sid) legacy.sid = sid
        if (m.agent && !legacy.kind) Object.assign(legacy, { kind: 'asked', agent: m.agent })
        continue
      }
      push(c, { id: sid || legacyId(m), sid, re: m.re || '', dir: 'in', text: String(m.text ?? ''), time: m.time,
                ...(m.agent ? { kind: 'asked', agent: m.agent } : {}) })
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

  async function loadTeamAgents() {
    if (!state.value?.installed) return
    try {
      teamAgents.value = (await api('/api/team-agents')).people || []
      teamAgentsError.value = ''
    } catch (e) { teamAgentsError.value = e.message }
  }

  function openAgent(row) {
    open({ email: row.key, name: row.agentName, agent: true, owner: row.owner, agentName: row.agentName, detail: row.description })
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
    try { await post('/api/listen', {}); await loadState() }
    catch (e) { listenError.value = e.message }
    finally { listenBusy.value = false }
  }

  function open(person) {
    const c = ensure(person)
    activeKey.value = c.person.email
    markActiveRead()
  }

  // `re`: el id del home del mensaje que se contesta (sólo en conversaciones con personas).
  async function send(text, re = '') {
    const c = active.value
    const body = String(text || '').trim()
    if (!c || !body) return
    const message = { id: `out|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, dir: 'out', text: body,
                      time: new Date().toISOString(), status: 'sending', ...(re && !c.person.agent ? { re } : {}) }
    c.messages.push(message)
    const stored = () => c.messages.find((m) => m.id === message.id)
    if (c.person.agent) return askAgent(c, body, stored)
    try {
      const r = await post('/api/send', { to: c.person.email, text: body, re: message.re || '' })
      Object.assign(stored(), { status: 'sent', delivered: r.delivered, sid: r.id || '' })
    } catch (e) {
      Object.assign(stored(), { status: 'error', error: e.message })
    }
  }

  /* Una pregunta a un agente del equipo sale con `playground ask`. Si contesta a tiempo, la respuesta entra
     como mensaje recibido; si no, la pregunta queda «esperando» con su id y la respuesta llega después. */
  async function askAgent(c, text, stored) {
    try {
      const r = await post('/api/ask', { to: c.person.owner?.email, agent: c.person.agentName, text })
      if (r.pending) { Object.assign(stored(), { status: 'pending', sid: r.id }); return }
      Object.assign(stored(), { status: 'answered', sid: r.id })
      push(c, { id: `answer|${r.id}`, re: r.id, dir: 'in', text: r.answer, time: new Date().toISOString() })
      markActiveRead()
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
    await send(failed.text, failed.re || '')
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
      if (document.visibilityState === 'visible') await Promise.all([loadOnline(), loadTeamAgents()])
      onlineTimer = setTimeout(tickOnline, POLL_ONLINE_MS)
    }
    loadState().then(() => Promise.all([loadOnline(), loadTeamAgents()]))
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
    teamAgents, teamAgentsError,
    me, meKey, list, active, unreadTotal, onlineKeys, agentList,
    loadState, loadOnline, loadTeamAgents, startListening, open, openAgent, send, retry, forget, findBySid, start, stop,
  }
})
