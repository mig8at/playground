<script setup>
/* NEWS: lo que pasó en Hugging Face cada semana. A la izquierda las semanas y los temas; al centro la portada (lo más
 * innovador, los modelos nuevos, los que siguen subiendo y los papers más votados); a la derecha la ficha del modelo
 * elegido, documentada.
 *
 * Todo lo arma el servidor (news/server): junta la semana de la API pública de Hugging Face y le pide al modelo de
 * fondo los textos. La ruta es `#/<semana>` (p. ej. `#/2026-W47`); sin ella, la última.
 *
 * Los favoritos (`#/favorites`) son modelos curiosos que se guardan para no perderlos de vista, con qué hacen, por qué
 * son interesantes, si corren en la Mac y lo que dieron al probarlos: los escribe Claude en news/favorites.json. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle, bindPanelMaximize } from './workbench.js'

const weeks = ref([])
const data = ref(null)
const refreshing = ref(false)
const NO_API = 'No contesta la API de News.'
const apiError = ref('')
async function api(path, opts) {
  const res = await fetch(path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}
const routeKey = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''))
// La vista de investigación que pide la ruta, si pide una.
const routeView = () => ({ research: 'ideas', 'research/lineages': 'lineages', 'research/cheap': 'cheap' })[routeKey()] || ''
const favorites = ref([])
// LA MÁQUINA DONDE ESTÁ ABIERTO NEWS (lib/machine): el repo se usa en la Mac y en el PC con Linux, y «instalado acá» o
// «corre acá» dependen de cuál. La dice la API; mientras no contesta (o si es un servidor viejo que no la manda) queda
// la Mac, que es como hablaba la interfaz antes: en la Mac no cambia nada.
const machine = ref({ id: 'mac', label: 'la Mac', here: 'esta Mac' })
const setMachine = (m) => { if (m?.id) machine.value = m }
const GB = 1024 ** 3
const machineSpec = computed(() => { const m = machine.value; return [m.gpu && m.accel !== 'mps' ? `${m.gpu} · ${Math.round(m.vram / GB)} GB` : m.cpu, m.ram ? `${Math.round(m.ram / GB)} GB de RAM` : ''].filter(Boolean).join(' · ') })
// Los modelos instalados en esta máquina (caché de Hugging Face, GGUF de llama-server y entornos), con su tamaño.
const installed = ref([])
const installedBytes = ref(0)
// `|| []`: una máquina sin modelos mandaba null y la interfaz dejaba de pintarse al leerle `.length`
// CADA SECCIÓN DICE SU ERROR. Antes los tres pedidos terminaban en un catch vacío: un favorites.json a medio escribir
// (que la API rechaza con un mensaje claro) o un registro roto se veían como «cero favoritos» o «ningún modelo».
const sectionError = ref({ favorites: '', research: '', installed: '' })
const sectionLoaded = ref({ favorites: false, research: false, installed: false })
const section = (name, promise, apply) => promise.then((r) => { apply(r); sectionError.value[name] = ''; sectionLoaded.value[name] = true })
  .catch((e) => { sectionError.value[name] = e.message || 'no contestó' })
const loadInstalled = () => section('installed', api('/api/installed'), (r) => { installed.value = r.installed || []; installedBytes.value = r.bytes || 0; setMachine(r.machine) })
// `measuring`: el servidor todavía está bajando de Hugging Face el tamaño real de algunos (la primera vez en una máquina
// tarda unos segundos): se vuelve a pedir hasta que termine, con tope, para que la ficha no se quede con la cuenta vieja.
const measuring = ref(0)
let measureTries = 0
const loadFavorites = () => section('favorites', api('/api/favorites'), (r) => {
  favorites.value = r.favorites || []; setMachine(r.machine); measuring.value = r.measuring || 0
  if (measuring.value && measureTries++ < 12) setTimeout(loadFavorites, 4000)
  else measureTries = 0
})
const loadResearch = () => section('research', api('/api/research'), (r) => { research.value = r })
// Lo que no cambia solo (favoritos, investigación, instalados) se pide al abrir, al volver a la ventana y después de
// borrar: no en cada vuelta del sondeo, que antes hacía medir todo el disco una vez por minuto.
const loadSections = () => { loadFavorites(); loadResearch(); loadInstalled() }
const KIND_ICON = { hub: 'download', gguf: 'server', env: 'code', whisper: 'mic' }
// Borrar se confirma en la misma fila (el primer toque pregunta, el segundo borra): los diálogos del navegador no
// siempre aparecen dentro de la ventana de Cockpit.
const removing = ref('')
const confirming = ref('')
const removeError = ref('')
// La pregunta vence a los 10 s: quedaba armada para siempre, y un segundo toque distraído minutos después borraba.
let confirmTimer = null
async function removeInstalled(it) {
  clearTimeout(confirmTimer)
  if (confirming.value !== it.key) {
    confirming.value = it.key; removeError.value = ''
    confirmTimer = setTimeout(() => { confirming.value = '' }, 10000)
    return
  }
  confirming.value = ''
  removing.value = it.key
  try {
    // lo que usa una herramienta sólo se borra con force: el servidor lo exige, y acá va porque la fila ya lo avisó
    const force = it.tools?.length ? '&force=1' : ''
    await api(`/api/installed?key=${encodeURIComponent(it.key)}${force}`, { method: 'DELETE', headers: { 'X-News': '1' } })
  } catch (e) { removeError.value = `No se pudo borrar ${it.name}: ${e.message}` }
  removing.value = ''
  loadInstalled()
}
async function load() {
  try {
    if (routeKey() === 'favorites') view.value = 'favorites'
    const rv = routeView()
    if (rv) view.value = rv
    const list = await api('/api/weeks')
    weeks.value = list.weeks
    refreshing.value = list.refreshing
    apiError.value = list.error || ''
    const key = weeks.value.some((w) => w.key === routeKey()) ? routeKey() : weeks.value[0]?.key
    if (!key) return
    const wk = await api(`/api/weeks/${key}`)
    if (data.value?.key !== wk.key || data.value?.fetched !== wk.fetched) {
      data.value = wk
      if (!models.value.some((m) => m.id === selectedId.value)) selectedId.value = wk.lead || models.value.find((m) => m.new)?.id
    }
  } catch { apiError.value = NO_API }
}
// Al tocar «Actualizar» el sondeo se rearma ya (cada 5 s mientras actualiza): antes seguía con el minuto que tenía
// puesto y no había señal de nada hasta entonces. Si el pedido falla, lo dice el pie.
const refreshError = ref('')
async function refreshNow() {
  refreshError.value = ''
  try { await api('/api/refresh', { method: 'POST' }); refreshing.value = true; schedule() }
  catch (e) { refreshError.value = `No se pudo actualizar: ${e.message}` }
}

const TOPICS = [
  { id: 'all', name: 'Todo', tasks: null },
  { id: 'text', name: 'Texto', tasks: ['text-generation', 'text2text-generation', 'fill-mask', 'sentence-similarity', 'feature-extraction', 'text-classification'] },
  { id: 'multimodal', name: 'Multimodal', tasks: ['image-text-to-text', 'any-to-any', 'visual-question-answering', 'video-text-to-text'] },
  { id: 'image', name: 'Imagen y video', tasks: ['text-to-image', 'image-to-image', 'image-to-video', 'text-to-video', 'unconditional-image-generation', 'image-to-3d', 'text-to-3d'] },
  { id: 'audio', name: 'Audio y voz', tasks: ['text-to-speech', 'audio-to-audio', 'automatic-speech-recognition', 'text-to-audio', 'audio-classification'] },
]
const topicOf = (task) => TOPICS.find((t) => t.tasks?.includes(task))?.id || 'other'
// El ícono y el color de cada tema, para reconocer el tipo de modelo a simple vista.
const TOPIC_ICON = { all: 'apps', text: 'text', multimodal: 'multimodal', image: 'image', audio: 'audio', other: 'box' }
// Dentro de «Imagen y video», el video lleva su propio ícono.
const VIDEO_TASKS = ['image-to-video', 'text-to-video', 'video']
const taskIcon = (task) => (VIDEO_TASKS.includes(task) ? 'video' : TOPIC_ICON[topicOf(task)])
const topic = ref('all')
const search = ref('')
const view = ref('cover') // cover · papers · favorites · ideas · lineages · cheap

// ── los favoritos ──
const FAV_GROUPS = [
  { id: 'tried', name: 'Probados', icon: 'check' },
  { id: 'voice', name: 'Voz que conversa', icon: 'mic' },
  { id: 'music', name: 'Música y sonido', icon: 'play' },
  { id: 'odd', name: 'Rarezas', icon: 'emoji' },
  { id: 'tiny', name: 'Diminutos', icon: 'box' },
  { id: 'detect', name: 'Detectores raros', icon: 'eye' },
  { id: 'create', name: 'Para crear', icon: 'image' },
  { id: 'specialist', name: 'Especialistas', icon: 'multimodal' },
  { id: 'gpu', name: 'Piden GPU NVIDIA', icon: 'server' },
]
const MAC = { yes: 'corre en la Mac', no: 'no corre en la Mac', unknown: 'en la Mac: sin confirmar' }
// ¿CORRE ACÁ? En la Mac es lo de siempre (`mac`, lo que dice la ficha o se probó). En el PC casi nada está probado, así
// que el servidor lo estima por tamaño contra la memoria de la GPU y la RAM (`here`, news/server/fits.go) y acá se dice
// que es una estimación: no es lo mismo «lo probamos» que «por el tamaño debería entrar».
const onMac = computed(() => machine.value.id === 'mac')
const hereOf = (f) => (onMac.value || !f.here ? { status: f.mac, basis: 'declared', why: '' } : f.here)
const HERE = { yes: 'corre en el PC', slow: 'corre en el PC, lento (en la RAM)', no: 'no corre en el PC', unknown: 'en el PC: sin confirmar' }
const chipText = (f) => (onMac.value ? (f.mac === 'yes' ? 'Mac' : f.mac === 'no' ? 'GPU' : '¿Mac?') : { yes: 'PC', slow: 'PC lento', no: 'no entra', unknown: '¿PC?' }[hereOf(f).status] || '¿PC?')
const chipTitle = (f) => (onMac.value ? MAC[f.mac] : `${HERE[hereOf(f).status] || ''}${hereOf(f).basis === 'estimated' ? ' (estimado, sin probar)' : ''}: ${hereOf(f).why}`)
const favGroup = ref('all')
// dos perillas de la vista: ver sólo lo que corre en esta máquina, y ordenar cada grupo del más chico al más grande
const onlyHere = ref(false)
const bySize = ref(false)
const runsHere = (f) => ['yes', 'slow'].includes(hereOf(f).status)
// para ordenar, los parámetros, que es el tamaño que muestra la tarjeta; lo que no lo declara va al final
const weight = (f) => f.params || Infinity
const favSorted = (list) => (bySize.value ? [...list].sort((a, b) => weight(a) - weight(b)) : list)
const favMatches = (f) => (favGroup.value === 'all' || f.group === favGroup.value) && (!onlyHere.value || runsHere(f))
  && (!q.value || `${f.id} ${f.task} ${f.what}`.toLowerCase().includes(q.value))
// «Probados» no va en tarjetas: es el historial, una tabla con fecha, veredicto, quién lo usa y cuánto ocupa.
const favSections = computed(() => FAV_GROUPS.filter((g) => g.id !== 'tried').map((g) => ({ ...g, items: favSorted(favorites.value.filter((f) => f.group === g.id && favMatches(f))) })).filter((g) => g.items.length))
const triedHistory = computed(() => favorites.value.filter((f) => f.verdict && (favGroup.value === 'all' || favGroup.value === 'tried')
  && (!q.value || `${f.id} ${f.task} ${f.what}`.toLowerCase().includes(q.value))).sort((a, b) => (b.triedOn || '').localeCompare(a.triedOn || '')))
const VERDICT = { keep: 'Vale la pena', dropped: 'Descartado' }
const installedByKey = computed(() => Object.fromEntries(installed.value.map((i) => [i.key, i])))
const favInstalled = (f) => (f.installed || []).map((k) => installedByKey.value[k]).filter(Boolean)
const favBytes = (f) => favInstalled(f).reduce((n, i) => n + i.bytes, 0)
const favOfInstalled = (it) => favorites.value.find((f) => (f.installed || []).includes(it.key))
const favStats = computed(() => {
  const tried = favorites.value.filter((f) => f.verdict)
  return { saved: favorites.value.length, tried: tried.length, keep: tried.filter((f) => f.verdict === 'keep').length,
    dropped: tried.filter((f) => f.verdict === 'dropped').length, inUse: favorites.value.filter((f) => f.usedBy).length,
    here: favorites.value.filter(runsHere).length }
})
const favCount = (id) => favorites.value.filter((f) => id === 'all' || f.group === id).length
const favName = (f) => f.id.split('/')[1]
const favOrg = (f) => f.id.split('/')[0]
const openFavorites = (g) => { favGroup.value = g; view.value = 'favorites'; if (location.hash !== '#/favorites') history.replaceState(null, '', '#/favorites') }
const selectedFavId = ref('')
const selectedFav = computed(() => (view.value === 'favorites' ? favorites.value.find((f) => f.id === selectedFavId.value) : null))

// ── la investigación: cómo mejoran los modelos ──
// Las ideas que mejoraron modelos (con su evidencia y la máquina que hizo falta) y los linajes: familias de modelos con
// la idea que entró en cada salto. Las escribe Claude en news/research.json. Rutas: #/research, #/research/lineages y
// #/research/cheap.
const research = ref({ ideas: [], lineages: [] })
const RESEARCH_VIEWS = { ideas: 'research', lineages: 'research/lineages', cheap: 'research/cheap' }
const isResearch = (v) => v in RESEARCH_VIEWS
const STAGES = [
  { id: 'data', name: 'Datos' },
  { id: 'architecture', name: 'Arquitectura' },
  { id: 'training', name: 'Entrenamiento' },
  { id: 'alignment', name: 'Calibrar y alinear' },
  { id: 'efficiency', name: 'Achicar y acelerar' },
  { id: 'use', name: 'Al usarlo' },
  { id: 'interpretability', name: 'Entender por dentro' },
]
const stageName = (id) => STAGES.find((s) => s.id === id)?.name || id
const HARDWARE = [
  { id: 'mac', name: 'Una Mac' },
  { id: 'gpu', name: 'Una GPU' },
  { id: 'server', name: 'Un servidor' },
  { id: 'datacenter', name: 'Data center' },
  { id: 'unknown', name: 'Sin dato' },
]
const hwName = (id) => HARDWARE.find((h) => h.id === id)?.name || id
const stage = ref('all')
const hardware = ref('all')
const ideaMatches = (d) => (stage.value === 'all' || d.stage === stage.value) && (hardware.value === 'all' || d.hardware === hardware.value)
  && (!q.value || `${d.name} ${d.who} ${d.problem} ${d.idea}`.toLowerCase().includes(q.value))
// Por etapa, y dentro de cada una de la más vieja a la más nueva: se lee como una historia.
const ideaSections = computed(() => STAGES.map((s) => ({ ...s, items: research.value.ideas.filter((d) => d.stage === s.id && ideaMatches(d)).sort((a, b) => a.year - b.year) })).filter((s) => s.items.length))
const stageCount = (id) => research.value.ideas.filter((d) => d.stage === id).length
const hwCount = (id) => research.value.ideas.filter((d) => (stage.value === 'all' || d.stage === stage.value) && (id === 'all' || d.hardware === id)).length
const onAMac = computed(() => research.value.ideas.filter((d) => d.hardware === 'mac' || d.mac).filter((d) => !q.value || `${d.name} ${d.mac}`.toLowerCase().includes(q.value)))
const cheapIdeas = computed(() => research.value.ideas.filter((d) => d.cheap))
// Lo que se HACE en la Mac (ajustar, cuantizar, mezclar) va aparte de lo que se entrenó en grande y en la Mac sólo se usa.
const macGroups = computed(() => [
  { id: 'make', name: 'Se hace en la Mac', desc: 'mejorar o adaptar un modelo sin salir de la Mac', items: onAMac.value.filter((d) => d.hardware === 'mac') },
  { id: 'use', name: 'Se entrena en grande, se usa en la Mac', desc: 'lo que hizo un data center y acá corre', items: onAMac.value.filter((d) => d.hardware !== 'mac') },
].filter((g) => g.items.length))
const ideasById = computed(() => Object.fromEntries(research.value.ideas.map((d) => [d.id, d])))
const selectedIdeaId = ref('')
const selectedIdea = computed(() => (isResearch(view.value) ? ideasById.value[selectedIdeaId.value] : null))
const lineagesOf = (id) => research.value.lineages.filter((l) => l.steps.some((s) => s.ideas.includes(id)))
const favById = (id) => favorites.value.find((f) => f.id === id)
const openResearch = (v, opts = {}) => {
  view.value = v
  if (opts.stage) stage.value = opts.stage
  const hash = `#/${RESEARCH_VIEWS[v]}`
  if (location.hash !== hash) history.replaceState(null, '', hash)
}
const pickIdea = (id) => { selectedIdeaId.value = id; if (!shown.value.aux) toggle('aux', auxOpen) }
const openFav = (id) => { const f = favById(id); if (f) { openFavorites('all'); pickFav(f) } }

const models = computed(() => (data.value?.models || []).map((m) => ({ ...m, topic: topicOf(m.task) })))
const q = computed(() => search.value.trim().toLowerCase())
const matches = (m) => (topic.value === 'all' || m.topic === topic.value || (topic.value === 'other' && m.topic === 'other'))
  && (!q.value || `${m.id} ${m.task}`.toLowerCase().includes(q.value))
const fresh = computed(() => models.value.filter((m) => m.new && matches(m)))
const rising = computed(() => models.value.filter((m) => !m.new && matches(m)).slice(0, 8))
// Lo más innovador lo elige el modelo de fondo; sin su texto todavía, el primero en tendencia de los nuevos.
const lead = computed(() => fresh.value.find((m) => m.id === data.value?.lead) || fresh.value[0] || null)
// Lo más popular: el nuevo de la semana que va más alto en tendencia (la lista ya viene en ese orden). Puede ser el
// mismo que el más innovador: entonces queda una sola nota con las dos etiquetas.
const popular = computed(() => fresh.value[0] || null)
const both = computed(() => !!lead.value && lead.value === popular.value)
const popularWhy = computed(() => popular.value ? [`Es el nuevo de la semana que va más alto en tendencia: #${popular.value.rank} de todo Hugging Face.`, popular.value.what].filter(Boolean).join(' ') : '')
const countFor = (id) => models.value.filter((m) => m.new && (id === 'all' || m.topic === id)).length
const otherCount = computed(() => models.value.filter((m) => m.new && m.topic === 'other').length)

const selectedId = ref('')
const selected = computed(() => models.value.find((m) => m.id === selectedId.value))
const openPaper = ref('')

// ── formatos ──
const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const day = (iso) => { if (!iso) return '—'; const [, m, d] = iso.split('-').map(Number); return `${d} ${months[m - 1]}` }
const num = (n) => (n ?? 0).toLocaleString('es-CO')
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${(n / 1e3).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil` : num(n))
const bytes = (n) => (!n ? '0 GB' : n >= 1e9 ? `${(n / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 })} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)
const params = (n) => (!n ? 'no lo declara' : n >= 1e9 ? `${(n / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 })} B parámetros` : `${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 0 })} M parámetros`)
const weekLabel = computed(() => (data.value ? `${day(data.value.from)} al ${day(data.value.to)}` : ''))
const papers = computed(() => data.value?.papers || [])
const clock = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const hf = (id) => `https://huggingface.co/${id}`

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
/* LAS VISTAS DEL SIDEBAR, como en el chat y VS Code: cada bloque se pliega con su encabezado, las abiertas se reparten
   el alto y una cerrada ocupa una fila. Lo abierto se recuerda en este navegador (`news.sidebar-views`). */
const sidebarViews = ref(readPref('news.sidebar-views', {}) || {})
const isViewOpen = (id) => sidebarViews.value[id] ?? true
function toggleView(id) { sidebarViews.value = { ...sidebarViews.value, [id]: !isViewOpen(id) }; savePref('news.sidebar-views', sidebarViews.value) }

/* LA CONSOLA (la región `panel` del taller): lo que News hace sola, que antes era una frase en el pie que se pisaba.
   Tres pestañas: Actividad (la bitácora del servidor: cada actualización, lo medido, lo borrado), Esta máquina (qué
   es, qué motores tiene para correr modelos y dónde se buscan los instalados) y Avisos (lo que hoy pide atención, con
   qué hacer). Arranca cerrada: se abre con su botón del pie o tocando el contador de avisos. */
const consoleTab = ref(readPref('news.console-tab', 'activity'))
const pickConsoleTab = (id) => { consoleTab.value = id; savePref('news.console-tab', id) }
const activity = ref([])
const machineInfo = ref(null)
const loadActivity = () => api('/api/activity').then((r) => { activity.value = r.entries || [] }).catch(() => {})
const loadMachine = () => api('/api/machine').then((r) => { machineInfo.value = r; setMachine(r.machine) }).catch(() => {})
const hhmmss = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour12: false })
const gbOf = (n) => (n ? `${Math.round(n / GB)} GB` : '—')
// Avisos: lo que pide atención AHORA, cada uno con qué hacer. Sale de lo que ya se sabe; no es otra consulta.
const notices = computed(() => {
  const out = []
  if (apiError.value) out.push({ kind: 'error', text: apiError.value, fix: 'Levantala con `make news`.' })
  if (refreshError.value) out.push({ kind: 'error', text: refreshError.value })
  // El consejo sale del ERROR: sólo uno de sesión pide iniciarla. «No devolvió JSON» o un plazo vencido se arreglan
  // pidiéndolo de nuevo, y la semana lo reintenta sola en la próxima actualización (no conserva un texto con error).
  if (data.value?.writeError) {
    const e = data.value.writeError
    const session = /sesi[oó]n|login|credencial|token|expir|unauthori|forbidden|\b40[13]\b/i.test(e)
    out.push({ kind: 'warn', text: `Una parte de los textos de la semana no se escribió: ${e}`,
      fix: session ? 'El modelo de fondo necesita sesión (Cockpit → engranaje → Modelo); sin él, lo que falta se ve con los datos de Hugging Face, sin el texto.'
        : 'Tocá «Actualizar» para pedirlo de nuevo; si no, se reintenta solo en la próxima actualización (cada 6 h). Mientras, quedan los textos de la vez anterior.' })
  }
  for (const w of data.value?.fetchWarnings || []) out.push({ kind: 'warn', text: `La semana quedó incompleta: ${w}`, fix: 'Tocá «Actualizar» para volver a leer.' })
  for (const [k, e] of Object.entries(sectionError.value)) if (e) out.push({ kind: 'error', text: `No se pudo leer ${({ favorites: 'los favoritos', research: 'la investigación', installed: 'lo instalado' })[k]}: ${e}` })
  // MLX fuera de Apple Silicon no es algo que falte instalar: no va como aviso (lo dice la ficha de cada modelo)
  for (const e of machineInfo.value?.engines || []) if (e.id !== 'mlx' && e.ready === false && e.hint && favorites.value.some((f) => f.here?.engine?.name === e.name)) out.push({ kind: 'info', text: `Falta ${e.name} en ${machine.value.label}: ${favorites.value.filter((f) => f.here?.engine?.name === e.name).length} favoritos lo piden`, fix: e.hint })
  const unknown = favorites.value.filter((f) => hereOf(f).status === 'unknown').length
  if (unknown && !onMac.value) out.push({ kind: 'info', text: `${unknown} favoritos no declaran su tamaño: no se sabe si corren en ${machine.value.label}` })
  return out
})
const noticeCount = computed(() => notices.value.filter((n) => n.kind !== 'info').length)

const sidebarOpen = ref(readSize('news.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('news.sidebar-w', 240))
const auxOpen = ref(readSize('news.aux-open', 1) !== 0)
const auxW = ref(readSize('news.aux-w', 320))
const panelOpen = ref(readSize('news.panel-open', 0) !== 0)
const panelH = ref(readSize('news.panel-h', 220))
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 220)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 420), [
    { size: auxOpen.value ? auxW.value : 0, min },
    { size: sidebarOpen.value ? sidebarW.value : 0, min },
  ])
  const [panel] = fitRegions(viewportH.value - 240, [{ size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) }])
  return { sidebar, aux, panel }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px`, '--panel-h': `${shown.value.panel}px` }))
const panelResize = {
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 220,
  min: () => cssSize('--panel-min', 124), max: () => viewportH.value - 240,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('news.panel-open', v ? 1 : 0); if (v) saveSize('news.panel-h', panelH.value) },
}
function togglePanel(open = !shown.value.panel) { panelOpen.value = open; saveSize('news.panel-open', open ? 1 : 0); if (open) { loadActivity(); loadMachine() } }
const openNotices = () => { pickConsoleTab('notices'); togglePanel(true) }
const maximize = ref(null)
let maximizeBinding = null
watch(() => [shown.value.panel > 0, maximize.value], ([open, el]) => { maximizeBinding?.destroy?.(); maximizeBinding = open && el ? bindPanelMaximize(el) : null }, { flush: 'post' })
const resizeOf = (key, w, open, sign, other) => ({
  label: key === 'sidebar' ? 'Ancho de las semanas' : 'Ancho de la ficha', sign, defaultValue: key === 'sidebar' ? 240 : 320,
  min: () => cssSize('--sidebar-min', 220), max: () => viewportW.value - shown.value[other] - cssSize('--editor-min', 420),
  get: () => shown.value[key],
  set: (v) => { if (!v) open.value = false; else { open.value = true; w.value = v } },
  reopen: () => w.value,
  commit: (v) => { saveSize(`news.${key}-open`, v ? 1 : 0); if (v) saveSize(`news.${key}-w`, w.value) },
})
const sidebarResize = resizeOf('sidebar', sidebarW, sidebarOpen, 1, 'aux')
const auxResize = resizeOf('aux', auxW, auxOpen, -1, 'sidebar')
const toggle = (key, open) => { open.value = !shown.value[key]; saveSize(`news.${key}-open`, open.value ? 1 : 0) }
const pick = (m) => { selectedId.value = m.id; if (!shown.value.aux) toggle('aux', auxOpen) }
const pickFav = (f) => { selectedFavId.value = f.id; if (!shown.value.aux) toggle('aux', auxOpen) }
// Tocar un instalado abre la ficha del favorito al que pertenece (si lo hay).
const pickInstalled = (it) => { const f = favOfInstalled(it); if (f) { openFavorites('all'); pickFav(f) } }
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const themeToggle = ref(null)
let themeBinding = null
// Mientras se actualiza, cada 5 s; si no, cada minuto (por si cambió de fondo).
let timer = null
// Sin API reintenta a los 2 s: al abrir, la interfaz está lista antes que el servidor (que compila al arrancar) y se
// quedaba un minuto en «Sin API» con todo ya andando.
function schedule() { clearTimeout(timer); timer = setTimeout(async () => { if (!document.hidden) { await load(); if (shown.value.panel) loadActivity() } schedule() }, apiError.value === NO_API ? 2000 : refreshing.value ? 5000 : 60000) }
const onVisible = () => { if (!document.hidden) { loadSections(); load() } }
const onHash = () => {
  if (routeKey() === 'favorites') { view.value = 'favorites'; return }
  const rv = routeView()
  if (rv) { view.value = rv; return }
  if (view.value === 'favorites' || isResearch(view.value)) view.value = 'cover'
  data.value = null; load()
}
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHash)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  loadSections()
  loadMachine()
  if (panelOpen.value) loadActivity()
  document.addEventListener('visibilitychange', onVisible)
  load().then(schedule)
})
onBeforeUnmount(() => { maximizeBinding?.destroy?.(); document.removeEventListener('visibilitychange', onVisible); clearTimeout(confirmTimer); window.removeEventListener('resize', onWindowResize); window.removeEventListener('hashchange', onHash); clearTimeout(timer); themeBinding?.destroy?.() })
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar en-bloques" aria-label="Semana, favoritos, instalados e investigación">
      <!-- CUATRO VISTAS (`en-bloques` y `.view` de la base, como el sidebar del chat): la semana, los favoritos, lo
           instalado en esta máquina y la investigación. Cada una se pliega con su encabezado, las abiertas se reparten
           el alto y scrollean por separado, y una cerrada ocupa una fila (no desaparece). Antes era una sola lista
           larga: para llegar a Investigación había que pasar por todo lo demás. -->
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <section class="view wb-bloque week" :class="{ open: isViewOpen('week') }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="isViewOpen('week')" @click="toggleView('week')">
            <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Semana</span>
          </button>
          <span v-if="data" class="count" :title="weekLabel">{{ data.number ? `W${data.number}` : '' }}</span><div class="region-actions"><button type="button" class="region-action" :disabled="refreshing" title="Actualizar la semana ahora (lo hace sola cada 6 horas)" aria-label="Actualizar la semana" @click="refreshNow"><span class="ui-icon" data-icon="refresh" aria-hidden="true"></span></button></div>
        </div>
        <div v-if="isViewOpen('week')" class="region-body">
        <a v-for="w in weeks" :key="w.key" class="nav-row" :class="{ on: data?.key === w.key && view !== 'favorites' && !isResearch(view) }" :href="`#/${w.key}`" @click="(view === 'favorites' || isResearch(view)) && (view = 'cover')">
          <span class="ui-icon" data-icon="clock" aria-hidden="true"></span><span class="nav-name">Semana {{ w.number }}</span><span class="count">{{ day(w.from) }} al {{ day(w.to) }}</span>
        </a>
        <div v-if="!weeks.length" class="nav-row muted"><span class="ui-icon" data-icon="clock" aria-hidden="true"></span><span class="nav-name">{{ refreshing ? 'Juntando la primera semana…' : 'Todavía no hay semanas' }}</span></div>
        <div class="region-head group"><span>Temas</span></div>
        <button v-for="t in TOPICS" :key="t.id" type="button" class="nav-row" :class="{ on: topic === t.id && view === 'cover' }" @click="topic = t.id; view = 'cover'">
          <span class="ui-icon topic-icon" :class="`t-${t.id}`" :data-icon="TOPIC_ICON[t.id]" aria-hidden="true"></span><span class="nav-name">{{ t.name }}</span><span class="count">{{ countFor(t.id) }}</span>
        </button>
        <button v-if="otherCount" type="button" class="nav-row" :class="{ on: topic === 'other' && view === 'cover' }" @click="topic = 'other'; view = 'cover'">
          <span class="ui-icon topic-icon t-other" data-icon="box" aria-hidden="true"></span><span class="nav-name">Otros</span><span class="count">{{ otherCount }}</span>
        </button>
        </div>
      </section>
      <section class="view wb-bloque" :class="{ open: isViewOpen('favorites') }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="isViewOpen('favorites')" @click="toggleView('favorites')">
            <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Favoritos</span>
          </button>
          <span class="count">{{ favCount('all') || '' }}</span>
        </div>
        <div v-if="isViewOpen('favorites')" class="region-body">
        <button type="button" class="nav-row" :class="{ on: view === 'favorites' && favGroup === 'all' }" @click="openFavorites('all')">
          <span class="ui-icon" data-icon="star" aria-hidden="true"></span><span class="nav-name">Todos</span><span class="count">{{ favCount('all') }}</span>
        </button>
        <button v-for="g in FAV_GROUPS.filter((x) => favCount(x.id))" :key="g.id" type="button" class="nav-row sub" :class="{ on: view === 'favorites' && favGroup === g.id }" @click="openFavorites(g.id)">
          <span class="ui-icon" :data-icon="g.icon" aria-hidden="true"></span><span class="nav-name">{{ g.name }}</span><span class="count">{{ favCount(g.id) }}</span>
        </button>
        </div>
      </section>
      <section class="view wb-bloque fit" :class="{ open: isViewOpen('installed') }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="isViewOpen('installed')" @click="toggleView('installed')">
            <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Instalados</span>
          </button>
          <span class="count" :title="`En ${machine.here}: ${machineSpec}`">{{ installed.length ? bytes(installedBytes) : machine.id === 'mac' ? 'Mac' : 'PC' }}</span><div class="region-actions"><button type="button" class="region-action" title="Volver a medir lo instalado" aria-label="Volver a medir lo instalado" @click="loadInstalled"><span class="ui-icon" data-icon="refresh" aria-hidden="true"></span></button></div>
        </div>
        <div v-if="isViewOpen('installed')" class="region-body">
        <template v-for="it in installed" :key="it.key">
          <div class="nav-row installed" :class="{ muted: removing === it.key, asking: confirming === it.key }" :title="`${it.name} · ${it.where}${it.usedBy ? ` · lo usa ${it.usedBy}` : ''}`">
            <span class="ui-icon" :data-icon="KIND_ICON[it.kind]" aria-hidden="true"></span><span class="installed-text"><button type="button" class="nav-name installed-name" :disabled="!favOfInstalled(it)" @click="pickInstalled(it)">{{ it.name.split('/').pop() }}</button><span class="installed-meta"><span v-if="it.tools?.length" class="in-use" :title="`Lo usa ${it.usedBy}`">{{ it.tools.join(', ') }}</span><span class="count">{{ removing === it.key ? 'borrando…' : bytes(it.bytes) }}</span></span></span>
            <button type="button" class="region-action trash" :disabled="removing === it.key" :title="`Borrar ${it.name}`" :aria-label="`Borrar ${it.name}`" @click="removeInstalled(it)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
          </div>
          <div v-if="confirming === it.key" class="confirm-row">
            <span>¿Borrar {{ it.name }}? Libera {{ bytes(it.bytes) }}. {{ it.tools?.length ? `Lo usa ${it.tools.join(', ')} (${it.usedBy}): deja de andar hasta volver a bajarlo.` : 'Ninguna herramienta lo usa: se puede volver a bajar.' }}</span>
            <span class="confirm-actions"><button type="button" class="danger" @click="removeInstalled(it)">Borrar</button><button type="button" @click="confirming = ''">Cancelar</button></span>
          </div>
        </template>
        <div v-if="removeError" class="confirm-row error">{{ removeError }}</div>
        <div v-if="sectionError.installed" class="confirm-row error">No se pudo medir lo instalado: {{ sectionError.installed }}</div>
        <div v-else-if="!sectionLoaded.installed" class="nav-row muted"><span class="ui-icon" data-icon="box" aria-hidden="true"></span><span class="nav-name">Midiendo lo instalado…</span></div>
        <div v-else-if="!installed.length" class="nav-row muted"><span class="ui-icon" data-icon="box" aria-hidden="true"></span><span class="nav-name">Ningún modelo en {{ machine.label }}</span></div>
        </div>
      </section>
      <section class="view wb-bloque" :class="{ open: isViewOpen('research') }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="isViewOpen('research')" @click="toggleView('research')">
            <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Investigación</span>
          </button>
          <span class="count">{{ research.ideas.length || '' }}</span>
        </div>
        <div v-if="isViewOpen('research')" class="region-body">
        <button type="button" class="nav-row" :class="{ on: view === 'papers' }" @click="view = 'papers'">
          <span class="ui-icon" data-icon="paper" aria-hidden="true"></span><span class="nav-name">Papers</span><span class="count">{{ data?.papersTotal ?? '' }}</span>
        </button>
        <button type="button" class="nav-row" :class="{ on: view === 'ideas' && stage === 'all' }" @click="openResearch('ideas', { stage: 'all' })">
          <span class="ui-icon" data-icon="start" aria-hidden="true"></span><span class="nav-name">Cómo mejoran</span><span class="count">{{ research.ideas.length || '' }}</span>
        </button>
        <button v-for="s in STAGES.filter((x) => stageCount(x.id))" :key="s.id" type="button" class="nav-row sub" :class="{ on: view === 'ideas' && stage === s.id }" @click="openResearch('ideas', { stage: s.id })">
          <span class="nav-name">{{ s.name }}</span><span class="count">{{ stageCount(s.id) }}</span>
        </button>
        <button type="button" class="nav-row" :class="{ on: view === 'lineages' }" @click="openResearch('lineages')">
          <span class="ui-icon" data-icon="popular" aria-hidden="true"></span><span class="nav-name">Evolución</span><span class="count">{{ research.lineages.length || '' }}</span>
        </button>
        <button type="button" class="nav-row" :class="{ on: view === 'cheap' }" @click="openResearch('cheap')">
          <span class="ui-icon" data-icon="local" aria-hidden="true"></span><span class="nav-name">Hecho con poco</span><span class="count">{{ onAMac.length + cheapIdeas.length || '' }}</span>
        </button>
        </div>
      </section>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ view === 'favorites' ? 'Favoritos' : view === 'papers' ? 'Papers de la semana' : view === 'ideas' ? 'Cómo mejoran los modelos' : view === 'lineages' ? 'Evolución' : view === 'cheap' ? 'Hecho con poco' : data ? `Semana ${data.number} · ${weekLabel}` : 'News' }}</span>
        <input v-model="search" class="search" type="search" :placeholder="isResearch(view) ? 'Buscar una idea' : 'Buscar un modelo o una tarea'" aria-label="Buscar">
      </div>
      <div class="region-body">
        <!-- la investigación: las ideas -->
        <div v-if="view === 'ideas'" class="cover">
          <p class="fav-intro">Cada idea: qué problema resolvió, cuánto mejoró según su paper y con qué máquina se logró.</p>
          <div class="chips" role="group" aria-label="Con qué máquina">
            <button type="button" class="chip" :class="{ on: hardware === 'all' }" @click="hardware = 'all'">Todas <span>{{ hwCount('all') }}</span></button>
            <button v-for="h in HARDWARE.filter((x) => hwCount(x.id))" :key="h.id" type="button" class="chip" :class="[h.id, { on: hardware === h.id }]" @click="hardware = h.id">{{ h.name }} <span>{{ hwCount(h.id) }}</span></button>
          </div>
          <section v-for="s in ideaSections" :key="s.id">
            <h2 class="section-title">{{ s.name }} <span>{{ s.items.length }}</span></h2>
            <div class="favs">
              <button v-for="d in s.items" :key="d.id" type="button" class="fav idea" :class="{ on: selectedIdeaId === d.id }" @click="pickIdea(d.id)">
                <span class="model-top"><span class="model-name">{{ d.name }}</span><span class="hw" :class="d.hardware">{{ hwName(d.hardware) }}</span></span>
                <span class="model-org">{{ d.year }} · {{ d.who }}</span>
                <span class="fav-what">{{ d.idea }}</span>
                <span class="idea-evidence">{{ d.evidence }}</span>
                <span v-if="d.ours || d.models.length" class="fav-tags"><span v-if="d.ours" class="in-use">medido acá</span><span v-if="d.models.length" class="tag">{{ d.models.length }} en favoritos</span></span>
              </button>
            </div>
          </section>
          <p v-if="!ideaSections.length" class="empty-line">{{ research.ideas.length ? 'Ninguna idea coincide.' : 'Todavía no hay ideas (news/research.json).' }}</p>
        </div>

        <!-- la investigación: los linajes -->
        <div v-else-if="view === 'lineages'" class="cover">
          <p class="fav-intro">Familias de modelos paso a paso, con la idea que entró en cada salto. Tocá una idea para ver su ficha.</p>
          <section v-for="l in research.lineages" :key="l.id">
            <h2 class="section-title">{{ l.name }} <span>{{ l.why }}</span></h2>
            <ol class="lineage">
              <li v-for="st in l.steps" :key="st.model" class="step">
                <span class="step-date">{{ st.date }} · {{ st.who }}</span>
                <b class="step-model">{{ st.model }}</b>
                <span class="step-change">{{ st.change }}</span>
                <span v-if="st.ideas.length" class="step-ideas"><button v-for="id in st.ideas" :key="id" type="button" class="chip" :class="{ on: selectedIdeaId === id }" @click="pickIdea(id)">{{ ideasById[id]?.name || id }}</button></span>
              </li>
            </ol>
          </section>
        </div>

        <!-- la investigación: hecho con poco -->
        <div v-else-if="view === 'cheap'" class="cover">
          <section v-for="g in macGroups" :key="g.id">
            <h2 class="section-title">{{ g.name }} <span>{{ g.desc }}</span></h2>
            <div class="rows">
              <button v-for="d in g.items" :key="d.id" type="button" class="row cheap-row" :class="{ on: selectedIdeaId === d.id }" @click="pickIdea(d.id)">
                <span class="hw" :class="d.hardware">{{ hwName(d.hardware) }}</span><b>{{ d.name }}</b><span class="cheap-text">{{ d.mac || d.machine }}</span>
              </button>
            </div>
          </section>
          <section v-if="cheapIdeas.length">
            <h2 class="section-title">Con poco <span>quién lo logró con una GPU o unos cientos de dólares</span></h2>
            <div class="rows">
              <button v-for="d in cheapIdeas" :key="d.id" type="button" class="row cheap-row" :class="{ on: selectedIdeaId === d.id }" @click="pickIdea(d.id)">
                <span class="hw" :class="d.hardware">{{ hwName(d.hardware) }}</span><b>{{ d.name }}</b><span class="cheap-text">{{ d.cheap }}</span>
              </button>
            </div>
          </section>
        </div>

        <!-- los favoritos -->
        <div v-else-if="view === 'favorites'" class="cover">
          <div class="fav-stats">
            <span><b>{{ favStats.saved }}</b> guardados</span><span><b>{{ favStats.tried }}</b> probados</span>
            <span class="keep"><b>{{ favStats.keep }}</b> valen la pena</span><span class="dropped"><b>{{ favStats.dropped }}</b> {{ favStats.dropped === 1 ? 'descartado' : 'descartados' }}</span>
            <span class="use"><b>{{ favStats.inUse }}</b> en uso</span><span><b>{{ bytes(installedBytes) }}</b> en {{ machine.label }}</span><span v-if="!onMac" class="use" :title="`De los ${favStats.saved}: los que entran en ${machine.here} (${machineSpec}), por lo probado o estimado por tamaño`"><b>{{ favStats.here }}</b> corren en {{ machine.label }}</span>
          </div>
          <!-- los errores de la sección, a la vista, y las dos perillas -->
          <p v-if="sectionError.favorites" class="section-error">No se pudieron leer los favoritos: {{ sectionError.favorites }}</p>
          <p v-if="measuring" class="empty-line">Midiendo en Hugging Face el tamaño real de {{ measuring }} {{ measuring === 1 ? 'modelo' : 'modelos' }}…</p>
          <div class="fav-tools">
            <button type="button" class="toggle" :aria-pressed="onlyHere" :title="`Sólo los que corren en ${machine.here} (${machineSpec})`" @click="onlyHere = !onlyHere">Sólo los que corren en {{ machine.label }}</button>
            <button type="button" class="toggle" :aria-pressed="bySize" title="Dentro de cada grupo, del más chico al más grande" @click="bySize = !bySize">Ordenar por tamaño</button>
          </div>
          <section v-if="triedHistory.length">
            <h2 class="section-title">Probados <span>el historial: lo que dio cada uno y si se quedó{{ onMac ? '' : ' · se probaron en la Mac; «borrado» es de allá' }}</span></h2>
            <div class="rows history">
              <button v-for="f in triedHistory" :key="f.id" type="button" class="row" :class="{ on: selectedFavId === f.id, dropped: f.verdict === 'dropped' }" @click="pickFav(f)">
                <span class="row-num">{{ day(f.triedOn) }}</span>
                <span class="hist-name"><span class="model-icon small" :class="`t-${topicOf(f.task)}`"><span class="ui-icon" :data-icon="taskIcon(f.task)" aria-hidden="true"></span></span><b>{{ favName(f) }}</b><span class="hist-why">{{ f.verdictWhy }}</span></span>
                <span class="verdict" :class="f.verdict">{{ VERDICT[f.verdict] }}</span>
                <span class="hist-use">{{ f.usedBy ? `en uso · ${f.usedBy}` : '' }}</span>
                <span class="row-num">{{ favBytes(f) ? bytes(favBytes(f)) : f.verdict === 'dropped' ? 'borrado' : '—' }}</span>
              </button>
            </div>
          </section>
          <section v-for="g in favSections" :key="g.id">
            <h2 class="section-title">{{ g.name }} <span>{{ g.items.length }}</span></h2>
            <div class="favs">
              <button v-for="f in g.items" :key="f.id" type="button" class="fav" :class="{ on: selectedFavId === f.id }" @click="pickFav(f)">
                <span class="model-top"><span class="model-icon" :class="`t-${topicOf(f.task)}`"><span class="ui-icon" :data-icon="taskIcon(f.task)" aria-hidden="true"></span></span><span class="model-name">{{ favName(f) }}</span><span class="mac" :class="hereOf(f).status" :title="chipTitle(f)">{{ chipText(f) }}</span></span>
                <span class="model-org">{{ favOrg(f) }} · {{ params(f.params) }}</span>
                <span class="fav-what">{{ f.what }}</span>
                <span v-if="f.usedBy || favBytes(f)" class="fav-tags"><span v-if="f.usedBy" class="in-use">en uso · {{ f.usedBy }}</span><span v-if="favBytes(f)" class="tag">instalado · {{ bytes(favBytes(f)) }}</span></span>
              </button>
            </div>
          </section>
          <p v-if="!favSections.length" class="empty-line">Ningún favorito coincide.</p>
        </div>

        <!-- la portada -->
        <div v-else-if="!data" class="empty"><div class="empty-head">
          <div class="empty-title">{{ apiError ? 'Sin API' : refreshing ? 'Juntando la semana…' : 'Todavía no hay semanas' }}</div>
          <div class="empty-desc">{{ apiError || 'Junta los modelos y los papers de Hugging Face y le pide al modelo de fondo los textos: tarda un minuto.' }}</div>
        </div></div>
        <div v-else-if="view === 'cover'" class="cover">
          <div class="leads" :class="{ single: both }">
          <article v-if="lead" class="lead" :class="{ on: selectedId === lead.id }" @click="pick(lead)">
            <div class="kickers"><span class="kicker"><span class="ui-icon" data-icon="claude" aria-hidden="true"></span> Lo más innovador</span><span v-if="both" class="kicker hot"><span class="ui-icon" data-icon="popular" aria-hidden="true"></span> y lo más popular</span></div>
            <h1><span class="model-icon big" :class="`t-${lead.topic}`"><span class="ui-icon" :data-icon="taskIcon(lead.task)" aria-hidden="true"></span></span>{{ lead.name }}</h1>
            <div class="byline">{{ lead.org }} · <span class="task" :class="`t-${lead.topic}`"><span class="ui-icon" :data-icon="taskIcon(lead.task)" aria-hidden="true"></span>{{ lead.task }}</span> · {{ params(lead.params) }} · salió el {{ day(lead.created) }}</div>
            <p v-if="lead.id === data.lead && data.why" class="why">{{ data.why }}</p>
            <p v-else class="why muted">{{ refreshing ? 'El modelo de fondo está escribiendo por qué importa…' : 'Todavía sin el texto de por qué importa.' }}</p>
            <div class="stats"><span>♥ {{ num(lead.likes) }}</span><span>↓ {{ num(lead.downloads) }}</span><span>tendencia {{ lead.trending }} · #{{ lead.rank }}</span></div>
          </article>
          <article v-if="popular && !both" class="lead hot" :class="{ on: selectedId === popular.id }" @click="pick(popular)">
            <div class="kickers"><span class="kicker hot"><span class="ui-icon" data-icon="popular" aria-hidden="true"></span> Lo más popular</span></div>
            <h1><span class="model-icon big" :class="`t-${popular.topic}`"><span class="ui-icon" :data-icon="taskIcon(popular.task)" aria-hidden="true"></span></span>{{ popular.name }}</h1>
            <div class="byline">{{ popular.org }} · <span class="task" :class="`t-${popular.topic}`"><span class="ui-icon" :data-icon="taskIcon(popular.task)" aria-hidden="true"></span>{{ popular.task }}</span> · salió el {{ day(popular.created) }}</div>
            <p class="why">{{ popularWhy }}</p>
            <div class="stats"><span>♥ {{ num(popular.likes) }}</span><span>↓ {{ num(popular.downloads) }}</span><span>tendencia {{ popular.trending }} · #{{ popular.rank }}</span></div>
          </article>
          </div>

          <section>
            <h2 class="section-title">Nuevos esta semana <span>{{ fresh.length }} modelos creados del {{ weekLabel }} que entraron en tendencia</span></h2>
            <div class="cards">
              <button v-for="m in fresh.filter((x) => x !== lead && x !== popular)" :key="m.id" type="button" class="model" :class="{ on: selectedId === m.id }" @click="pick(m)">
                <span class="model-top"><span class="model-icon" :class="`t-${m.topic}`"><span class="ui-icon" :data-icon="taskIcon(m.task)" aria-hidden="true"></span></span><span class="model-name">{{ m.name }}</span></span>
                <span class="model-org">{{ m.org }} · {{ day(m.created) }}</span>
                <span class="model-foot"><span class="task" :class="`t-${m.topic}`"><span class="ui-icon" :data-icon="taskIcon(m.task)" aria-hidden="true"></span>{{ m.task }}</span><span class="model-num">♥ {{ short(m.likes) }}</span></span>
              </button>
            </div>
            <p v-if="!fresh.length" class="empty-line">Ningún modelo nuevo coincide.</p>
          </section>

          <section>
            <h2 class="section-title">Siguen subiendo <span>no son de esta semana</span></h2>
            <div class="rows">
              <button v-for="m in rising" :key="m.id" type="button" class="row" :class="{ on: selectedId === m.id }" @click="pick(m)">
                <span class="row-rank">#{{ m.rank }}</span>
                <span class="row-name">{{ m.id }}</span>
                <span class="task" :class="`t-${m.topic}`"><span class="ui-icon" :data-icon="taskIcon(m.task)" aria-hidden="true"></span>{{ m.task }}</span>
                <span class="row-num">♥ {{ short(m.likes) }} · ↓ {{ short(m.downloads) }}</span>
                <span class="row-num">{{ day(m.created) }}</span>
              </button>
            </div>
          </section>

          <section>
            <h2 class="section-title">Papers más votados <span>{{ data.papersTotal }} en la semana</span><button type="button" class="link" @click="view = 'papers'">ver todos</button></h2>
            <div class="rows">
              <div v-for="p in papers.slice(0, 5)" :key="p.id" class="row paper"><span class="votes">▲ {{ p.upvotes }}</span><span class="row-name">{{ p.title }}</span><span class="row-num">{{ day(p.day) }}</span></div>
            </div>
          </section>
        </div>

        <!-- los papers -->
        <div v-else class="cover">
          <div v-for="p in papers" :key="p.id" class="paper-card" :class="{ open: openPaper === p.id }" @click="openPaper = openPaper === p.id ? '' : p.id">
            <div class="paper-head"><span class="votes">▲ {{ p.upvotes }}</span><span class="paper-title">{{ p.title }}</span><span class="row-num">{{ day(p.day) }}</span></div>
            <p class="paper-summary">{{ p.summarySpanish || p.summary }}</p>
            <div class="paper-links"><a :href="`https://huggingface.co/papers/${p.id}`" target="_blank" rel="noopener" @click.stop>Hugging Face</a><a v-if="p.github" :href="p.github" target="_blank" rel="noopener" @click.stop>Código</a><span>{{ p.comments }} comentarios</span></div>
          </div>
        </div>
      </div>
    </main>

    <section v-if="shown.panel" class="panel" aria-label="Consola de News">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <nav class="tabs" role="tablist" aria-label="Consola">
        <button type="button" role="tab" class="tab" :class="{ on: consoleTab === 'activity' }" :aria-selected="consoleTab === 'activity'" @click="pickConsoleTab('activity')">Actividad</button>
        <button type="button" role="tab" class="tab" :class="{ on: consoleTab === 'machine' }" :aria-selected="consoleTab === 'machine'" @click="pickConsoleTab('machine')">{{ machine.id === 'mac' ? 'Esta Mac' : 'Este PC' }}</button>
        <button type="button" role="tab" class="tab" :class="{ on: consoleTab === 'notices' }" :aria-selected="consoleTab === 'notices'" @click="pickConsoleTab('notices')">Avisos <span v-if="notices.length" class="count" :class="{ filtered: noticeCount }">{{ notices.length }}</span></button>
        <div class="region-actions">
          <button v-if="consoleTab === 'activity'" type="button" class="region-action" title="Volver a leer la actividad" aria-label="Volver a leer la actividad" @click="loadActivity"><span class="ui-icon" data-icon="refresh" aria-hidden="true"></span></button>
          <button ref="maximize" type="button" class="region-action"></button>
          <button type="button" class="region-action" title="Cerrar la consola" aria-label="Cerrar la consola" @click="togglePanel(false)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
        </div>
      </nav>
      <!-- la subbanda dice qué se está viendo: de cuándo es la semana y si se está actualizando -->
      <div v-if="consoleTab === 'activity'" class="subband">
        <span class="grow"><strong>{{ data ? `Semana ${data.number}` : 'Sin semana' }}</strong>{{ data ? ` · Hugging Face al ${clock(data.fetched)} · se actualiza cada 6 h` : '' }}</span>
        <span v-if="refreshing" class="count filtered">actualizando…</span>
      </div>
      <div v-else-if="consoleTab === 'machine'" class="subband"><span class="grow"><strong>{{ machine.id === 'mac' ? 'La Mac' : 'El PC' }}</strong> · {{ machineSpec }}</span></div>
      <div class="region-body console-body">
        <template v-if="consoleTab === 'activity'">
          <div v-for="(e, i) in activity" :key="i" class="log-line" :data-kind="e.kind"><span class="log-time">{{ hhmmss(e.at) }}</span><span class="log-text">{{ e.text }}</span></div>
          <p v-if="!activity.length" class="console-empty">Todavía no pasó nada en esta sesión del servidor: acá queda cada actualización, lo que se mide y lo que se borra.</p>
        </template>
        <template v-else-if="consoleTab === 'machine'">
          <template v-if="machineInfo">
            <div class="log-line"><span class="log-key">Procesador</span><span class="log-text">{{ machineInfo.machine.cpu || '—' }}</span></div>
            <div class="log-line"><span class="log-key">Memoria</span><span class="log-text">{{ gbOf(machineInfo.machine.ram) }} de RAM{{ machineInfo.machine.accel === 'mps' ? ', compartida con la GPU (memoria unificada)' : '' }}</span></div>
            <div class="log-line"><span class="log-key">GPU</span><span class="log-text">{{ machineInfo.machine.gpu ? `${machineInfo.machine.gpu}${machineInfo.machine.accel === 'mps' ? '' : ` · ${gbOf(machineInfo.machine.vram)}`} · acelera con ${({ mps: 'Metal (MPS)', cuda: 'CUDA', cpu: 'CPU' })[machineInfo.machine.accel]}` : 'sin GPU para modelos: todo corre en la CPU' }}</span></div>
            <div class="region-head group"><span>Motores para correr modelos</span></div>
            <div v-for="e in machineInfo.engines" :key="e.id" class="log-line" :data-kind="e.ready === true ? 'ok' : e.ready === false ? 'warn' : 'info'">
              <span class="log-key">{{ e.name }}</span><span class="log-text">{{ e.ready === true ? 'instalado' : e.ready === false ? 'falta' : 'no se puede saber desde acá' }}{{ e.hint ? ` · ${e.hint}` : '' }}</span>
            </div>
            <div class="region-head group"><span>Dónde se buscan los instalados</span></div>
            <div v-for="r in machineInfo.roots" :key="r.path" class="log-line"><span class="log-key">{{ r.name }}</span><span class="log-text">{{ r.path }}</span></div>
          </template>
          <p v-else class="console-empty">Leyendo la máquina…</p>
        </template>
        <template v-else>
          <div v-for="(n, i) in notices" :key="i" class="log-line notice" :data-kind="n.kind"><span class="log-key">{{ ({ error: 'error', warn: 'aviso', info: 'dato' })[n.kind] }}</span><span class="log-text">{{ n.text }}<span v-if="n.fix" class="log-fix">{{ n.fix }}</span></span></div>
          <p v-if="!notices.length" class="console-empty">Nada pide atención: la semana está completa y con sus textos.</p>
        </template>
      </div>
    </section>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="La ficha del modelo">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head"><span>Ficha</span><a v-if="selectedIdea" class="region-action" :href="selectedIdea.paper.url" target="_blank" rel="noopener" title="Abrir el paper" aria-label="Abrir el paper"><span class="ui-icon" data-icon="external" aria-hidden="true"></span></a><a v-else-if="selectedFav || (selected && view !== 'favorites' && !isResearch(view))" class="region-action" :href="hf(selectedFav?.id || selected.id)" target="_blank" rel="noopener" title="Abrir en Hugging Face" aria-label="Abrir en Hugging Face"><span class="ui-icon" data-icon="external" aria-hidden="true"></span></a></div>
      <div v-if="selectedIdea" class="region-body doc">
        <div class="doc-name">{{ selectedIdea.name }}</div>
        <div class="doc-org">{{ selectedIdea.who }} · {{ selectedIdea.year }}</div>
        <dl>
          <dt>Etapa</dt><dd>{{ stageName(selectedIdea.stage) }}</dd>
          <dt>Máquina</dt><dd><span class="hw" :class="selectedIdea.hardware">{{ hwName(selectedIdea.hardware) }}</span></dd>
          <dt>Paper</dt><dd><a :href="selectedIdea.paper.url" target="_blank" rel="noopener">{{ selectedIdea.paper.title }}</a></dd>
        </dl>
        <div class="doc-section">El problema</div>
        <p class="doc-text">{{ selectedIdea.problem }}</p>
        <div class="doc-section">La idea</div>
        <p class="doc-text">{{ selectedIdea.idea }}</p>
        <div class="doc-section">La evidencia</div>
        <p class="doc-text">{{ selectedIdea.evidence }}</p>
        <div class="doc-section">Con qué máquina</div>
        <p class="doc-text">{{ selectedIdea.machine || 'No se publicó.' }}</p>
        <template v-if="selectedIdea.mac">
          <div class="doc-section">En la Mac</div>
          <p class="doc-text">{{ selectedIdea.mac }}</p>
        </template>
        <template v-if="selectedIdea.cheap">
          <div class="doc-section">Con poco</div>
          <p class="doc-text">{{ selectedIdea.cheap }}</p>
        </template>
        <div v-if="selectedIdea.ours" class="verdict-box keep">
          <span class="verdict keep">Lo que medimos acá</span>
          <p>{{ selectedIdea.ours }}</p>
        </div>
        <template v-if="selectedIdea.models.length">
          <div class="doc-section">En tus favoritos</div>
          <div class="step-ideas"><button v-for="id in selectedIdea.models" :key="id" type="button" class="chip" @click="openFav(id)">{{ id.split('/')[1] }}</button></div>
        </template>
        <template v-if="lineagesOf(selectedIdea.id).length">
          <div class="doc-section">Aparece en</div>
          <div class="step-ideas"><button v-for="l in lineagesOf(selectedIdea.id)" :key="l.id" type="button" class="chip" @click="openResearch('lineages')">{{ l.name }}</button></div>
        </template>
      </div>
      <div v-else-if="isResearch(view)" class="region-body"><p class="empty-line pad">Elegí una idea para ver su ficha.</p></div>
      <div v-else-if="selectedFav" class="region-body doc">
        <div class="doc-name">{{ favName(selectedFav) }}</div>
        <div class="doc-org">{{ favOrg(selectedFav) }}</div>
        <div v-if="selectedFav.verdict" class="verdict-box" :class="selectedFav.verdict">
          <span class="verdict" :class="selectedFav.verdict">{{ VERDICT[selectedFav.verdict] }}</span> <span class="row-num">probado el {{ day(selectedFav.triedOn) }}</span>
          <p>{{ selectedFav.verdictWhy }}</p>
          <p v-if="selectedFav.usedBy" class="in-use-line">Lo usa {{ selectedFav.usedBy }}.</p>
        </div>
        <dl>
          <dt>Tarea</dt><dd><span class="task" :class="`t-${topicOf(selectedFav.task)}`"><span class="ui-icon" :data-icon="taskIcon(selectedFav.task)" aria-hidden="true"></span>{{ selectedFav.task }}</span></dd>
          <dt>Tamaño</dt><dd>{{ params(selectedFav.params) }}</dd>
          <!-- lo medido en Hugging Face: cuánto pesa lo que de verdad se baja -->
          <template v-if="selectedFav.gguf?.length || selectedFav.storage">
            <dt>En disco</dt><dd>{{ selectedFav.gguf?.length ? `${selectedFav.gguf.length === 1 ? 'un GGUF de' : `${selectedFav.gguf.length} GGUF, de`} ${bytes(selectedFav.gguf[0])}${selectedFav.gguf.length > 1 ? ` a ${bytes(selectedFav.gguf[selectedFav.gguf.length - 1])}` : ''}` : `${bytes(selectedFav.storage)} el repo entero` }}</dd>
          </template>
          <template v-if="selectedFav.here?.engine">
            <dt>Se corre con</dt><dd>{{ selectedFav.here.engine.name }}<span v-if="selectedFav.here.engine.ready === true" class="engine ok"> · instalado en {{ machine.label }}</span><span v-else-if="selectedFav.here.engine.ready === false" class="engine missing"> · falta en {{ machine.label }}</span><span v-if="selectedFav.here.engine.hint" class="here-why">{{ selectedFav.here.engine.hint }}</span></dd>
          </template>
          <dt>Licencia</dt><dd>{{ selectedFav.license || 'no la declara' }}</dd>
          <dt>En la Mac</dt><dd><span class="mac" :class="selectedFav.mac">{{ MAC[selectedFav.mac] }}</span></dd>
          <!-- en el PC, además, lo que da acá: declarado si alguien lo probó, o la estimación por tamaño, dicha como tal -->
          <template v-if="!onMac && selectedFav.here">
            <dt>En el PC</dt><dd><span class="mac" :class="selectedFav.here.status">{{ HERE[selectedFav.here.status] }}</span><span class="here-why">{{ selectedFav.here.basis === 'estimated' ? 'Estimado, sin probar: ' : '' }}{{ selectedFav.here.why }}</span></dd>
          </template>
          <dt>Guardado</dt><dd>{{ day(selectedFav.added) }}</dd>
        </dl>
        <div class="doc-section">Qué hace</div>
        <p class="doc-text">{{ selectedFav.what }}</p>
        <div class="doc-section">Por qué es interesante</div>
        <p class="doc-text">{{ selectedFav.why }}</p>
        <template v-if="selectedFav.ideas?.length">
          <div class="doc-section">Ideas</div>
          <ul class="doc-list"><li v-for="i in selectedFav.ideas" :key="i">{{ i }}</li></ul>
        </template>
        <template v-if="selectedFav.tried">
          <div class="doc-section">Lo que dio al probarlo{{ (selectedFav.triedIn || 'mac') !== machine.id ? ((selectedFav.triedIn || 'mac') === 'mac' ? ' en la Mac' : ' en el PC') : '' }}</div>
          <p class="doc-text">{{ selectedFav.tried }}</p>
        </template>
        <template v-if="favInstalled(selectedFav).length">
          <div class="doc-section">Instalado en {{ machine.label }} · {{ bytes(favBytes(selectedFav)) }}</div>
          <template v-for="it in favInstalled(selectedFav)" :key="it.key">
            <div class="nav-row installed doc-installed" :class="{ asking: confirming === it.key }">
              <span class="ui-icon" :data-icon="KIND_ICON[it.kind]" aria-hidden="true"></span><span class="nav-name">{{ it.where }}</span><span class="count">{{ bytes(it.bytes) }}</span>
              <button type="button" class="region-action trash" :disabled="removing === it.key" :aria-label="`Borrar ${it.name}`" @click="removeInstalled(it)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
            </div>
            <div v-if="confirming === it.key" class="confirm-row">
              <span>¿Borrar {{ it.name }}? Libera {{ bytes(it.bytes) }}. {{ it.tools?.length ? `Lo usa ${it.tools.join(', ')} (${it.usedBy}): deja de andar hasta volver a bajarlo.` : 'Ninguna herramienta lo usa: se puede volver a bajar.' }}</span>
              <span class="confirm-actions"><button type="button" class="danger" @click="removeInstalled(it)">Borrar</button><button type="button" @click="confirming = ''">Cancelar</button></span>
            </div>
          </template>
        </template>
      </div>
      <div v-else-if="view === 'favorites'" class="region-body"><p class="empty-line pad">Elegí un favorito para ver su ficha.</p></div>
      <div v-else-if="selected" class="region-body doc">
        <div class="doc-name">{{ selected.name }}</div>
        <div class="doc-org">{{ selected.org }}</div>
        <dl>
          <dt>Tarea</dt><dd><span class="task" :class="`t-${selected.topic}`"><span class="ui-icon" :data-icon="taskIcon(selected.task)" aria-hidden="true"></span>{{ selected.task }}</span></dd>
          <dt>Salió</dt><dd>{{ day(selected.created) }}</dd>
          <dt>Tamaño</dt><dd>{{ params(selected.params) }}</dd>
          <dt>Licencia</dt><dd>{{ selected.license || 'no la declara' }}</dd>
          <dt>Formatos</dt><dd>{{ selected.formats?.length ? selected.formats.join(' · ') : '—' }}</dd>
          <dt>Librería</dt><dd>{{ selected.library || '—' }}</dd>
          <dt>Idiomas</dt><dd>{{ selected.languages?.length ? selected.languages.slice(0, 6).join(', ') : '—' }}</dd>
          <dt v-if="selected.base">Basado en</dt><dd v-if="selected.base">{{ Array.isArray(selected.base) ? selected.base.join(', ') : selected.base }}</dd>
          <dt>Tendencia</dt><dd>#{{ selected.rank }} · {{ selected.trending }}</dd>
          <dt>Popularidad</dt><dd>♥ {{ num(selected.likes) }} · ↓ {{ num(selected.downloads) }}</dd>
        </dl>
        <div class="doc-section">Qué hace</div>
        <p class="doc-text">{{ selected.what || (selected.new ? 'Todavía sin escribir.' : 'Sólo se documentan los modelos nuevos de la semana.') }}</p>
        <div class="doc-section">Lo nuevo</div>
        <p class="doc-text">{{ selected.novelty || '—' }}</p>
      </div>
    </aside>

    <footer class="statusbar">
      <!-- el detalle (el error del modelo de fondo, lo que faltó de la semana) vive en la consola: acá va lo corto -->
      <span v-if="apiError">{{ apiError }}</span>
      <span v-else-if="refreshError">{{ refreshError }}</span>
      <span v-else-if="refreshing">actualizando la semana…</span>
      <span v-else-if="data">Hugging Face al {{ clock(data.fetched) }}{{ data.writtenBy ? ` · textos de ${data.writtenBy === 'claude' ? 'Claude' : 'Gemini'}` : '' }}</span>
      <button v-if="notices.length" type="button" class="statusbar-item" :class="{ warn: noticeCount }" title="Ver los avisos en la consola" @click="openNotices">{{ notices.length }} {{ notices.length === 1 ? 'aviso' : 'avisos' }}</button>
      <button type="button" class="statusbar-item" :disabled="refreshing" title="Actualizar la semana ahora (lo hace sola cada 6 horas)" @click="refreshNow">Actualizar</button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las semanas" aria-label="Mostrar u ocultar las semanas" @click="toggle('sidebar', sidebarOpen)"><span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Mostrar u ocultar la consola" aria-label="Mostrar u ocultar la consola" @click="togglePanel()"><span class="ui-icon" data-icon="console" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar la ficha" aria-label="Mostrar u ocultar la ficha" @click="toggle('aux', auxOpen)"><span class="ui-icon" data-icon="detail" aria-hidden="true"></span></button>
      </div>
    </footer>
  </div>
</template>
