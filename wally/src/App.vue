<script setup>
/* WALLY: un chat para hacerle preguntas a Gemini, eligiendo el modelo, POR LA WEB de AI Studio (bin/aistudio, en el
 * Chrome de Miguel con Jarvis y su cuenta, sin llave de API). A la izquierda las conversaciones guardadas, con un
 * buscador y agrupadas por día; al centro, en PESTAÑAS, las abiertas (varias a la vez, como documentos de un editor),
 * cada una con su campo para preguntar, su borrador y su modelo. El servidor (wally/server) guarda todo; cuando Google
 * corta, la cuenta queda en pausa y no se pregunta hasta que vence.
 *
 * Pestañas, con la gramática del taller (tools/ui/README.md): un clic en la lista abre la conversación «de paso»
 * (itálica, la reemplaza el próximo clic); doble clic, o mandar una pregunta, la deja fija. «+» abre una nueva. Las
 * pestañas abiertas y la activa se recuerdan en esta máquina (`wally.tabs`). La ruta es `#/c/<id>` (la activa) o
 * `#/nueva/<n>` (una sin preguntas todavía).
 *
 * Preguntas de a una: AI Studio se maneja en UNA pestaña de Chrome y corta si se le pide mucho. Mientras una pestaña
 * espera, en las otras se puede escribir y leer, pero no mandar. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import { vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const models = ref([])
const defaultModel = ref('')
// v2 (2026-11-17): el de siempre pasó a Hydrogen; la preferencia vieja («wally.model») era Flash.
const lastModel = ref(readPref('wally.model.v2', ''))
const conversations = ref([])
const apiError = ref('')

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── LOS MODELOS ──
const usable = (name) => models.value.some((m) => m.name === name && !m.paused)
async function loadModels() {
  try {
    const r = await api('/api/models')
    models.value = r.models || []
    defaultModel.value = r.default
    if (!usable(lastModel.value)) lastModel.value = usable(r.default) ? r.default : (models.value.find((m) => !m.paused)?.name || lastModel.value || r.default)
  } catch (e) { apiError.value = `No pude leer los modelos: ${e.message}` }
}
// Un modelo que ya no está en la lista (conversaciones viejas) se nombra desde su id: gemini-3.5-flash-lite → Gemini 3.5 Flash Lite.
const prettyModel = (id) => (id || '').split('-').map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ').replace(/ It$/, '')
const modelName = (name) => models.value.find((m) => m.name === name)?.displayName || prettyModel(name)
const pausedCount = computed(() => models.value.filter((m) => m.paused).length)
// Toda la cuenta en pausa: Google cortó y no se pregunta hasta que vence (la hora es la de la pausa).
const allPaused = computed(() => models.value.length > 0 && models.value.every((m) => m.paused) ? models.value[0].paused : '')

async function loadList() {
  try { conversations.value = (await api('/api/conversations')).conversations; apiError.value = '' } catch { apiError.value = 'No contesta la API. ¿Está arriba? (make wally) · reintenta cada 30 s' }
}

// ── LAS PESTAÑAS ──
// Una pestaña: { key, preview }. La clave es el id de la conversación, o `nueva-<n>` mientras no tiene preguntas.
// Lo de cada pestaña (la conversación cargada, el borrador, el modelo, el error) va en mapas por clave.
const saved = readPref('wally.tabs', { tabs: [], active: '' })
const tabs = ref(Array.isArray(saved.tabs) ? saved.tabs.filter((t) => t && t.key) : [])
const active = ref(saved.active || '')
const loaded = ref({})      // clave → conversación { id, title, model, messages }
const drafts = ref({})      // clave → texto sin mandar
const tabModel = ref({})    // clave → modelo elegido en esa pestaña
const errors = ref({})      // clave → el último error
const attachments = ref({}) // clave → archivos subidos y todavía sin mandar: [{ id, name, size, chars, kind }]
const uploading = ref({})   // clave → cuántos se están subiendo
const tabMode = ref({})     // clave de una pestaña nueva → su modo («knowledge») antes de la primera pregunta
let newCounter = Math.max(0, ...tabs.value.map((t) => Number((/^nueva-(\d+)$/.exec(t.key) || [])[1] || 0)))
const isNew = (key) => key.startsWith('nueva-')

function persistTabs() { savePref('wally.tabs', { tabs: tabs.value, active: active.value }) }
watch([tabs, active], persistTabs, { deep: true })

const tabTitle = (t) => {
  if (t.key === AGENT_NEW) return 'Agente nuevo'
  if (t.key === GROUP_NEW) return 'Grupo nuevo'
  if (isGroup(t.key)) return loadedGroups.value[t.key]?.title || agentGroups.value.find((g) => `g:${g.id}` === t.key)?.title || 'Grupo'
  if (isNew(t.key)) return MODES[tabMode.value[t.key]]?.label || 'Conversación nueva'
  return loaded.value[t.key]?.title || conversations.value.find((c) => c.id === t.key)?.title || 'Conversación'
}

async function loadConv(key) {
  if (isNew(key) || isGroup(key) || key === AGENT_NEW) return
  try {
    const c = await api(`/api/conversations/${encodeURIComponent(key)}`)
    loaded.value = { ...loaded.value, [key]: c }
    if (!tabModel.value[key] && c.model && models.value.some((m) => m.name === c.model)) tabModel.value = { ...tabModel.value, [key]: c.model }
  } catch (e) {
    // Una conversación que ya no existe (se borró en otra ventana) no deja la pestaña colgada.
    if (/no existe/.test(e.message)) closeTab(key)
    else errors.value = { ...errors.value, [key]: e.message }
  }
}

/** Abre (o trae al frente) una pestaña. `preview`: de paso, la reemplaza la próxima que se abra de paso. */
function openTab(key, { preview = false } = {}) {
  const existing = tabs.value.find((t) => t.key === key)
  if (existing) {
    if (!preview && existing.preview) existing.preview = false
  } else {
    const prev = tabs.value.findIndex((t) => t.preview)
    if (preview && prev >= 0) tabs.value.splice(prev, 1, { key, preview: true })
    else tabs.value.push({ key, preview })
  }
  activate(key)
}
function pinTab(key) { const t = tabs.value.find((x) => x.key === key); if (t) t.preview = false }
function newTab() { newCounter += 1; openTab(`nueva-${newCounter}`) }
function closeTab(key) {
  const i = tabs.value.findIndex((t) => t.key === key)
  if (i < 0 || pending.value?.key === key) return
  tabs.value.splice(i, 1)
  const { [key]: _d, ...restDrafts } = drafts.value
  drafts.value = restDrafts
  // Los archivos subidos y sin mandar se borran del disco: nadie los va a mandar.
  for (const f of attachments.value[key] || []) fetch(`/api/files/${f.id}`, { method: 'DELETE' }).catch(() => {})
  const { [key]: _a, ...restAtts } = attachments.value
  attachments.value = restAtts
  if (active.value === key) {
    const next = tabs.value[i] || tabs.value[i - 1]
    if (next) activate(next.key)
    else newTab()
  }
}
function activate(key) {
  active.value = key
  if (key === AGENT_NEW) loadTopics()
  else if (isGroup(key)) { if (key === GROUP_NEW) loadTopics(); else loadGroup(key) }
  else if (!isNew(key) && !loaded.value[key]) loadConv(key)
  writeRoute()
  scrollDown()
  focusInput()
}

// La ruta dice la pestaña activa: abrir un enlace `#/c/<id>` la abre.
function writeRoute() {
  const hash = active.value === AGENT_NEW ? '#/agente-nuevo' : active.value === GROUP_NEW ? '#/grupo-nuevo'
    : isGroup(active.value) ? `#/g/${encodeURIComponent(active.value.slice(2))}`
    : isNew(active.value) ? `#/nueva/${active.value.slice(6)}` : `#/c/${encodeURIComponent(active.value)}`
  if (location.hash !== hash) history.replaceState(null, '', hash)
}
function readRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'c' && parts[1]) openTab(decodeURIComponent(parts[1]))
  else if (parts[0] === 'grupo-nuevo') openTab(GROUP_NEW)
  else if (parts[0] === 'agente-nuevo') openTab(AGENT_NEW)
  else if (parts[0] === 'g' && parts[1]) openTab(`g:${decodeURIComponent(parts[1])}`)
  else if (parts[0] === 'nueva' && parts[1] && tabs.value.some((t) => t.key === `nueva-${parts[1]}`)) activate(`nueva-${parts[1]}`)
}

// ── LOS AGENTES ── (wally/server/agents.go) Cada uno es UNA conversación larga con nombre propio y una intención (poner y
// tener al día el contexto de una parte, p. ej. KYC), que lleva siempre precargados sus temas de knowledge y el estado
// de sus fuentes contra main. No hablan entre ellos. La lista dice cuántas fuentes de sus temas cambiaron: así se ve
// quién tiene que tomar un cambio.
const AGENT_NEW = 'a:nuevo'
const agents = ref([])
const agentForm = ref({ name: '', intent: '', topics: [], model: '', busy: false, error: '' })
async function loadAgents() { try { agents.value = (await api('/api/agents')).agents } catch { /* lo dice loadList */ } }
function newAgentTab() { openTab(AGENT_NEW) }
function toggleAgentTopic(id) {
  const list = agentForm.value.topics
  agentForm.value.topics = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}
async function createAgent() {
  const f = agentForm.value
  f.busy = true; f.error = ''
  try {
    const c = await api('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: f.name, intent: f.intent, topics: f.topics, model: f.model || lastModel.value }) })
    loaded.value = { ...loaded.value, [c.id]: c }
    const i = tabs.value.findIndex((t) => t.key === AGENT_NEW)
    if (i >= 0) tabs.value.splice(i, 1, { key: c.id, preview: false })
    agentForm.value = { name: '', intent: '', topics: [], model: '', busy: false, error: '' }
    await Promise.all([loadList(), loadAgents()])
    activate(c.id)
  } catch (e) { f.error = e.message } finally { f.busy = false }
}
const agentRow = (key) => agents.value.find((a) => a.conv === key)
const agentOf = computed(() => conv.value?.agent || null)
const AGENT_PROMPTS = [
  { label: 'Ponete al día con lo que cambió', text: 'Mirá en tus fuentes lo que CAMBIÓ en main desde que se revisaron: pedí los diffs que necesites y decime, sección por sección, qué sigue cierto y qué hay que corregir, con propuestas en el formato de WALLY.md.' },
  { label: 'Revisá que tu parte siga cierta', text: 'Revisá contra el código de main lo que dicen tus temas: elegí las afirmaciones que más pesan, pedí el código que haga falta y decime cuáles siguen ciertas y cuáles no, con propuestas.' },
  { label: 'Contame tu parte', text: 'Contame en pocas líneas de qué te ocupás: qué cubren tus temas, cómo se conectan y qué te parece que falta o está flojo.' },
]

// ── LOS GRUPOS DE AGENTES ── (wally/server/groups.go) Un grupo «Knowledge»: el coordinador (Wally, sin modelo)
// reparte temas entre EVA y M-O, que trabajan en paralelo en pestañas de AI Studio; en el grupo queda sólo el resumen
// de cada uno, y su conversación completa se abre tocándolo. La pestaña de un grupo es `g:<id>`; armar uno, `g:nuevo`.
const GROUP_NEW = 'g:nuevo'
const isGroup = (key) => key.startsWith('g:')
const agentGroups = ref([])
const loadedGroups = ref({})
const topics = ref([])
const groupForm = ref({ topics: [], model: '', busy: false, error: '' })
async function loadAgentGroups() { try { agentGroups.value = (await api('/api/groups')).groups } catch { /* lo dice loadList */ } }
async function loadGroup(key) {
  try { loadedGroups.value = { ...loadedGroups.value, [key]: await api(`/api/groups/${encodeURIComponent(key.slice(2))}`) } } catch (e) {
    if (/no existe/.test(e.message)) closeTab(key)
    else errors.value = { ...errors.value, [key]: e.message }
  }
}
async function loadTopics() { try { topics.value = (await api('/api/topics')).topics } catch (e) { groupForm.value.error = e.message } }
const pendingTopicCount = computed(() => topics.value.filter((t) => t.changed).length)
function newGroupTab() { openTab(GROUP_NEW) }
function toggleGroupTopic(id) {
  const list = groupForm.value.topics
  groupForm.value.topics = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}
async function startGroup(onlyPending) {
  const f = groupForm.value
  f.busy = true; f.error = ''
  try {
    const g = await api('/api/groups', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topics: onlyPending ? [] : f.topics, model: f.model || lastModel.value }) })
    const i = tabs.value.findIndex((t) => t.key === GROUP_NEW)
    if (i >= 0) tabs.value.splice(i, 1, { key: `g:${g.id}`, preview: false })
    loadedGroups.value = { ...loadedGroups.value, [`g:${g.id}`]: g }
    f.topics = []
    activate(`g:${g.id}`)
    loadAgentGroups()
  } catch (e) { f.error = e.message } finally { f.busy = false }
}
async function removeGroup(g) {
  if (!confirm(`¿Borrar el grupo «${g.title}»? Las conversaciones de los agentes quedan.`)) return
  try { await api(`/api/groups/${encodeURIComponent(g.id)}`, { method: 'DELETE' }); closeTab(`g:${g.id}`); loadAgentGroups() } catch (e) { apiError.value = e.message }
}
const group = computed(() => (isGroup(active.value) && active.value !== GROUP_NEW ? loadedGroups.value[active.value] : null))
const AUTHOR = { Wally: { badge: 'W', role: 'coordinador' }, EVA: { badge: 'E', role: 'agente' }, 'M-O': { badge: 'M', role: 'agente' } }
const KIND = { plan: 'plan', toma: 'toma un tema', resumen: 'resumen', pausa: 'en pausa', error: 'problema', cierre: 'cierre' }
const memberTone = (m) => (m.status.startsWith('en pausa') ? 'pause' : m.status === 'trabajando' ? 'work' : m.status === 'listo' ? 'done' : 'idle')
// Mientras un grupo trabaja, el grupo abierto y la lista se releen cada 3 s.
let groupPoll = null

// ── LA PESTAÑA ACTIVA ──
const conv = computed(() => loaded.value[active.value] || null)
// El modo de la pestaña: el de su conversación, o el elegido en una nueva.
const modeOf = (key) => loaded.value[key]?.mode || conversations.value.find((c) => c.id === key)?.mode || tabMode.value[key] || ''
const mode = computed(() => modeOf(active.value))
// Los modos asistidos: «asistente» lee wally/WALLY.md (sus herramientas de lectura); «knowledge» es el primero, que
// sólo conocía la biblioteca (sus conversaciones siguen andando).
const MODES = {
  asistente: { label: 'Asistente', short: 'asistente', badge: 'A' },
  knowledge: { label: 'Asistente de knowledge', short: 'knowledge', badge: 'K' },
}
const messages = computed(() => conv.value?.messages || [])
const draft = computed({
  get: () => drafts.value[active.value] || '',
  set: (v) => { drafts.value = { ...drafts.value, [active.value]: v } },
})
const model = computed({
  get: () => (usable(tabModel.value[active.value]) ? tabModel.value[active.value] : lastModel.value),
  set: (v) => { tabModel.value = { ...tabModel.value, [active.value]: v }; lastModel.value = v; savePref('wally.model.v2', v) },
})
const error = computed(() => errors.value[active.value] || '')
const pendingFiles = computed(() => attachments.value[active.value] || [])
const fileChars = (files) => (files || []).reduce((n, f) => n + (f.chars || 0), 0)
// Lo que viaja: el texto de cada bloque, sus archivos y las salidas de los comandos que se corrieron.
const outputsOf = (m) => (m.commands || []).filter((c) => c.output).map((c) => c.output)
const contextChars = computed(() => messages.value.reduce((n, m) => n + (m.text || '').length + fileChars(m.files) + fileChars(outputsOf(m)), 0))
const contextFiles = computed(() => messages.value.reduce((n, m) => n + (m.files?.length || 0) + outputsOf(m).length, 0))

// ── MANDAR ── (de a una pregunta en toda la app: la respuesta llega cuando AI Studio termina, sin streaming)
const pending = ref(null)   // { key, text, model, since }
const elapsed = ref(0)
let tick = null
let refresher = null
const busyElsewhere = computed(() => !!pending.value && pending.value.key !== active.value)
async function send() {
  const key = active.value
  const files = attachments.value[key] || []
  const draftBefore = draft.value
  const text = draft.value.trim() || (files.length ? (files.length > 1 ? 'Revisá los archivos adjuntos.' : 'Revisá el archivo adjunto.') : '')
  if (!text || pending.value || allPaused.value || uploading.value[key]) return
  errors.value = { ...errors.value, [key]: '' }
  pending.value = { key, text, files, model: model.value, since: Date.now() }
  attachments.value = { ...attachments.value, [key]: [] }   // salen del campo: ya van con la pregunta
  elapsed.value = 0
  tick = setInterval(() => { elapsed.value = Math.floor((Date.now() - pending.value.since) / 1000) }, 250)
  drafts.value = { ...drafts.value, [key]: '' }
  pinTab(key)
  scrollDown()
  try {
    const c = await api('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: isNew(key) ? '' : key, model: pending.value.model, text, files: files.map((f) => f.id), mode: isNew(key) ? (tabMode.value[key] || '') : '' }) })
    attachments.value = { ...attachments.value, [key]: [] }
    if (isNew(key)) {
      // La pestaña nueva pasa a ser la de su conversación, en el mismo lugar.
      const t = tabs.value.find((x) => x.key === key)
      if (t) t.key = c.id
      tabModel.value = { ...tabModel.value, [c.id]: pending.value.model }
      attachments.value = { ...attachments.value, [c.id]: [] }
      if (active.value === key) active.value = c.id
      writeRoute()
    }
    loaded.value = { ...loaded.value, [c.id]: c }
    loadList()
  } catch (e) {
    errors.value = { ...errors.value, [key]: e.message }
    if (!drafts.value[key]) drafts.value = { ...drafts.value, [key]: draftBefore }   // no se pierde lo escrito
    if (files.length) attachments.value = { ...attachments.value, [key]: [...files, ...(attachments.value[key] || [])] }
  } finally {
    loadModels()
    clearInterval(tick)
    pending.value = null
    scrollDown()
    focusInput()
  }
}
function onKey(e) {
  // Enter manda; Shift+Enter, renglón nuevo (como en el chat del equipo).
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
}

// LOS ARCHIVOS: se suben a Wally (no a AI Studio, que los guardaría en tu Drive), que les saca el texto en esta máquina;
// en el campo quedan como fichas, y su texto viaja con la pregunta sin ocupar la conversación. Texto y código, PDF y
// Word; una imagen o un binario vuelve con su porqué.
const fileInput = ref(null)
const dragging = ref(false)
async function addFiles(list) {
  const key = active.value
  for (const file of [...list]) {
    uploading.value = { ...uploading.value, [key]: (uploading.value[key] || 0) + 1 }
    try {
      const body = new FormData()
      body.append('file', file)
      const att = await api('/api/files', { method: 'POST', body })
      attachments.value = { ...attachments.value, [key]: [...(attachments.value[key] || []), att] }
    } catch (e) {
      errors.value = { ...errors.value, [key]: e.message }
    } finally {
      uploading.value = { ...uploading.value, [key]: (uploading.value[key] || 1) - 1 }
    }
  }
  focusInput()
}
// Pegar un archivo copiado en el Finder también lo adjunta (el texto se pega como siempre).
function onPaste(e) { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files) } }
function pickFiles(e) { addFiles(e.target.files); e.target.value = '' }
function removeAttachment(f) {
  const key = active.value
  attachments.value = { ...attachments.value, [key]: (attachments.value[key] || []).filter((x) => x.id !== f.id) }
  fetch(`/api/files/${f.id}`, { method: 'DELETE' }).catch(() => {})
}
let dragDepth = 0
function onDragEnter(e) { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth += 1; dragging.value = true } }
function onDragLeave() { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragging.value = false }
function onDrop(e) { dragDepth = 0; dragging.value = false; if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files) }
// Ver un archivo ya mandado: su ficha se abre y muestra el texto que viajó (el comienzo; «Ver todo» lo abre entero).
const openFile = ref({ id: '', text: '', full: false })
async function toggleFile(f) {
  if (openFile.value.id === f.id) { openFile.value = { id: '', text: '', full: false }; return }
  try {
    const text = await (await fetch(`/api/files/${f.id}`)).text()
    openFile.value = { id: f.id, text, full: false }
  } catch (e) { errors.value = { ...errors.value, [active.value]: e.message } }
}
const PREVIEW_CHARS = 4000
const sizeLabel = (n) => n >= 1048576 ? `${(n / 1048576).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`
const charsLabel = (n) => n >= 1000 ? `${Math.round(n / 1000).toLocaleString('es-CO')} mil car.` : `${n} car.`
const FILE_ICON = { pdf: 'PDF', documento: 'DOC', texto: 'TXT' }

// EL MODO ASISTIDO: el modelo pide comandos de sólo lectura en sus respuestas; acá se corren o se descartan, uno por
// uno (el servidor sólo corre los de su lista blanca, sin shell). Cuando no queda ninguno por decidir, «Mandar
// resultados» le avisa al modelo, y las salidas viajan pegadas a la respuesta que las pidió.
const running = ref('')   // el id del comando que se está corriendo
async function commandAction(m, c, action) {
  const key = active.value
  if (!conv.value || running.value) return
  running.value = c.id
  try {
    const updated = await api(`/api/conversations/${encodeURIComponent(conv.value.id)}/messages/${encodeURIComponent(m.id)}/commands/${encodeURIComponent(c.id)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
    loaded.value = { ...loaded.value, [key]: updated }
    scrollDown()
  } catch (e) { errors.value = { ...errors.value, [key]: e.message } } finally { running.value = '' }
}
// La última respuesta, si pidió comandos y ya se decidió cada uno: es cuando se le puede seguir.
const awaitingResults = computed(() => {
  const last = messages.value[messages.value.length - 1]
  if (!last || last.role !== 'model' || !last.commands?.length) return null
  if (last.commands.some((c) => c.status === 'propuesto')) return null
  return { ran: last.commands.filter((c) => c.status === 'corrido').length, total: last.commands.length }
})
function sendResults() {
  const r = awaitingResults.value
  if (!r) return
  draft.value = r.ran
    ? `Listo: corrí ${r.ran === 1 ? 'el comando' : `los ${r.ran} comandos`} (la salida va arriba${r.ran < r.total ? '; los otros los descarté' : ''}). Seguí.`
    : 'No corrí ninguno de esos comandos. Seguí con lo que tenés, o pedí otra cosa.'
  send()
}
const proposedCount = (m) => (m.commands || []).filter((c) => c.status === 'propuesto').length
// En una respuesta con comandos, sus bloques ```comando no se repiten como código: van como tarjetas.
const answerText = (m) => (m.commands?.length ? (m.text || '').replace(/```comando[^\n]*\n[\s\S]*?```/g, '').trim() : m.text)
function chooseMode(m) { if (isNew(active.value)) tabMode.value = { ...tabMode.value, [active.value]: m }; focusInput() }

// BORRAR UN BLOQUE: una pregunta o una respuesta sale de lo guardado y, con eso, del contexto de la próxima pregunta
// (AI Studio no recuerda nada: cada pregunta le manda todo lo que queda). Sin confirmación, como en un chat.
async function removeBlock(m) {
  const key = active.value
  if (!conv.value || !m.id) return
  try {
    const c = await api(`/api/conversations/${encodeURIComponent(conv.value.id)}/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' })
    loaded.value = { ...loaded.value, [key]: c }
    loadList()
  } catch (e) { errors.value = { ...errors.value, [key]: e.message } }
}
async function removeConv(c) {
  if (!confirm(`¿Borrar «${c.title}»? No se puede recuperar.`)) return
  try {
    await api(`/api/conversations/${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    closeTab(c.id)
    loadList()
  } catch (e) { apiError.value = e.message }
}

// ── LA LISTA: buscador y grupos por día ──
const search = ref('')
const DAY = 86_400_000
function dayGroup(iso) {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const t = new Date(iso).getTime()
  if (t >= start.getTime()) return 'Hoy'
  if (t >= start.getTime() - DAY) return 'Ayer'
  if (t >= start.getTime() - 6 * DAY) return 'Últimos 7 días'
  return 'Antes'
}
const groups = computed(() => {
  const q = search.value.trim().toLowerCase()
  const out = []
  for (const c of conversations.value) {
    if (c.agent) continue // los agentes tienen su sección
    if (q && !c.title.toLowerCase().includes(q)) continue
    const name = dayGroup(c.updated)
    let g = out.find((x) => x.name === name)
    if (!g) { g = { name, items: [] }; out.push(g) }
    g.items.push(c)
  }
  return out
})
const openKeys = computed(() => new Set(tabs.value.map((t) => t.key)))

// ── LAS RESPUESTAS, en Markdown ── El HTML crudo que venga en una respuesta se muestra como texto (no se ejecuta), y
// los enlaces sólo pueden ser http(s): lo que escribe un modelo no es de confianza. Un bloque de código lleva su
// lenguaje y su «Copiar» (un clic delegado en el hilo, abajo).
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const renderer = new marked.Renderer()
renderer.html = ({ text }) => escapeHtml(text)
const baseLink = renderer.link.bind(renderer)
renderer.link = function (token) {
  if (!/^https?:\/\//i.test(token.href || '')) return escapeHtml(token.text || '')
  return baseLink(token).replace(/^<a /, '<a target="_blank" rel="noopener" ')
}
renderer.image = ({ text }) => escapeHtml(text || '')
renderer.code = ({ text, lang }) => {
  const label = escapeHtml((lang || '').split(/\s/)[0] || 'código')
  return `<div class="code-block"><div class="code-head"><span>${label}</span><button type="button" class="btn btn-ghost btn-xs code-copy">Copiar</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`
}
const md = (text) => marked.parse(text || '', { gfm: true, breaks: false, renderer })
function onThreadClick(e) {
  const button = e.target.closest?.('.code-copy')
  if (!button) return
  const code = button.closest('.code-block')?.querySelector('code')?.textContent || ''
  navigator.clipboard.writeText(code).then(() => {
    button.textContent = 'Copiado'
    setTimeout(() => { button.textContent = 'Copiar' }, 1500)
  }).catch(() => {})
}

const copiedId = ref('')
async function copy(m) {
  try { await navigator.clipboard.writeText(m.text); copiedId.value = m.id; setTimeout(() => { if (copiedId.value === m.id) copiedId.value = '' }, 1500) } catch { /* sin portapapeles */ }
}

// Sugerencias de una conversación vacía: sólo escriben en el campo, no mandan nada.
const SUGGESTIONS = [
  { label: 'Resumir un texto', text: 'Resumí en cinco puntos lo esencial de este texto:\n\n' },
  { label: 'Explicar algo', text: 'Explicame en palabras simples, con un ejemplo: ' },
  { label: 'Revisar código', text: 'Revisá este código y decime qué puede fallar:\n\n```\n\n```' },
  { label: 'Redactar un mensaje', text: 'Redactá un mensaje corto y cordial para ' },
]
function suggest(s) { draft.value = s.text; focusInput(true) }

// ── el hilo y el campo ──
const thread = ref(null)
const input = ref(null)
function scrollDown() { nextTick(() => { if (thread.value) thread.value.scrollTop = thread.value.scrollHeight }) }
function focusInput(toEnd = false) {
  nextTick(() => {
    const el = input.value
    if (!el) return
    el.focus()
    if (toEnd) el.setSelectionRange(el.value.length, el.value.length)
    grow()
  })
}
// El campo crece con lo escrito, hasta un tope (después scrollea).
function grow() {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.4))}px`
}
watch(draft, () => nextTick(grow))

const seconds = (ms) => (ms / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })
const pad = (n) => String(n).padStart(2, '0')
const clock = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
function when(iso) {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return clock(iso)
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const sidebarOpen = ref(readSize('wally.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('wally.sidebar-w', 260))
const shown = computed(() => {
  const [sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  return { sidebar }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px` }))
const sidebarResize = {
  label: 'Ancho de las conversaciones', sign: 1, defaultValue: 260,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('wally.sidebar-open', v ? 1 : 0); if (v) saveSize('wally.sidebar-w', sidebarW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('wally.sidebar-open', sidebarOpen.value ? 1 : 0) }
const onWindowResize = () => { viewportW.value = window.innerWidth; grow() }

const themeToggle = ref(null)
let themeBinding = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  await loadModels()
  await loadList()
  // Las pestañas recordadas cuya conversación ya no existe se cierran; sin ninguna, una nueva.
  const ids = new Set(conversations.value.map((c) => c.id))
  if (!apiError.value) tabs.value = tabs.value.filter((t) => isNew(t.key) || isGroup(t.key) || t.key === AGENT_NEW || ids.has(t.key))
  readRoute()
  if (!tabs.value.length) newTab()
  else activate(tabs.value.some((t) => t.key === active.value) ? active.value : tabs.value[0].key)
  // Cada 30 s: si la API no contestaba al abrir, aparece sola, y una pausa que venció habilita «Preguntar».
  refresher = setInterval(() => { if (!document.hidden && !pending.value) { loadModels(); loadList(); loadAgents(); loadAgentGroups() } }, 30_000)
  loadAgentGroups()
  loadAgents()
  groupPoll = setInterval(() => {
    if (document.hidden) return
    const running = agentGroups.value.some((g) => g.status === 'corriendo')
    if (group.value?.status === 'corriendo') loadGroup(active.value)
    if (running) { loadAgentGroups(); loadList() }
  }, 3_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  clearInterval(tick)
  clearInterval(refresher)
  clearInterval(groupPoll)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Conversaciones">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Wally</span>
        <span class="count">{{ conversations.length }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Conversación nueva" aria-label="Conversación nueva" @click="newTab">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="sidebar-search">
        <div class="input-group">
          <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          <input v-model="search" class="input input-sm" type="search" placeholder="Buscar conversaciones" aria-label="Buscar conversaciones" />
        </div>
      </div>
      <div class="region-body">
        <section class="agents">
          <div class="region-head group">
            <span>Agentes</span>
            <button type="button" class="region-action" title="Agente nuevo: una conversación larga con una intención y sus temas precargados" aria-label="Agente nuevo" @click="newAgentTab">
              <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
            </button>
          </div>
          <div v-for="a in agents" :key="a.conv" class="conv-row agent-row" :class="{ on: active === a.conv, open: openKeys.has(a.conv) }">
            <button type="button" class="conv" :title="`${a.agent.name}: ${a.agent.intent}\nTemas: ${a.agent.topics.join(', ')}`" @click="openTab(a.conv)">
              <span class="avatar agent-avatar">{{ a.agent.name[0] }}</span>
              <span class="agent-text">
                <span class="conv-title"><i v-if="pending && pending.key === a.conv" class="live-dot" aria-label="esperando la respuesta"></i>{{ a.agent.name }}</span>
                <span class="conv-meta">{{ a.agent.intent.replace(/^tener al día (el contexto de |el )?/i, '') }}</span>
              </span>
              <span v-if="a.changed" class="badge badge-xs" :title="`${a.changed} fuente${a.changed > 1 ? 's' : ''} de sus temas cambiaron en main: le toca a este agente`">{{ a.changed }}</span>
            </button>
            <button type="button" class="region-action conv-del" title="Borrar el agente y su conversación" aria-label="Borrar el agente" @click="removeConv({ id: a.conv, title: a.agent.name }).then(loadAgents)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </div>
          <p v-if="!agents.length" class="none">Ninguno todavía.</p>
        </section>
        <section class="agent-groups">
          <div class="region-head group">
            <span>Grupos de agentes</span>
            <button type="button" class="region-action" title="Grupo Knowledge nuevo: EVA y M-O ponen al día o revisan temas en paralelo" aria-label="Grupo nuevo" @click="newGroupTab">
              <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
            </button>
          </div>
          <div v-for="g in agentGroups" :key="g.id" class="conv-row" :class="{ on: active === `g:${g.id}` }">
            <button type="button" class="conv" @click="openTab(`g:${g.id}`)">
              <span class="conv-title"><i v-if="g.status === 'corriendo'" class="live-dot" aria-label="trabajando"></i>{{ g.title }}</span>
              <span class="conv-meta">{{ g.status }} · {{ g.members.map((m) => m.name).join(', ') }} · {{ when(g.updated) }}</span>
            </button>
            <button type="button" class="region-action conv-del" :disabled="g.status === 'corriendo'" title="Borrar el grupo" aria-label="Borrar el grupo" @click="removeGroup(g)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </div>
          <p v-if="!agentGroups.length" class="none">Ninguno todavía.</p>
        </section>
        <section v-for="g in groups" :key="g.name">
          <div class="region-head group"><span>{{ g.name }}</span></div>
          <div v-for="c in g.items" :key="c.id" class="conv-row" :class="{ on: active === c.id, open: openKeys.has(c.id) }">
            <button type="button" class="conv" :title="`${c.title} · ${modelName(c.model)}\nUn clic la abre de paso; doble clic la deja fija`"
                    @click="openTab(c.id, { preview: true })" @dblclick="openTab(c.id)">
              <span class="conv-title">
                <i v-if="pending && pending.key === c.id" class="live-dot" aria-label="esperando la respuesta"></i>
                {{ c.title }}
              </span>
              <span class="conv-meta">{{ c.mode ? `${MODES[c.mode]?.short || c.mode} · ` : '' }}{{ modelName(c.model) }} · {{ c.count }} bloque{{ c.count === 1 ? '' : 's' }} · {{ when(c.updated) }}</span>
            </button>
            <button type="button" class="region-action conv-del" title="Borrar la conversación" aria-label="Borrar la conversación" @click="removeConv(c)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </div>
        </section>
        <p v-if="!conversations.length" class="none">Todavía no le preguntaste nada.</p>
        <p v-else-if="!groups.length" class="none">Ninguna conversación dice «{{ search }}».</p>
      </div>
    </aside>

    <main class="editor">
      <nav class="tabs" aria-label="Conversaciones abiertas" @dblclick.self="newTab">
        <div v-for="t in tabs" :key="t.key" class="tab" :class="{ on: t.key === active, preview: t.preview }" role="tab" :aria-selected="t.key === active"
             @mousedown.middle.prevent="closeTab(t.key)">
          <button type="button" class="tab-label" :title="tabTitle(t)" @click="activate(t.key)" @dblclick="pinTab(t.key)">
            <i v-if="pending && pending.key === t.key" class="live-dot" aria-label="esperando la respuesta"></i>
            <span v-if="modeOf(t.key)" class="mode-badge" :title="MODES[modeOf(t.key)]?.label">{{ MODES[modeOf(t.key)]?.badge || 'A' }}</span>
            <span>{{ tabTitle(t) }}</span>
          </button>
          <button type="button" class="tab-close" :disabled="pending && pending.key === t.key" title="Cerrar la pestaña" aria-label="Cerrar la pestaña" @click="closeTab(t.key)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
        <div class="region-actions">
          <button type="button" class="region-action" title="Pestaña nueva" aria-label="Pestaña nueva" @click="newTab">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
          </button>
        </div>
      </nav>

      <!-- CREAR UN AGENTE -->
      <div v-if="active === AGENT_NEW" class="region-body group-new">
        <form class="group-new-inner" @submit.prevent="createAgent">
          <h2>Agente nuevo</h2>
          <p class="group-lede">Una conversación larga con <b>una intención</b>: lleva siempre precargados sus temas de knowledge (el texto vigente y el estado de sus fuentes contra main) y pide comandos de lectura como el asistente. No habla con otros agentes. Crearlo no le pregunta nada a Google.</p>
          <div class="group-option column">
            <label class="field"><b>Nombre</b><input v-model="agentForm.name" class="input input-sm" placeholder="Pikachu" maxlength="30" /></label>
            <label class="field"><b>Intención</b><input v-model="agentForm.intent" class="input input-sm" placeholder="tener al día el contexto de KYC" maxlength="140" /></label>
          </div>
          <div class="group-option column">
            <div><b>Sus temas</b><span>{{ agentForm.topics.length ? `${agentForm.topics.length} elegido${agentForm.topics.length > 1 ? 's' : ''}` : 'Los que lleva precargados en cada pregunta.' }}</span></div>
            <div class="topic-list">
              <label v-for="t in topics" :key="t.id" class="topic-item" :class="{ on: agentForm.topics.includes(t.id) }">
                <input type="checkbox" :checked="agentForm.topics.includes(t.id)" @change="toggleAgentTopic(t.id)" />
                <span class="topic-title">{{ t.title }}</span>
                <code>{{ t.id }}</code>
                <span v-if="t.changed" class="badge badge-xs">{{ t.changed }} cambiada{{ t.changed > 1 ? 's' : '' }}</span>
              </label>
              <p v-if="!topics.length" class="none">Cargando los temas…</p>
            </div>
            <div class="group-actions">
              <label v-if="models.length > 1" class="select model-select" title="El modelo del agente (se cambia después en su conversación)">
                <select v-model="agentForm.model" class="input input-xs" aria-label="Modelo del agente">
                  <option value="">{{ modelName(lastModel) }} (el de siempre)</option>
                  <option v-for="m in models" :key="m.name" :value="m.name">{{ m.displayName }}</option>
                </select>
              </label>
              <button type="submit" class="btn btn-sm" :disabled="!agentForm.name.trim() || !agentForm.intent.trim() || !agentForm.topics.length || agentForm.busy">Crear</button>
            </div>
          </div>
          <div v-if="agentForm.error" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ agentForm.error }}</p></div></div>
        </form>
      </div>

      <!-- ARMAR UN GRUPO -->
      <div v-else-if="active === GROUP_NEW" class="region-body group-new">
        <div class="group-new-inner">
          <h2>Grupo Knowledge</h2>
          <p class="group-lede">Wally coordina; <b>EVA</b> y <b>M-O</b> trabajan en paralelo en AI Studio, cada uno con un tema y su paquete en un solo envío. Corren solos los comandos de lectura que pidan; <b>nada se escribe en knowledge</b>: las propuestas quedan para revisar.</p>
          <div class="group-option">
            <div>
              <b>Poner al día lo pendiente</b>
              <span>{{ pendingTopicCount ? `${pendingTopicCount} tema${pendingTopicCount > 1 ? 's tienen' : ' tiene'} fuentes que cambiaron en main` : 'Ningún tema tiene fuentes cambiadas en main: la biblioteca está al día' }}</span>
            </div>
            <button type="button" class="btn btn-sm" :disabled="!pendingTopicCount || groupForm.busy" @click="startGroup(true)">Empezar</button>
          </div>
          <div class="group-option column">
            <div>
              <b>Revisar temas</b>
              <span>Que comprueben contra main lo que dicen los temas que marques{{ groupForm.topics.length ? ` (${groupForm.topics.length})` : '' }}.</span>
            </div>
            <div class="topic-list">
              <label v-for="t in topics" :key="t.id" class="topic-item" :class="{ on: groupForm.topics.includes(t.id) }">
                <input type="checkbox" :checked="groupForm.topics.includes(t.id)" @change="toggleGroupTopic(t.id)" />
                <span class="topic-title">{{ t.title }}</span>
                <code>{{ t.id }}</code>
                <span v-if="t.changed" class="badge badge-xs">{{ t.changed }} cambiada{{ t.changed > 1 ? 's' : '' }}</span>
              </label>
            </div>
            <div class="group-actions">
              <label v-if="models.length > 1" class="select model-select" title="El modelo de los agentes">
                <select v-model="groupForm.model" class="input input-xs" aria-label="Modelo de los agentes">
                  <option value="">{{ modelName(lastModel) }} (el de siempre)</option>
                  <option v-for="m in models" :key="m.name" :value="m.name" :disabled="!!m.paused">{{ m.displayName }}</option>
                </select>
              </label>
              <button type="button" class="btn btn-sm" :disabled="!groupForm.topics.length || groupForm.busy" @click="startGroup(false)">Revisar {{ groupForm.topics.length || '' }}</button>
            </div>
          </div>
          <div v-if="groupForm.error" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ groupForm.error }}</p></div></div>
        </div>
      </div>

      <!-- UN GRUPO TRABAJANDO: los agentes arriba (tocar uno abre su conversación), el chat del grupo abajo -->
      <div v-else-if="isGroup(active)" class="region-body group-view" @click="onThreadClick">
        <template v-if="group">
          <div class="group-members">
            <button v-for="m in group.members" :key="m.name" type="button" class="member" :class="`is-${memberTone(m)}`" :disabled="!m.conv"
                    :title="m.conv ? `Abrir la conversación de ${m.name}` : `${m.name} todavía no empezó`" @click="m.conv && openTab(m.conv)">
              <span class="avatar member-avatar">{{ AUTHOR[m.name]?.badge || m.name[0] }}</span>
              <span class="member-main">
                <b>{{ m.name }}</b>
                <span>{{ m.status }}{{ m.topic ? ` · ${m.topic}` : '' }}{{ m.rounds ? ` · vuelta ${m.rounds}` : '' }}</span>
              </span>
              <span v-if="m.done" class="count">{{ m.done }} hecho{{ m.done > 1 ? 's' : '' }}</span>
              <i v-if="m.status === 'trabajando'" class="live-dot"></i>
            </button>
          </div>
          <ol class="posts">
            <li v-for="p in group.posts" :key="p.id" class="post" :class="[`kind-${p.kind}`, { coordinator: p.author === 'Wally' }]">
              <span class="avatar">{{ AUTHOR[p.author]?.badge || p.author[0] }}</span>
              <div class="post-main">
                <div class="post-head"><b>{{ p.author }}</b><span>{{ AUTHOR[p.author]?.role }}</span><span class="post-kind">{{ KIND[p.kind] || p.kind }}</span><span>{{ clock(p.at) }}</span></div>
                <div class="answer-body" v-html="md(p.text)"></div>
                <button v-if="p.conv" type="button" class="btn btn-ghost btn-xs" @click="openTab(p.conv)"><span class="ui-icon" data-icon="external" aria-hidden="true"></span>Abrir la conversación</button>
              </div>
            </li>
          </ol>
          <p v-if="group.status === 'corriendo'" class="thinking group-working"><span class="typing"><i></i><i></i><i></i></span>trabajando…</p>
        </template>
        <p v-else class="none">Cargando el grupo…</p>
      </div>

      <template v-else>
      <div ref="thread" class="region-body thread" :class="{ dragging }" @click="onThreadClick"
           @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
        <div v-if="dragging" class="drop-hint"><span class="ui-icon" data-icon="attach" aria-hidden="true"></span>Soltá para adjuntar: el texto viaja con la pregunta</div>
        <div v-if="agentOf" class="agent-sheet">
          <span class="avatar agent-avatar big">{{ agentOf.name[0] }}</span>
          <div class="agent-sheet-main">
            <div><b>{{ agentOf.name }}</b> · {{ agentOf.intent }}</div>
            <div class="agent-topics">
              <span>precarga</span><code v-for="t in agentOf.topics" :key="t">{{ t }}</code>
              <span v-if="agentRow(active)?.changed" class="badge badge-xs">{{ agentRow(active).changed }} fuente{{ agentRow(active).changed > 1 ? 's' : '' }} cambiaron en main</span>
              <span v-else-if="agentRow(active)" class="count">sus fuentes, al día</span>
            </div>
          </div>
        </div>
        <div v-if="agentOf && !messages.length && !(pending && pending.key === active)" class="suggestions agent-prompts">
          <button v-for="s in AGENT_PROMPTS" :key="s.label" type="button" class="btn btn-outline btn-sm" @click="suggest(s)">{{ s.label }}</button>
        </div>
        <div v-if="!agentOf && !messages.length && !(pending && pending.key === active)" class="empty">
          <div class="empty-head">
            <div class="empty-media"><span class="ui-icon" data-icon="comment" aria-hidden="true"></span></div>
            <div class="empty-title">{{ mode ? 'Preguntale al asistente' : 'Preguntale a Wally' }}</div>
            <div class="empty-desc">Pregunta por la web de AI Studio, en tu Chrome y con tu cuenta, sin llave de API. Lo que quede guardado acá es el contexto de la próxima pregunta.</div>
          </div>
          <div class="mode-pick" role="radiogroup" aria-label="Qué hace esta conversación">
            <button type="button" class="mode-card" role="radio" :aria-checked="!mode" @click="chooseMode('')">
              <span class="ui-icon" data-icon="comment" aria-hidden="true"></span><b>Chat</b><span>Preguntás y contesta.</span>
            </button>
            <button type="button" class="mode-card" role="radio" :aria-checked="mode === 'asistente'" @click="chooseMode('asistente')">
              <span class="ui-icon" data-icon="folder" aria-hidden="true"></span><b>Asistente</b><span>Lee WALLY.md: conoce tus herramientas y te pide comandos de lectura (knowledge, trampas, guías, tareas). Vos aprobás cada uno.</span>
            </button>
          </div>
          <div v-if="!mode" class="suggestions">
            <button v-for="s in SUGGESTIONS" :key="s.label" type="button" class="btn btn-outline btn-sm" @click="suggest(s)">{{ s.label }}</button>
          </div>
        </div>
        <template v-for="m in messages" :key="m.id">
          <div v-if="m.role === 'user'" class="block block-user">
            <button type="button" class="region-action block-del" :disabled="!!pending" title="Borrar esta pregunta del contexto" aria-label="Borrar esta pregunta del contexto" @click="removeBlock(m)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
            <div class="user-col">
              <div class="bubble mine" :title="clock(m.at)">{{ m.text }}</div>
              <div v-if="m.files?.length" class="file-chips sent">
                <button v-for="f in m.files" :key="f.id" type="button" class="file-chip" :class="{ on: openFile.id === f.id }" :title="`${f.name} · ${sizeLabel(f.size)} · ${charsLabel(f.chars)} de texto: tocá para verlo`" @click="toggleFile(f)">
                  <span class="file-kind">{{ FILE_ICON[f.kind] || 'TXT' }}</span><span class="file-name">{{ f.name }}</span><span class="file-size">{{ charsLabel(f.chars) }}</span>
                </button>
              </div>
            </div>
          </div>
          <div v-if="m.role === 'user' && m.files?.some((f) => f.id === openFile.id)" class="file-view">
            <div class="file-view-head">
              <b>{{ m.files.find((f) => f.id === openFile.id)?.name }}</b>
              <span class="count">el texto que viaja con la pregunta</span>
              <button v-if="openFile.text.length > PREVIEW_CHARS" type="button" class="btn btn-ghost btn-xs" @click="openFile.full = !openFile.full">{{ openFile.full ? 'Ver menos' : 'Ver todo' }}</button>
              <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="openFile = { id: '', text: '', full: false }"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
            </div>
            <pre>{{ openFile.full ? openFile.text : openFile.text.slice(0, PREVIEW_CHARS) + (openFile.text.length > PREVIEW_CHARS ? '\n…' : '') }}</pre>
          </div>
          <article v-if="m.role === 'model'" class="block answer">
            <div class="answer-who"><span class="avatar" aria-hidden="true">W</span><b>Wally</b><span>{{ modelName(m.model) }} · {{ seconds(m.ms) }} s · {{ clock(m.at) }}</span></div>
            <div class="answer-body" v-html="md(answerText(m))"></div>
            <div v-if="m.commands?.length" class="commands">
              <div class="commands-head"><span class="ui-icon" data-icon="console" aria-hidden="true"></span>Wally pide correr {{ m.commands.length === 1 ? 'un comando' : `${m.commands.length} comandos` }} de sólo lectura{{ proposedCount(m) ? ': decidí cada uno' : '' }}</div>
              <div v-for="c in m.commands" :key="c.id" class="command" :class="`is-${c.status}`">
                <code class="command-line">{{ c.cmd }}</code>
                <template v-if="c.status === 'propuesto'">
                  <button type="button" class="btn btn-sm" :disabled="!!running || !!pending" @click="commandAction(m, c, 'run')">
                    <span class="ui-icon" data-icon="play" aria-hidden="true"></span>{{ running === c.id ? 'Corriendo…' : 'Correr' }}
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm" :disabled="!!running || !!pending" @click="commandAction(m, c, 'decline')">Descartar</button>
                </template>
                <template v-else-if="c.status === 'corrido'">
                  <button v-if="c.output" type="button" class="file-chip" :class="{ on: openFile.id === c.output.id }" :title="'Ver la salida que viaja con la respuesta'" @click="toggleFile(c.output)">
                    <span class="file-kind">OUT</span><span class="file-name">salida</span><span class="file-size">{{ charsLabel(c.output.chars) }} · {{ seconds(c.ms) }} s{{ c.exit ? ` · código ${c.exit}` : '' }}</span>
                  </button>
                  <span v-else class="command-status warn-text">{{ c.reason }}</span>
                </template>
                <span v-else-if="c.status === 'descartado'" class="command-status">descartado</span>
                <span v-else class="command-status warn-text" :title="c.reason">no permitido</span>
              </div>
              <div v-if="m.commands.some((c) => c.output && c.output.id === openFile.id)" class="file-view">
                <div class="file-view-head">
                  <b>{{ m.commands.find((c) => c.output?.id === openFile.id)?.cmd }}</b>
                  <span class="count">la salida que viaja con esta respuesta</span>
                  <button v-if="openFile.text.length > PREVIEW_CHARS" type="button" class="btn btn-ghost btn-xs" @click="openFile.full = !openFile.full">{{ openFile.full ? 'Ver menos' : 'Ver todo' }}</button>
                  <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="openFile = { id: '', text: '', full: false }"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
                </div>
                <pre>{{ openFile.full ? openFile.text : openFile.text.slice(0, PREVIEW_CHARS) + (openFile.text.length > PREVIEW_CHARS ? '\n…' : '') }}</pre>
              </div>
            </div>
            <div class="answer-meta">
              <button type="button" class="btn btn-ghost btn-xs" @click="copy(m)">
                <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>{{ copiedId === m.id ? 'Copiado' : 'Copiar' }}
              </button>
              <button type="button" class="btn btn-ghost btn-xs block-del" :disabled="!!pending" title="Borrar esta respuesta del contexto" @click="removeBlock(m)">
                <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>Borrar
              </button>
            </div>
          </article>
        </template>
        <div v-if="awaitingResults && !pending" class="results-bar">
          <span>{{ awaitingResults.ran ? `${awaitingResults.ran} de ${awaitingResults.total} corrido${awaitingResults.total > 1 ? 's' : ''}: sus salidas viajan con la próxima pregunta.` : 'Descartaste todo lo que pidió.' }}</span>
          <button type="button" class="btn btn-sm" :disabled="!!allPaused" @click="sendResults"><span class="ui-icon" data-icon="send" aria-hidden="true"></span>{{ awaitingResults.ran ? 'Mandar resultados' : 'Seguir sin eso' }}</button>
        </div>
        <template v-if="pending && pending.key === active">
          <div class="block block-user"><div class="user-col">
            <div class="bubble mine">{{ pending.text }}</div>
            <div v-if="pending.files?.length" class="file-chips sent">
              <span v-for="f in pending.files" :key="f.id" class="file-chip"><span class="file-kind">{{ FILE_ICON[f.kind] || 'TXT' }}</span><span class="file-name">{{ f.name }}</span></span>
            </div>
          </div></div>
          <article class="answer">
            <div class="answer-who"><span class="avatar" aria-hidden="true">W</span><b>Wally</b><span>{{ modelName(pending.model) }} · en AI Studio, en tu Chrome · {{ elapsed }} s</span></div>
            <div class="typing" aria-label="pensando"><i></i><i></i><i></i></div>
          </article>
        </template>
        <div v-if="error" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ error }}</p></div></div>
      </div>

      <form class="composer" @submit.prevent="send">
        <div class="composer-box" :class="{ dragging }" @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
          <div v-if="pendingFiles.length || uploading[active]" class="file-chips">
            <span v-for="f in pendingFiles" :key="f.id" class="file-chip" :title="`${f.name} · ${sizeLabel(f.size)} · ${charsLabel(f.chars)} de texto`">
              <span class="file-kind">{{ FILE_ICON[f.kind] || 'TXT' }}</span><span class="file-name">{{ f.name }}</span><span class="file-size">{{ charsLabel(f.chars) }}</span>
              <button type="button" class="file-del" title="Quitar el archivo" aria-label="Quitar el archivo" @click="removeAttachment(f)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
            </span>
            <span v-if="uploading[active]" class="file-chip uploading"><i class="live-dot"></i>leyendo {{ uploading[active] }} archivo{{ uploading[active] > 1 ? 's' : '' }}…</span>
          </div>
          <textarea ref="input" v-model="draft" class="composer-input" rows="2" placeholder="Preguntale algo… (Enter manda, Shift+Enter baja de renglón)"
                    aria-label="La pregunta" @keydown="onKey" @input="grow" @paste="onPaste"></textarea>
          <div class="composer-bar">
            <input ref="fileInput" type="file" multiple hidden @change="pickFiles" />
            <button type="button" class="region-action" title="Adjuntar archivos: texto y código, PDF o Word. También se pueden arrastrar" aria-label="Adjuntar archivos" @click="fileInput?.click()">
              <span class="ui-icon" data-icon="attach" aria-hidden="true"></span>
            </button>
            <label v-if="models.length > 1" class="select model-select" title="El modelo que contesta en esta pestaña">
              <select v-model="model" class="input input-xs" aria-label="Modelo" :disabled="!models.length">
                <option v-for="m in models" :key="m.name" :value="m.name" :disabled="!!m.paused">{{ m.displayName }}{{ m.paused ? ` · en pausa hasta las ${m.paused}` : m.note ? ` · ${m.note}` : '' }}</option>
              </select>
            </label>
            <span class="count" :title="'Lo que viaja como contexto en la próxima pregunta: AI Studio no recuerda nada (chat temporal), así que se le manda todo lo guardado. Borrá los bloques que no hagan falta.'">
              {{ messages.length ? `contexto: ${messages.length} bloque${messages.length > 1 ? 's' : ''}${contextFiles ? ` · ${contextFiles} archivo${contextFiles > 1 ? 's' : ''}` : ''} · ${contextChars.toLocaleString('es-CO')} car.` : 'sin contexto' }}
            </span>
            <span v-if="allPaused" class="composer-note warn-text">Google cortó: en pausa hasta las {{ allPaused }}</span>
            <span v-else-if="busyElsewhere" class="composer-note">Wally está contestando en otra pestaña</span>
            <button type="submit" class="btn btn-sm send" :disabled="(!draft.trim() && !pendingFiles.length) || !!pending || !!allPaused || !!uploading[active]" title="Preguntar (Enter)">
              <span class="ui-icon" data-icon="send" aria-hidden="true"></span>Preguntar
            </button>
          </div>
        </div>
      </form>
      </template>
    </main>

    <footer class="statusbar">
      <span v-if="apiError" class="warn-text">{{ apiError }}</span>
      <span v-else>{{ tabs.length }} abierta{{ tabs.length === 1 ? '' : 's' }} · por la web de AI Studio{{ allPaused ? ` · en pausa hasta las ${allPaused}` : pausedCount ? ` · ${pausedCount} modelo${pausedCount > 1 ? 's' : ''} en pausa` : '' }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las conversaciones" aria-label="Mostrar u ocultar las conversaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
