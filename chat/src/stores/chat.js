/* EL ESTADO DE CHAT — las conversaciones, quién está, los agentes del equipo y si estás escuchando.
 *
 * Lo que llega lo tiene `playground listen` (en memoria, los últimos cien) y lo que se manda sale por el
 * CLI. El HISTORIAL lo guarda el servidor del chat en disco (server/history.go): todo lo que pasa por el listen,
 * aunque esta ventana esté cerrada, y las imágenes que llegan, bajadas apenas llegan. Esta app arma las
 * conversaciones con eso, las tiene en el navegador (`localStorage`, `chat:conversations:v1`) para arrancar rápido y
 * le manda al servidor una copia (`/api/conversations`). Si el navegador no tiene nada (otro navegador, datos
 * borrados, el almacenamiento lleno), arranca de esa copia. Nada sale de esta máquina.
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
import { isImage } from '../voiceText.js'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'chat:conversations:v1'
const POLL_STATE_MS = 2500
// Con el stream en vivo abierto (/api/events), la consulta queda de respaldo: por si se cortó y no se notó.
const POLL_STATE_LIVE_MS = 20_000
const POLL_ONLINE_MS = 15000

const keyOf = (email) => String(email || '').trim().toLowerCase()
// Lo recibido antes de que el home pusiera ids se reconocía por hora + quién + texto: se sigue mirando, para
// no duplicar lo que ya está en el historial.
const legacyId = (m) => `${m.time}|${keyOf(m.from?.email)}|${m.text}`
export const agentKey = (owner, agent) => `agent:${keyOf(owner)}/${agent}`
const isAgentKey = (key) => String(key).startsWith('agent:')
// Un grupo del chat se guarda por su nombre de canal: `#ecommerce`.
const isGroupKey = (key) => String(key).startsWith('#')
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

// Las conversaciones que borraste: clave → hasta qué mensaje. Lo anterior no vuelve cuando el listen lo reenvía.
const DELETED_KEY = 'chat:borradas:v1'
function readDeleted() {
  try { const v = JSON.parse(localStorage.getItem(DELETED_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')

// Quién sos, recordado: la sesión puede estar vencida (sin nombre) y tus conversaciones de otra cuenta tuya
// siguen ahí. Se guardan tus correos, nombres y GitHub de cuando sí se sabían.
const SELF_KEY = 'chat:yo:v1'
function readSelf() {
  try { const v = JSON.parse(localStorage.getItem(SELF_KEY) || 'null'); return v && Array.isArray(v.emails) ? v : { emails: [], names: [], githubs: [] } } catch { return { emails: [], names: [], githubs: [] } }
}

// El agente `journal` se retiró del CLI: ni sus preguntas ni su conversación se muestran, tampoco las ya guardadas.
const isJournal = (m) => m?.agent === 'journal'
function dropJournal(all) {
  for (const [key, c] of Object.entries(all)) {
    if (/\/journal$/.test(key)) { delete all[key]; continue }
    if (Array.isArray(c?.messages)) c.messages = dropDoubles(c.messages.filter((m) => !isJournal(m)))
  }
  return all
}
/* LOS AGENTES HABLAN EN LA CONVERSACIÓN DE SU DUEÑO: un agente (`@duncan/rambo`) es una identidad de esa persona, no
   alguien aparte. Lo que dijo un agente de Duncan, o lo que le escribiste a uno, va en la conversación con Duncan, cada
   mensaje marcado: `via` (el agente que habló) o `toAgent` (al que le escribiste). Las conversaciones aparte que quedaron
   guardadas de antes (`agent:correo/nombre`) se pasan acá al cargar. Canon y cuadrilla (`agent:canon`…) siguen aparte. */
function mergeAgentConversations(all) {
  for (const [key, c] of Object.entries(all)) {
    const m = /^agent:([^/]+@[^/]+)\/(.+)$/.exec(key)
    if (!m) continue
    const [, owner, name] = m
    const ownerName = c.person?.owner?.name || owner.split('@')[0]
    const dest = all[owner] || (all[owner] = { person: { email: owner, name: ownerName }, messages: [], readAt: c.readAt || '' })
    const have = new Set(dest.messages.map((x) => x.id))
    for (const x of c.messages || []) {
      if (have.has(x.id)) continue
      dest.messages.push(x.dir === 'out' ? { ...x, toAgent: x.toAgent || name } : { ...x, via: x.via || name, author: x.author || { email: owner, name: ownerName } })
    }
    dest.messages.sort((a, b) => String(a.time).localeCompare(String(b.time)))
    if ((c.readAt || '') > (dest.readAt || '')) dest.readAt = c.readAt
    delete all[key]
  }
  return all
}

/* Un mensaje que mandaste, dos veces: el que puso esta app al mandarlo y el que trajo el historial antes de que el
   envío volviera con su id (pasaba con los mensajes a personas). Tienen el mismo `sid`: queda el primero, que es el
   tuyo y trae si se entregó. */
function dropDoubles(messages) {
  const seen = new Set()
  const sent = messages.filter((m) => m?.dir === 'out' && m.sid)
  const sentIds = new Set(sent.map((m) => m.sid))
  return messages.filter((m) => {
    // El recibido de un mensaje a vos mismo (mismo id del home que uno que mandaste): ya está como enviado.
    if (m?.dir === 'in' && sentIds.has(m.sid || m.id)) return false
    if (m?.dir !== 'out' || !m.sid) return true
    if (seen.has(m.sid)) return false
    seen.add(m.sid)
    return true
  })
}

/* LAS IMÁGENES, COMO EN WHATSAPP: una imagen que llega se baja sola para mostrarla (hasta 15 MB, sólo png, jpg, gif y
   webp), al caché del chat y no a Descargas; la que mandás se muestra con una miniatura hecha en el navegador. */
export const IMAGE_AUTO_MAX = 15 * 1024 * 1024
export { isImage }
async function thumbnailOf(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch { return '' }
}

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const useChatStore = defineStore('chat', () => {
  // Lo leído según el servidor (server/reads.go): una conversación que aparece después toma su marca de acá.
  const serverReads = {}
  // clave → { person: {email, name, github, agent?, owner?, agentName?, detail?}, messages: [...], readAt }
  // mensaje: { id, sid?, re?, dir: 'in'|'out', kind?: 'asked', agent?, text, time, status?, error? }
  const conversations = ref(mergeAgentConversations(dropJournal(readStored())))
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
  // Cuadrilla: el tablero ({ me, url, epics }) y qué notas ya se mostraron.
  const cuadrilla = ref(null)
  const cuadrillaError = ref('')
  const cuadrillaSeen = readSeen()
  const deleted = readDeleted()
  const self = ref(readSelf())

  // La copia en el servidor: si el navegador no tiene conversaciones, se arranca de ella. Hasta saberlo no se escribe
  // nada allá, para no pisar la copia buena con un navegador vacío.
  let serverCopyReady = false
  let serverCopyTimer = null
  /* La copia pesa cientos de KB (trae las miniaturas), así que no se sube con cada cambio: se espera a que pasen 20 s
     sin cambios, y no se sube si quedó igual a la última que se mandó. */
  let lastServerCopy = ''
  const saveServerCopy = () => {
    if (!serverCopyReady) return
    clearTimeout(serverCopyTimer)
    serverCopyTimer = setTimeout(() => {
      const body = JSON.stringify(conversations.value)
      if (body === lastServerCopy) return
      fetch('/api/conversations', { method: 'PUT', headers: { 'content-type': 'application/json' }, body })
        .then((r) => { if (r.ok) lastServerCopy = body })
        .catch(() => { /* el próximo cambio lo vuelve a intentar */ })
    }, 20_000)
  }
  async function loadServerCopy() {
    try {
      if (!Object.keys(conversations.value).length) {
        const copy = await api('/api/conversations')
        if (copy && typeof copy === 'object' && !Array.isArray(copy) && Object.keys(copy).length) conversations.value = mergeAgentConversations(dropJournal(copy))
      }
    } catch { /* sin copia: se arma con el historial del servidor */ }
    serverCopyReady = true
    saveServerCopy()
  }

  /* Guardar en el navegador serializa TODAS las conversaciones: con cada mensaje, cada «leído» y cada miniatura eso era
     una escritura de cientos de KB. Los cambios se juntan (un segundo sin cambios) y se escribe una vez; al ocultar o
     cerrar la pestaña se escribe enseguida, para no perder el último. */
  let localCopyTimer = null
  let localCopyFailed = false
  const saveLocalCopy = () => {
    clearTimeout(localCopyTimer); localCopyTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.value))
      localCopyFailed = false
    } catch (e) {
      // sin almacenamiento (o sin cupo: QuotaExceededError): queda la copia del servidor. Se avisa UNA vez por racha de
      // fallos, en la consola: antes se tragaba en silencio y no había cómo saber por qué el navegador «olvidaba».
      if (!localCopyFailed) console.warn('[chat] no se pudo guardar la copia de las conversaciones en este navegador (¿sin cupo en localStorage?); sigue la copia del servidor:', e?.name || e)
      localCopyFailed = true
    }
  }
  const flushLocalCopy = () => { if (localCopyTimer) saveLocalCopy() }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushLocalCopy)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushLocalCopy() })
  }
  watch(conversations, () => {
    clearTimeout(localCopyTimer)
    localCopyTimer = setTimeout(saveLocalCopy, 1000)
    saveServerCopy()
  }, { deep: true })

  const me = computed(() => state.value?.me || null)
  // Quién sos: del listen si está prendido, si no de la sesión. Tu propia conversación no se lista: «Mi chat» sos vos.
  const meKey = computed(() => keyOf(me.value?.email || state.value?.session?.email))
  // «Yo» es toda cuenta con mi nombre o mi GitHub, aunque llegue con otro correo (@creditop.com, personal…): se vinculan
  // a «Mi chat» y no salen como otra persona.
  const remember = (list, v) => { const x = plain(v); if (x && !list.includes(x)) list.push(x) }
  watch([me, () => state.value?.session, () => cuadrilla.value?.me], () => {
    const next = { emails: [...self.value.emails], names: [...self.value.names], githubs: [...self.value.githubs] }
    for (const who of [me.value, state.value?.session]) { remember(next.emails, who?.email); remember(next.names, who?.name) }
    remember(next.githubs, cuadrilla.value?.me)
    if (JSON.stringify(next) === JSON.stringify(self.value)) return
    self.value = next
    try { localStorage.setItem(SELF_KEY, JSON.stringify(next)) } catch { /* vale mientras la pestaña */ }
  }, { immediate: true })
  const isMe = (person) => {
    const key = keyOf(person?.email)
    if (!key || isAgentKey(key)) return false
    if (key === meKey.value || self.value.emails.includes(key)) return true
    if (person.github && self.value.githubs.includes(plain(person.github))) return true
    return !!person.name && self.value.names.includes(plain(person.name))
  }
  const onlineKeys = computed(() => new Set(online.value.map((p) => keyOf(p.email))))

  function ensure(person) {
    const key = isAgentKey(person.email) ? person.email : keyOf(person.email)
    if (!conversations.value[key]) conversations.value[key] = { person: { ...person, email: key }, messages: [], readAt: serverReads[key] || '' }
    else if (person.name) conversations.value[key].person = { ...conversations.value[key].person, ...person, email: key }
    return conversations.value[key]
  }

  // Lo no leído: lo que llegó después de la última vez que se miró. Que alguien le pregunte a tu agente no
  // cuenta: tu listen ya le contestó.
  const summarize = (c) => {
    // Las propuestas del agente de antes nunca salieron: no cuentan.
    const visible = c.messages.filter((m) => m.kind !== 'propuesta')
    const last = visible.at(-1) || null
    const unread = visible.filter((m) => m.dir === 'in' && m.kind !== 'asked' && m.time > (c.readAt || '')).length
    return { ...c, last, unread, online: onlineKeys.value.has(c.person.email) }
  }
  // Las conversaciones con personas (los agentes van en su propia sección).
  const list = computed(() => Object.values(conversations.value)
    .filter((c) => !isAgentKey(c.person.email) && !isGroupKey(c.person.email) && !isMe(c.person))
    .map(summarize)
    .sort((a, b) => (b.last?.time || '').localeCompare(a.last?.time || '')))

  /* Los agentes, uno por fila, con su conversación si ya hubo una: canon y cuadrilla primero, después los tuyos y los
     del equipo. Un agente es una identidad de alguien (`@miguel/luigi`): se le escribe un mensaje, no se le pregunta. */
  const agentList = computed(() => {
    const rows = []
    if (state.value?.installed) {
      for (const tool of [CANON, CUADRILLA]) {
        const c = conversations.value[tool.key]
        rows.push({ ...tool, tool: true, owner: null, mine: false, ...(c ? summarize(c) : { last: null, unread: 0 }) })
      }
    }
    const rank = (r) => (r.tool ? 0 : r.offline ? 3 : r.mine ? 1 : 2)
    return rows.sort((x, y) => rank(x) - rank(y) || firstName(x.owner).localeCompare(firstName(y.owner)))
  })
  // Los agentes de una persona (los que guarda el home): para la bolita de su muñequito y para nombrarlos.
  const agentsOf = (email) => teamAgents.value.find((p) => keyOf(p.email) === keyOf(email))?.agents || []
  const active = computed(() => conversations.value[activeKey.value] || null)
  /* «Mi chat»: lo que te dijeron tus agentes desde la última vez que lo miraste. Desde otra máquina llega recibido y con
     `via`; desde ésta queda como enviado por tu agente (`asAgent`, el recibido se descarta por repetido). Lo tuyo no cuenta. */
  const selfUnread = computed(() => {
    const c = conversations.value[meKey.value]
    return c ? c.messages.filter((m) => (m.via || m.asAgent) && m.time > (c.readAt || '')).length : 0
  })
  let stopReadWatch = null
  const unreadTotal = computed(() => selfUnread.value + list.value.reduce((n, c) => n + c.unread, 0) + agentList.value.reduce((n, a) => n + a.unread, 0)
    + groupList.value.reduce((n, g) => n + g.unread, 0))

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
    if (c.messages.some((x) => x.id === message.id || (message.sid && x.sid === message.sid && x.dir === message.dir))) return false
    /* Lo que te mandaste a vos mismo existe dos veces, enviado y recibido, con el mismo id del home; y el recibido puede
       llegar ANTES que el enviado (así quedan en el historial). Se muestra una vez, el enviado, en cualquier orden. */
    const homeId = message.sid || message.id
    if (message.dir === 'in' && c.messages.some((x) => x.dir === 'out' && x.sid && x.sid === homeId)) return false
    if (message.dir === 'out' && message.sid) c.messages = c.messages.filter((x) => !(x.dir === 'in' && (x.sid || x.id) === message.sid))
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
      if (!m?.time || isJournal(m)) continue
      const cut = deleted[keyOf(m.dir === 'out' ? m.to : m.from?.email)]
      if (cut && m.time <= cut) continue
      const sid = m.id || ''
      if (m.dir === 'out') {
        if (!m.to) continue
        // A un grupo (`#id`): su conversación. A un agente de alguien (`correo/agente`): la conversación con su dueño,
        // marcado para cuál de sus agentes.
        if (isGroupKey(m.to) || (m.to.includes('/') && !m.agent)) {
          const [owner, agentName] = m.to.split('/')
          const toAgent = isGroupKey(m.to) ? null : agentName
          const c = isGroupKey(m.to) ? ensure({ email: m.to, name: m.to, group: true }) : ensure({ email: keyOf(owner) })
          const own = c.messages.find((x) => x.dir === 'out' && !x.sid && x.status === 'sending' && x.text === m.text)
          if (own) { own.sid = sid; continue }
          // con sus adjuntos (bin/chat send "#grupo" … --file): sin esto, en un grupo el adjunto no se veía
          const files = Array.isArray(m.files) && m.files.length ? m.files.map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.type })) : null
          const pushed = push(c, { id: `cli|${sid}`, sid, re: m.re || '', dir: 'out', text: String(m.text ?? ''), time: m.time, status: 'sent',
                    ...(m.via?.name ? { asAgent: m.via.name } : {}), ...(toAgent ? { toAgent } : {}), ...(files ? { files } : {}) })
          // Ya estaba (guardado antes en este navegador): se le completa con qué agente salió y sus adjuntos.
          if (!pushed) {
            const had = c.messages.find((x) => x.sid === sid)
            if (had && m.via?.name && !had.asAgent) had.asAgent = m.via.name
            if (had && files && !had.files?.length) had.files = files
          }
          continue
        }
        if (m.agent) {
          // Una pregunta de antes a un agente de alguien: en la conversación con su dueño.
          const c = ensure({ email: keyOf(m.to) })
          const own = c.messages.find((x) => x.dir === 'out' && !x.sid && x.status === 'sending' && x.text === m.text)
          if (own) { own.sid = sid; continue }
          push(c, { id: `cli|${sid}`, sid, dir: 'out', text: String(m.text ?? ''), time: m.time, status: 'sent', toAgent: m.agent })
        } else {
          const c = ensure({ email: m.to, name: m.to.split('@')[0] })
          // La que mandó esta app puede llegar acá antes de que su pedido vuelva con el id: es la misma (sin esto
          // quedaban dos: la tuya y la del historial).
          const own = c.messages.find((x) => x.dir === 'out' && !x.sid && x.status === 'sending' && x.text === String(m.text ?? ''))
          if (own) { own.sid = sid; continue }
          // Con sus adjuntos: el servidor guarda la ficha de lo que se subió desde él (bin/chat send --file) y una copia
          // en su caché, que applySavedFiles muestra. Si el mensaje ya estaba sin ellos, se le agregan.
          const files = Array.isArray(m.files) && m.files.length ? m.files.map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.type })) : null
          push(c, { id: `cli|${sid}`, sid, re: m.re || '', dir: 'out', text: String(m.text ?? ''), time: m.time, status: 'sent',
                    ...(m.via?.name ? { asAgent: m.via.name } : {}), ...(files ? { files } : {}) })
          if (files) {
            const item = c.messages.find((x) => x.sid === sid)
            if (item && !item.files?.length) item.files = files
          }
        }
        continue
      }
      if (!m.from?.email) continue
      const author = { email: keyOf(m.from.email), name: m.from.name || m.from.email }
      // Lo que publicó o contestó un agente de antes: en la conversación con su dueño, como ese agente.
      if ((m.kind === 'publish' || m.re) && m.agent) {
        const c = ensure(m.from)
        if (push(c, { id: sid || legacyId(m), sid, re: m.re || '', dir: 'in', text: String(m.text ?? ''), time: m.time, via: m.agent, author,
                      ...(m.kind === 'publish' ? { kind: 'publish', agent: m.agent } : {}), ...(m.queued ? { queued: true } : {}) }) && m.re) {
          const asked = c.messages.find((x) => x.sid === m.re)
          if (asked) asked.status = 'answered'
        }
        continue
      }
      // Por un grupo: a la conversación del grupo, con quién lo escribió (y si fue el agente de alguien).
      if (m.group?.id) {
        const c = ensure({ email: `#${m.group.id}`, name: `#${m.group.id}`, group: true })
        push(c, { id: sid || legacyId(m), sid, re: m.re || '', dir: 'in', text: String(m.text ?? ''), time: m.time,
                  author: { email: keyOf(m.from.email), name: m.from.name || m.from.email }, ...(m.via?.name ? { via: m.via.name } : {}),
                  ...(m.for ? { forAgent: m.for } : {}), ...(m.queued ? { queued: true } : {}) })
        continue
      }
      // De un agente de alguien (`--as`): en la conversación con su dueño, marcado con el agente que habló.
      if (m.via?.name) {
        const c = ensure(m.from)
        push(c, { id: sid || legacyId(m), sid, re: m.re || '', dir: 'in', text: String(m.text ?? ''), time: m.time, via: m.via.name, author,
                  ...(m.for ? { forAgent: m.for } : {}), ...(m.queued ? { queued: true } : {}) })
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
      const id = sid || legacyId(m)
      const pushed = push(c, { id, sid, re: m.re || '', dir: 'in', text: String(m.text ?? ''), time: m.time,
                ...(m.agent ? { kind: 'asked', agent: m.agent } : {}), ...(m.queued ? { queued: true } : {}),
                // Te lo escribieron para uno de TUS agentes (`@vos/agente`).
                ...(m.for ? { forAgent: m.for } : {}),
                // Los adjuntos que trae: las imágenes se bajan solas para mostrarlas; lo demás, con «Bajar».
                ...(Array.isArray(m.files) && m.files.length ? { files: m.files.map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.type })) } : {}) })
      if (pushed) {
        const item = c.messages.find((x) => x.id === id)
        // Si el servidor ya la bajó (lo hace apenas llega), applySavedFiles la muestra; si no, se pide acá.
        for (const f of item?.files || []) if (((isImage(f) && f.size <= IMAGE_AUTO_MAX) || /\.pdf$/i.test(f.name || '')) && !state.value?.files?.[f.id]) getFile(item, f, { cache: true })
      }
    }
    markActiveRead()
  }

  // «Vaciar chat», como en WhatsApp: se van los mensajes y la conversación queda; lo ya recibido no vuelve.
  function clearMessages(key) {
    const c = conversations.value[key]
    if (!c) return
    const last = c.messages.reduce((t, m) => (m.time > t ? m.time : t), '')
    if (last) deleted[key] = last
    try { localStorage.setItem(DELETED_KEY, JSON.stringify(deleted)) } catch { /* vale mientras la pestaña */ }
    c.messages = []
    c.readAt = last || c.readAt
  }

  /* LO LEÍDO lo comparten la app y bin/chat por el servidor (server/reads.go): al mirar una conversación se le avisa,
     y lo que marque un agente desde la terminal llega por el stream (`read`). Sólo avanza. */
  function mergeRead(key, at) {
    if (at && at > (serverReads[key] || '')) serverReads[key] = at
    const c = conversations.value[key]
    if (c && at && at > (c.readAt || '')) c.readAt = at
  }
  async function loadReads() {
    let server
    try { server = (await api('/api/reads')).reads || {} } catch { return /* queda lo del navegador */ }
    for (const [k, at] of Object.entries(server)) mergeRead(k, at)
    // Lo que este navegador ya tenía leído y el servidor no (lo de antes de que lo guardara él): se le pasa una vez.
    for (const [k, c] of Object.entries(conversations.value)) {
      if (c.readAt && c.readAt > (server[k] || '')) post('/api/reads', { key: k, at: c.readAt }).catch(() => {})
    }
  }
  // La conversación abierta se da por leída sólo si la pestaña está a la vista.
  // Sin conversación abierta estás en «Mi chat»: lo que te dijeron tus agentes también se marca leído.
  function markActiveRead() {
    const c = active.value || (activeKey.value ? null : conversations.value[meKey.value])
    if (!c || document.visibilityState !== 'visible') return
    const latest = c.messages.at(-1)?.time || ''
    if (latest > (c.readAt || '')) {
      c.readAt = latest
      post('/api/reads', { key: c.person.email, at: latest }).catch(() => { /* lo marca el navegador igual */ })
    }
  }

  let absorbedCount = 0
  // Las imágenes que el servidor ya bajó (id → archivo): se muestran sin volver a pedirlas.
  function applySavedFiles(files) {
    if (!files) return
    for (const c of Object.values(conversations.value)) {
      for (const m of c.messages || []) {
        for (const f of m.files || []) {
          const path = files[f.id]
          // Uno que el servidor reconoció en tus Descargas ya está guardado ahí: no se ofrece «Guardar en Descargas».
          const inDownloads = /\/Downloads\//.test(path || '')
          if (path && (f.status !== 'bajado' || f.path !== path)) Object.assign(f, { status: 'bajado', path, cached: !inDownloads, error: '', gone: false, ...(inDownloads ? { savedPath: path } : {}) })
        }
      }
    }
  }

  async function loadState() {
    try {
      // Sólo lo nuevo: se le dice al servidor cuántos mensajes del historial ya se vieron (`after`) y devuelve los que
      // siguen, con el total. Si el historial es más corto que lo visto (se vació), se vuelve a pedir entero.
      let next = await api(`/api/state?after=${absorbedCount}`)
      if ((next.total ?? 0) < absorbedCount) { absorbedCount = 0; next = await api('/api/state') }
      const fresh = next.messages || []
      // El estado guardado no carga con los mensajes: ya están repartidos en las conversaciones.
      state.value = { ...next, messages: [] }
      stateError.value = ''
      absorb(fresh)
      absorbedCount = next.total ?? absorbedCount + fresh.length
      applySavedFiles(state.value.files)
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

  // Borrar uno de tus agentes: sale de la lista; si una sesión vuelve a hablar con su nombre, renace.
  async function removeAgent(name) {
    await post('/api/agents/remove', { name })
    await loadTeamAgents()
  }
  async function loadTeamAgents() {
    if (!state.value?.installed) return
    try {
      teamAgents.value = ((await api('/api/team-agents')).people || [])
        .map((p) => ({ ...p, agents: (p.agents || []).filter((x) => x.name !== 'journal') }))
      teamAgentsError.value = ''
    } catch (e) { teamAgentsError.value = e.message }
  }

  function openAgent(row) {
    open({ email: row.key, name: row.agentName, agent: true, owner: row.owner, agentName: row.agentName, detail: row.description,
           ...(row.tool ? { tool: row.agentName } : {}) })
  }

  /* LOS GRUPOS (`#ecommerce`): los del home donde estás vos o un agente tuyo. Un home anterior a los grupos contesta
     error: la sección queda vacía, sin ruido. */
  const groups = ref([])
  const groupsError = ref('')
  async function loadGroups() {
    if (!state.value?.installed) return
    try {
      groups.value = (await api('/api/groups')).groups || []
      groupsError.value = ''
      for (const g of groups.value) ensure({ email: `#${g.id}`, name: `#${g.id}`, group: true, members: g.members, owner: g.owner })
      // Un grupo que el servidor ya no lista (lo borraron, o saliste desde otro lado) se va de la lista.
      const live = new Set(groups.value.map((g) => `#${g.id}`))
      for (const key of Object.keys(conversations.value)) if (isGroupKey(key) && !live.has(key)) removeConversation(key)
    } catch (e) { groupsError.value = e.message }
  }
  async function createGroup(name, members) {
    const r = await post('/api/groups', { name, members })
    await loadGroups()
    return r.group
  }
  // Eliminar un grupo: si lo creaste, se borra para todos; si no, salís (y si eras el único, se borra). Se va de tu lista.
  async function leaveGroup(key) {
    const id = key.replace(/^#/, '')
    let r = {}
    try { r = await post(`/api/groups/${encodeURIComponent(id)}/remove`, {}) } catch (e) {
      // Si ya no estás (lo borraron o saliste desde otro lado), sólo queda sacarlo de la lista.
      if (!/no estás en/.test(e.message)) throw e
    }
    removeConversation(key)
    await loadGroups()
    return r
  }
  const groupList = computed(() => Object.values(conversations.value)
    .filter((c) => isGroupKey(c.person.email))
    .map(summarize)
    .sort((a, b) => (b.last?.time || '').localeCompare(a.last?.time || '')))

  async function loadOnline() {
    if (!state.value?.installed) return
    try {
      online.value = (await api('/api/online')).online || []
      onlineError.value = ''
      for (const p of online.value) if (conversations.value[keyOf(p.email)]) ensure(p)
    } catch (e) { onlineError.value = e.message }
    loadGroups()
  }

  async function startListening() {
    listenBusy.value = true; listenError.value = ''
    try { await post('/api/listen', {}); await loadState() }
    catch (e) { listenError.value = e.message }
    finally { listenBusy.value = false }
  }

  // Apagar el listen (`playground listen --stop`): deja de recibir en vivo; lo que llegue espera en el buzón.
  async function stopListening() {
    listenBusy.value = true; listenError.value = ''
    try { await api('/api/listen', { method: 'DELETE' }); await loadState() }
    catch (e) { listenError.value = e.message }
    finally { listenBusy.value = false }
  }

  // Borrar una conversación: se va de la lista y lo que ya llegó no vuelve; lo nuevo sí, como una conversación nueva.
  function removeConversation(key) {
    const c = conversations.value[key]
    if (!c) return
    const last = c.messages.reduce((t, m) => (m.time > t ? m.time : t), '')
    if (last) deleted[key] = last
    try { localStorage.setItem(DELETED_KEY, JSON.stringify(deleted)) } catch { /* vale mientras la pestaña */ }
    delete conversations.value[key]
    if (activeKey.value === key) activeKey.value = ''
  }

  function open(person) {
    const c = ensure(person)
    activeKey.value = c.person.email
    markActiveRead()
  }

  // `re`: el id del home del mensaje que se contesta (sólo en conversaciones con personas).
  // `extra`: marcas del mensaje.
  // `files`: los archivos que se adjuntan (File del navegador). Se suben uno por uno antes del mensaje; con adjuntos el
  // texto puede ir vacío. Sólo a personas: a un agente no se le mandan archivos.
  async function send(text, re = '', conversation = null, extra = {}, files = []) {
    const c = conversation || active.value
    const body = String(text || '').trim()
    // A un grupo o a un agente no van adjuntos (el home todavía no los reparte).
    const attach = c?.person.agent || c?.person.group ? [] : files
    if (!c || (!body && !attach.length)) return
    const message = { id: `out|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, dir: 'out', text: body,
                      time: new Date().toISOString(), status: 'sending', ...(re && !c.person.agent ? { re } : {}), ...extra,
                      ...(attach.length ? { files: attach.map((f) => ({ name: f.name, size: f.size, type: f.type, status: 'subiendo' })) } : {}) }
    c.messages.push(message)
    // La miniatura de cada imagen que mandás: se hace acá y se guarda con el mensaje (un JPEG chico).
    for (const [i, f] of attach.entries()) {
      if (isImage(f)) thumbnailOf(f).then((thumb) => { if (thumb && stored()?.files?.[i]) stored().files[i].thumb = thumb })
    }
    const stored = () => c.messages.find((m) => m.id === message.id)
    // A canon se le pregunta; las demás herramientas (cuadrilla) tienen su propio camino y no pasan por acá.
    if (c.person.tool) return c.person.tool === 'canon' ? askCanon(c, body, stored) : undefined
    // El destino: el grupo, el agente de alguien (`correo/agente`) o la persona.
    const to = c.person.agent ? `${keyOf(c.person.owner?.email)}/${c.person.agentName}` : c.person.email
    try {
      const ids = []
      for (const [i, f] of attach.entries()) {
        const res = await fetch(`/api/upload?to=${encodeURIComponent(c.person.email)}&name=${encodeURIComponent(f.name)}`,
          { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f })
        const up = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(`${f.name}: ${up.error || `HTTP ${res.status}`}`)
        ids.push(up.id)
        Object.assign(stored().files[i], { id: up.id, status: 'subido' })
      }
      const r = await post('/api/send', { to, text: body, re: message.re || '', ...(ids.length ? { files: ids } : {}) })
      /* El historial pudo traer este mismo mensaje antes que esta respuesta (como enviado, o como recibido si te lo
         mandaste a vos mismo): queda uno solo, el tuyo, con su estado. */
      if (r.id) {
        for (let i = c.messages.length - 1; i >= 0; i--) {
          const x = c.messages[i]
          if (x.id !== message.id && (x.dir === 'out' ? x.sid === r.id : (x.sid || x.id) === r.id)) c.messages.splice(i, 1)
        }
      }
      Object.assign(stored(), { status: 'sent', delivered: r.delivered, sid: r.id || '' })
      unsentFiles.delete(message.id)
    } catch (e) {
      Object.assign(stored(), { status: 'error', error: e.message })
      // Los adjuntos que no llegaron a salir quedan «no salió», no «subiendo…»; y se guardan (sólo en esta pestaña)
      // para que «reintentar» los vuelva a subir.
      for (const f of stored().files || []) if (f.status !== 'subido') f.status = 'error'
      if (attach.length) unsentFiles.set(message.id, attach)
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
    for (const e of b.epics || []) {
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
    for (const e of board.epics || []) {
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
  // Bajar un adjunto recibido: queda en Descargas (y el home lo borra). Se recuerda dónde, para mostrarlo.
  async function getFile(item, file, { cache = false } = {}) {
    Object.assign(file, { status: 'bajando', error: '' })
    try {
      const s = await post(`/api/files/${encodeURIComponent(file.id)}/get${cache ? '?cache=1' : ''}`, {})
      Object.assign(file, { status: 'bajado', path: s.path, ...(cache ? { cached: true } : { savedPath: s.path }) })
    } catch (e) {
      // El home borra un adjunto cuando lo baja quien lo recibe: si otra terminal o sesión tuya (`playground get`) lo
      // bajó antes, acá ya no está, y reintentar no sirve.
      const gone = /no existe o ya venci/.test(e.message)
      Object.assign(file, { status: 'error', gone,
        error: gone ? 'ya lo bajó otra terminal o sesión tuya (el playground lo borra al bajarlo), o venció' : e.message })
    }
  }
  // Guardar en Descargas una imagen que se bajó sola al caché: una copia, sin pisar nada.
  async function saveFile(file) {
    try {
      const r = await post(`/api/files/${encodeURIComponent(file.id)}/save?path=${encodeURIComponent(file.path || '')}`, {})
      Object.assign(file, { savedPath: r.path, error: '' })
    } catch (e) { Object.assign(file, { error: e.message }) }
  }
  const fileUrl = (file) => `/api/files/${encodeURIComponent(file.id)}?path=${encodeURIComponent(file.path || '')}`
  async function revealFile(file) {
    try { await post(`/api/files/${encodeURIComponent(file.id)}/reveal?path=${encodeURIComponent(file.savedPath || file.path || '')}`, {}) }
    catch (e) { Object.assign(file, { error: e.message }) }
  }

  // Los archivos de un mensaje que no salió, para reintentarlo. Sólo en memoria: al recargar la página no están, y
  // entonces «reintentar» no aparece en un mensaje con adjuntos (se borra y se manda de nuevo).
  const unsentFiles = new Map()
  const canRetry = (m) => !m.files?.length || unsentFiles.has(m.id)

  async function retry(id) {
    const c = active.value
    const failed = c?.messages.find((m) => m.id === id)
    if (!failed || !canRetry(failed)) return
    const files = unsentFiles.get(id) || []
    unsentFiles.delete(id)
    c.messages.splice(c.messages.indexOf(failed), 1)
    await send(failed.text, failed.re || '', null, {}, files)
  }

  // Borrar un mensaje que no salió: nunca le llegó a nadie, así que sólo se saca de acá.
  function discard(id) {
    const c = active.value
    const failed = c?.messages.find((m) => m.id === id && m.dir === 'out' && m.status === 'error')
    if (!failed) return
    unsentFiles.delete(id)
    c.messages.splice(c.messages.indexOf(failed), 1)
  }

  function forget(key) {
    delete conversations.value[key]
    if (activeKey.value === key) activeKey.value = ''
  }

  let stateTimer = null
  let onlineTimer = null
  let cuadrillaTimer = null

  /* EN VIVO (server/realtime.go): un EventSource a /api/events. Lo que llega se absorbe enseguida, también con la
     pestaña oculta (la consulta de respaldo sólo corre con la pestaña a la vista). `live` dice si está abierto;
     `liveNotice` es el aviso corto de lo que hizo el servidor por su cuenta (el llavero que contestó solo). */
  const live = ref(false)
  const liveNotice = ref(null)   // { text, at }
  let source = null
  let lastBeat = 0
  let watchdog = null
  let noticeTimer = null
  function showNotice(text) {
    liveNotice.value = { text, at: Date.now() }
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { liveNotice.value = null }, 8000)
  }
  function openLive() {
    if (typeof EventSource === 'undefined') return
    source?.close()
    source = new EventSource('/api/events')
    // El servidor late cada 25 s (`ping`). Si pasa más de un minuto sin nada, el stream quedó muerto detrás del proxy
    // (el servidor se reinició) y se vuelve a abrir: si no, el servidor no sabría que esta pestaña está.
    lastBeat = Date.now()
    const beat = () => { lastBeat = Date.now() }
    for (const name of ['hello', 'ping', 'messages', 'file', 'keyring', 'voice-sync']) source.addEventListener(name, beat)
    clearInterval(watchdog)
    watchdog = setInterval(() => { if (Date.now() - lastBeat > 65_000) { live.value = false; openLive() } }, 15_000)
    source.addEventListener('hello', () => { live.value = true })
    source.addEventListener('messages', (e) => {
      try {
        const fresh = JSON.parse(e.data) || []
        absorb(fresh)
      } catch { /* un evento roto: lo trae la consulta de respaldo */ }
    })
    source.addEventListener('file', (e) => {
      try { const f = JSON.parse(e.data); if (f?.id) applySavedFiles({ [f.id]: f.path }) } catch { /* idem */ }
    })
    source.addEventListener('keyring', (e) => {
      try {
        const k = JSON.parse(e.data)
        const who = (k.name || k.to || '').split(/[\s@]/)[0]
        showNotice(k.kind === 'list' ? `Le pasaste a ${who} la lista de tu llavero` : `Le mandaste a ${who} las claves que pidió`)
      } catch { /* idem */ }
    })
    // cómo va la sincronización de voz de una conversación (server/voice_sync.go): la escucha la videollamada
    source.addEventListener('voice-sync', (e) => {
      try { window.dispatchEvent(new CustomEvent('chat:voice-sync', { detail: JSON.parse(e.data) })) } catch { /* lo trae la consulta */ }
    })
    source.addEventListener('read', (e) => {
      try { const r = JSON.parse(e.data); mergeRead(r.key, r.at) } catch { /* lo trae loadReads */ }
    })
    // EventSource reintenta solo; mientras tanto, la consulta vuelve a su ritmo normal.
    source.onerror = () => { live.value = false }
  }

  function start() {
    loadReads()
    const tickCuadrilla = async () => {
      if (document.visibilityState === 'visible') await loadCuadrilla()
      cuadrillaTimer = setTimeout(tickCuadrilla, POLL_CUADRILLA_MS)
    }
    const tickState = async () => {
      if (document.visibilityState === 'visible') await loadState()
      stateTimer = setTimeout(tickState, live.value ? POLL_STATE_LIVE_MS : POLL_STATE_MS)
    }
    const tickOnline = async () => {
      if (document.visibilityState === 'visible') await Promise.all([loadOnline(), loadTeamAgents()])
      onlineTimer = setTimeout(tickOnline, POLL_ONLINE_MS)
    }
    // Sin sesión al abrir, entra solo (una vez por carga: si lo cancelás, queda el botón «Entrar»).
    const autoLogin = () => {
      const st = state.value
      if (st && !st.session && !st.login?.running && !loginBusy.value) login()
    }
    // Primero la copia del servidor (si el navegador está vacío), después el historial: así nada llega dos veces.
    loadServerCopy().then(loadState).then(autoLogin).then(() => Promise.all([loadOnline(), loadTeamAgents(), loadCuadrilla()]))
    cuadrillaTimer = setTimeout(tickCuadrilla, POLL_CUADRILLA_MS)
    stateTimer = setTimeout(tickState, POLL_STATE_MS)
    onlineTimer = setTimeout(tickOnline, POLL_ONLINE_MS)
    openLive()
    document.addEventListener('visibilitychange', markActiveRead)
    stopReadWatch = watch(activeKey, markActiveRead)
  }
  function stop() {
    clearTimeout(stateTimer); clearTimeout(onlineTimer); clearTimeout(cuadrillaTimer)
    source?.close(); source = null; live.value = false; clearInterval(watchdog)
    document.removeEventListener('visibilitychange', markActiveRead)
    stopReadWatch?.()
  }

  return {
    conversations, activeKey, state, stateError, online, onlineError, listenBusy, listenError, loginBusy, loginError, login,
    teamAgents, teamAgentsError, agentsOf, cuadrilla, cuadrillaError, myTasks, taskUrl, loadCuadrilla, noteTask, doneTask,
    removeConversation, clearMessages, isMe, ensure, removeAgent, selfUnread,
    me, meKey, list, active, unreadTotal, onlineKeys, agentList, groups, groupsError, groupList, loadGroups, createGroup, leaveGroup,
    live, liveNotice, reconnectLive: () => openLive(), loadState, loadOnline, loadTeamAgents, startListening, stopListening, open, openAgent, send, retry, canRetry, discard, getFile, saveFile, fileUrl, revealFile, forget, findBySid, start, stop,
  }
})
