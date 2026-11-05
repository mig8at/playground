<script setup>
/* navegador · la interfaz. Todo lo hace la API en Go (playwright-go): acá se elige el sitio, se abre la ventana
 * para loguearse a mano, se lanza el recorrido y se lee el mapa. El sitio y la página elegida viven en la URL.
 *
 * Las regiones son las de la base: el sidebar con UN árbol (cada sitio es una raíz y sus páginas cuelgan
 * adentro, como las carpetas del Explorer de VS Code), el editor con la captura ENTERA de la página y su resumen
 * arriba (o el resumen del sitio), el sidebar secundario con la ficha de la página, y abajo la consola con
 * pestañas: lo que hace el navegador y lo técnico de la página (formularios, enlaces, llamadas, errores). */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'
import RegionMenu from './RegionMenu.vue'
import RunViewer from './RunViewer.vue'

// ── la ruta: #/corrida/<id> (una corrida) o #/<sitio>?page=<id> (el explorador de sitios) ──
const route = readHashRoute()
const runId = ref(route.parts[0] === 'corrida' ? route.parts[1] || '' : '')
const siteSlug = ref(route.parts[0] === 'corrida' ? '' : route.parts[0] || '')
const pageId = ref(route.params.get('page') || '')
function writeRoute(push) {
  if (runId.value) return setRoute(hashRoute(['corrida', runId.value]), { push })
  setRoute(hashRoute(siteSlug.value ? [siteSlug.value] : [], { page: pageId.value }), { push })
}
function onHashChange() {
  const r = readHashRoute()
  runId.value = r.parts[0] === 'corrida' ? r.parts[1] || '' : ''
  siteSlug.value = r.parts[0] === 'corrida' ? siteSlug.value : r.parts[0] || ''
  pageId.value = r.params.get('page') || ''
}

// ── las corridas: lo que hizo ask (o una sesión a mano con su reporte), con su paso a paso ──
// El sidebar tiene dos pestañas: Corridas (lo de todos los días) y Sitios (el explorador del principio).
const sideTab = ref(readPref('navegador.side-tab', 'runs'))
watch(sideTab, (v) => savePref('navegador.side-tab', v))
const runs = ref([])
const runData = ref(null)
const runLoadError = ref('')
async function loadRuns() {
  try { runs.value = await api('/api/runs') } catch { /* la API se cae al reiniciar */ }
}
async function loadRun(id) {
  runData.value = null
  runLoadError.value = ''
  if (!id) return
  try { runData.value = await api(`/api/runs/${encodeURIComponent(id)}`) } catch (e) { runLoadError.value = e.message }
}
function pickRun(id) { runId.value = id; auxOpen.value = true; saveSize('navegador.aux-open', 1) }
function closeRun() { runId.value = '' }
const DEVICES = [
  { id: 'desktop', label: 'Escritorio', title: 'Escritorio, 1280×800' },
  { id: 'mobile', label: 'Móvil', title: 'Un teléfono (Pixel 7): el sitio sirve su versión móvil. Cambiar reabre la sesión en la misma página' },
]
const KW_CLASS = { LISTO: 'kw-ok', 'NO PUDE': 'kw-bad', NECESITO: 'kw-ask', CONFIRMAR: 'kw-ask' }
const fmtRunDate = (t) => (t ? new Date(t).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
async function copyRunScript() { if (runData.value?.script) copyText(runData.value.script, 'run-script') }
watch(runId, (id) => { writeRoute(true); loadRun(id) })

// ── las evals: cada caso de la suite con su último resultado y su historia (evals/historial.jsonl) ──
const evals = ref({ casos: [], historial: [] })
async function loadEvals() {
  try { evals.value = await api('/api/evals') } catch { /* la API se cae al reiniciar */ }
}
// Por caso: sus resultados de la más nueva a la más vieja, con la fecha y el commit de la corrida de la suite.
const evalCases = computed(() => {
  const byCase = {}
  for (const run of [...evals.value.historial].reverse()) {
    for (const c of run.casos || []) (byCase[c.caso] ||= []).push({ ...c, fecha: run.fecha, commit: run.commit })
  }
  return (evals.value.casos || []).map((c) => ({ ...c, runs: byCase[c.nombre] || [] }))
})
const evalSuites = computed(() => [...evals.value.historial].reverse())
const evalPassing = computed(() => evalCases.value.filter((c) => c.runs[0]?.ok).length)
const reportRunId = (url) => (url || '').match(/\/corridas\/([^/]+)\//)?.[1] || ''
function pickEval(c) { const id = reportRunId(c.runs[0]?.reporte); if (id) pickRun(id) }
watch(sideTab, (v) => { if (v === 'evals') loadEvals() })

// ── una meta lanzada desde acá: la API corre bin/navegador ask y junta lo que va diciendo (server/ask.go) ──
const askGoal = ref('')
// Guía: Claude marca cada paso en la página y la persona lo hace. Hacerlo: Claude actúa y frena antes de guardar.
const askMode = ref(readPref('navegador.ask-mode', 'guide'))
watch(askMode, (v) => savePref('navegador.ask-mode', v))
const askURL = ref('')
const askState = ref({ running: false, waiting: false, meta: '', eventos: [] })
const askEvents = ref([])
const askError = ref('')
const askReply = ref('')
const askBusy = ref(false)
let askTimer = null
async function pollAsk() {
  clearTimeout(askTimer)
  try {
    const st = await api(`/api/ask?desde=${askEvents.value.length}`)
    if (st.total < askEvents.value.length) askEvents.value = [] // otra corrida: se empieza de cero
    else askEvents.value.push(...st.eventos)
    const wasRunning = askState.value.running
    askState.value = st
    if (wasRunning && !st.running) loadRuns()
  } catch { /* la API se cae al reiniciar */ }
  askTimer = setTimeout(pollAsk, askState.value.running ? 800 : 5000)
}
async function launchAsk() {
  if (!askGoal.value.trim() || askState.value.running) return
  askBusy.value = true
  askError.value = ''
  try {
    await api('/api/ask', { method: 'POST', body: JSON.stringify({ meta: askGoal.value, url: askURL.value.trim(), device: devicePref.value, modo: askMode.value }) })
    askEvents.value = []
    runId.value = '' // el editor pasa a mostrar el navegador en vivo
    auxOpen.value = true
    askGoal.value = ''
    pollAsk()
  } catch (e) { askError.value = e.message } finally { askBusy.value = false }
}
async function answerAsk(text) {
  askError.value = ''
  try {
    await api('/api/ask/answer', { method: 'POST', body: JSON.stringify({ text }) })
    askReply.value = ''
    pollAsk()
  } catch (e) { askError.value = e.message }
}
async function stopAsk() {
  try { await api('/api/ask/stop', { method: 'POST' }); pollAsk() } catch (e) { askError.value = e.message }
}
const showAgent = computed(() => !runId.value && (askState.value.running || askEvents.value.length > 0))
// El paso de la guía que espera a la persona, marcado sobre la página en vivo.
const guide = computed(() => (isLive.value ? liveState.value.guide : null))
const guideStyle = computed(() => {
  const g = guide.value
  if (!g?.box || !g.view?.w) return null
  const pct = (n, d) => `${(n / d) * 100}%`
  return { left: pct(g.box.x, g.view.w), top: pct(g.box.y, g.view.h), width: pct(g.box.w, g.view.w), height: pct(g.box.h, g.view.h) }
})
const guideNote = ref('')
const guideStuck = ref(false)
async function answerGuide(done) {
  try {
    await api('/api/live/guide/answer', { method: 'POST', body: JSON.stringify({ done, note: done ? '' : guideNote.value }) })
    guideNote.value = ''
    guideStuck.value = false
    pollLive()
  } catch (e) { liveError.value = e.message }
}
// Un comando de la guía en el panel del agente: «navegador point 5 'Abrí Pagos'» se muestra como la instrucción.
function guideText(cmd) {
  const m = cmd.match(/^navegador point\s+(?:\S+|'[^']*')\s+'((?:[^']|'\\'')*)'\s*$/)
  return m ? m[1] : ''
}
// La pregunta pendiente: el texto de la última vuelta (el que terminó con NECESITO o CONFIRMAR).
const askQuestion = computed(() => {
  if (!askState.value.waiting) return ''
  const last = [...askEvents.value].reverse().find((e) => e.k === 'result')
  return last ? stripKeyword(last.t) : ''
})
const askKeyword = computed(() => [...askEvents.value].reverse().find((e) => e.k === 'ask')?.t || '')
// La corrida que dejó: el reporte trae la URL con su carpeta.
const askRunId = computed(() => {
  const ev = askEvents.value.find((e) => e.k === 'report')
  return ev?.t.match(/\/corridas\/([^/]+)\//)?.[1] || ''
})
const askOut = computed(() => askEvents.value.filter((e) => e.k === 'out'))
const askTimeline = computed(() => askEvents.value.filter((e) => e.k !== 'out' && e.k !== 'ask' && e.k !== 'report'))
function keywordOf(text) {
  const head = (text || '').replace(/^[\s*_#>`]+/, '').toUpperCase()
  return ['LISTO', 'NO PUDE', 'NECESITO', 'CONFIRMAR'].find((k) => head.startsWith(k)) || ''
}
// Claude escribe con Markdown; acá va como texto: sin los ** y __ de la negrita.
function stripKeyword(text) { return plainText(text).replace(/^\s*[*_#>`]*\s*(LISTO|NO PUDE|NECESITO|CONFIRMAR)\s*:?[*_]*\s*/i, '') }
const plainText = (text) => (text || '').replace(/(\*\*|__)(.+?)\1/g, '$2')

async function api(path, opts = {}) {
  const res = await fetch(path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── los sitios ──
const sites = ref([])
const sitesError = ref('')
const newURL = ref('')
const adding = ref(false)
async function loadSites() {
  try {
    sites.value = await api('/api/sites')
    sitesError.value = ''
    if (!siteSlug.value && sites.value.length) siteSlug.value = sites.value[0].slug
  } catch (e) {
    sitesError.value = `No se pudo leer: ${e.message}. ¿Está la API arriba? (make navegador levanta las dos partes)`
  }
}
async function addSite() {
  if (!newURL.value.trim()) return
  adding.value = true
  try {
    const site = await api('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: newURL.value }) })
    newURL.value = ''
    await loadSites()
    pickSite(site.slug)
    // Al agregarlo arranca solo: enlace por enlace hasta que no queden páginas nuevas. Si pide login, el
    // recorrido lo detecta en la entrada y avisa que hay que abrir la ventana.
    run('explore')
  } catch (e) {
    sitesError.value = e.message
  } finally {
    adding.value = false
  }
}
async function removeSite(s) {
  if (!confirm(`¿Olvidar ${s.name}? Se borran su sesión guardada, el mapa y las capturas.`)) return
  try {
    await api(`/api/sites?site=${encodeURIComponent(s.slug)}`, { method: 'DELETE' })
    if (siteSlug.value === s.slug) { siteSlug.value = ''; pageId.value = '' }
    await loadSites()
  } catch (e) {
    sitesError.value = e.message
  }
}
function pickSite(slug) { runId.value = ''; siteSlug.value = slug; pageId.value = ''; expandSite(slug, true) }
const site = computed(() => sites.value.find((s) => s.slug === siteSlug.value))

// ── el mapa del sitio ──
// Cada sitio desplegado tiene su mapa cargado; el elegido es el que muestran el editor y el detalle.
const pagesBySite = ref({})
const runBySite = ref({})
const pages = computed(() => pagesBySite.value[siteSlug.value] || [])
const lastRun = computed(() => runBySite.value[siteSlug.value] || null)
const pagesError = ref('')
const filter = ref('')
const filtering = ref(false)
async function loadPages(slug = siteSlug.value) {
  if (!slug) return
  try {
    const body = await api(`/api/pages?site=${encodeURIComponent(slug)}`)
    pagesBySite.value = { ...pagesBySite.value, [slug]: body.pages || [] }
    runBySite.value = { ...runBySite.value, [slug]: body.run }
    pagesError.value = ''
  } catch (e) {
    pagesError.value = e.message
  }
}
const expandedSites = ref(new Set(readPref('navegador.expanded', [])))
function expandSite(slug, open) {
  const next = new Set(expandedSites.value)
  open ? next.add(slug) : next.delete(slug)
  expandedSites.value = next
  savePref('navegador.expanded', [...next])
  if (open && !pagesBySite.value[slug]) loadPages(slug)
}
const storedPage = computed(() => pages.value.find((p) => p.id === pageId.value))
// Con la sesión en vivo, «la página» es la que está abierta en ese navegador, tal como se analizó por última vez.
const page = computed(() => (isLive.value && liveState.value.page ? liveState.value.page : storedPage.value))
function pickPage(id) {
  runId.value = ''
  pageId.value = id
  auxOpen.value = true
  saveSize('navegador.aux-open', 1)
  // En vivo, elegir una página del árbol es ir a ella.
  const target = pages.value.find((p) => p.id === id)
  if (isLive.value && target && liveState.value.page?.id !== id) liveNav('goto', target.finalUrl || target.url)
}

// El elemento señalado y el elegido: los comparten la captura, la sesión en vivo y la pestaña Acciones.
const hoverControl = ref(-1)
const pickedControl = ref(-1)

// ── la sesión en vivo: el navegador real en el editor (live.go) ──
const liveState = ref({ active: false, steps: [] })
const isLive = computed(() => liveState.value.active && liveState.value.site === siteSlug.value)
const liveError = ref('')
const liveURL = ref('')
const inspect = ref(false) // los cuadros se tocan (y abren su menú) en vez de dejar pasar el clic a la página
const frameMeta = ref(null)
const liveCanvas = ref(null)
// El navegador en vivo tiene el tamaño FIJO de su dispositivo (escritorio 1280×800, o el teléfono): el editor se
// mide y la página se escala para entrar entera, sin cambiar su tamaño real (así las fotos y el script no dependen
// de cómo esté armada la interfaz).
const editorBody = ref(null)
const editorSize = () => {
  const el = editorBody.value
  return el ? { w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight) } : { w: 0, h: 0 }
}
let resizeObs = null
const editorBox = ref({ w: 0, h: 0 })
function watchEditorSize(on) {
  resizeObs?.disconnect()
  resizeObs = null
  if (!on || !editorBody.value) return
  editorBox.value = editorSize()
  resizeObs = new ResizeObserver(() => { editorBox.value = editorSize() })
  resizeObs.observe(editorBody.value)
}
const isMobile = computed(() => liveState.value.device === 'mobile')
// El tamaño en pantalla del navegador: entra entero en el editor, sin agrandarse más que 1:1.
const liveFit = computed(() => {
  const w = liveState.value.width || 1280
  const h = liveState.value.height || 800
  const pad = (isMobile.value ? 48 : 16) + (liveState.value.guide ? 64 : 0)
  const sc = Math.min((editorBox.value.w - pad) / w, (editorBox.value.h - pad) / h, 1)
  return sc > 0 ? { width: `${Math.floor(w * sc)}px`, height: `${Math.floor(h * sc)}px` } : {}
})
// ── el dispositivo: escritorio (por defecto) o un teléfono ──
const devicePref = ref(readPref('navegador.device', 'desktop'))
watch(devicePref, (v) => savePref('navegador.device', v))
const deviceSwitching = ref(false)
async function setDevice(d) {
  devicePref.value = d
  if (!liveState.value.active || liveState.value.device === d) return
  deviceSwitching.value = true
  liveError.value = ''
  try {
    // Se reabre en la misma página: el perfil de un teléfono se fija al abrir el navegador.
    liveState.value = await api('/api/live/device', { method: 'POST', body: JSON.stringify({ device: d }) })
    openFrames()
    pollLive()
  } catch (e) { liveError.value = e.message } finally { deviceSwitching.value = false }
}
let frames = null
let liveTimer = null
async function pollLive() {
  clearTimeout(liveTimer)
  try {
    const st = await api('/api/live/state')
    const prev = liveState.value
    liveState.value = st
    if (st.active && st.url !== prev.url && document.activeElement?.id !== 'live-url') liveURL.value = st.url
    // Mientras corre una meta, el editor sigue al navegador del agente aunque cambie de sitio.
    if (askState.value.running && st.active && st.site !== siteSlug.value && !runId.value) { siteSlug.value = st.site; pageId.value = '' }
    if (st.active && st.version !== prev.version) {
      loadPages(st.site)
      if (st.site === siteSlug.value && st.page) pageId.value = st.page.id
    }
  } catch { /* la API se cae al reiniciar */ }
  liveTimer = setTimeout(pollLive, liveState.value.active ? 1000 : 4000)
}
function drawFrame(msg) {
  const canvas = liveCanvas.value
  if (!canvas) return
  const img = new Image()
  img.onload = () => {
    if (canvas.width !== img.width || canvas.height !== img.height) { canvas.width = img.width; canvas.height = img.height }
    canvas.getContext('2d').drawImage(img, 0, 0)
  }
  img.src = 'data:image/jpeg;base64,' + msg.data
  frameMeta.value = msg.meta
}
function openFrames() {
  closeFrames()
  frames = new EventSource('/api/live/frames')
  frames.onmessage = (e) => { try { drawFrame(JSON.parse(e.data)) } catch { /* cuadro roto */ } }
  frames.addEventListener('end', closeFrames)
}
function closeFrames() { frames?.close(); frames = null }
watch(isLive, (on) => {
  on ? requestAnimationFrame(openFrames) : closeFrames()
  requestAnimationFrame(() => watchEditorSize(on))
})
async function liveStart(start = '') {
  liveError.value = ''
  panelOpen.value = true
  saveSize('navegador.panel-open', 1)
  try {
    const q = `site=${encodeURIComponent(siteSlug.value)}&device=${devicePref.value}${start ? `&start=${encodeURIComponent(start)}` : ''}`
    liveState.value = await api(`/api/live/start?${q}`, { method: 'POST' })
    liveURL.value = liveState.value.url
    poll()
    pollLive()
  } catch (e) {
    liveError.value = e.message
  }
}
async function liveStop() { await api('/api/live/stop', { method: 'POST' }); closeFrames(); setTimeout(pollLive, 300) }
async function liveNav(action, target = '') {
  liveError.value = ''
  try { await api('/api/live/nav', { method: 'POST', body: JSON.stringify({ action, url: target }) }) } catch (e) { liveError.value = e.message }
}
// Del canvas a la página: el canvas se escala al ancho del editor, la página mide lo que dice el cuadro.
function toPage(e) {
  const r = liveCanvas.value.getBoundingClientRect()
  const w = frameMeta.value?.deviceWidth || 1280
  const h = frameMeta.value?.deviceHeight || 800
  return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h }
}
function sendInput(ev) { api('/api/live/input', { method: 'POST', body: JSON.stringify(ev) }).catch((e) => { liveError.value = e.message }) }
function onCanvasClick(e) { liveCanvas.value.focus(); sendInput({ type: 'click', ...toPage(e) }) }
let wheelAcc = 0, wheelTimer = null, wheelAt = null
function onCanvasWheel(e) {
  wheelAcc += e.deltaY
  wheelAt = toPage(e)
  clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => { sendInput({ type: 'wheel', ...wheelAt, dy: wheelAcc }); wheelAcc = 0 }, 60)
}
const KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])
function onCanvasKey(e) {
  const mod = e.ctrlKey || e.metaKey || e.altKey
  if (e.key.length === 1 && !mod) { e.preventDefault(); sendInput({ type: 'text', text: e.key }); return }
  if (KEYS.has(e.key) || (mod && e.key.length === 1)) {
    e.preventDefault()
    const prefix = (e.ctrlKey ? 'Control+' : '') + (e.metaKey ? 'Meta+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && e.key.length > 1 ? 'Shift+' : '')
    sendInput({ type: 'key', key: prefix + e.key })
  }
}
// Los cuadros de los elementos sobre el canvas: la página se mueve (scroll), los cuadros vienen del análisis.
function liveBoxStyle(c) {
  const m = frameMeta.value
  if (!m) return { display: 'none' }
  const x = c.box.x - (m.scrollOffsetX || 0)
  const y = c.box.y - (m.scrollOffsetY || 0)
  if (y + c.box.h < 0 || y > m.deviceHeight || x + c.box.w < 0 || x > m.deviceWidth) return { display: 'none' }
  return { left: `${(x / m.deviceWidth) * 100}%`, top: `${(y / m.deviceHeight) * 100}%`, width: `${(c.box.w / m.deviceWidth) * 100}%`, height: `${(c.box.h / m.deviceHeight) * 100}%` }
}
// El menú de un elemento: lo que se le puede hacer, por su localizador.
const actValue = ref('')
const actBusy = ref(false)
const actError = ref('')
const pickedLive = computed(() => (isLive.value ? (page.value?.controls || [])[pickedControl.value] : null))
watch(pickedControl, () => {
  actError.value = ''
  const c = pickedLive.value
  actValue.value = c?.kind === 'select' ? (c.options || []).find((o) => o.value && !o.disabled)?.value || '' : ''
})
async function liveAct(action) {
  const c = pickedLive.value
  if (!c) return
  actBusy.value = true
  actError.value = ''
  try {
    await api('/api/live/act', { method: 'POST', body: JSON.stringify({ control: c.id, action, value: actValue.value, version: liveState.value.version }) })
    pickedControl.value = -1
  } catch (e) {
    actError.value = e.message
  } finally {
    actBusy.value = false
    pollLive()
  }
}
async function copyLiveScript() { try { copyText(await (await fetch('/api/live/script')).text(), 'live-script') } catch { /* sin API */ } }
// El paso a paso de la corrida (con una foto por paso), en una pestaña nueva.
async function openReport() {
  try {
    const r = await api('/api/live/report', { method: 'POST', body: JSON.stringify({}) })
    window.open(r.url.replace(/^https?:\/\/[^/]+/, ''), '_blank', 'noopener')
  } catch (e) { liveError.value = e.message }
}
async function clearSteps() { await api('/api/live/steps', { method: 'DELETE' }); pollLive() }
async function clearPages() {
  if (!site.value || !confirm(`¿Vaciar el mapa de ${site.value.name}? La sesión se conserva.`)) return
  await api(`/api/pages?site=${encodeURIComponent(siteSlug.value)}`, { method: 'DELETE' })
  pageId.value = ''
  await Promise.all([loadPages(), loadSites()])
}
// Lo que el sitio tiene de verdad hasta donde se sabe: lo visitado más lo que quedó en la cola.
const totals = computed(() => ({ visited: pages.value.length, pending: lastRun.value?.queued || 0 }))
const summary = computed(() => {
  const stack = new Map()
  let calls = 0, errors = 0, walls = 0, forms = 0
  for (const p of pages.value) {
    for (const s of p.stack || []) stack.set(s, (stack.get(s) || 0) + 1)
    calls += (p.requests || []).length
    errors += (p.console || []).length
    forms += (p.forms || []).length
    if (p.authWall) walls++
  }
  return { stack: [...stack.keys()], calls, errors, walls, forms }
})

// ── el árbol del sidebar: cada sitio es una raíz y sus páginas cuelgan adentro ──
// Dos formas de agrupar las páginas: por CARPETAS de la URL (como un explorador de archivos) o por NAVEGACIÓN
// (cada página cuelga de la página desde la que se llegó; el recorrido va a lo ancho, así que la rama es el
// camino más corto desde la entrada).
const grouping = ref(readPref('navegador.grouping', 'folders'))
watch(grouping, (v) => { savePref('navegador.grouping', v); openNodes.value = new Map() })
const showPending = ref(readPref('navegador.show-pending', true))
watch(showPending, (v) => savePref('navegador.show-pending', v))
// Abierta o cerrada la elige la persona; mientras no elija, se abren los primeros niveles bajo el sitio.
const openNodes = ref(new Map())
const isOpen = (n) => openNodes.value.has(n.id) ? openNodes.value.get(n.id) : n.level < 3
function toggleNode(n) {
  if (n.kind === 'site') return expandSite(n.site.slug, !expandedSites.value.has(n.site.slug))
  const m = new Map(openNodes.value); m.set(n.id, !isOpen(n)); openNodes.value = m
}
function collapseAll() {
  const m = new Map()
  for (const r of treeRows.value) if (r.children && r.kind !== 'site') m.set(r.id, false)
  openNodes.value = m
}

function segmentsOf(u) {
  try {
    const x = new URL(u)
    const route = x.pathname + (x.hash.startsWith('#/') ? x.hash.slice(1) : '')
    const parts = route.split('/').filter(Boolean)
    if (x.search && parts.length) parts[parts.length - 1] += x.search
    else if (x.search) parts.push(x.search)
    return parts
  } catch { return [u] }
}
function pendingOf(slug) {
  return showPending.value ? (runBySite.value[slug]?.pending || []).map((l, i) => ({ ...l, id: `${slug}:pending:${i}` })) : []
}

// Un nodo: { id, name, url?, page?, pendingLeaf?, kids: [] }. Una carpeta puede ser también página (su índice).
// La raíz es el sitio: su página («/») queda en la fila del sitio.
function folderTree(slug, list) {
  const root = { id: `${slug}:folder:/`, kids: [], map: new Map() }
  const place = (url, attach) => {
    let node = root
    let path = ''
    for (const seg of segmentsOf(url)) {
      path += '/' + seg
      if (!node.map.has(seg)) {
        const child = { id: `${slug}:folder:${path}`, name: seg, kids: [], map: new Map() }
        node.map.set(seg, child)
        node.kids.push(child)
      }
      node = node.map.get(seg)
    }
    if (!node.page || attach.page) Object.assign(node, attach)
  }
  for (const p of list) place(p.url, { page: p, url: p.url })
  for (const l of pendingOf(slug)) place(l.url, { url: l.url, pendingLeaf: true })
  return root
}
function navTree(slug, list) {
  const byId = new Map(list.map((p) => [p.id, { id: `${slug}:${p.id}`, name: pathOf(p.url), url: p.url, page: p, kids: [] }]))
  // La entrada se funde con la fila del sitio: lo que colgaba de ella cuelga del sitio.
  const entry = list.find((p) => p.depth === 0 && !p.parent)
  const root = { id: `${slug}:nav`, kids: [], page: entry, url: entry?.url }
  const hang = (node, parentId) => {
    const parent = byId.get(parentId)
    if (parent && parent !== node && parentId !== entry?.id) parent.kids.push(node)
    else root.kids.push(node)
  }
  for (const n of byId.values()) if (n.page !== entry) hang(n, n.page.parent)
  for (const l of pendingOf(slug)) hang({ id: l.id, name: pathOf(l.url), url: l.url, pendingLeaf: true, kids: [] }, l.parent)
  return root
}
const treeRows = computed(() => {
  const q = filter.value.trim().toLowerCase()
  const match = (n) => !q || ((n.url || n.name || '') + ' ' + (n.page?.title || '')).toLowerCase().includes(q)
  // Carpetas primero, después archivos, por nombre; lo sin visitar al final de su carpeta.
  const order = (a, b) => (!!a.pendingLeaf - !!b.pendingLeaf) || (!b.kids.length - !a.kids.length) || (a.name || '').localeCompare(b.name || '')
  const out = []
  for (const s of sites.value) {
    const list = pagesBySite.value[s.slug]
    const expanded = expandedSites.value.has(s.slug)
    const root = list ? (grouping.value === 'nav' ? navTree(s.slug, list) : folderTree(s.slug, list)) : { kids: [] }
    const keep = new Map()
    const mark = (n) => {
      if (keep.has(n.id)) return keep.get(n.id)
      keep.set(n.id, false) // corta un ciclo, si lo hubiera
      let hit = match(n)
      for (const k of n.kids) hit = mark(k) || hit
      keep.set(n.id, hit)
      return hit
    }
    const anyHit = root.kids.map(mark).some(Boolean)
    if (q && !anyHit && !s.name.toLowerCase().includes(q)) continue
    out.push({ id: `site:${s.slug}`, kind: 'site', site: s, name: s.name, page: root.page, level: 0,
      children: list ? root.kids.length : s.pages + (s.queued || 0), open: expanded || !!q })
    if (!(expanded || q) || !list) continue
    const seen = new Set()
    const walk = (n, level) => {
      if (seen.has(n.id) || (q && !keep.get(n.id))) return
      seen.add(n.id)
      const kids = [...n.kids].sort(order)
      const row = { id: n.id, kind: 'page', slug: s.slug, name: n.name, url: n.url, page: n.page, pending: n.pendingLeaf && !n.page, level, children: kids.length }
      row.open = kids.length && (q || isOpen(row))
      out.push(row)
      if (row.open) kids.forEach((k) => walk(k, level + 1))
    }
    root.kids.sort(order).forEach((k) => walk(k, 1))
  }
  return out
})
function onRow(r) {
  if (r.kind === 'site') {
    if (siteSlug.value === r.site.slug && !pageId.value) return toggleNode(r)
    return pickSite(r.site.slug)
  }
  if (r.page) { siteSlug.value = r.slug; pickPage(r.page.id) }
  else if (r.children) toggleNode(r)
}

// ── correr: la ventana o el recorrido ──
const state = ref({ busy: false, log: [] })
const log = ref([])
const runError = ref('')
const maxPages = ref(readPref('navegador.max-pages', 300))
const maxDepth = ref(readPref('navegador.levels', '')) // vacío: sin límite, hasta que no queden páginas nuevas
watch(maxPages, (v) => savePref('navegador.max-pages', v))
watch(maxDepth, (v) => savePref('navegador.levels', v))
let lastSeq = 0
let pollTimer = null
async function poll() {
  clearTimeout(pollTimer)
  try {
    const st = await api(`/api/state?since=${lastSeq}`)
    const wasBusy = state.value.busy
    state.value = st
    if (st.log.length) {
      log.value = [...log.value, ...st.log].slice(-600)
      lastSeq = st.lastSeq
      if (st.site === siteSlug.value || expandedSites.value.has(st.site)) loadPages(st.site)
      loadSites()
    }
    if (wasBusy && !st.busy) { loadSites(); loadPages(st.site || siteSlug.value) }
  } catch { /* la API se cae al reiniciar: se reintenta */ }
  pollTimer = setTimeout(poll, state.value.busy ? 1000 : 3000)
}
async function run(kind, start = '', slug = siteSlug.value) {
  runError.value = ''
  panelOpen.value = true
  saveSize('navegador.panel-open', 1)
  tab.value = 'log'
  if (slug !== siteSlug.value) pickSite(slug)
  try {
    const q = `site=${encodeURIComponent(slug)}${start ? `&start=${encodeURIComponent(start)}` : ''}`
    if (kind === 'browse') await api(`/api/browse?${q}`, { method: 'POST' })
    else await api(`/api/explore?${q}`, { method: 'POST', body: JSON.stringify({ max: Number(maxPages.value) || 0, depth: Number(maxDepth.value) || 0, start }) })
    poll()
  } catch (e) {
    runError.value = e.message
  }
}
async function stop() { await api('/api/stop', { method: 'POST' }); poll() }
const busyHere = computed(() => state.value.busy && state.value.site === siteSlug.value)
const busyLabel = computed(() => {
  if (!state.value.busy) return ''
  const what = state.value.kind === 'browse' ? 'Ventana abierta' : 'Explorando'
  return `${what} · ${state.value.site} · ${state.value.visited} páginas`
})

// ── las pestañas de la consola: lo que hace el navegador y, con una página elegida, lo técnico de ella ──
const TABS = [
  { id: 'log', label: 'Consola' },
  { id: 'steps', label: 'Pasos', live: true },
  { id: 'actions', label: 'Acciones', count: (p) => (p.controls || []).length, page: true },
  { id: 'forms', label: 'Formularios', count: (p) => (p.forms || []).length, page: true },
  { id: 'links', label: 'Enlaces', count: (p) => (p.links || []).length, page: true },
  { id: 'calls', label: 'Llamadas', count: (p) => (p.requests || []).length, page: true },
  { id: 'errors', label: 'Errores', count: (p) => (p.console || []).length, page: true },
]
const tab = ref(TABS.some((t) => t.id === readPref('navegador.panel-tab', 'log')) ? readPref('navegador.panel-tab', 'log') : 'log')
watch(tab, (v) => savePref('navegador.panel-tab', v))
const panelTab = computed(() => {
  const t = TABS.find((x) => x.id === tab.value)
  if (t?.live) return isLive.value ? tab.value : 'log'
  return page.value || !t?.page ? tab.value : 'log'
})

const internalLinks = computed(() => {
  if (!page.value || !site.value) return []
  return (page.value.links || []).map((l) => {
    let internal = false
    try { internal = new URL(l.href).host === site.value.host } catch { /* enlace raro */ }
    return { ...l, internal }
  })
})
function pageByURL(href) {
  const clean = href.split('#')[0].replace(/\/$/, '')
  return pages.value.find((p) => p.url.split('#')[0].replace(/\/$/, '') === clean)
}
const parentPage = computed(() => page.value && pages.value.find((p) => p.id === page.value.parent))
async function copyURL() { try { await navigator.clipboard.writeText(page.value.finalUrl || page.value.url) } catch { /* sin permiso */ } }

// ── la página en el editor: su captura entera y, arriba, cuánto tiene ──
const shotFit = ref(readPref('navegador.shot-fit', true)) // ajustada al ancho o en tamaño real
watch(shotFit, (v) => savePref('navegador.shot-fit', v))
const pageStats = computed(() => {
  const p = page.value
  if (!p) return []
  const internal = internalLinks.value.filter((l) => l.internal).length
  return [
    { id: 'actions', label: 'elementos interactivos', value: (p.controls || []).length },
    { id: 'forms', label: 'formularios', value: (p.forms || []).length },
    { id: 'links', label: 'enlaces internos', value: internal },
    { id: 'links', label: 'enlaces externos', value: internalLinks.value.length - internal },
    { id: 'calls', label: 'llamadas', value: (p.requests || []).length },
    { id: 'errors', label: 'errores', value: (p.console || []).length, bad: true },
  ]
})
function openTab(id) { tab.value = id; panelOpen.value = true; saveSize('navegador.panel-open', 1) }

// ── los elementos interactivos: el localizador de Playwright para llegar a cada uno, probado en la página ──
const KIND_LABEL = { field: 'campo', select: 'desplegable', check: 'casilla', button: 'botón', link: 'enlace', scroll: 'zona con scroll', file: 'archivo', drag: 'arrastrable' }
const LOC_LABEL = { role: 'rol', scoped: 'rol en zona', nth: 'rol (n-ésimo)', label: 'etiqueta', placeholder: 'placeholder', testid: 'test id', text: 'texto', css: 'CSS' }
const showBoxes = ref(readPref('navegador.boxes', true))
watch(showBoxes, (v) => savePref('navegador.boxes', v))
const shotSize = ref({ w: 0, h: 0 })
const controls = computed(() => page.value?.controls || [])
watch(() => page.value?.id, () => { pickedControl.value = -1; hoverControl.value = -1; shotSize.value = { w: 0, h: 0 } })
function onShotLoad(e) { shotSize.value = { w: e.target.naturalWidth, h: e.target.naturalHeight } }
function boxStyle(c) {
  const { w, h } = shotSize.value
  if (!w || !h) return { display: 'none' }
  return { left: `${(c.box.x / w) * 100}%`, top: `${(c.box.y / h) * 100}%`, width: `${(c.box.w / w) * 100}%`, height: `${(c.box.h / h) * 100}%` }
}
const bestCode = (c) => (c.best >= 0 ? c.locators[c.best].code + c.action : '')
// Un CSS por posición encuentra el elemento hoy, pero se rompe con cualquier cambio del HTML.
const fragile = (l) => l.kind === 'css' && /nth-of-type|>/.test(l.value)
function pickControl(c, from) {
  pickedControl.value = c.id
  if (isLive.value && from === 'row') return // en vivo, la fila abre el menú del elemento sobre el canvas
  if (from === 'shot') {
    openTab('actions')
    requestAnimationFrame(() => document.getElementById(`control-row-${c.id}`)?.scrollIntoView({ block: 'nearest' }))
  } else {
    requestAnimationFrame(() => document.getElementById(`control-box-${c.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }
}
const copied = ref('')
async function copyText(text, key) {
  try { await navigator.clipboard.writeText(text); copied.value = key; setTimeout(() => { if (copied.value === key) copied.value = '' }, 1200) } catch { /* sin permiso */ }
}
// El script: entra a la página, llena cada formulario y lo envía. Los enlaces quedan afuera (navegan a otra página).
const playwrightScript = computed(() => {
  const p = page.value
  if (!p) return ''
  const lines = []
  const groups = new Map()
  for (const c of controls.value) {
    if (c.kind === 'link') continue
    const key = c.form
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  for (const [form, list] of groups) {
    const f = form >= 0 ? (p.forms || [])[form] : null
    lines.push('', `  // ${f ? `Formulario ${form + 1}${f.action ? ` · ${(f.method || 'get').toUpperCase()} ${pathOf(f.action)}` : ''}` : 'Fuera de un formulario'}`)
    const fields = list.filter((c) => c.kind !== 'button')
    const buttons = list.filter((c) => c.kind === 'button')
    for (const c of [...fields, ...buttons]) {
      lines.push(c.best >= 0 ? `  await ${bestCode(c)}` : `  // sin localizador único: ${c.name}`)
    }
  }
  const title = (p.title || pathOf(p.url)).replace(/'/g, "\\'")
  return [
    "import { test } from '@playwright/test'",
    '',
    `test('${title}', async ({ page }) => {`,
    `  await page.goto('${(p.finalUrl || p.url).replace(/'/g, "\\'")}')`,
    ...lines,
    '})',
    '',
  ].join('\n')
})

// ── formato ──
function pathOf(u) {
  try { const x = new URL(u); return (x.pathname || '/') + x.search + (x.hash.startsWith('#/') ? x.hash : '') } catch { return u }
}
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')
const fmtFull = (t) => (t && !t.startsWith('0001') ? new Date(t).toLocaleString('es-CO') : '')
const statusClass = (s) => (s >= 400 ? 'bad' : s >= 300 ? 'warn' : '')

// ── las regiones, con el contrato de la base ──
const sidebarOpen = ref(readSize('navegador.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('navegador.sidebar-w', 320))
const auxOpen = ref(readSize('navegador.aux-open', 1) !== 0)
const auxW = ref(readSize('navegador.aux-w', 380))
const panelOpen = ref(readSize('navegador.panel-open', 1) !== 0)
const panelH = ref(readSize('navegador.panel-h', 220))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 240)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: auxOpen.value && (runId.value ? runData.value : showAgent.value || page.value) ? auxW.value : 0, min },
    { size: sidebarOpen.value ? sidebarW.value : 0, min },
  ])
  const [panel] = fitRegions(viewportH.value - 200, [
    { size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) },
  ])
  return { sidebar, aux, panel }
})
const layoutVars = computed(() => ({
  '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px`, '--panel-h': `${shown.value.panel}px`,
}))
const sidebarResize = {
  label: 'Ancho del explorador', sign: 1, defaultValue: 320,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('navegador.sidebar-open', v ? 1 : 0); if (v) saveSize('navegador.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho del detalle', sign: -1, defaultValue: 380,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('navegador.aux-open', v ? 1 : 0); if (v) saveSize('navegador.aux-w', auxW.value) },
}
const panelResize = {
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 220,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('navegador.panel-open', v ? 1 : 0); if (v) saveSize('navegador.panel-h', panelH.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('navegador.sidebar-open', sidebarOpen.value ? 1 : 0) }
function toggleAux() { auxOpen.value = !shown.value.aux; saveSize('navegador.aux-open', auxOpen.value ? 1 : 0) }
function togglePanel() { panelOpen.value = !shown.value.panel; saveSize('navegador.panel-open', panelOpen.value ? 1 : 0) }

// El menú de la región: cómo se agrupa el árbol y qué se ve.
const treeMenu = computed(() => [
  { id: 'folders', label: 'Agrupar por carpetas de la URL', selected: grouping.value === 'folders' },
  { id: 'nav', label: 'Agrupar por navegación (desde dónde se llegó)', selected: grouping.value === 'nav' },
  { separator: true },
  { id: 'pending', label: 'Mostrar lo encontrado sin visitar', checked: showPending.value },
  { separator: true },
  { id: 'reload', label: 'Volver a leer', icon: 'refresh' },
])
function onTreeMenu(id) {
  if (id === 'folders' || id === 'nav') grouping.value = id
  if (id === 'pending') showPending.value = !showPending.value
  if (id === 'reload') { loadSites(); for (const slug of expandedSites.value) loadPages(slug) }
}
// El menú de cada sitio: lo que se hace con él y se toca poco.
function siteMenu(s) {
  const busy = state.value.busy
  return [
    { id: 'browse', label: 'Abrir la ventana (login a mano)', icon: 'external', disabled: busy },
    { id: 'clear', label: 'Vaciar el mapa', icon: 'trash', disabled: !s.pages || (busy && state.value.site === s.slug) },
    { separator: true },
    { id: 'remove', label: 'Olvidar el sitio', icon: 'trash', disabled: busy && state.value.site === s.slug },
  ]
}
function onSiteMenu(s, id) {
  if (id === 'browse') run('browse', '', s.slug)
  if (id === 'clear') { pickSite(s.slug); clearPages() }
  if (id === 'remove') removeSite(s)
}
function toggleFilter() { filtering.value = !filtering.value; if (!filtering.value) filter.value = '' }

watch(siteSlug, (slug) => { writeRoute(true); if (!pagesBySite.value[slug]) loadPages(slug) })
watch(pageId, () => writeRoute(false))

const themeToggle = ref(null)
let themeBinding = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  await loadSites()
  writeRoute(false)
  if (siteSlug.value) expandSite(siteSlug.value, true)
  for (const slug of expandedSites.value) if (sites.value.some((x) => x.slug === slug)) loadPages(slug)
  poll()
  pollLive()
  loadRuns()
  loadRun(runId.value)
  pollAsk()
  if (sideTab.value === 'evals') loadEvals()
  runsTimer = setInterval(loadRuns, 8000)
})
let runsTimer = null
onBeforeUnmount(() => {
  clearInterval(runsTimer)
  clearTimeout(askTimer)
  clearTimeout(liveTimer)
  closeFrames()
  resizeObs?.disconnect()
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearTimeout(pollTimer)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <!-- SIDEBAR · el explorador: un solo árbol, cada sitio es una raíz y sus páginas cuelgan adentro -->
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Explorador">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <nav class="tabs">
        <button type="button" class="tab" :class="{ on: sideTab === 'runs' }" @click="sideTab = 'runs'">Corridas <span class="count">{{ runs.length }}</span></button>
        <button type="button" class="tab" :class="{ on: sideTab === 'evals' }" @click="sideTab = 'evals'">Evals <span class="count">{{ evalCases.length ? `${evalPassing}/${evalCases.length}` : '' }}</span></button>
        <button type="button" class="tab" :class="{ on: sideTab === 'sites' }" @click="sideTab = 'sites'">Sitios <span class="count" :class="{ filtered: filter }">{{ sites.length }}</span></button>
        <div v-if="sideTab !== 'sites'" class="region-actions">
          <button type="button" class="region-action" title="Volver a leer" aria-label="Volver a leer" @click="sideTab === 'runs' ? loadRuns() : loadEvals()">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
        <div v-else class="region-actions">
          <button type="button" class="region-action" :aria-pressed="filtering" title="Filtrar páginas" aria-label="Filtrar páginas" @click="toggleFilter">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" title="Plegar las carpetas" aria-label="Plegar las carpetas" @click="collapseAll">
            <span class="ui-icon" data-icon="collapse" aria-hidden="true"></span>
          </button>
          <RegionMenu :items="treeMenu" :active="grouping !== 'folders' || !showPending" @select="onTreeMenu" />
        </div>
      </nav>
      <div v-if="sideTab === 'runs'" class="region-body">
        <form class="ask-form" @submit.prevent="launchAsk">
          <textarea v-model="askGoal" class="input ask-goal" rows="3" placeholder="Qué querés configurar, como se lo dirías a alguien: «agregá Crédito Ya como medio de pago, en modo pruebas»" aria-label="La meta" @keydown.enter.exact.prevent="launchAsk"></textarea>
          <div class="seg-toggle ask-mode" role="group" aria-label="Cómo trabaja">
            <button type="button" :aria-pressed="askMode === 'guide'" title="Claude te marca cada paso en la página y vos lo hacés: aprendés el camino y queda la guía con fotos" @click="askMode = 'guide'">Guiame</button>
            <button type="button" :aria-pressed="askMode === 'do'" title="Claude lo hace y frena antes de guardar, activar o borrar algo, con la lista de cambios" @click="askMode = 'do'">Hacelo</button>
          </div>
          <div class="ask-form-row">
            <input v-model="askURL" class="input input-sm" type="url" placeholder="URL de arranque (vacío: la sesión abierta)" aria-label="URL de arranque" />
            <select v-model="devicePref" class="input input-sm ask-device" aria-label="Dispositivo" title="En qué dispositivo navega">
              <option v-for="d in DEVICES" :key="d.id" :value="d.id">{{ d.label }}</option>
            </select>
            <button type="submit" class="btn btn-sm" :disabled="!askGoal.trim() || askState.running || askBusy">Lanzar</button>
          </div>
          <p v-if="askState.running" class="none">Hay una meta corriendo: la sigue el panel Agente.</p>
          <p v-if="askError && !showAgent" class="ask-error">{{ askError }}</p>
        </form>
        <p v-if="!runs.length" class="none">Todavía no hay corridas con reporte. Aparecen cuando termina un <code>bin/navegador ask</code>, una corrida de evals o un <code>bin/navegador report</code>.</p>
        <button v-for="r in runs" :key="r.id" type="button" class="row stacked run-row" :class="{ on: r.id === runId }" @click="pickRun(r.id)">
          <span class="run-row-top"><span class="badge badge-xs kw" :class="KW_CLASS[r.palabra] || 'kw-none'">{{ r.palabra || '—' }}</span><span class="run-row-meta">{{ r.meta || '(sin meta)' }}</span></span>
          <span class="row-desc">{{ r.sitio }} · {{ fmtRunDate(r.fecha) }}<template v-if="r.usd"> · US$ {{ r.usd.toFixed(2) }}</template> · {{ r.pasos }} pasos<template v-if="r.fallidos"> ({{ r.fallidos }} ✗)</template></span>
        </button>
      </div>
      <div v-else-if="sideTab === 'evals'" class="region-body">
        <p class="none">La suite de regresión de <code>ask</code>: <code>make navegador-evals</code> (cuesta, por eso se corre desde la terminal). Un caso abre la corrida de su último reporte, si lo dejó.</p>
        <button v-for="c in evalCases" :key="c.nombre" type="button" class="row stacked run-row" :class="{ on: reportRunId(c.runs[0]?.reporte) && reportRunId(c.runs[0]?.reporte) === runId }" :title="c.meta" @click="pickEval(c)">
          <span class="run-row-top">
            <span class="badge badge-xs kw" :class="!c.runs.length ? 'kw-none' : c.runs[0].ok ? 'kw-ok' : 'kw-bad'">{{ !c.runs.length ? 'sin correr' : c.runs[0].ok ? 'pasa' : 'falla' }}</span>
            <span class="run-row-meta">{{ c.nombre }}</span>
            <span v-if="c.externo" class="row-desc">internet</span>
          </span>
          <span class="row-desc ellipsis">{{ c.meta }}</span>
          <span v-if="c.runs.length" class="row-desc">
            <span class="eval-dots" aria-label="Historia, la más nueva primero"><span v-for="(r, i) in c.runs.slice(0, 12)" :key="i" class="eval-dot" :class="r.ok ? 'ok' : 'bad'" :title="`${fmtRunDate(r.fecha)} · ${r.commit} · ${(r.termino || []).join(' → ')}${r.por_que ? ' · ' + r.por_que : ''}`"></span></span>
            {{ fmtRunDate(c.runs[0].fecha) }} · US$ {{ (c.runs[0].usd || 0).toFixed(2) }}
          </span>
          <span v-if="c.runs[0] && !c.runs[0].ok && c.runs[0].por_que" class="row-desc eval-why">{{ c.runs[0].por_que }}</span>
        </button>
        <div class="region-head group"><span>Corridas de la suite</span><span class="count">{{ evalSuites.length }}</span></div>
        <div v-for="(r, i) in evalSuites" :key="i" class="row stacked">
          <span>{{ r.pasaron }}/{{ r.total }} · {{ fmtRunDate(r.fecha) }}</span>
          <span class="row-desc">{{ r.commit }}<template v-if="r.cambios_sin_commit"> + cambios</template> · US$ {{ (r.usd || 0).toFixed(2) }} · {{ Math.round(r.seg || 0) }} s</span>
        </div>
      </div>
      <div v-else class="region-body">
        <div class="tree-top">
          <form class="add" @submit.prevent="addSite">
            <input v-model="newURL" class="input input-sm" placeholder="Pegá una URL para agregar y explorar" aria-label="URL de entrada del sitio" />
            <button type="submit" class="region-action" :disabled="adding || !newURL.trim()" title="Agregar y explorar el sitio" aria-label="Agregar y explorar el sitio">
              <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
            </button>
          </form>
          <span v-if="filtering" class="input-group input-group-xs">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
            <input v-model="filter" class="input input-xs" placeholder="Filtrar por ruta o título" aria-label="Filtrar páginas" />
          </span>
        </div>
        <p v-if="sitesError" class="none bad">{{ sitesError }}</p>
        <p v-else-if="pagesError" class="none bad">{{ pagesError }}</p>
        <p v-if="!sites.length && !sitesError" class="none">Pegá la URL de entrada de un sitio: se agrega y se explora solo.</p>

        <div class="tree" role="tree" aria-label="Sitios y sus páginas">
          <div v-for="r in treeRows" :key="r.id" class="row tree-row" role="treeitem"
            :class="{
              on: r.kind === 'site' ? r.site.slug === siteSlug && !pageId : r.page && r.slug === siteSlug && r.page.id === pageId,
              site: r.kind === 'site', pending: r.pending, folder: r.kind === 'page' && !r.page && !r.pending,
            }"
            :aria-expanded="r.children ? !!r.open : undefined"
            :style="{ paddingLeft: `calc(var(--space-1) + ${r.level} * var(--indent))` }"
            :title="r.kind === 'site' ? r.site.url : r.pending ? `${r.url} · encontrada, sin visitar` : r.page ? `${r.page.title || ''}\n${r.url}` : r.name"
            tabindex="0" @click="onRow(r)" @keydown.enter="onRow(r)">
            <button v-if="r.children" type="button" class="twisty" :aria-expanded="!!r.open"
              :aria-label="r.open ? 'Plegar' : 'Desplegar'" @click.stop="toggleNode(r)">
              <span class="ui-icon" data-icon="chevron" aria-hidden="true"></span>
            </button>
            <div v-else class="twisty"></div>
            <span class="node-name">{{ r.name }}</span>
            <template v-if="r.kind === 'site'">
              <small v-if="state.busy && state.site === r.site.slug" class="node-flag">{{ state.kind === 'browse' ? 'ventana abierta' : `explorando · ${state.visited}` }}</small>
              <small v-else class="node-flag" :title="`${r.site.pages} visitadas${r.site.queued ? `, ${r.site.queued} sin visitar` : ''}`">
                {{ r.site.queued ? `${r.site.pages} + ${r.site.queued}` : r.site.pages }}
              </small>
              <div class="row-actions">
                <button v-if="state.busy && state.site === r.site.slug" type="button" class="region-action" title="Parar" aria-label="Parar" @click.stop="stop">
                  <span class="ui-icon" data-icon="stop" aria-hidden="true"></span>
                </button>
                <button v-else type="button" class="region-action" :disabled="state.busy" title="Explorar el sitio (sin ventana, con la sesión guardada)" aria-label="Explorar el sitio"
                  @click.stop="run('explore', '', r.site.slug)">
                  <span class="ui-icon" data-icon="play" aria-hidden="true"></span>
                </button>
                <RegionMenu :items="siteMenu(r.site)" title="Más acciones del sitio" @click.stop @select="(id) => onSiteMenu(r.site, id)" />
              </div>
            </template>
            <template v-else>
              <small v-if="r.page?.authWall" class="node-flag bad">login</small>
              <small v-else-if="r.page?.status >= 300" class="node-flag" :class="statusClass(r.page.status)">{{ r.page.status }}</small>
              <small v-else-if="r.page?.error" class="node-flag bad">error</small>
              <small v-else-if="r.pending" class="node-flag">sin visitar</small>
            </template>
          </div>
        </div>
      </div>
    </aside>

    <!-- EDITOR · la captura entera de la página con su resumen arriba; sin página, el resumen del sitio -->
    <main class="editor">
      <div v-if="runId" class="region-head">
        <span class="ellipsis">Corrida · {{ runData?.corrida?.meta || runId }}</span>
        <div class="region-actions">
          <a class="region-action" :href="`/api/corridas/${runId}/reporte.html`" target="_blank" rel="noopener" title="Abrir el reporte en una pestaña" aria-label="Abrir el reporte en una pestaña">
            <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
          </a>
          <button type="button" class="region-action" :disabled="!runData?.script" :title="copied === 'run-script' ? 'Copiado' : 'Copiar el script de Playwright'" aria-label="Copiar el script de Playwright" @click="copyRunScript">
            <span class="ui-icon" :data-icon="copied === 'run-script' ? 'check' : 'code'" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" title="Cerrar la corrida" aria-label="Cerrar la corrida" @click="closeRun">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div v-else-if="isLive" class="region-head live-head">
        <button type="button" class="region-action" title="Atrás" aria-label="Atrás" @click="liveNav('back')">
          <span class="ui-icon" data-icon="chevron" aria-hidden="true" style="transform: rotate(180deg)"></span>
        </button>
        <button type="button" class="region-action" title="Recargar" aria-label="Recargar" @click="liveNav('reload')">
          <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
        </button>
        <form class="live-url" @submit.prevent="liveNav('goto', liveURL)">
          <input id="live-url" v-model="liveURL" class="input input-sm" aria-label="URL de la sesión en vivo" spellcheck="false" />
        </form>
        <span v-if="liveState.analyzing" class="muted head-note">analizando…</span>
        <div class="seg-toggle" role="group" aria-label="Dispositivo">
          <button v-for="d in DEVICES" :key="d.id" type="button" :aria-pressed="liveState.device === d.id" :disabled="deviceSwitching" :title="d.title" @click="setDevice(d.id)">{{ d.label }}</button>
        </div>
        <div class="region-actions">
          <button type="button" class="region-action" :aria-pressed="inspect" :title="inspect ? 'Volver a usar la página' : 'Inspeccionar: tocar un elemento abre su localizador y sus acciones'"
            aria-label="Inspeccionar los elementos" @click="inspect = !inspect; pickedControl = -1">
            <span class="ui-icon" data-icon="pick" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" :aria-pressed="showBoxes" :title="showBoxes ? 'Ocultar los marcos' : 'Marcar los elementos interactivos'" aria-label="Marcar los elementos interactivos" @click="showBoxes = !showBoxes">
            <span class="ui-icon" data-icon="eye" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" title="Cerrar la sesión en vivo" aria-label="Cerrar la sesión en vivo" @click="liveStop">
            <span class="ui-icon" data-icon="stop" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div v-else class="region-head">
        <span class="ellipsis">{{ page ? (page.title || pathOf(page.url)) : site ? site.name : 'navegador' }}</span>
        <div v-if="site" class="region-actions">
          <button type="button" class="region-action" :disabled="state.busy" title="Abrir en vivo: el navegador real en el editor" aria-label="Abrir en vivo"
            @click="liveStart(page ? page.finalUrl || page.url : '')">
            <span class="ui-icon" data-icon="start" aria-hidden="true"></span>
          </button>
          <template v-if="page">
            <button type="button" class="region-action" :aria-pressed="showBoxes" :disabled="!page.shot || !controls.length"
              :title="showBoxes ? 'Ocultar los elementos interactivos' : 'Marcar los elementos interactivos'" aria-label="Marcar los elementos interactivos" @click="showBoxes = !showBoxes">
              <span class="ui-icon" data-icon="pick" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" :aria-pressed="!shotFit" :disabled="!page.shot"
              :title="shotFit ? 'Ver la captura en tamaño real' : 'Ajustar la captura al ancho'" :aria-label="shotFit ? 'Ver la captura en tamaño real' : 'Ajustar la captura al ancho'" @click="shotFit = !shotFit">
              <span class="ui-icon" :data-icon="shotFit ? 'maximize' : 'restore'" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" title="Volver al resumen del sitio" aria-label="Volver al resumen del sitio" @click="pageId = ''">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </template>
        </div>
      </div>
      <div v-if="runId" class="region-body run-body">
        <div v-if="runLoadError" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-title">{{ runLoadError }}</div></div>
        <RunViewer v-else-if="runData" :run="runData" />
        <div v-else class="empty"><div class="empty-desc">Leyendo la corrida…</div></div>
      </div>
      <div v-show="!runId" ref="editorBody" class="region-body" :class="{ 'live-body': isLive }">
        <div v-if="runError" class="alert alert-destructive" role="alert">
          <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
          <div class="alert-title">{{ runError }}</div>
        </div>

        <div v-if="liveError" class="alert alert-destructive" role="alert">
          <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
          <div class="alert-title">{{ liveError }}</div>
        </div>

        <div v-if="isLive" class="live-wrap" :class="{ guiding: guide }">
          <!-- El paso de la guía va AFUERA de la página: encima taparía lo que la persona tiene que tocar. -->
          <div v-if="guide" class="guide-bar" role="status" aria-live="polite">
            <span class="guide-what">👉 {{ guide.instruction }}</span>
            <template v-if="!guideStuck">
              <button type="button" class="btn btn-sm" @click="answerGuide(true)">Hecho</button>
              <button type="button" class="btn btn-ghost btn-sm" @click="guideStuck = true">No lo encuentro</button>
            </template>
            <form v-else class="guide-row" @submit.prevent="answerGuide(false)">
              <input v-model="guideNote" class="input input-sm" placeholder="Qué ves (opcional)" aria-label="Qué ves" />
              <button type="submit" class="btn btn-sm">Avisar</button>
            </form>
          </div>
          <div class="live-stage" :class="{ phone: isMobile }" :style="liveFit">
            <canvas ref="liveCanvas" class="live-canvas" tabindex="0" aria-label="La página en vivo: hacé clic y escribí como en un navegador"
              @click="onCanvasClick" @wheel.prevent="onCanvasWheel" @keydown="onCanvasKey"></canvas>
            <template v-if="showBoxes || inspect">
              <button v-for="c in page?.controls || []" :key="`live-${c.id}`" type="button" class="control-box live-box"
                :class="{ on: pickedControl === c.id, hot: hoverControl === c.id, none: c.best < 0, touch: inspect, [`k-${c.kind}`]: true }"
                :style="liveBoxStyle(c)" :tabindex="inspect ? 0 : -1"
                :title="`${c.id + 1} · ${KIND_LABEL[c.kind]} «${c.name}»\n${bestCode(c) || 'sin localizador único'}`" :aria-label="`${KIND_LABEL[c.kind]} ${c.name}`"
                @mouseenter="hoverControl = c.id" @mouseleave="hoverControl = -1" @click="pickedControl = c.id; openTab('actions')">
                <span class="control-num">{{ c.id + 1 }}</span>
              </button>
            </template>
            <template v-if="guide">
              <div v-if="guideStyle" :key="guide.id" class="guide-box" :style="guideStyle"></div>
            </template>
            <div v-if="pickedLive" class="act-pop" :style="{ left: liveBoxStyle(pickedLive).left, top: `calc(${liveBoxStyle(pickedLive).top} + ${liveBoxStyle(pickedLive).height} + 6px)` }"
              role="dialog" :aria-label="`Acciones de ${pickedLive.name}`" @click.stop>
              <div class="act-head">
                <strong>{{ pickedLive.id + 1 }} · {{ KIND_LABEL[pickedLive.kind] }} «{{ pickedLive.name }}»</strong>
                <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="pickedControl = -1"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
              </div>
              <code v-if="pickedLive.best >= 0" class="act-code">{{ pickedLive.locators[pickedLive.best].code }}</code>
              <p v-else class="bad small">Ningún localizador encuentra sólo este elemento: no se puede actuar sobre él.</p>
              <p v-if="pickedLive.disabled" class="notice-inline small">Está deshabilitado: la página exige algo antes.<template v-if="page.notices?.length"> {{ page.notices.join(' · ') }}</template></p>
              <p v-if="pickedLive.kind === 'scroll'" class="muted small">{{ pickedLive.atEnd ? 'Ya se bajó hasta el final.' : 'Todavía no se bajó hasta el final.' }}</p>
              <form v-if="pickedLive.best >= 0" class="act-row" @submit.prevent="liveAct({ field: 'fill', select: 'select', check: 'check', scroll: 'scroll' }[pickedLive.kind] || 'click')">
                <input v-if="pickedLive.kind === 'field'" v-model="actValue" class="input input-sm" placeholder="Valor a escribir" aria-label="Valor a escribir" />
                <select v-else-if="pickedLive.kind === 'select'" v-model="actValue" class="input input-sm" aria-label="Opción">
                  <option v-for="o in pickedLive.options || []" :key="o.value" :value="o.value" :disabled="o.disabled">{{ o.label }}</option>
                </select>
                <button type="submit" class="btn btn-sm" :disabled="actBusy || pickedLive.disabled">{{ { field: 'Llenar', select: 'Elegir', check: 'Marcar', button: 'Hacer clic', link: 'Hacer clic', scroll: 'Bajar hasta el final' }[pickedLive.kind] }}</button>
                <button v-if="pickedLive.kind === 'check'" type="button" class="btn btn-outline btn-sm" :disabled="actBusy" @click="liveAct('uncheck')">Desmarcar</button>
              </form>
              <p v-if="actError" class="bad small">{{ actError }}</p>
            </div>
          </div>
        </div>

        <div v-else-if="!site" class="empty">
          <div class="empty-title">Ningún sitio elegido</div>
          <div class="empty-desc">Pegá una URL en el explorador: se agrega y se explora sola. Si pide login, abrí la ventana desde el menú del sitio, entrá a mano y volvé a explorar.</div>
        </div>

        <template v-else-if="page">
          <div class="page-stats">
            <button v-for="(st, i) in pageStats" :key="i" type="button" class="stat stat-btn" :title="`Ver ${st.label} en la consola`" @click="openTab(st.id)">
              <strong :class="{ bad: st.bad && st.value }">{{ st.value }}</strong><span>{{ st.label }}</span>
            </button>
          </div>
          <div v-if="page.shot" class="shot-wrap" :class="{ fit: shotFit }">
            <div class="shot-stage">
              <img class="shot-full" :src="`/api/shot?site=${siteSlug}&id=${page.id}&t=${page.at}`" :alt="`Captura completa de ${page.title}`" @load="onShotLoad" />
              <template v-if="showBoxes">
                <button v-for="c in controls" :id="`control-box-${c.id}`" :key="c.id" type="button" class="control-box"
                  :class="{ on: pickedControl === c.id, hot: hoverControl === c.id, none: c.best < 0, [`k-${c.kind}`]: true }"
                  :style="boxStyle(c)" :title="`${c.id + 1} · ${KIND_LABEL[c.kind]} «${c.name}»\n${bestCode(c) || 'sin localizador único'}`"
                  :aria-label="`${KIND_LABEL[c.kind]} ${c.name}`"
                  @mouseenter="hoverControl = c.id" @mouseleave="hoverControl = -1" @click="pickControl(c, 'shot')">
                  <span class="control-num">{{ c.id + 1 }}</span>
                </button>
              </template>
            </div>
          </div>
          <div v-else class="empty">
            <div class="empty-title">Sin captura</div>
            <div class="empty-desc">{{ page.error || 'La página no dejó sacar la captura. Volvé a explorarla.' }}</div>
          </div>
        </template>

        <article v-else class="doc">
          <h1 class="doc-title">{{ site.name }}</h1>
          <a class="doc-url" :href="site.url" target="_blank" rel="noopener noreferrer"><code>{{ site.url }}</code></a>
          <p v-if="lastRun?.authWall" class="bad">La entrada mandó al login: abrí la ventana, logueate a mano y volvé a explorar.</p>
          <p v-else-if="lastRun && !busyHere" class="muted">
            {{ lastRun.queued ? `Quedaron ${lastRun.queued} enlaces sin visitar (llegó al tope${lastRun.stopped ? ' o se paró' : ''}).` : 'Sitio completo: no quedan enlaces nuevos desde la entrada.' }}
            Último recorrido: {{ fmtFull(lastRun.finished) }}.
          </p>
          <div class="stats">
            <div class="stat"><strong>{{ totals.visited }}</strong><span>visitadas</span></div>
            <div class="stat"><strong>{{ totals.pending }}</strong><span>sin visitar</span></div>
            <div class="stat"><strong>{{ summary.forms }}</strong><span>formularios</span></div>
            <div class="stat"><strong>{{ summary.calls }}</strong><span>llamadas</span></div>
            <div class="stat"><strong :class="{ bad: summary.errors }">{{ summary.errors }}</strong><span>errores de consola</span></div>
          </div>
          <p v-if="summary.stack.length" class="muted">Hecho con {{ summary.stack.join(' · ') }}.</p>

          <h2 class="doc-h">Explorar</h2>
          <div class="controls">
            <label class="field"><span class="label">Páginas como mucho</span>
              <input v-model="maxPages" class="input" type="number" min="1" max="2000" /></label>
            <label class="field"><span class="label">Niveles</span>
              <input v-model="maxDepth" class="input" type="number" min="1" max="50" placeholder="todos" /></label>
          </div>
          <div class="actions">
            <button v-if="!busyHere" type="button" class="btn" :disabled="state.busy" @click="run('explore')">Explorar</button>
            <button v-else type="button" class="btn btn-destructive" @click="stop">Parar</button>
            <button type="button" class="btn btn-outline" :disabled="state.busy" @click="run('browse')">Abrir la ventana</button>
          </div>
          <p class="muted small">
            Sólo sigue enlaces de {{ site.host }}, nunca envía formularios ni hace clic en botones, y salta lo que parezca
            cerrar sesión o borrar. Con login: abrí la ventana, entrá a mano, cerrala y explorá.
          </p>
        </article>
      </div>
    </main>

    <!-- SIDEBAR SECUNDARIO · la ficha de la página: lo que se sabe de ella -->
    <aside v-if="shown.aux && showAgent" class="auxiliarybar" aria-label="El agente">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span class="ellipsis">Agente</span>
        <span v-if="askState.running" class="badge badge-xs" :class="askState.waiting ? 'kw-ask' : 'kw-none'">{{ askState.waiting ? 'espera tu respuesta' : 'trabajando…' }}</span>
        <div class="region-actions">
          <button v-if="askState.running" type="button" class="region-action" title="Frenar la meta" aria-label="Frenar la meta" @click="stopAsk">
            <span class="ui-icon" data-icon="stop" aria-hidden="true"></span>
          </button>
          <button v-else type="button" class="region-action" title="Cerrar el panel del agente" aria-label="Cerrar el panel del agente" @click="askEvents = []">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body agent">
        <p class="agent-goal">{{ askState.meta }}</p>
        <template v-for="e in askTimeline" :key="e.n">
          <p v-if="e.k === 'think'" class="ev-think">{{ plainText(e.t) }}</p>
          <p v-else-if="e.k === 'act' && guideText(e.t)" class="ev-guide">👉 {{ guideText(e.t) }}</p>
          <code v-else-if="e.k === 'act'" class="ev-act">{{ e.t }}</code>
          <p v-else-if="e.k === 'look'" class="ev-note">mira la captura {{ e.t }}</p>
          <code v-else-if="e.k === 'fail' || e.k === 'err'" class="ev-fail">✗ {{ e.t }}</code>
          <div v-else-if="e.k === 'result'" class="ev-result">
            <span class="badge badge-xs kw" :class="KW_CLASS[keywordOf(e.t)] || 'kw-none'">{{ keywordOf(e.t) || '¿?' }}</span>
            <div class="ev-result-text">{{ stripKeyword(e.t) }}</div>
          </div>
          <p v-else-if="e.k === 'stats'" class="ev-note">{{ e.t }}</p>
          <p v-else-if="e.k === 'answer'" class="ev-answer">› {{ e.t }}</p>
          <p v-else class="ev-note">{{ e.t }}</p>
        </template>
        <details v-if="askOut.length" class="ev-out">
          <summary>Salida del CLI ({{ askOut.length }} líneas)</summary>
          <pre>{{ askOut.map((e) => e.t).join('\n') }}</pre>
        </details>

        <div v-if="askState.waiting" class="card ask-card">
          <div class="ask-card-head"><span class="badge badge-xs kw kw-ask">{{ askKeyword }}</span> Te pregunta:</div>
          <div class="ev-result-text">{{ askQuestion }}</div>
          <div v-if="askKeyword === 'CONFIRMAR'" class="ask-card-row">
            <button type="button" class="btn btn-sm" @click="answerAsk('sí')">Sí</button>
            <button type="button" class="btn btn-outline btn-sm" @click="answerAsk('no')">No</button>
          </div>
          <form class="ask-card-row" @submit.prevent="askReply.trim() && answerAsk(askReply)">
            <input v-model="askReply" class="input input-sm" :placeholder="askKeyword === 'CONFIRMAR' ? 'u otra respuesta…' : 'tu respuesta…'" aria-label="Tu respuesta" />
            <button type="submit" class="btn btn-outline btn-sm" :disabled="!askReply.trim()">Enviar</button>
          </form>
          <button type="button" class="btn btn-ghost btn-sm" @click="answerAsk('')">Terminar sin contestar</button>
        </div>
        <p v-if="askState.running && !askState.waiting" class="ev-note">trabajando…</p>
        <p v-if="askError" class="ask-error">{{ askError }}</p>
        <p v-if="!askState.running && askState.salida" class="ask-error">El proceso terminó: {{ askState.salida }}</p>
        <button v-if="!askState.running && askRunId" type="button" class="btn btn-outline btn-sm" @click="pickRun(askRunId)">Ver la corrida paso a paso</button>
      </div>
    </aside>

    <aside v-else-if="shown.aux && runId && runData" class="auxiliarybar" aria-label="Ficha de la corrida">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head"><span>Corrida</span></div>
      <div class="region-body">
        <div class="card">
          <dl class="facts">
            <dt>Terminó</dt><dd><span class="badge badge-xs kw" :class="KW_CLASS[runData.corrida.palabra] || 'kw-none'">{{ runData.corrida.palabra || '—' }}</span></dd>
            <dt>Sitio</dt><dd>{{ runData.corrida.sitio }}</dd>
            <dt>Desde</dt><dd class="ellipsis" :title="runData.corrida.inicio">{{ runData.corrida.inicio }}</dd>
            <dt>Origen</dt><dd>{{ runData.corrida.origen || '—' }}</dd>
            <template v-if="runData.corrida.usd"><dt>Costo</dt><dd>US$ {{ runData.corrida.usd.toFixed(4) }} · {{ runData.corrida.turnos }} turnos · {{ Math.round(runData.corrida.seg || 0) }} s</dd></template>
            <template v-if="runData.corrida.modelo"><dt>Modelo</dt><dd>{{ runData.corrida.modelo }}</dd></template>
            <template v-if="runData.corrida.tokens?.salida"><dt>Tokens</dt><dd>{{ runData.corrida.tokens.cache_leida }} de caché · {{ runData.corrida.tokens.cache_escrita }} a caché · {{ runData.corrida.tokens.salida }} de salida</dd></template>
          </dl>
        </div>
        <div class="region-head group"><span>Fuentes consultadas</span><span class="count">{{ (runData.fuentes || []).length }}</span></div>
        <p v-if="!(runData.fuentes || []).length" class="none">Ninguna.</p>
        <a v-for="(f, i) in runData.fuentes || []" :key="i" class="row stacked source-row" :href="f.url" target="_blank" rel="noopener noreferrer">
          <span>{{ f.title || f.url }}</span>
          <span class="row-desc">{{ f.url }}<template v-if="f.updated"> · {{ f.updated }}</template></span>
        </a>
      </div>
    </aside>

    <aside v-else-if="shown.aux && !runId && page" class="auxiliarybar" aria-label="Ficha de la página">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>Página</span>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="state.busy" title="Abrir esta página en la ventana" aria-label="Abrir esta página en la ventana"
            @click="run('browse', page.finalUrl || page.url)">
            <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" title="Copiar la URL" aria-label="Copiar la URL" @click="copyURL">
            <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <div class="card">
          <div class="card-title">{{ page.title || pathOf(page.url) }}</div>
          <a class="doc-url small" :href="page.finalUrl || page.url" target="_blank" rel="noopener noreferrer"><code>{{ page.finalUrl || page.url }}</code></a>
          <dl class="facts">
            <dt>Estado</dt><dd :class="statusClass(page.status)">{{ page.status || '—' }}<template v-if="page.authWall"> · mandó al login</template></dd>
            <dt>Stack</dt><dd>{{ (page.stack || []).join(' · ') || 'sin señales conocidas' }}</dd>
            <dt>Idioma</dt><dd>{{ page.lang || '—' }}</dd>
            <dt>Llegó desde</dt>
            <dd>
              <button v-if="parentPage" type="button" class="btn btn-link btn-xs link-btn" @click="pickPage(parentPage.id)">{{ pathOf(parentPage.url) }}</button>
              <template v-else>{{ page.depth === 0 ? 'es la entrada' : '—' }}</template>
            </dd>
            <dt>Visitada</dt><dd>{{ fmtFull(page.at) }} · {{ page.source === 'manual' ? 'a mano' : `nivel ${page.depth}` }}</dd>
            <dt>Estructura</dt>
            <dd>{{ Object.entries(page.landmarks || {}).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ') || '—' }}</dd>
            <dt>Contiene</dt>
            <dd>{{ (page.forms || []).length }} formularios · {{ (page.links || []).length }} enlaces · {{ (page.requests || []).length }} llamadas · {{ (page.buttons || []).length }} botones</dd>
            <template v-if="page.error"><dt>Error</dt><dd class="bad">{{ page.error }}</dd></template>
          </dl>
        </div>
        <template v-if="page.notices?.length">
          <div class="region-head group"><span>Avisos a la vista</span><span class="count">{{ page.notices.length }}</span></div>
          <p v-for="(n, i) in page.notices" :key="i" class="none notice-line">{{ n }}</p>
        </template>
      </div>
    </aside>

    <!-- PANEL · la consola con pestañas: lo que hace el navegador y lo técnico de la página elegida -->
    <section v-if="shown.panel" class="panel" aria-label="Consola">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <nav class="tabs">
        <template v-for="t in TABS" :key="t.id">
          <button v-if="t.live ? isLive : !t.page || page" type="button" class="tab" :class="{ on: panelTab === t.id }" @click="tab = t.id">
            {{ t.label }} <span v-if="t.page && t.count(page)" class="count">{{ t.count(page) }}</span><span v-if="t.live && liveState.steps?.length" class="count">{{ liveState.steps.length }}</span>
          </button>
        </template>
        <div class="region-actions">
          <span v-if="state.busy" class="muted head-note">{{ busyLabel }}</span>
          <button v-if="panelTab === 'actions' && controls.length" type="button" class="region-action"
            :title="copied === 'script' ? 'Copiado' : 'Copiar como script de Playwright'" aria-label="Copiar como script de Playwright" @click="copyText(playwrightScript, 'script')">
            <span class="ui-icon" :data-icon="copied === 'script' ? 'check' : 'code'" aria-hidden="true"></span>
          </button>
          <template v-if="panelTab === 'steps'">
            <button type="button" class="region-action" :disabled="!liveState.steps?.length" title="Ver el paso a paso, con una foto por paso" aria-label="Ver el paso a paso" @click="openReport">
              <span class="ui-icon" data-icon="image" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" :disabled="!liveState.steps?.length" :title="copied === 'live-script' ? 'Copiado' : 'Copiar los pasos como script de Playwright'" aria-label="Copiar los pasos como script de Playwright" @click="copyLiveScript">
              <span class="ui-icon" :data-icon="copied === 'live-script' ? 'check' : 'code'" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" :disabled="!liveState.steps?.length" title="Empezar los pasos de cero" aria-label="Empezar los pasos de cero" @click="clearSteps">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </template>
          <button v-if="panelTab === 'log'" type="button" class="region-action" title="Limpiar la consola" aria-label="Limpiar la consola" @click="log = []">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
        </div>
      </nav>
      <div class="region-body">
        <template v-if="panelTab === 'log'">
          <p v-if="!log.length" class="none">Acá sale lo que hace el navegador: cada página que analiza y lo que falla.</p>
          <div v-for="l in log" :key="l.seq" class="log-line" :data-kind="l.kind">
            <span class="log-time">{{ fmtTime(l.at) }}</span><span class="what wrap">{{ l.text }}</span>
          </div>
        </template>

        <template v-else-if="panelTab === 'steps'">
          <p v-if="!liveState.steps?.length" class="none">Todavía no hay pasos. Cada acción sobre un elemento (desde el menú del elemento o con bin/navegador) queda acá con su línea de Playwright.</p>
          <div v-for="(st, i) in liveState.steps || []" :key="i" class="log-line" :data-kind="st.ok ? 'ok' : 'error'">
            <span class="log-time">{{ fmtTime(st.at) }}</span><span class="what wrap">{{ st.ok ? '' : '✗ ' }}{{ st.code }}<template v-if="st.error"> · {{ st.error }}</template></span>
          </div>
        </template>

        <template v-else-if="panelTab === 'actions'">
          <p v-if="!controls.length" class="none">{{ page.controls ? 'La página no tiene elementos interactivos visibles.' : 'Esta página se analizó antes de que existieran los localizadores: volvé a explorarla.' }}</p>
          <table v-else class="table controls">
            <thead><tr><th class="num">#</th><th>Elemento</th><th>Localizador recomendado</th><th>Alternativas</th></tr></thead>
            <tbody>
              <tr v-for="c in controls" :id="`control-row-${c.id}`" :key="c.id" :class="{ on: pickedControl === c.id, hot: hoverControl === c.id }"
                @mouseenter="hoverControl = c.id" @mouseleave="hoverControl = -1" @click="pickControl(c, 'row')">
                <td class="num muted">{{ c.id + 1 }}</td>
                <td class="el"><span>{{ c.name }}</span> <small class="muted">{{ KIND_LABEL[c.kind] }}<template v-if="c.disabled"> · deshabilitado</template><template v-if="c.blocked"> · detrás del modal</template><template v-if="c.frame"> · en iframe</template><template v-if="c.kind === 'scroll'"> · {{ c.atEnd ? 'leída' : 'falta bajar' }}</template></small></td>
                <td class="best">
                  <template v-if="c.best >= 0">
                    <code :class="{ warn: fragile(c.locators[c.best]) }" :title="fragile(c.locators[c.best]) ? 'Funciona hoy, pero depende de la posición en el HTML: frágil' : ''">{{ bestCode(c) }}</code>
                    <button type="button" class="region-action copy" :title="copied === `c${c.id}` ? 'Copiado' : 'Copiar'" aria-label="Copiar el localizador" @click.stop="copyText(bestCode(c), `c${c.id}`)">
                      <span class="ui-icon" :data-icon="copied === `c${c.id}` ? 'check' : 'copy'" aria-hidden="true"></span>
                    </button>
                  </template>
                  <span v-else class="bad">ningún candidato encuentra sólo este elemento</span>
                </td>
                <td class="alts">
                  <button v-for="(l, j) in c.locators" :key="j" type="button" class="alt" :class="{ ok: l.works, off: !l.works, best: j === c.best }"
                    :title="`${l.code}${l.action || ''}\n${l.works ? 'encuentra sólo este elemento' : l.count === 0 ? 'no encuentra nada' : l.count === 1 ? 'encuentra otro elemento' : `encuentra ${l.count} elementos`}\nclic: copiar`"
                    @click.stop="copyText(l.code + c.action, `a${c.id}-${j}`)">
                    {{ copied === `a${c.id}-${j}` ? 'copiado' : LOC_LABEL[l.kind] }}<template v-if="!l.works"> · {{ l.count }}</template>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-else-if="panelTab === 'forms'">
          <p v-if="!(page.forms || []).length" class="none">Sin formularios ni campos.</p>
          <section v-for="(f, i) in page.forms || []" :key="i">
            <div class="region-head group">
              <span>{{ f.loose ? 'Campos sueltos (sin form)' : `${(f.method || 'get').toUpperCase()} ${f.action ? pathOf(f.action) : '(misma página)'}` }}</span>
              <span class="count">{{ (f.fields || []).length }}</span>
              <span v-if="(f.submits || []).length" class="muted head-note">envía con {{ f.submits.join(' · ') }}</span>
            </div>
            <table class="table">
              <thead><tr><th>Campo</th><th>Tipo</th><th>name</th><th>Opciones</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(x, j) in f.fields || []" :key="j">
                  <td>{{ x.label || x.placeholder || x.id || '—' }}</td>
                  <td class="muted">{{ x.tag === 'input' ? x.type || 'text' : x.tag }}</td>
                  <td><code>{{ x.name }}</code></td>
                  <td class="muted">{{ (x.options || []).join(' · ') }}</td>
                  <td class="muted">{{ x.required ? 'requerido' : '' }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>

        <template v-else-if="panelTab === 'links'">
          <p v-if="!internalLinks.length" class="none">Sin enlaces.</p>
          <table v-else class="table">
            <thead><tr><th>Texto</th><th>Destino</th><th></th></tr></thead>
            <tbody>
              <tr v-for="l in internalLinks" :key="l.href" :class="{ clickable: pageByURL(l.href) }" @click="pageByURL(l.href) && pickPage(pageByURL(l.href).id)">
                <td>{{ l.text || '(sin texto)' }}</td>
                <td><code>{{ l.internal ? pathOf(l.href) : l.href }}</code></td>
                <td class="muted nowrap">{{ !l.internal ? 'afuera' : pageByURL(l.href) ? 'en el mapa' : '' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-else-if="panelTab === 'calls'">
          <p v-if="!(page.requests || []).length" class="none">Sin llamadas registradas.</p>
          <div v-for="(r, i) in page.requests || []" :key="i" class="log-line call" :title="r.url">
            <span class="method">{{ r.method }}</span>
            <span class="code" :class="statusClass(r.status)">{{ r.status }}</span>
            <span class="kind">{{ r.type }}</span>
            <span class="what">{{ r.url }}</span>
          </div>
        </template>

        <template v-else-if="panelTab === 'errors'">
          <p v-if="!(page.console || []).length" class="none">La consola de la página no dijo nada.</p>
          <div v-for="(c, i) in page.console || []" :key="i" class="log-line" :data-kind="c.startsWith('warning') ? 'warn' : 'error'">
            <span class="what wrap">{{ c }}</span>
          </div>
        </template>
      </div>
    </section>

    <footer class="statusbar">
      <span>{{ busyLabel || 'Quieto' }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar el explorador" aria-label="Mostrar u ocultar el explorador" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Mostrar u ocultar la consola" aria-label="Mostrar u ocultar la consola" @click="togglePanel">
          <span class="ui-icon" data-icon="bottom" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" :disabled="!page" title="Mostrar u ocultar el detalle" aria-label="Mostrar u ocultar el detalle" @click="toggleAux">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Regiones, vistas, filas, pestañas, grupos, avisos, líneas y pie son de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.add { display: flex; gap: var(--space-1); align-items: center; padding: var(--space-2) var(--gutter) }
.add .input { flex: 1; min-width: 0 }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.muted { color: var(--fg-3) }
.small { font-size: var(--text-xs) }
.bad { color: var(--status-bad) }
.warn { color: var(--status-warn) }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0 }
.head-note { font-size: var(--text-sm); margin-left: var(--space-2) }
.clickable { cursor: pointer }
.alert { margin: var(--space-2) var(--gutter) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }

/* el árbol: filas de 28 como el Explorer, el chevron en su lugar aunque la fila no tenga hijos */
.tree-top { position: sticky; top: 0; z-index: 1; display: flex; flex-direction: column; gap: var(--space-1);
  padding: var(--space-2) var(--gutter); background: var(--region-bg, var(--sidebar)) }
.tree-top .add { padding: 0 }
.tree-row.site > .node-name { font-weight: 600 }
/* las acciones del sitio aparecen en el lugar del conteo: no se pisan */
.tree-row.site:hover > .node-flag, .tree-row.site.on > .node-flag { visibility: hidden }
.tree { padding-bottom: var(--space-2) }
.tree-row { display: flex; justify-content: flex-start; align-items: center; gap: var(--space-1); cursor: pointer; min-width: 0 }
.tree-row.pending { color: var(--fg-3) }
.tree-row > .twisty { flex: none; width: var(--icon-size); height: var(--icon-size); display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: none; color: var(--fg-2); cursor: pointer }
.tree-row > .node-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.tree-row.folder > .node-name { color: var(--fg-2) }
.node-flag { flex: none; font-size: var(--text-xs); color: var(--fg-3) }

/* el editor como documento */
.doc { padding: var(--space-6); max-width: 960px; display: flex; flex-direction: column; gap: var(--space-3) }
.doc-title { margin: 0; font-size: var(--text-title); font-weight: 600 }
.doc-url { color: var(--primary-ink); text-decoration: none; overflow-wrap: anywhere }
.doc-url:hover { text-decoration: underline }
.doc-h { margin: var(--space-3) 0 0; font-size: var(--text-base); font-weight: 600 }
.doc p { margin: 0 }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-4); margin: 0; font-size: var(--text-sm) }
.facts dt { color: var(--fg-3) }
.facts dd { margin: 0; overflow-wrap: anywhere }
.heading { font-size: var(--text-sm) }
.stats { display: flex; flex-wrap: wrap; gap: var(--space-6) }
.stat { display: flex; flex-direction: column }
.stat strong { font-size: var(--text-title); font-variant-numeric: tabular-nums }
.stat span { font-size: var(--text-xs); color: var(--fg-3) }
.controls { display: flex; gap: var(--space-3) }
.controls .field { width: 160px }
.actions { display: flex; gap: var(--space-2) }

/* la ficha del sidebar secundario */
.card { padding: var(--space-3) var(--gutter); display: flex; flex-direction: column; gap: var(--space-2) }
.card-title { font-weight: 600; font-size: var(--text-base) }
.card .facts { margin-top: var(--space-2); gap: var(--space-1) var(--space-3) }
.link-btn { padding: 0; height: auto; min-width: 0 }
.nowrap { white-space: nowrap }

/* la página en el editor: el resumen fijo arriba y la captura entera debajo */
.page-stats { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: var(--space-6);
  padding: var(--space-3) var(--space-6); background: var(--region-bg, var(--background)); border-bottom: 1px solid var(--border) }
.stat-btn { border: 0; background: none; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer }
.stat-btn:hover span { color: var(--foreground) }
.shot-wrap { padding: var(--space-6) }
.shot-stage { position: relative; display: inline-block; vertical-align: top }
.shot-wrap.fit .shot-stage { display: block }
/* los elementos interactivos sobre la captura: un marco por elemento, con su número */
.control-box { position: absolute; padding: 0; border: 1px solid var(--control-box); background: transparent; border-radius: 2px; cursor: pointer }
.control-box.k-link { border-style: dashed; opacity: .7 }
.control-box.none { border-color: var(--status-bad) }
.control-box:hover, .control-box.hot { background: var(--control-box-fill); opacity: 1 }
.control-box.on { border-width: 2px; background: var(--control-box-fill); opacity: 1 }
.control-num { position: absolute; top: -9px; left: -9px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 8px;
  background: var(--control-box); color: var(--control-box-ink); font-size: 10px; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums }
.control-box.none .control-num { background: var(--status-bad) }
/* la sesión en vivo: el canvas a lo ancho del editor, los marcos encima y el menú del elemento */
.live-head { gap: var(--space-1) }
.live-url { flex: 1; min-width: 0; display: flex }
.live-url .input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--text-sm) }
/* el navegador, escalado para entrar entero en el editor (su tamaño real es el del dispositivo) */
.live-body { overflow: hidden }
.live-wrap { height: 100%; display: grid; place-items: center }
.live-stage { position: relative; box-shadow: 0 0 0 1px var(--border) }
.live-stage.phone { border-radius: 18px; box-shadow: 0 0 0 8px var(--stage-bg), 0 0 0 9px var(--border) }
.live-stage.phone .live-canvas { border-radius: 18px }
.live-canvas { display: block; width: 100%; height: 100%; background: var(--card); outline: none }
.seg-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-control); overflow: hidden; flex: none }
.seg-toggle button { border: 0; background: transparent; color: var(--fg-2); font: inherit; font-size: var(--text-sm); padding: 2px var(--space-2); cursor: pointer }
.seg-toggle button + button { border-left: 1px solid var(--border) }
.seg-toggle button[aria-pressed="true"] { background: var(--hover); color: var(--foreground) }
.seg-toggle button:disabled { opacity: .5; cursor: progress }
.ask-device { flex: none !important; width: auto }
.ask-mode { align-self: flex-start }
.ev-guide { font-weight: 600; line-height: 1.45 }
/* el paso de la guía sobre la página en vivo */
.guide-box { position: absolute; z-index: 2; pointer-events: none; border: 3px solid var(--primary); border-radius: 6px; animation: guide-pulse 1.4s ease-in-out infinite }
@keyframes guide-pulse { 50% { outline: 6px solid color-mix(in srgb, var(--primary) 35%, transparent); outline-offset: 2px } }
.live-wrap.guiding { grid-template-rows: auto 1fr; align-content: start; gap: var(--space-2); padding-top: var(--space-2) }
.guide-bar { justify-self: stretch; margin: 0 var(--space-3); display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 2px solid var(--primary); border-radius: var(--radius-control); background: var(--card) }
.guide-what { flex: 1; min-width: 0; font-weight: 600; line-height: 1.4 }
.guide-row { display: flex; gap: var(--space-2); align-items: center }
.guide-row .input { flex: 1; min-width: 0 }
.live-box { pointer-events: none }
.live-box.touch { pointer-events: auto }
.act-pop { position: absolute; z-index: 2; width: 360px; max-width: calc(100% - 16px); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2);
  background: var(--popover); color: var(--popover-foreground); border: 1px solid var(--border); border-radius: var(--radius-float); box-shadow: 0 8px 24px rgb(0 0 0 / .25) }
.act-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--text-sm) }
.act-code { font-family: var(--font-mono); font-size: var(--text-xs); overflow-wrap: anywhere; color: var(--fg-2) }
.act-row { display: flex; gap: var(--space-2) }
.act-row .input { flex: 1; min-width: 0 }
.log-line[data-kind="ok"] .what { color: var(--foreground) }
/* las corridas */
.run-body { container-type: inline-size }
.run-row-top { display: flex; align-items: center; gap: var(--space-2); min-width: 0 }
.run-row-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.kw { flex: none }
.kw-ok { background: var(--kw-ok); color: var(--kw-ink) }
.kw-bad { background: var(--kw-bad); color: var(--kw-ink) }
.kw-ask { background: var(--kw-ask); color: var(--kw-ink) }
.kw-none { background: var(--hover); color: var(--fg-2) }
.source-row { text-decoration: none; color: inherit }
.eval-dots { display: inline-flex; gap: 2px; margin-right: var(--space-1); vertical-align: middle }
.eval-dot { width: 7px; height: 7px; border-radius: 50% }
.eval-dot.ok { background: var(--kw-ok) }
.eval-dot.bad { background: var(--kw-bad) }
.eval-why { color: var(--status-bad); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
/* la meta y el agente */
.ask-form { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) var(--space-3) var(--space-3); border-bottom: 1px solid var(--border) }
.ask-goal { resize: vertical; min-height: 64px; font: inherit }
.ask-form-row, .ask-card-row { display: flex; gap: var(--space-2); align-items: center }
.ask-form-row .input, .ask-card-row .input { flex: 1; min-width: 0 }
.ask-error { color: var(--status-bad); font-size: var(--text-sm); margin: 0 }
.agent { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) }
.agent p { margin: 0 }
.agent-goal { font-weight: 600 }
.ev-think { line-height: 1.5; white-space: pre-wrap }
.ev-act, .ev-fail { font-family: var(--font-mono); font-size: var(--text-sm); overflow-wrap: anywhere; color: var(--fg-2) }
.ev-act::before { content: '→ '; color: var(--fg-3) }
.ev-fail { color: var(--status-bad) }
.ev-note { color: var(--fg-3); font-size: var(--text-sm) }
.ev-answer { color: var(--fg-2) }
.ev-result { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-left: 2px solid var(--border); background: var(--hover) }
.ev-result .kw { align-self: flex-start }
.ev-result-text { white-space: pre-wrap; line-height: 1.5 }
.ev-out pre { font-size: var(--text-sm); white-space: pre-wrap; max-height: 240px; overflow: auto; margin: var(--space-1) 0 0 }
.ev-out summary { color: var(--fg-3); font-size: var(--text-sm); cursor: pointer }
.ask-card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--kw-ask); border-radius: var(--radius-control) }
.ask-card-head { display: flex; align-items: center; gap: var(--space-2); font-weight: 600 }
.notice-inline { color: var(--status-warn) }
.notice-line { color: var(--status-warn) }
.control-box.k-scroll { border-style: dotted }
/* la tabla de acciones */
.controls .el { max-width: 220px }
.controls .best { white-space: nowrap }
.controls .best code { white-space: normal; overflow-wrap: anywhere }
.controls .best .copy { vertical-align: middle; margin-left: var(--space-1) }
.controls tr.hot td { background: var(--hover) }
.controls tr { cursor: pointer }
.alts { white-space: normal }
.alt { margin: 1px 2px 1px 0; padding: 0 6px; height: 20px; border-radius: 10px; font: inherit; font-size: var(--text-xs); cursor: pointer;
  background: none; border: 1px solid var(--border); color: var(--fg-3) }
.alt.ok { color: var(--foreground) }
.alt.best { background: var(--accent); color: var(--accent-foreground); border-color: transparent }
.alt.off { text-decoration: line-through }
.shot-full { display: block; border: 1px solid var(--border); border-radius: var(--radius-control) }
.shot-wrap.fit .shot-full { width: 100%; height: auto }
.shot-wrap:not(.fit) { overflow-x: auto }

.call .method { min-width: 48px; font-family: var(--font-mono); font-size: var(--text-sm) }
.call .code { min-width: 32px; font-variant-numeric: tabular-nums; font-size: var(--text-sm) }
.call .kind { min-width: 64px; color: var(--fg-3); font-size: var(--text-sm) }
.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-sm) }
.log-line .what.wrap { white-space: pre-wrap; overflow-wrap: anywhere }
.log-line[data-kind="error"] .what { color: var(--status-bad) }
.log-line[data-kind="warn"] .what { color: var(--status-warn) }
</style>
