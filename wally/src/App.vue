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
// Lo que se ve es el nombre RECONOCIBLE (Gemini, DeepSeek, ChatGPT, Groq) aunque por debajo el modelo se llame
// distinto (Miguel, 2026-11-17: «como con Gemini, que por debajo es Hydrogen»). El interno va chico, como dato.
const BRAND = { 'gemini-4-hydrogen': 'Gemini', 'gemini-3.8-flash': 'Gemini', 'deepseek-web': 'DeepSeek', 'chatgpt-web': 'ChatGPT', 'groq-web': 'Groq' }
const modelName = (name) => BRAND[(name || '').split(':')[0]] || models.value.find((m) => m.name === name)?.displayName || prettyModel(name)

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
  if (isNew(key) || isGroup(key) || key === AGENT_NEW || key === CONFIG) return
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
  else if (parts[0] === 'configuracion') toggleAux(true)
  else if (parts[0] === 'g' && parts[1]) openTab(`g:${decodeURIComponent(parts[1])}`)
  else if (parts[0] === 'nueva' && parts[1] && tabs.value.some((t) => t.key === `nueva-${parts[1]}`)) activate(`nueva-${parts[1]}`)
}

// ── LA CONVERSACIÓN CON WALLY ── (como «Mi chat» del chat) Una sola, arriba en la lista: hablarle a Wally, el
// orquestador. Es del modo asistente, así que conoce las herramientas (WALLY.md). La crea el servidor la primera vez.
const mainId = ref('')
async function loadMain() {
  try {
    const c = await api('/api/main')
    mainId.value = c.id
    loaded.value = { ...loaded.value, [c.id]: loaded.value[c.id] || c }
  } catch { /* lo dice loadList */ }
}
function openMain() { if (mainId.value) openTab(mainId.value) }
const MAIN_PROMPTS = [
  { label: '¿Qué podés hacer?', text: 'Contame en pocas líneas qué podés hacer por mí y con qué herramientas.' },
  { label: '¿Qué agentes tengo?', text: 'Contame qué agentes tengo y de qué se ocupa cada uno.' },
  { label: 'Buscar en knowledge', text: 'Buscá en knowledge lo que haya sobre ' },
]
const mainSummary = computed(() => conversations.value.find((c) => c.id === mainId.value))

// ── LA CONFIGURACIÓN ── (wally/server/config.go) Con qué proveedor contesta Wally y cómo, guardada en el servidor al
// tocarla (como la de avisos del chat). Vale desde la próxima pregunta. La pestaña es `config`.
const CONFIG = 'config'
const config = ref(null)
const usageToday = ref({ today: [], paused: {} })
const configError = ref('')
async function loadConfig() { try { config.value = await api('/api/config'); configError.value = '' } catch (e) { configError.value = e.message } }
async function loadUsage() { try { usageToday.value = await api('/api/usage') } catch { /* lo dice loadConfig */ } }
async function saveConfig(patch) {
  try {
    config.value = await api('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    configError.value = ''
    loadModels()
  } catch (e) { configError.value = e.message }
}
function openConfig() { if (shown.value.aux && auxTab.value === 'model') toggleAux(false); else { toggleAux(true); setAuxTab('model') } }
const PROVIDERS = [
  { id: 'aistudio', name: 'Gemini', note: 'Gemini 4 Hydrogen (pensando a fondo) por la web de Google AI Studio, con tu cuenta. Cupo diario.' },
  { id: 'deepseek', name: 'DeepSeek', note: 'chat.deepseek.com con tu sesión. Cada pregunta queda en su historial, en servidores en China.' },
  { id: 'chatgpt', name: 'ChatGPT', note: 'chatgpt.com en chat temporal: no queda en tu historial (puede guardar una copia 30 días). Gratis: hasta ~40 mil caracteres.' },
  { id: 'groq', name: 'Groq', note: 'chat.groq.com: el ultra rápido (~480 tokens/s), modelos abiertos. Sin historial. Hasta ~20 mil caracteres: para lo corto.' },
]
const GROQ_MODELS = { 'openai/gpt-oss-120b': 'GPT OSS 120B', 'openai/gpt-oss-20b': 'GPT OSS 20B' }
const WINDOWS = { minimized: 'Minimizada', aside: 'Ventana aparte', tab: 'Pestaña' }
// El proveedor de ahora, para los textos: sale del modelo que da el servidor (la configuración se carga sólo en su pestaña).
const providerName = computed(() => PROVIDER_NAME[effectiveProvider.value] || 'Gemini')
const USAGE_NAME = { 'gemini-4-hydrogen': 'Gemini (4 Hydrogen)', 'gemini-3.8-flash': 'Gemini (3.8 Flash)', 'deepseek-web': 'DeepSeek', 'chatgpt-web': 'ChatGPT', 'groq-web:openai/gpt-oss-120b': 'Groq (GPT OSS 120B)', 'groq-web:openai/gpt-oss-20b': 'Groq (GPT OSS 20B)' }

// ── LOS AGENTES ── (wally/server/agents.go) Cada uno es UNA conversación larga con nombre propio y una intención (poner y
// tener al día el contexto de una parte, p. ej. KYC), que lleva siempre precargados sus temas de knowledge y el estado
// de sus fuentes contra main. No hablan entre ellos. La lista dice cuántas fuentes de sus temas cambiaron: así se ve
// quién tiene que tomar un cambio.
const AGENT_NEW = 'a:nuevo'
const agents = ref([])
const EMPTY_AGENT = () => ({ name: '', intent: '', notes: '', files: [], topics: [], showTopics: false, uploading: 0, model: '', busy: false, error: '' })
const agentForm = ref(EMPTY_AGENT())
const agentFileInput = ref(null)
// Los archivos del contexto de un agente: se suben como los de una pregunta (el texto se saca en esta máquina).
async function addAgentFiles(list) {
  const f = agentForm.value
  for (const file of [...list]) {
    f.uploading++
    try {
      const body = new FormData()
      body.append('file', file)
      f.files = [...f.files, await api('/api/files', { method: 'POST', body })]
    } catch (e) { f.error = e.message } finally { f.uploading-- }
  }
}
function removeAgentFile(att) {
  agentForm.value.files = agentForm.value.files.filter((x) => x.id !== att.id)
  api(`/api/files/${encodeURIComponent(att.id)}`, { method: 'DELETE' }).catch(() => {})
}
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
      body: JSON.stringify({ name: f.name, intent: f.intent, notes: f.notes, fileIds: f.files.map((x) => x.id), topics: f.topics, model: f.model || lastModel.value }) })
    loaded.value = { ...loaded.value, [c.id]: c }
    const i = tabs.value.findIndex((t) => t.key === AGENT_NEW)
    if (i >= 0) tabs.value.splice(i, 1, { key: c.id, preview: false })
    agentForm.value = EMPTY_AGENT()
    await Promise.all([loadList(), loadAgents()])
    activate(c.id)
  } catch (e) { f.error = e.message } finally { f.busy = false }
}
const agentRow = (key) => agents.value.find((a) => a.conv === key)
// EL PROVEEDOR DE CADA AGENTE: «el de la configuración» o uno elegido para él (que vale como permiso para ese agente).
// El servidor dice por dónde va a contestar de verdad (`effective`) y cuánto pesa lo que manda (precarga + conversación).
const providers = ref([])
const providersInfo = ref({ default: 'aistudio', agentsOther: false, checking: false, checked: '' })
async function loadProviders() {
  try {
    const r = await api('/api/providers')
    providers.value = r.providers
    providersInfo.value = { default: r.default, agentsOther: r.agentsOther, checking: r.checking, checked: r.checked }
  } catch { /* lo dice loadList */ }
}
// «Comprobar ahora» (en la configuración): el servidor mira cada web sin preguntar nada; se sigue hasta que termina.
async function checkProvidersNow() {
  try { await api('/api/providers/check', { method: 'POST' }) } catch (e) { configError.value = e.message; return }
  providersInfo.value = { ...providersInfo.value, checking: true }
  const poll = setInterval(async () => { await loadProviders(); if (!providersInfo.value.checking) clearInterval(poll) }, 1500)
}
// EL PROVEEDOR DE LA BARRA ES UNO PARA TODO (Miguel, 2026-11-17: «el chat arranca con el modelo que se haya colocado
// en el input; si se cambia en la conversación, no importa: no tiene que ver con el chat»). Es el de la configuración:
// elegirlo en la barra lo guarda ahí, y cada respuesta dice con cuál salió. Sin «Automático» ni proveedor por chat.
const effectiveProvider = computed(() => providersInfo.value.default)
async function setProvider(id) {
  try {
    await api('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: id }) })
    await loadProviders()
    if (config.value) config.value = { ...config.value, provider: id }
    loadModels()
  } catch (e) { errors.value = { ...errors.value, [active.value]: e.message } }
}
// LA CUENTA REGRESIVA de una pausa: un reloj que late cada segundo y cuánto falta para que vuelva.
const now = ref(Date.now())
let ticker = null
function timeLeft(until) {
  const s = Math.max(0, Math.round((until - now.value) / 1000))
  if (!s) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m}:${String(sec).padStart(2, '0')}`
}
// LOS TOKENS de cada uno: el techo de su modelo más poderoso según lo publicado (el detalle y lo medido, en el título).
const tokensLabel = (p) => (p?.context ? `${p.context >= 1_000_000 ? `${Math.round(p.context / 1_048_576 * 10) / 10 || 1}M` : `${Math.round(p.context / 1000)}k`} tokens` : '')
const providerOf = (id) => providers.value.find((p) => p.id === id)
const effectivePaused = computed(() => providerOf(effectiveProvider.value)?.paused || '')
const providerState = (id) => (providerOf(id)?.paused ? 'pausa' : providerOf(id)?.status?.state || 'sin-comprobar')
// EL MENÚ DE LA BARRA: el modelo que contesta en grande y, chico, por dónde va. Lo que no se puede usar ahora queda
// deshabilitado y el mouse dice por qué (con `aria-disabled` y no `disabled`: Chrome no muestra el título de un botón
// deshabilitado).
const providerMenu = ref(false)
const modelLabel = (id) => PROVIDER_NAME[id] || id
// El modelo interno, sólo si dice algo más que el nombre (Gemini 4 Hydrogen, GPT OSS 120B).
const innerModel = (id) => { const m = providerOf(id)?.model?.displayName || ''; return m && m !== PROVIDER_NAME[id] ? m : '' }
function unavailableReason(id) {
  const p = providerOf(id)
  if (!p) return ''
  if (p.paused) return id === 'aistudio' ? `En pausa hasta las ${p.paused}: se acabó el cupo diario de Gemini (lo dijo su último aviso)` : `En pausa hasta las ${p.paused}: cortó por el ritmo`
  if (p.status?.state === 'proximamente') return p.status.detail
  if (p.status?.state === 'sin-sesion') return `${PROVIDER_NAME[id]} pide entrar: hacelo a mano en tu Chrome y tocá «Comprobar ahora» en la configuración`
  if (p.status?.state === 'sin-jarvis') return 'Jarvis no está conectado en Chrome: abrí Chrome o tocá el ícono de Jarvis'
  if (p.status?.state === 'error') return p.status.detail
  return ''
}
function pickProvider(id) {
  if (unavailableReason(id)) return
  providerMenu.value = false
  if (id !== effectiveProvider.value) setProvider(id)
}
function closeProviderMenu(e) { if (providerMenu.value && !e.target.closest?.('.provider-menu-wrap')) providerMenu.value = false }
// Lo que viaja (la precarga del agente, si es uno, más la conversación y lo escrito) contra el tope del proveedor.
const fit = computed(() => {
  const limit = providerOf(effectiveProvider.value)?.limit || 0
  const total = (agentRow(active.value)?.preload || 0) + contextChars.value + (draft.value?.length || 0)
  return { limit, total, over: limit > 0 && total > limit }
})
const PROVIDER_NAME = { aistudio: 'Gemini', deepseek: 'DeepSeek', chatgpt: 'ChatGPT', groq: 'Groq', kimi: 'Kimi' }
async function setAgentProvider(key, provider) {
  try {
    const c = await api(`/api/agents/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider }) })
    loaded.value = { ...loaded.value, [key]: c }
    await loadAgents()
  } catch (e) { errors.value = { ...errors.value, [key]: e.message } }
}
// EL COLOR DE CADA AGENTE: un tono sacado de su nombre, el mismo en la lista, su ficha y sus burbujas (como en el chat).
// Wally, sin agente, va con el color del tema.
// El número del nombre se multiplica por el ángulo áureo (137,5°): nombres parecidos quedan en tonos lejanos.
function agentHue(name) { let h = 0; for (const ch of name || '') h = (h * 31 + ch.codePointAt(0)) >>> 0; return Math.round((h * 137.508) % 360) }
const agentStyle = (name) => (name ? { background: `oklch(0.66 0.14 ${agentHue(name)})`, color: 'white' } : null)
const agentInk = (name) => (name ? { color: `oklch(0.62 0.15 ${agentHue(name)})` } : null)
const agentOf = computed(() => conv.value?.agent || null)
const speaker = computed(() => (agentOf.value ? { name: agentOf.value.name, agent: true } : { name: 'Wally', agent: false }))
const AGENT_PROMPTS_GENERIC = [
  { label: 'Contame qué entendiste', text: 'Contame en pocas líneas qué entendiste de tu intención y de tu contexto, y qué te falta saber para hacerlo bien.' },
  { label: 'Arrancá', text: 'Arrancá con tu intención: decime por dónde empezarías y hacé el primer paso.' },
]
const agentPrompts = computed(() => (agentOf.value?.topics?.length ? AGENT_PROMPTS : AGENT_PROMPTS_GENERIC))
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
  if (!text || pending.value || effectivePaused.value || uploading.value[key]) return
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
      body: JSON.stringify({ id: isNew(key) ? '' : key, model: pending.value.model, text, files: files.map((f) => f.id), mode: isNew(key) ? (tabMode.value[key] || '') : '', provider: effectiveProvider.value }) })
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
    if (c.agent || c.main) continue // los agentes y Wally tienen su lugar arriba
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
const auxOpen = ref(readSize('wally.aux-open', 1) !== 0)
const auxW = ref(readSize('wally.aux-w', 340))
const shown = computed(() => {
  const [sidebar, aux] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
    { size: auxOpen.value ? auxW.value : 0, min: 280 },
  ])
  return { sidebar, aux }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px` }))
const auxResize = {
  label: 'Ancho de la configuración', sign: -1, defaultValue: 340,
  min: () => 280, max: () => viewportW.value - cssSize('--editor-min', 360) - shown.value.sidebar,
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('wally.aux-open', v ? 1 : 0); if (v) saveSize('wally.aux-w', auxW.value) },
}
const AUX_TABS = [
  { id: 'agents', label: 'Agentes' },
  { id: 'model', label: 'Modelo: con qué contesta Wally', icon: 'settings' },
  { id: 'services', label: 'Servicios: qué está listo y qué en pausa', icon: 'server' },
  { id: 'today', label: 'Hoy: cuánto se le preguntó a cada uno', icon: 'clock' },
]
const auxTab = ref(readPref('wally.aux-tab', 'agents'))
function setAuxTab(id) { auxTab.value = id; savePref('wally.aux-tab', id); if (id === 'today') loadUsage(); if (id !== 'agents') loadConfig() }
// El anillo de la pestaña de agentes: un arco por agente, en su color (como el del perfil del chat).
const agentRing = computed(() => {
  const n = agents.value.length
  if (!n) return []
  const c = 2 * Math.PI * 15, gap = n > 1 ? 2.2 : 0, len = c / n - gap
  return agents.value.map((a, i) => ({ name: a.agent.name, color: `oklch(0.66 0.14 ${agentHue(a.agent.name)})`, dash: `${len} ${c - len}`, offset: -i * (c / n) }))
})
// Un aviso en la pestaña de servicios si alguno no está listo (sin sesión, sin Jarvis, sin respuesta).
const servicesTrouble = computed(() => providers.value.some((p) => ['sin-sesion', 'sin-jarvis', 'error'].includes(p.status?.state)))
function toggleAux(open = !shown.value.aux) {
  auxOpen.value = open
  saveSize('wally.aux-open', open ? 1 : 0)
  if (open) { loadConfig(); loadUsage() }
}
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
  ticker = setInterval(() => { now.value = Date.now(); if (providers.value.some((p) => p.pausedUntil && p.pausedUntil <= now.value)) loadProviders() }, 1000)
  document.addEventListener('click', closeProviderMenu)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  await loadModels()
  await loadList()
  // Las pestañas recordadas cuya conversación ya no existe se cierran; sin ninguna, una nueva.
  const ids = new Set(conversations.value.map((c) => c.id))
  if (!apiError.value) tabs.value = tabs.value.filter((t) => isNew(t.key) || isGroup(t.key) || t.key === AGENT_NEW || ids.has(t.key))
  readRoute()
  await loadMain()
  if (shown.value.aux) { loadConfig(); loadUsage() }
  if (!tabs.value.length) { if (mainId.value) openMain(); else newTab() }
  else activate(tabs.value.some((t) => t.key === active.value) ? active.value : tabs.value[0].key)
  // Cada 30 s: si la API no contestaba al abrir, aparece sola, y una pausa que venció habilita «Preguntar».
  refresher = setInterval(() => { if (!document.hidden && !pending.value) { loadModels(); loadList(); loadAgents(); loadProviders(); loadAgentGroups() } }, 30_000)
  loadAgentGroups()
  loadAgents()
  loadProviders()
  groupPoll = setInterval(() => {
    if (document.hidden) return
    const running = agentGroups.value.some((g) => g.status === 'corriendo')
    if (group.value?.status === 'corriendo') loadGroup(active.value)
    if (running) { loadAgentGroups(); loadList() }
  }, 3_000)
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  document.removeEventListener('click', closeProviderMenu)
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
          <button type="button" class="region-action" :class="{ on: shown.aux }" :aria-pressed="!!shown.aux" title="Configuración: con qué proveedor contesta Wally (sidebar derecho)" aria-label="Configuración" @click="openConfig">
            <span class="ui-icon" data-icon="settings" aria-hidden="true"></span>
          </button>
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
        <section class="main-chat">
          <button type="button" class="conv main-row" :class="{ on: active === mainId }" :title="'Tu conversación con Wally, el orquestador'" @click="openMain">
            <span class="avatar main-avatar" aria-hidden="true">W</span>
            <span class="agent-text">
              <span class="conv-title"><i v-if="pending && pending.key === mainId" class="live-dot" aria-label="esperando la respuesta"></i>Wally</span>
              <span class="conv-meta">{{ mainSummary?.preview || 'Tu conversación con Wally' }}</span>
            </span>
          </button>
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
          <p class="group-lede">Una conversación larga con <b>una intención</b> y su <b>contexto</b>, que lleva precargado en cada pregunta: lo que le escribas, los archivos que le des y, si viene al caso, temas de knowledge. Puede pedir comandos de lectura, como el asistente. No habla con otros agentes. Crearlo no le pregunta nada al modelo.</p>
          <div class="group-option column">
            <label class="field"><b>Nombre</b><input v-model="agentForm.name" class="input input-sm" placeholder="Eevee" maxlength="30" /></label>
            <label class="field"><b>Intención</b><input v-model="agentForm.intent" class="input input-sm" placeholder="qué hace: «revisar los correos que le mandamos a VTEX», «tener al día KYC»…" maxlength="160" /></label>
          </div>
          <div class="group-option column">
            <div><b>Lo que tiene que saber</b><span>Instrucciones, datos, cómo querés que conteste. Va antes de cada pregunta.</span></div>
            <textarea v-model="agentForm.notes" class="input agent-notes" rows="5" placeholder="Por ejemplo: contestá corto y en español de Colombia; el comercio es…; lo que importa es…"></textarea>
            <div class="agent-files">
              <span v-for="f in agentForm.files" :key="f.id" class="file-chip" :title="`${f.name} · ${charsLabel(f.chars)} de texto`">
                <span class="file-kind">{{ FILE_ICON[f.kind] || 'TXT' }}</span><span class="file-name">{{ f.name }}</span><span class="file-size">{{ charsLabel(f.chars) }}</span>
                <button type="button" class="file-del" title="Quitar el archivo" aria-label="Quitar el archivo" @click="removeAgentFile(f)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
              </span>
              <button type="button" class="btn btn-outline btn-xs" @click="agentFileInput?.click()"><span class="ui-icon" data-icon="attach" aria-hidden="true"></span>{{ agentForm.uploading ? 'Subiendo…' : 'Adjuntar archivos' }}</button>
              <input ref="agentFileInput" type="file" multiple hidden @change="addAgentFiles($event.target.files); $event.target.value = ''" />
            </div>
          </div>
          <div class="group-option column">
            <button type="button" class="agent-topics-toggle" :aria-expanded="agentForm.showTopics" @click="agentForm.showTopics = !agentForm.showTopics">
              <b>Temas de knowledge</b><span>(opcional){{ agentForm.topics.length ? ` · ${agentForm.topics.length} elegido${agentForm.topics.length > 1 ? 's' : ''}` : '' }}: si es para tener al día una parte de la biblioteca</span>
              <span class="ui-icon topics-chevron" :class="{ open: agentForm.showTopics }" data-icon="chevron" aria-hidden="true"></span>
            </button>
            <div v-if="agentForm.showTopics" class="topic-list">
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
              <button type="submit" class="btn btn-sm" :disabled="!agentForm.name.trim() || !agentForm.intent.trim() || agentForm.busy || agentForm.uploading > 0">Crear</button>
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
          <span class="avatar agent-avatar big" :style="agentStyle(agentOf.name)">{{ agentOf.name[0] }}</span>
          <div class="agent-sheet-main">
            <div><b>{{ agentOf.name }}</b> · {{ agentOf.intent }}</div>
            <div v-if="agentOf.notes || agentOf.files?.length || agentOf.topics?.length" class="agent-topics">
              <span>precarga</span>
              <span v-if="agentOf.notes" class="agent-chip" :title="agentOf.notes">lo que tiene que saber</span>
              <span v-for="f in agentOf.files || []" :key="f.id" class="agent-chip" :title="`${f.name} · ${charsLabel(f.chars)} de texto`">{{ f.name }}</span>
              <code v-for="t in agentOf.topics || []" :key="t">{{ t }}</code>
              <template v-if="agentOf.topics?.length">
                <span v-if="agentRow(active)?.changed" class="badge badge-xs">{{ agentRow(active).changed }} fuente{{ agentRow(active).changed > 1 ? 's' : '' }} cambiaron en main</span>
                <span v-else-if="agentRow(active)" class="count">sus fuentes, al día</span>
              </template>
            </div>
          </div>
        </div>
        <div v-if="agentOf && !messages.length && !(pending && pending.key === active)" class="suggestions agent-prompts">
          <button v-for="s in agentPrompts" :key="s.label" type="button" class="btn btn-outline btn-sm" @click="suggest(s)">{{ s.label }}</button>
        </div>
        <!-- La conversación con Wally, vacía: su saludo en vez de elegir modo (siempre es el asistente). -->
        <div v-if="active === mainId && !messages.length && !(pending && pending.key === active)" class="empty">
          <div class="empty-head">
            <div class="main-avatar main-avatar-big" aria-hidden="true">W</div>
            <div class="empty-title">Hola, soy Wally</div>
            <div class="empty-desc">Tu orquestador: conozco tus herramientas (WALLY.md) y puedo pedirte ver cosas de tu máquina, siempre de lectura y con tu sí. Contesto por la web de {{ providerName }}; lo cambiás abajo o a la derecha.</div>
          </div>
          <div class="suggestions">
            <button v-for="s in MAIN_PROMPTS" :key="s.label" type="button" class="btn btn-outline btn-sm" @click="suggest(s)">{{ s.label }}</button>
          </div>
        </div>
        <div v-else-if="!agentOf && !messages.length && !(pending && pending.key === active)" class="empty">
          <div class="empty-head">
            <div class="empty-media"><span class="ui-icon" data-icon="comment" aria-hidden="true"></span></div>
            <div class="empty-title">{{ mode ? 'Preguntale al asistente' : 'Preguntale a Wally' }}</div>
            <div class="empty-desc">Pregunta por la web de {{ providerName }}, en tu Chrome y con tu cuenta, sin llave de API. Lo que quede guardado acá es el contexto de la próxima pregunta.</div>
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
              <div class="bubble mine">{{ m.text }}<span class="bubble-time">{{ clock(m.at) }}</span></div>
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
          <article v-if="m.role === 'model'" class="block answer chat-in">
            <span class="msg-avatar" :class="{ wally: !speaker.agent }" :style="agentStyle(speaker.agent && speaker.name)" aria-hidden="true">{{ speaker.name[0] }}</span>
            <div class="chat-bubble">
            <div class="answer-who"><b :style="agentInk(speaker.agent && speaker.name)">{{ speaker.name }}</b><span>{{ modelName(m.model) }} · {{ seconds(m.ms) }} s</span></div>
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
              <span class="bubble-time">{{ clock(m.at) }}</span>
            </div>
            </div>
          </article>
        </template>
        <div v-if="awaitingResults && !pending" class="results-bar">
          <span>{{ awaitingResults.ran ? `${awaitingResults.ran} de ${awaitingResults.total} corrido${awaitingResults.total > 1 ? 's' : ''}: sus salidas viajan con la próxima pregunta.` : 'Descartaste todo lo que pidió.' }}</span>
          <button type="button" class="btn btn-sm" :disabled="!!effectivePaused" @click="sendResults"><span class="ui-icon" data-icon="send" aria-hidden="true"></span>{{ awaitingResults.ran ? 'Mandar resultados' : 'Seguir sin eso' }}</button>
        </div>
        <template v-if="pending && pending.key === active">
          <div class="block block-user"><div class="user-col">
            <div class="bubble mine">{{ pending.text }}</div>
            <div v-if="pending.files?.length" class="file-chips sent">
              <span v-for="f in pending.files" :key="f.id" class="file-chip"><span class="file-kind">{{ FILE_ICON[f.kind] || 'TXT' }}</span><span class="file-name">{{ f.name }}</span></span>
            </div>
          </div></div>
          <article class="answer chat-in">
            <span class="msg-avatar" :class="{ wally: !speaker.agent }" :style="agentStyle(speaker.agent && speaker.name)" aria-hidden="true">{{ speaker.name[0] }}</span>
            <div class="chat-bubble">
              <div class="answer-who"><b :style="agentInk(speaker.agent && speaker.name)">{{ speaker.name }}</b><span>{{ providerName }}, en tu Chrome · {{ elapsed }} s</span></div>
              <div class="typing" aria-label="pensando"><i></i><i></i><i></i></div>
            </div>
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
            <div class="provider-menu-wrap" @keydown.esc="providerMenu = false">
              <button type="button" class="provider-trigger" :aria-expanded="providerMenu" aria-haspopup="listbox"
                      :title="unavailableReason(effectiveProvider) || `Contesta ${modelLabel(effectiveProvider)}, por ${PROVIDER_NAME[effectiveProvider]}`" @click="providerMenu = !providerMenu">
                <i class="state-dot" :class="`is-${providerState(effectiveProvider)}`" aria-hidden="true"></i>
                <span>{{ modelLabel(effectiveProvider) }}</span>
                <span v-if="providerOf(effectiveProvider)?.pausedUntil" class="countdown">{{ timeLeft(providerOf(effectiveProvider).pausedUntil) }}</span>
                <span class="ui-icon provider-chevron" :class="{ open: providerMenu }" data-icon="chevron" aria-hidden="true"></span>
              </button>
              <div v-if="providerMenu" class="provider-menu" role="listbox" aria-label="Con qué contesta Wally">
                <button v-for="p in providers" :key="p.id" type="button" role="option" class="provider-option" :class="{ on: effectiveProvider === p.id }"
                        :aria-selected="effectiveProvider === p.id" :aria-disabled="!!unavailableReason(p.id)"
                        :title="[unavailableReason(p.id) || p.status?.detail || '', p.contextNote || ''].filter(Boolean).join('\n\n')" @click="pickProvider(p.id)">
                  <i class="state-dot" :class="`is-${providerState(p.id)}`" aria-hidden="true"></i>
                  <span class="po-main"><b>{{ PROVIDER_NAME[p.id] }}</b><span>{{ p.status?.state === 'proximamente' ? 'Próximamente' : [innerModel(p.id), tokensLabel(p), p.limit ? `la web: ~${Math.round(p.limit / 1000)} mil car.` : ''].filter(Boolean).join(' · ') || 'listo' }}</span></span>
                  <span v-if="p.pausedUntil" class="countdown" :title="`Vuelve a las ${p.paused}`">{{ timeLeft(p.pausedUntil) }}</span>
                </button>
              </div>
            </div>
            <span class="count" :title="'Lo que viaja como contexto en la próxima pregunta: el modelo no recuerda nada (chat temporal), así que se le manda todo lo guardado. Borrá los bloques que no hagan falta.'">
              {{ messages.length ? `contexto: ${messages.length} bloque${messages.length > 1 ? 's' : ''}${contextFiles ? ` · ${contextFiles} archivo${contextFiles > 1 ? 's' : ''}` : ''} · ${contextChars.toLocaleString('es-CO')} car.` : 'sin contexto' }}
            </span>
            <span v-if="effectivePaused" class="composer-note warn-text">{{ providerName }} vuelve en {{ timeLeft(providerOf(effectiveProvider).pausedUntil) }}: elegí otro o esperá</span>
            <span v-else-if="agentOf && effectiveProvider !== 'aistudio'" class="composer-note" :title="'Lo que lleva precargado el agente (knowledge, código de main) viaja con cada pregunta'">{{ agentOf.name }} manda su contexto interno a {{ providerName }}</span>
            <span v-else-if="fit.over" class="composer-note warn-text">~{{ Math.round(fit.total / 1000) }} mil car.: {{ providerName }} acepta ~{{ Math.round(fit.limit / 1000) }} mil, no le entra</span>
            <span v-else-if="busyElsewhere" class="composer-note">Wally está contestando en otra pestaña</span>
            <button type="submit" class="btn btn-sm send" :disabled="(!draft.trim() && !pendingFiles.length) || !!pending || !!effectivePaused || !!uploading[active]" title="Preguntar (Enter)">
              <span class="ui-icon" data-icon="send" aria-hidden="true"></span>Preguntar
            </button>
          </div>
        </div>
      </form>
      </template>
    </main>

    <!-- EL SIDEBAR DERECHO: la configuración, al lado del chat (como el panel de la derecha del chat). -->
    <!-- EL SIDEBAR DERECHO, con pestañas por icono como el perfil del chat: los agentes, el modelo, los servicios y lo de hoy. -->
    <aside v-show="shown.aux" class="auxiliarybar" :aria-label="AUX_TABS.find((t) => t.id === auxTab)?.label">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head aux-head">
        <nav class="aux-tabs" role="tablist" aria-label="Wally">
          <button v-for="t in AUX_TABS" :key="t.id" type="button" role="tab" class="region-action aux-tab"
                  :class="{ on: auxTab === t.id }" :aria-selected="auxTab === t.id" :title="t.label" :aria-label="t.label" @click="setAuxTab(t.id)">
            <svg v-if="t.id === 'agents'" class="tab-ring" viewBox="0 0 42 42" aria-hidden="true">
              <circle v-if="!agents.length" cx="21" cy="21" r="15" stroke="currentColor" />
              <circle v-for="r in agentRing" :key="r.name" cx="21" cy="21" r="15" :stroke="r.color" :stroke-dasharray="r.dash" :stroke-dashoffset="r.offset" transform="rotate(-90 21 21)" />
            </svg>
            <span v-else class="ui-icon" :data-icon="t.icon" aria-hidden="true"></span>
            <i v-if="t.id === 'services' && servicesTrouble" class="tab-alert" aria-hidden="true"></i>
          </button>
        </nav>
        <div class="region-actions">
          <button type="button" class="region-action" title="Ocultar" aria-label="Ocultar el sidebar derecho" @click="toggleAux(false)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>

      <!-- LOS AGENTES: tocar uno abre su conversación; el número es cuántas fuentes suyas cambiaron en main. -->
      <div v-if="auxTab === 'agents'" class="region-body aux-section">
        <div class="aux-section-head">
          <b>Tus agentes</b><span class="count">{{ agents.length }}</span>
          <button type="button" class="region-action" title="Agente nuevo: un nombre, una intención y su contexto" aria-label="Agente nuevo" @click="newAgentTab">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
          </button>
        </div>
        <p v-if="!agents.length" class="field-note">Todavía no tenés agentes: el «+» arma uno con su nombre, su intención y su contexto.</p>
        <ul v-else class="aux-agents">
          <li v-for="a in agents" :key="a.conv">
            <button type="button" class="aux-agent" :class="{ on: active === a.conv }" :title="`${a.agent.name}: ${a.agent.intent}`" @click="openTab(a.conv)">
              <span class="avatar agent-avatar" :style="agentStyle(a.agent.name)" aria-hidden="true">{{ a.agent.name[0] }}</span>
              <span class="aux-agent-text">
                <b><i v-if="pending && pending.key === a.conv" class="live-dot" aria-label="esperando la respuesta"></i>{{ a.agent.name }}</b>
                <small>{{ a.agent.intent.replace(/^tener al día (el contexto de |el )?/i, '') }}</small>
              </span>
              <span v-if="a.changed" class="badge badge-xs" :title="`${a.changed} fuente${a.changed > 1 ? 's' : ''} de sus temas cambiaron en main: le toca a este agente`">{{ a.changed }}</span>
              <span v-else class="count" :title="`${a.count} bloque${a.count === 1 ? '' : 's'} en su conversación`">{{ a.count || '' }}</span>
            </button>
            <button type="button" class="region-action conv-del" title="Borrar el agente y su conversación" aria-label="Borrar el agente" @click="removeConv({ id: a.conv, title: a.agent.name }).then(loadAgents)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </li>
        </ul>
      </div>

      <div v-else class="region-body config-aside aux-section">
        <div v-if="config" class="config">
          <template v-if="auxTab === 'model'">
            <p class="group-lede">Con qué contesta Wally y cómo. Se guarda al tocarla y vale desde la próxima pregunta; cada respuesta dice con qué salió.</p>
            <div class="group-option column">
              <div><b>Proveedor</b><span>Todos van por su web, en tu Chrome con Jarvis y tu sesión: sin llaves de API.</span></div>
              <div class="provider-pick" role="radiogroup" aria-label="Proveedor">
                <button v-for="p in PROVIDERS" :key="p.id" type="button" class="mode-card" role="radio" :aria-checked="config.provider === p.id" @click="saveConfig({ provider: p.id })">
                  <b>{{ p.name }}</b><span>{{ p.note }}</span>
                </button>
              </div>
            </div>

            <div class="group-option column">
              <div><b>Gemini</b><span>Sólo Gemini 4 Hydrogen, por la web de AI Studio. El nivel de razonamiento lo pone Wally en cada pregunta.</span></div>
              <div class="config-row">
                <span class="label">Thinking level</span>
                <div class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Thinking level">
                  <button v-for="t in ['Low', 'Medium', 'High']" :key="t" type="button" class="toggle" role="radio" :aria-checked="config.thinking === t" :aria-pressed="config.thinking === t" @click="saveConfig({ thinking: t })">{{ t }}</button>
                </div>
              </div>
            </div>

            <div class="group-option column">
              <div><b>DeepSeek</b><span>Los dos interruptores de su pantalla, puestos en cada pregunta.</span></div>
              <div class="config-row">
                <span class="label">Pensamiento Profundo</span>
                <button type="button" class="switch" role="switch" :aria-checked="config.deepThink" aria-label="Pensamiento Profundo" @click="saveConfig({ deepThink: !config.deepThink })"></button>
              </div>
              <div class="config-row">
                <span class="label">Búsqueda inteligente</span>
                <button type="button" class="switch" role="switch" :aria-checked="config.search" aria-label="Búsqueda inteligente" @click="saveConfig({ search: !config.search })"></button>
              </div>
            </div>

            <div class="group-option column">
              <div><b>ChatGPT</b><span>Siempre en chat temporal. El modelo es el que tenga tu cuenta.</span></div>
              <div class="config-row">
                <span class="label">Pensar</span>
                <button type="button" class="switch" role="switch" :aria-checked="config.chatgptThink" aria-label="Pensar" @click="saveConfig({ chatgptThink: !config.chatgptThink })"></button>
              </div>
            </div>

            <div class="group-option column">
              <div><b>Groq</b><span>El ultra rápido: el modelo abierto que corre en su chip.</span></div>
              <div class="config-row">
                <span class="label">Modelo</span>
                <div class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Modelo de Groq">
                  <button v-for="(label, m) in GROQ_MODELS" :key="m" type="button" class="toggle" role="radio" :aria-checked="config.groqModel === m" :aria-pressed="config.groqModel === m" @click="saveConfig({ groqModel: m })">{{ label }}</button>
                </div>
              </div>
            </div>

            <div class="group-option column">
              <div><b>Ventana de Chrome</b><span>Dónde trabaja Wally: minimizada no te llena de pestañas.</span></div>
              <div class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Ventana">
                <button v-for="(label, w) in WINDOWS" :key="w" type="button" class="toggle" role="radio" :aria-checked="config.window === w" :aria-pressed="config.window === w" @click="saveConfig({ window: w })">{{ label }}</button>
              </div>
            </div>

          </template>
          <template v-else-if="auxTab === 'services'">
          <div class="group-option column">
            <div class="config-row">
              <div><b>Servicios</b><span class="field-note"> Al arrancar, Wally abre cada web en la ventana aparte y mira si está lista y con sesión, sin preguntar nada.</span></div>
              <button type="button" class="btn btn-outline btn-xs" :disabled="providersInfo.checking" @click="checkProvidersNow">{{ providersInfo.checking ? 'Comprobando…' : 'Comprobar ahora' }}</button>
            </div>
            <ul class="services">
              <li v-for="p in providers" :key="p.id">
                <i class="state-dot" :class="`is-${providerState(p.id)}`" aria-hidden="true"></i>
                <b>{{ PROVIDER_NAME[p.id] }}</b>
                <span>{{ p.paused ? `en pausa hasta las ${p.paused} (lo dijo su último aviso)` : p.status.detail }}</span>
                <span v-if="p.limit" class="count">hasta ~{{ Math.round(p.limit / 1000) }} mil car.</span>
              </li>
            </ul>
            <span v-if="providersInfo.checked && !providersInfo.checked.startsWith('0001')" class="count">comprobado a las {{ clock(providersInfo.checked) }}</span>
          </div>

          </template>
          <template v-else-if="auxTab === 'today'">
          <div class="group-option column">
            <div><b>Hoy</b><span>De cada pregunta queda su tamaño y cómo terminó, nunca el texto (también por consola: <code>bin/aistudio uso</code>).</span></div>
            <table v-if="usageToday.today.length" class="usage">
              <tr><th>Modelo</th><th>Preguntas</th><th>Bien</th><th>Cortes</th><th>Media</th><th></th></tr>
              <tr v-for="u in usageToday.today" :key="u.model">
                <td>{{ USAGE_NAME[u.model] || u.model }}</td><td>{{ u.asked }}</td><td>{{ u.ok }}</td><td>{{ u.cuts }}</td>
                <td>{{ u.ok ? `${Math.round(u.avgMs / 1000)} s` : '—' }}</td>
                <td class="usage-note">{{ u.dailyOut ? `cupo diario agotado a las ${u.dailyOut}` : '' }}{{ usageToday.paused[u.model] ? ` · en pausa hasta las ${usageToday.paused[u.model]}` : '' }}</td>
              </tr>
            </table>
            <p v-else class="none">Nada todavía hoy.</p>
          </div>
          </template>
          <div v-if="configError" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ configError }}</p></div></div>
        </div>
        <p v-else class="none">{{ configError || 'Cargando…' }}</p>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="apiError" class="warn-text">{{ apiError }}</span>
      <span v-else>{{ tabs.length }} abierta{{ tabs.length === 1 ? '' : 's' }} · por la web de {{ providerName }}{{ effectivePaused ? ` · en pausa hasta las ${effectivePaused}` : '' }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las conversaciones" aria-label="Mostrar u ocultar las conversaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar la configuración" aria-label="Mostrar u ocultar la configuración" @click="toggleAux()">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
