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
 * Hay cinco clases de conversación:
 *   - con una persona (su correo es la clave);
 *   - con cuadrilla (`agent:cuadrilla`), el tablero del equipo: arriba tus tareas, y en el hilo lo que los demás
 *     anotan en ellas y los bloqueos que dependen de vos. Lo que escribís va como nota en la tarea que elijas
 *     (`playground cuadrilla note|block|unblock|edit`);
 *   - con canon (`agent:canon`), la herramienta del equipo: siempre está, no depende del listen de nadie, y
 *     cada pregunta va sola (`playground canon ask`), sin las anteriores;
 *   - con un agente del equipo (`agent:<correo del dueño>/<agente>`): las preguntas salen con `playground ask`
 *     y la respuesta vuelve ahí mismo, o después, como mensaje con `re` = la pregunta;
 *   - y lo que alguien le pregunta a TUS agentes, que se anota en la conversación con esa persona, aparte de
 *     sus mensajes (`kind: 'asked'`): tu listen ya le contestó, acá sólo se ve que preguntó.
 *
 * Lo que publica un agente al que estás anotado (`playground subscribe`, `kind: 'publish'`) entra en la conversación
 * con ese agente, aunque su dueño ya no esté conectado. Lo que llegó por el buzón del home, porque no estabas cuando lo
 * mandaron, se marca `queued`.
 *
 * ⚠ El texto de un mensaje lo escribió otra persona: se guarda y se pinta como texto, nunca se interpreta.
 */
import { defineStore } from 'pinia'
import { useMyAgentStore } from './myAgent.js'
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
// Canon: el conocimiento del equipo sobre cómo funciona CreditOp. Es una herramienta, no el agente de alguien.
export const CANON = { key: 'agent:canon', agentName: 'canon', description: 'el conocimiento del equipo sobre cómo funciona CreditOp' }
// Cuadrilla: las épicas y tareas del equipo. También es una herramienta.
export const CUADRILLA = { key: 'agent:cuadrilla', agentName: 'cuadrilla', description: 'tus tareas y lo que anotan en ellas' }
const CUADRILLA_SEEN_KEY = 'chat:cuadrilla:vistas:v1'
const POLL_CUADRILLA_MS = 60_000
// Una nota, por su tarea, su fecha y quién la escribió: con eso se sabe si ya se mostró.
const noteKey = (task, n) => `${task.codigo || task.id}|${n.fecha}|${n.autor}|${n.tipo}`
const sameLogin = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()
function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(CUADRILLA_SEEN_KEY) || 'null')
    return v && Array.isArray(v.keys) ? v : { baseline: false, keys: [] }
  } catch { return { baseline: false, keys: [] } }
}

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
  // Entrar desde el chat: `playground login` abre el navegador; al volver con sesión, se prende el listen solo.
  const loginBusy = ref(false)
  const loginError = ref('')
  let listenAfterLogin = false
  // Los agentes del equipo (`playground agents`): [{ email, name, github, agents: [{ name, description }] }].
  const teamAgents = ref([])
  const teamAgentsError = ref('')
  // Cuadrilla: el tablero ({ me, url, epicas }) y qué notas ya se mostraron.
  const cuadrilla = ref(null)
  const cuadrillaError = ref('')
  const cuadrillaSeen = readSeen()
  // Tu agente (`myAgent.js`): con él prendido, a lo que te llega le arma una propuesta de respuesta.
  const mine = useMyAgentStore()

  watch(conversations, (value) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* sin almacenamiento: vive mientras la pestaña */ }
  }, { deep: true })

  const me = computed(() => state.value?.me || null)
  // Quién sos: del listen si está prendido, si no de la sesión. Tu propia conversación no se lista: «Mi chat» sos vos.
  const meKey = computed(() => keyOf(me.value?.email || state.value?.session?.email))
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
    // Una propuesta de tu agente no salió: no es el último mensaje de la conversación.
    const visible = c.messages.filter((m) => m.kind !== 'propuesta')
    const last = visible.at(-1) || null
    const unread = visible.filter((m) => m.dir === 'in' && m.kind !== 'asked' && m.time > (c.readAt || '')).length
    return { ...c, last, unread, online: onlineKeys.value.has(c.person.email) }
  }
  // Las conversaciones con personas (los agentes van en su propia sección).
  const list = computed(() => Object.values(conversations.value)
    .filter((c) => !isAgentKey(c.person.email) && c.person.email !== meKey.value)
    .map(summarize)
    .sort((a, b) => (b.last?.time || '').localeCompare(a.last?.time || '')))

  // Los agentes del equipo, uno por fila, con su conversación si ya hubo una: canon primero, después los tuyos.
  const agentList = computed(() => {
    const rows = []
    if (state.value?.installed) {
      for (const tool of [CANON, CUADRILLA]) {
        const c = conversations.value[tool.key]
        rows.push({ ...tool, tool: true, owner: null, mine: false, ...(c ? summarize(c) : { last: null, unread: 0 }) })
      }
    }
    for (const p of teamAgents.value) {
      for (const a of p.agents || []) {
        const key = agentKey(p.email, a.name)
        const c = conversations.value[key]
        rows.push({ key, agentName: a.name, description: a.description, owner: p, mine: keyOf(p.email) === meKey.value,
                    ...(c ? summarize(c) : { last: null, unread: 0 }) })
      }
    }
    // Las conversaciones con agentes cuyo dueño no está conectado (lo que publicaron sigue acá), al final.
    for (const c of Object.values(conversations.value)) {
      const key = c.person.email
      if (!isAgentKey(key) || key === CANON.key || key === CUADRILLA.key || !c.person.owner?.email || rows.some((r) => r.key === key)) continue
      rows.push({ key, agentName: c.person.agentName || c.person.name, description: c.person.detail || '', owner: c.person.owner,
                  mine: keyOf(c.person.owner.email) === meKey.value, offline: true, ...summarize(c) })
    }
    const rank = (r) => (r.tool ? 0 : r.offline ? 3 : r.mine ? 1 : 2)
    return rows.sort((x, y) => rank(x) - rank(y) || firstName(x.owner).localeCompare(firstName(y.owner)))
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
      if (m.kind === 'publish' && m.agent) {
        const c = ensure({ email: agentKey(m.from.email, m.agent), name: m.agent, agent: true, owner: m.from, agentName: m.agent })
        push(c, { id: sid || legacyId(m), sid, dir: 'in', kind: 'publish', agent: m.agent, text: String(m.text ?? ''), time: m.time,
                  ...(m.queued ? { queued: true } : {}) })
        continue
      }
      if (m.agent && m.re) {
        const c = ensure({ email: agentKey(m.from.email, m.agent), name: m.agent, agent: true, owner: m.from, agentName: m.agent })
        if (push(c, { id: sid || legacyId(m), sid, re: m.re, dir: 'in', text: String(m.text ?? ''), time: m.time, ...(m.queued ? { queued: true } : {}) })) {
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
                ...(m.agent ? { kind: 'asked', agent: m.agent } : {}), ...(m.queued ? { queued: true } : {}) })
    }
    markActiveRead()
    proposeReplies()
  }

  /* LAS PROPUESTAS DE TU AGENTE. Con el agente prendido, cada mensaje de una persona que llegó DESPUÉS de prenderlo
     recibe una propuesta de respuesta en su conversación (`kind: 'propuesta'`), justo debajo. No sale sola: «Mandar»
     la manda a tu nombre, como respuesta a ese mensaje, y «Descartar» la tira. */
  // Tu nombre, para que el agente diga de quién es: del listen si está prendido, si no de la sesión.
  const ownerName = () => me.value?.name || state.value?.session?.name || me.value?.email || state.value?.session?.email || ''
  function proposeReplies() {
    const a = mine.agent
    if (a.mode !== 'agente' || !a.modeSince) return
    // Con tu nombre y tus tareas, o no se arma: una propuesta sin eso diría «mi persona» y nada de lo que hacés.
    if (!state.value || (!cuadrilla.value && !cuadrillaError.value)) return
    for (const c of Object.values(conversations.value)) {
      if (isAgentKey(c.person.email)) continue
      for (const m of [...c.messages]) {
        if (m.dir !== 'in' || m.kind || m.time <= a.modeSince) continue
        if (c.messages.some((x) => x.kind === 'propuesta' && x.replyTo === m.id)) continue
        const time = new Date(new Date(m.time).getTime() + 1).toISOString()
        push(c, { id: `propuesta|${m.id}`, dir: 'out', kind: 'propuesta', replyTo: m.id, re: m.sid || '', time, status: 'propuesta',
                  text: mine.draftReply({ from: c.person.name || c.person.email, text: m.text, tasks: myTasks.value, owner: ownerName() }) })
      }
    }
  }
  // Una propuesta se manda o se descarta desde su conversación o desde «Mi chat»: se busca en todas.
  function findProposal(id) {
    for (const c of Object.values(conversations.value)) {
      const p = c.messages.find((m) => m.id === id && m.kind === 'propuesta')
      if (p) return { c, p }
    }
    return null
  }
  async function sendProposal(id) {
    const found = findProposal(id)
    if (!found) return
    found.c.messages.splice(found.c.messages.indexOf(found.p), 1)
    await send(found.p.text, found.p.re, found.c)
  }
  function discardProposal(id) {
    const found = findProposal(id)
    if (found) Object.assign(found.p, { status: 'descartada' })
  }

  /* «MI CHAT»: todo lo que te escriben, de cualquier persona, en un solo hilo, lo más nuevo abajo. Cada mensaje trae
     su conversación, si ya le contestaste y la propuesta de tu agente si la hay. Las preguntas a tus agentes también
     son preguntas a vos. */
  const inbox = computed(() => {
    const out = []
    for (const c of Object.values(conversations.value)) {
      if (isAgentKey(c.person.email) || c.person.email === meKey.value) continue
      const msgs = c.messages
      msgs.forEach((m, i) => {
        if (m.dir !== 'in' || (m.kind && m.kind !== 'asked')) return
        const answered = msgs.slice(i + 1).some((x) => x.dir === 'out' && x.kind !== 'propuesta')
        const proposal = msgs.find((x) => x.kind === 'propuesta' && x.replyTo === m.id) || null
        out.push({ ...m, key: `${c.person.email}|${m.id}`, person: c.person, answered, proposal })
      })
    }
    return out.sort((a, b) => a.time.localeCompare(b.time)).slice(-80)
  })
  watch(() => mine.agent.mode, proposeReplies)

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
      if (listenAfterLogin && state.value.session && !state.value.listening) { listenAfterLogin = false; startListening() }
      if (!state.value.login?.running && loginBusy.value) {
        loginBusy.value = false
        if (state.value.login?.error) loginError.value = state.value.login.error
      }
    } catch (e) { stateError.value = `no pude hablar con la API de chat: ${e.message}` }
  }

  async function login() {
    loginBusy.value = true; loginError.value = ''
    try { await post('/api/login', {}); listenAfterLogin = true; await loadState() }
    catch (e) { loginError.value = e.message; loginBusy.value = false }
  }

  async function loadTeamAgents() {
    if (!state.value?.installed) return
    try {
      teamAgents.value = (await api('/api/team-agents')).people || []
      teamAgentsError.value = ''
    } catch (e) { teamAgentsError.value = e.message }
  }

  function openAgent(row) {
    open({ email: row.key, name: row.agentName, agent: true, owner: row.owner, agentName: row.agentName, detail: row.description,
           ...(row.tool ? { tool: row.agentName } : {}) })
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
    proposeReplies()
  }

  // `re`: el id del home del mensaje que se contesta (sólo en conversaciones con personas).
  async function send(text, re = '', conversation = null) {
    const c = conversation || active.value
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
    if (c.person.tool === 'canon') return askCanon(c, text, stored)
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

  // Canon contesta con la respuesta, un resumen, sus fuentes y una pregunta para seguir: se guarda todo.
  async function askCanon(c, text, stored) {
    try {
      const r = await post('/api/canon', { text })
      Object.assign(stored(), { status: 'answered' })
      push(c, { id: `canon|${Date.now()}`, dir: 'in', text: r.respuesta || 'canon no contestó nada.', time: new Date().toISOString(),
                summary: r.en_una_linea || '', backed: r.respaldada !== false,
                sources: (r.citas || []).map((x) => ({ title: x.titulo, read: x.leer })), next: r.siguiente_pregunta || '' })
      markActiveRead()
    } catch (e) {
      Object.assign(stored(), { status: 'error', error: e.message })
    }
  }

  /* ── CUADRILLA ─────────────────────────────────────────────────────────────────────────────────────
     Tus tareas son las que llevás, y las que creaste sin responsable. Lo nuevo es lo que anotó otra persona en una
     tarea tuya, y cualquier bloqueo que depende de vos: entra al hilo de cuadrilla como mensaje recibido. La primera
     vez no se muestra nada de lo que ya había (sería todo el historial de golpe): se marca como visto. */
  const cuadrillaConversation = () =>
    ensure({ email: CUADRILLA.key, name: CUADRILLA.agentName, agent: true, owner: null, agentName: CUADRILLA.agentName,
             detail: CUADRILLA.description, tool: 'cuadrilla' })
  const myTasks = computed(() => {
    const b = cuadrilla.value
    if (!b?.me) return []
    const out = []
    for (const e of b.epicas || []) {
      for (const t of e.tareas || []) {
        if (!sameLogin(t.responsable, b.me) && !(sameLogin(t.creada_por, b.me) && !t.responsable)) continue
        const notes = t.notas || []
        let block = null
        for (const n of notes) { if (n.tipo === 'bloqueo') block = n; else if (n.tipo === 'desbloqueo') block = null }
        out.push({ ...t, epica: { id: e.id, codigo: e.codigo, nombre: e.nombre }, bloqueo: block, ultima: notes.at(-1) || null })
      }
    }
    // Bloqueadas primero, después en curso y al final las hechas.
    const rank = (t) => (t.bloqueo ? 0 : t.hecha ? 2 : 1)
    return out.sort((a, b2) => rank(a) - rank(b2) || (b2.ultima?.fecha || b2.creada || '').localeCompare(a.ultima?.fecha || a.creada || ''))
  })
  const taskUrl = (t) => (cuadrilla.value?.url && t ? `${cuadrilla.value.url}/e/${t.epica?.codigo || t.epica?.id}/t/${t.codigo || t.id}` : '')

  function absorbCuadrilla(board) {
    const seen = new Set(cuadrillaSeen.keys)
    const fresh = []
    for (const e of board.epicas || []) {
      for (const t of e.tareas || []) {
        const mine = sameLogin(t.responsable, board.me) || sameLogin(t.creada_por, board.me)
        for (const n of t.notas || []) {
          if (sameLogin(n.autor, board.me)) continue
          if (!mine && !(n.tipo === 'bloqueo' && sameLogin(n.depende_de, board.me))) continue
          const key = noteKey(t, n)
          if (seen.has(key)) continue
          seen.add(key)
          fresh.push({ key, n, t, e })
        }
      }
    }
    if (cuadrillaSeen.baseline && fresh.length) {
      const c = cuadrillaConversation()
      for (const { key, n, t, e } of fresh) {
        push(c, { id: `cuadrilla|${key}`, dir: 'in', text: n.texto || (n.tipo === 'desbloqueo' ? 'lo destrabó' : ''), time: n.fecha,
                  cuadrilla: { autor: n.autor, tipo: n.tipo, dependeDe: n.depende_de || '', tarea: t.titulo, tareaCodigo: t.codigo || t.id,
                               epica: e.nombre, epicaCodigo: e.codigo || e.id } })
      }
      markActiveRead()
    }
    cuadrillaSeen.baseline = true
    cuadrillaSeen.keys = [...seen].slice(-3000)
    try { localStorage.setItem(CUADRILLA_SEEN_KEY, JSON.stringify(cuadrillaSeen)) } catch { /* vale mientras la pestaña */ }
  }

  async function loadCuadrilla() {
    if (!state.value?.installed || !state.value?.session) return
    try {
      const board = await api('/api/cuadrilla')
      cuadrilla.value = board
      cuadrillaError.value = ''
      absorbCuadrilla(board)
    } catch (e) { cuadrillaError.value = e.message }
    proposeReplies()
  }

  /* Escribir en una tarea: `kind` es avance, bloqueo (con `owner`, de quién depende) o desbloqueo. Lo escrito queda
     en el hilo como mensaje mandado, con la tarea a la que fue. */
  async function noteTask(task, kind, text, owner = '') {
    const c = cuadrillaConversation()
    const message = { id: `out|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, dir: 'out', time: new Date().toISOString(),
                      text: String(text || '').trim() || (kind === 'desbloqueo' ? 'lo destrabé' : ''), status: 'sending',
                      cuadrilla: { autor: cuadrilla.value?.me || '', tipo: kind, dependeDe: owner, tarea: task.titulo,
                                   tareaCodigo: task.codigo || task.id, epica: task.epica?.nombre, epicaCodigo: task.epica?.codigo } }
    c.messages.push(message)
    const stored = () => c.messages.find((m) => m.id === message.id)
    try {
      await post('/api/cuadrilla/note', { task: task.codigo || task.id, kind, text: String(text || '').trim(), owner })
      Object.assign(stored(), { status: 'sent' })
      await loadCuadrilla()
    } catch (e) { Object.assign(stored(), { status: 'error', error: e.message }) }
  }

  async function doneTask(task) {
    const c = cuadrillaConversation()
    const message = { id: `out|${Date.now()}|done`, dir: 'out', time: new Date().toISOString(), text: 'la marqué hecha', status: 'sending',
                      cuadrilla: { autor: cuadrilla.value?.me || '', tipo: 'hecha', tarea: task.titulo, tareaCodigo: task.codigo || task.id,
                                   epica: task.epica?.nombre, epicaCodigo: task.epica?.codigo } }
    c.messages.push(message)
    const stored = () => c.messages.find((m) => m.id === message.id)
    try {
      await post('/api/cuadrilla/done', { task: task.codigo || task.id })
      Object.assign(stored(), { status: 'sent' })
      await loadCuadrilla()
    } catch (e) { Object.assign(stored(), { status: 'error', error: e.message }) }
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
  let cuadrillaTimer = null
  function start() {
    const tickCuadrilla = async () => {
      if (document.visibilityState === 'visible') await loadCuadrilla()
      cuadrillaTimer = setTimeout(tickCuadrilla, POLL_CUADRILLA_MS)
    }
    const tickState = async () => {
      if (document.visibilityState === 'visible') await loadState()
      stateTimer = setTimeout(tickState, POLL_STATE_MS)
    }
    const tickOnline = async () => {
      if (document.visibilityState === 'visible') await Promise.all([loadOnline(), loadTeamAgents()])
      onlineTimer = setTimeout(tickOnline, POLL_ONLINE_MS)
    }
    loadState().then(() => Promise.all([loadOnline(), loadTeamAgents(), loadCuadrilla()])).then(proposeReplies)
    cuadrillaTimer = setTimeout(tickCuadrilla, POLL_CUADRILLA_MS)
    stateTimer = setTimeout(tickState, POLL_STATE_MS)
    onlineTimer = setTimeout(tickOnline, POLL_ONLINE_MS)
    document.addEventListener('visibilitychange', markActiveRead)
  }
  function stop() {
    clearTimeout(stateTimer); clearTimeout(onlineTimer); clearTimeout(cuadrillaTimer)
    document.removeEventListener('visibilitychange', markActiveRead)
  }

  return {
    conversations, activeKey, state, stateError, online, onlineError, listenBusy, listenError, loginBusy, loginError, login,
    teamAgents, teamAgentsError, cuadrilla, cuadrillaError, myTasks, taskUrl, loadCuadrilla, noteTask, doneTask,
    proposeReplies, sendProposal, discardProposal, ownerName, inbox,
    me, meKey, list, active, unreadTotal, onlineKeys, agentList,
    loadState, loadOnline, loadTeamAgents, startListening, open, openAgent, send, retry, forget, findBySid, start, stop,
  }
})
