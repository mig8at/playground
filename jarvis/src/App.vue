<script setup>
/* Jarvis · la interfaz. Flujos para usar herramientas complejas: le decís a Claude qué querés hacer en una app,
 * lo ves trabajar en vivo (el navegador real en el editor y lo que piensa a la derecha) y lo que aprende queda como
 * FLUJO (jarvis/flows, JSON en git): se reproduce navegando de nuevo, con sus datos precargados o abiertos, y
 * para donde tiene que actuar la persona (o en lo irreversible).
 *
 * Todo llega por UN stream en tiempo real (/api/events, server/events.go); los cuadros del navegador, por el suyo
 * (/api/live/frames). La ruta: #/ (en vivo), #/project/<app> (su portada), #/flow/<app>/<id>. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle, readHashRoute, hashRoute, setRoute } from './workbench.js'
import RunViewer from './RunViewer.vue'

// Cada pedido va a la pestaña que se está mirando (server/tabs.go): sin el encabezado, el servidor usaría la última
// que se abrió, que puede ser la de Claude.
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (viewTab.value) headers['X-Jarvis-Tab'] = viewTab.value
  const res = await fetch(path, { ...opts, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── la ruta ──
const view = ref({ kind: 'live' }) // live · run {id} · flow {app, id}
function parseRoute() {
  const p = readHashRoute().parts
  if (p[0] === 'flow' && p[1] && p[2]) return { kind: 'flow', app: p[1], id: p[2] }
  if (p[0] === 'project' && p[1]) return { kind: 'project', app: p[1] }
  return { kind: 'live' }
}
view.value = parseRoute()
function go(v) {
  view.value = v
  const parts = v.kind === 'flow' ? ['flow', v.app, v.id] : v.kind === 'project' ? ['project', v.app] : []
  setRoute(hashRoute(parts), { push: true })
}
const onHashChange = () => { view.value = parseRoute() }

// ── las pestañas: varias sesiones a la vez, cada una con su página, su Claude y sus pasos ──
const tabs = ref([])
const viewTab = ref('') // la que se está mirando; elegirla no cambia a qué pestaña le hablan los comandos de Claude
const liveStates = ref({})
const askStates = ref({})
const askEventsBy = ref({})
const tabLabel = (t) => (t.active ? t.title || t.site || t.url : 'Vacía')
let tabsSeen = null
function onTabs(list) {
  const ids = list.map((t) => t.id)
  // Una pestaña que aparece después de cargar (la abrió Claude o «+») se sigue: es lo que hay que mirar.
  const fresh = tabsSeen ? ids.filter((id) => !tabsSeen.has(id)) : []
  tabsSeen = new Set(ids)
  tabs.value = list
  if (fresh.length) viewTab.value = fresh[fresh.length - 1]
  else if (!ids.includes(viewTab.value)) viewTab.value = (list.find((t) => t.last) || list[list.length - 1])?.id || ''
}
// ── seguir a Claude: la vista salta a la pestaña donde está actuando ──
// Con varias pestañas, Claude trabaja en una mientras se mira otra. Cada señal de trabajo en una pestaña (un comando o
// un pensamiento suyo, un paso nuevo, otra página) la trae al frente, para ver cómo trabaja sin buscarla. Si la persona
// eligió una pestaña a mano, se respeta un rato (FOLLOW_PAUSE_MS): seguir no puede pelearle la pantalla.
const FOLLOW_PAUSE_MS = 20_000
const followClaude = ref(readPref('jarvis.follow', '1') === '1')
watch(followClaude, (on) => savePref('jarvis.follow', on ? '1' : '0'))
let manualUntil = 0
function pickTab(id) {
  viewTab.value = id
  manualUntil = Date.now() + FOLLOW_PAUSE_MS
}
function followTo(id) {
  if (!followClaude.value || !id || id === viewTab.value || Date.now() < manualUntil) return
  if (!tabs.value.some((t) => t.id === id)) return
  viewTab.value = id
  go({ kind: 'live' })
}
/** Lo que cuenta como «Claude trabajó acá»: un paso más o una página distinta (no el análisis de fondo, que sube solo). */
function liveMoved(prev, st) {
  if (!prev) return false
  return (st.steps?.length ?? 0) > (prev.steps?.length ?? 0) || (!!st.url && st.url !== prev.url)
}

async function newTab() {
  try { const t = await api('/api/tabs', { method: 'POST' }); viewTab.value = t.id; go({ kind: 'live' }) } catch (e) { liveError.value = e.message }
}
async function closeTab(id) {
  const t = tabs.value.find((x) => x.id === id)
  if (t?.busy && !confirm(`En esta pestaña está trabajando Claude («${t.meta}»). ¿Cerrarla igual? Se frena.`)) return
  try { await api(`/api/tabs/${id}`, { method: 'DELETE' }) } catch (e) { liveError.value = e.message }
}

// ── el estado, en tiempo real (el de la pestaña que se mira) ──
const liveState = computed(() => liveStates.value[viewTab.value] || { active: false, steps: [] })
const askState = computed(() => askStates.value[viewTab.value] || { running: false, waiting: false, meta: '', total: 0 })
const askEvents = computed(() => askEventsBy.value[viewTab.value] || [])
const flows = ref([])
const apps = ref([])
const connected = ref(false)
let events = null
function connect() {
  events = new EventSource('/api/events')
  events.onopen = () => { connected.value = true }
  events.onerror = () => { connected.value = false } // EventSource se reconecta solo
  const on = (kind, fn) => events.addEventListener(kind, (e) => { try { fn(JSON.parse(e.data)) } catch { /* evento roto */ } })
  on('tabs', onTabs)
  on('live', (st) => {
    const prev = liveStates.value[st.tab]
    liveStates.value = { ...liveStates.value, [st.tab]: st }
    if (liveMoved(prev, st)) followTo(st.tab)
  })
  on('askstate', (st) => {
    const evs = askEventsBy.value
    if (st.total === 0) askEventsBy.value = { ...evs, [st.tab]: [] } // una meta nueva
    if (st.events?.length && st.events.length === st.total) askEventsBy.value = { ...askEventsBy.value, [st.tab]: st.events } // al conectarse: todo
    askStates.value = { ...askStates.value, [st.tab]: st }
  })
  on('ask', (ev) => {
    const list = askEventsBy.value[ev.tab] || []
    if (ev.n === list.length) askEventsBy.value = { ...askEventsBy.value, [ev.tab]: [...list, ev] }
    if (ev.k === 'act' || ev.k === 'think') followTo(ev.tab)
  })
  on('flows', (v) => { flows.value = v; if (view.value.kind === 'flow') loadView(view.value) })
  on('apps', (v) => { apps.value = v })
}


// ── Claude trabajando ──
const askReply = ref('')
const askError = ref('')
async function answerAsk(text) {
  askError.value = ''
  try { await api('/api/ask/answer', { method: 'POST', body: JSON.stringify({ text }) }); askReply.value = '' } catch (e) { askError.value = e.message }
}
async function stopAsk() { try { await api('/api/ask/stop', { method: 'POST' }) } catch (e) { askError.value = e.message } }
const KW_CLASS = { LISTO: 'kw-ok', 'NO PUDE': 'kw-bad', NECESITO: 'kw-ask', CONFIRMAR: 'kw-ask' }
const plainText = (t) => (t || '').replace(/(\*\*|__)(.+?)\1/g, '$2')
const keywordOf = (t) => ['LISTO', 'NO PUDE', 'NECESITO', 'CONFIRMAR'].find((k) => (t || '').replace(/^[\s*_#>`]+/, '').toUpperCase().startsWith(k)) || ''
const stripKeyword = (t) => plainText(t).replace(/^\s*[*_#>`]*\s*(LISTO|NO PUDE|NECESITO|CONFIRMAR)\s*:?[*_]*\s*/i, '')
const askKeyword = computed(() => [...askEvents.value].reverse().find((e) => e.k === 'ask')?.t || '')
const askQuestion = computed(() => (askState.value.waiting ? stripKeyword([...askEvents.value].reverse().find((e) => e.k === 'result')?.t) : ''))
const askFlow = computed(() => askEvents.value.find((e) => e.k === 'flow')?.t || '')
const timeline = computed(() => askEvents.value.filter((e) => !['out', 'ask', 'report', 'flow', 'site'].includes(e.k)))
function guideText(cmd) { return cmd.match(/^jarvis point\s+(?:\S+|'[^']*')\s+'(.*)'\s*$/)?.[1] || '' }
const agentShown = computed(() => askState.value.running || askEvents.value.length > 0)
// El sidebar derecho: la información del flujo abierto, o Claude trabajando (con pestañas si hay las dos).
const flowOpen = computed(() => view.value.kind === 'flow' && !!flowData.value)
const auxTab = ref('flow')
const auxShows = computed(() => (flowOpen.value && (auxTab.value === 'flow' || !agentShown.value) ? 'flow' : 'agent'))
// Cuando Claude arranca (por ask o desde la conversación), su panel se abre aunque se haya cerrado antes.
watch(() => askState.value.running, (on) => { if (on) { auxOpen.value = true; auxTab.value = 'agent'; saveSize('jarvis.aux-open', 1) } })

// ── la sesión en vivo: el navegador real en el editor ──
const isLive = computed(() => !!liveState.value.active)
const liveError = ref('')
const liveURL = ref('')
watch(() => liveState.value.url, (u) => { if (u && document.activeElement?.id !== 'live-url') liveURL.value = u })
const liveCanvas = ref(null)
const frameMeta = ref(null)
const editorBody = ref(null)
const editorBox = ref({ w: 0, h: 0 })
let resizeObs = null
let frames = null
function openFrames() {
  frames?.close()
  frames = new EventSource(`/api/live/frames?tab=${encodeURIComponent(viewTab.value)}`)
  frames.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      const canvas = liveCanvas.value
      if (!canvas) return
      const img = new Image()
      img.onload = () => {
        if (canvas.width !== img.width || canvas.height !== img.height) { canvas.width = img.width; canvas.height = img.height }
        canvas.getContext('2d').drawImage(img, 0, 0)
      }
      img.src = 'data:image/jpeg;base64,' + msg.data
      frameMeta.value = msg.meta
    } catch { /* cuadro roto */ }
  }
  frames.addEventListener('end', () => { frames?.close(); frames = null })
}
const showLive = computed(() => isLive.value && view.value.kind === 'live')
watch(showLive, (on) => {
  if (on) requestAnimationFrame(() => { openFrames(); watchEditor() })
  else { frames?.close(); frames = null }
}, { immediate: true })
watch(() => liveState.value.device, () => { if (showLive.value) openFrames() }) // cambiar de dispositivo reabre el navegador
watch(viewTab, () => { if (showLive.value) requestAnimationFrame(openFrames) }) // otra pestaña: sus cuadros
function watchEditor() {
  resizeObs?.disconnect()
  if (!editorBody.value) return
  const measure = () => { editorBox.value = { w: editorBody.value.clientWidth, h: editorBody.value.clientHeight } }
  measure()
  resizeObs = new ResizeObserver(measure)
  resizeObs.observe(editorBody.value)
}
const isMobile = computed(() => liveState.value.device === 'mobile')
const guide = computed(() => (isLive.value ? liveState.value.guide : null))
const replay = computed(() => (isLive.value ? liveState.value.replay : null))
const replayHidden = ref('')
const replayShown = computed(() => replay.value && replay.value.report !== replayHidden.value)
const replayActive = computed(() => replay.value && !['done', 'stopped'].includes(replay.value.status))
// El navegador tiene el tamaño FIJO de su dispositivo: acá se escala para entrar entero (sin agrandarse).
const liveFit = computed(() => {
  // El tamaño de lo que se está transmitiendo: la página, o una ventana emergente (más chica) mientras está abierta.
  const w = (liveState.value.popup && frameMeta.value?.deviceWidth) || liveState.value.width || 1280
  const h = (liveState.value.popup && frameMeta.value?.deviceHeight) || liveState.value.height || 800
  const pad = (isMobile.value ? 48 : 16) + (guide.value || replayShown.value || liveState.value.popup ? 76 : 0)
  const sc = Math.min((editorBox.value.w - pad) / w, (editorBox.value.h - pad) / h, 1)
  return sc > 0 ? { width: `${Math.floor(w * sc)}px`, height: `${Math.floor(h * sc)}px` } : {}
})
const guideStyle = computed(() => {
  const g = guide.value
  if (!g?.box || !g.view?.w) return null
  const pct = (n, d) => `${(n / d) * 100}%`
  return { left: pct(g.box.x, g.view.w), top: pct(g.box.y, g.view.h), width: pct(g.box.w, g.view.w), height: pct(g.box.h, g.view.h) }
})
function toPage(e) {
  const r = liveCanvas.value.getBoundingClientRect()
  const w = frameMeta.value?.deviceWidth || liveState.value.width || 1280
  const h = frameMeta.value?.deviceHeight || liveState.value.height || 800
  return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h }
}
function sendInput(ev) { api('/api/live/input', { method: 'POST', body: JSON.stringify(ev) }).catch((e) => { liveError.value = e.message }) }
// Pegar en el campo con el foco: el texto copiado se escribe tal cual (una contraseña larga, un código). No queda
// en ningún paso ni registro: sólo viaja a la API local y se teclea en la página.
function onCanvasPaste(e) {
  const text = e.clipboardData?.getData('text/plain') || ''
  if (!text) return
  e.preventDefault()
  sendInput({ type: 'text', text })
}
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
  // Ctrl+V / Cmd+V: no se manda el atajo (el Chromium del navegador tiene su propio portapapeles, vacío); el
  // navegador de la interfaz dispara «paste» con lo que la persona copió, y onCanvasPaste lo escribe.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'v') return
  if (e.key.length === 1 && !mod) { e.preventDefault(); sendInput({ type: 'text', text: e.key }); return }
  if (KEYS.has(e.key) || (mod && e.key.length === 1)) {
    e.preventDefault()
    const prefix = (e.ctrlKey ? 'Control+' : '') + (e.metaKey ? 'Meta+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && e.key.length > 1 ? 'Shift+' : '')
    sendInput({ type: 'key', key: prefix + e.key })
  }
}
async function liveNav(action, url = '') { liveError.value = ''; try { await api('/api/live/nav', { method: 'POST', body: JSON.stringify({ action, url }) }) } catch (e) { liveError.value = e.message } }
async function liveStop() { try { await api('/api/live/stop', { method: 'POST' }) } catch (e) { liveError.value = e.message } }
// Abrir cualquier página en vivo: en una pestaña de tu Chrome (la extensión Jarvis), con tu sesión.
const urlInput = ref('')
const opening = ref(false)
async function openURL(raw) {
  let u = raw.trim()
  if (!u) return
  if (!/^https?:\/\//i.test(u)) u = (/^(localhost|127\.|\[::1\])/.test(u) ? 'http://' : 'https://') + u
  opening.value = true
  liveError.value = ''
  try { await api(`/api/live/start?url=${encodeURIComponent(u)}`, { method: 'POST' }); urlInput.value = ''; go({ kind: 'live' }) } catch (e) { liveError.value = e.message } finally { opening.value = false }
}
async function openApp(a) {
  liveError.value = ''
  try { await api(`/api/live/start?url=${encodeURIComponent(a.url)}`, { method: 'POST' }); go({ kind: 'live' }) } catch (e) { liveError.value = e.message }
}
// La guía de Claude (modo enseñame): «Hecho» / «No lo encuentro».
const guideNote = ref('')
const guideStuck = ref(false)
async function answerGuide(done) {
  try { await api('/api/live/guide/answer', { method: 'POST', body: JSON.stringify({ done, note: done ? '' : guideNote.value }) }); guideNote.value = ''; guideStuck.value = false } catch (e) { liveError.value = e.message }
}
// La reproducción de un flujo.
async function replayAnswer(choice) { try { await api('/api/live/replay/answer', { method: 'POST', body: JSON.stringify({ choice }) }) } catch (e) { liveError.value = e.message } }
const viewError = ref('')

// ── un flujo abierto (su video es el de su última corrida, que vive en .data) ──
const flowData = ref(null)
const flowVideo = ref(null)
async function loadView(v) {
  viewError.value = ''
  try {
    if (v.kind === 'flow') {
      flowData.value = await api(`/api/flows/${v.app}/${v.id}`)
      const src = flowData.value.flow.lastRun || flowData.value.flow.run
      flowVideo.value = src ? await api(`/api/runs/${encodeURIComponent(src)}`).catch(() => null) : null
    }
  } catch (e) { viewError.value = e.message }
}
watch(view, (v) => { flowData.value = flowVideo.value = null; if (v.kind === 'flow') auxTab.value = 'flow'; loadView(v) }, { immediate: true })
// Lo que se edita de un flujo: el valor de cada dato y si el paso para para que lo haga la persona.
const flowSteps = computed(() => flowData.value?.flow.steps || [])
const flowParams = computed(() => flowSteps.value.map((s, i) => ({ ...s, i })).filter((s) => s.param))
async function saveFlowStep(i, patch) {
  const steps = flowSteps.value.map((_, j) => (j === i ? patch : {}))
  try { await api(`/api/flows/${view.value.app}/${view.value.id}`, { method: 'PUT', body: JSON.stringify({ steps }) }) } catch (e) { viewError.value = e.message }
}
async function renameFlow(name) {
  name = name.trim()
  if (!name || name === flowData.value.flow.name) return
  try { await api(`/api/flows/${view.value.app}/${view.value.id}`, { method: 'PUT', body: JSON.stringify({ name }) }) } catch (e) { viewError.value = e.message }
}
function editStepText(i, el) {
  const t = el.innerText.trim()
  if (t && t !== flowSteps.value[i].instruction) saveFlowStep(i, { instruction: t })
  else el.innerText = flowSteps.value[i].instruction || flowSteps.value[i].action
}
function removeStep(i) {
  if (confirm(`¿Sacar el paso ${i + 1} del flujo? «${flowSteps.value[i].instruction || flowSteps.value[i].action}»`)) saveFlowStep(i, { delete: true })
}
async function playFlow(m) {
  viewError.value = ''
  try { await api(`/api/flows/${view.value.app}/${view.value.id}/replay`, { method: 'POST', body: JSON.stringify({ mode: m }) }); go({ kind: 'live' }) } catch (e) { viewError.value = e.message }
}
// Borrar lo que ya no hace falta (algo que sólo se quería entender): un flujo, o un proyecto entero.
async function deleteFlowOf(f) {
  if (!confirm(`¿Borrar el flujo «${f.name}»? Se borra su archivo de jarvis/flows.`)) return
  try {
    await api(`/api/flows/${f.app}/${f.id}`, { method: 'DELETE' })
    if (view.value.kind === 'flow' && view.value.app === f.app && view.value.id === f.id) go({ kind: 'project', app: f.app })
  } catch (e) { viewError.value = e.message }
}
async function deleteProject(g) {
  const n = g.list.length
  const keeps = g.url && !g.real ? ' La app de práctica sigue en la lista, vacía.' : ''
  if (!confirm(`¿Borrar el proyecto «${appName(g.app)}»? Se borran ${n === 1 ? 'su flujo' : `sus ${n} flujos`} y sus corridas guardadas (los videos).${keeps}`)) return
  try {
    await api(`/api/projects/${g.app}`, { method: 'DELETE' })
    if (view.value.app === g.app) go(g.url && !g.real ? { kind: 'project', app: g.app } : { kind: 'live' })
  } catch (e) { viewError.value = e.message }
}
async function deleteFlow() {
  if (!confirm(`¿Eliminar el flujo «${flowData.value.flow.name}»? Se borra su archivo de jarvis/flows.`)) return
  try { await api(`/api/flows/${view.value.app}/${view.value.id}`, { method: 'DELETE' }); go({ kind: 'live' }) } catch (e) { viewError.value = e.message }
}

// ── la barra lateral ──
const appName = (id) => apps.value.find((a) => a.id === id)?.name || id
// Los proyectos: cada app del registro (aunque todavía no tenga flujos) y los sitios reales que ya tienen alguno.
const flowGroups = computed(() => {
  const g = Object.fromEntries(apps.value.map((a) => [a.id, []]))
  for (const f of flows.value) (g[f.app] ||= []).push(f)
  return Object.entries(g).map(([app, list]) => ({ app, list, url: apps.value.find((a) => a.id === app)?.url, real: apps.value.find((a) => a.id === app)?.real }))
})
// Qué carpetas están abiertas (los proyectos, abiertos por defecto; sus Corridas, cerradas).
const projectOpen = ref(readPref('jarvis.proyectos', {}))
watch(projectOpen, (v) => savePref('jarvis.proyectos', v), { deep: true })
const isOpen = (key, def = true) => projectOpen.value[key] ?? def
const toggleOpen = (key, def = true) => { projectOpen.value[key] = !isOpen(key, def) }
function openProject(app) { projectOpen.value[app] = true; go({ kind: 'project', app }) }
async function playFlowOf(f, m) {
  viewError.value = ''
  try { await api(`/api/flows/${f.app}/${f.id}/replay`, { method: 'POST', body: JSON.stringify({ mode: m }) }); go({ kind: 'live' }) } catch (e) { viewError.value = e.message }
}
const project = computed(() => (view.value.kind === 'project' ? {
  id: view.value.app, app: apps.value.find((a) => a.id === view.value.app),
  flows: flows.value.filter((f) => f.app === view.value.app),
} : null))

const hostOf = (u) => { try { return new URL(u).host } catch { return u } }
const fmtDate = (t) => (t && !t.startsWith('0001') ? new Date(t).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

// ── el panel de abajo: los pasos de la sesión y su script ──
const panelTab = ref('steps')
const script = ref('')
async function loadScript() { try { script.value = await fetch('/api/live/script', { headers: { 'X-Jarvis-Tab': viewTab.value } }).then((r) => r.text()) } catch { script.value = '' } }
watch([panelTab, () => liveState.value.steps?.length], () => { if (panelTab.value === 'script') loadScript() })

// ── las regiones (workbench) ──
const sidebarOpen = ref(readSize('jarvis.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('jarvis.sidebar-w', 320))
const auxOpen = ref(readSize('jarvis.aux-open', 1) !== 0)
const auxW = ref(readSize('jarvis.aux-w', 380))
const panelOpen = ref(readSize('jarvis.panel-open', 0) !== 0)
const panelH = ref(readSize('jarvis.panel-h', 200))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 240)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: auxOpen.value && (agentShown.value || flowOpen.value) ? auxW.value : 0, min },
    { size: sidebarOpen.value ? sidebarW.value : 0, min },
  ])
  const [panel] = fitRegions(viewportH.value - 200, [{ size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) }])
  return { sidebar, aux, panel }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px`, '--panel-h': `${shown.value.panel}px` }))
const sidebarResize = {
  label: 'Ancho de la barra lateral', sign: 1, defaultValue: 320,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('jarvis.sidebar-open', v ? 1 : 0); if (v) saveSize('jarvis.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho del panel de Claude', sign: -1, defaultValue: 380,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('jarvis.aux-open', v ? 1 : 0); if (v) saveSize('jarvis.aux-w', auxW.value) },
}
const panelResize = {
  label: 'Alto del panel de pasos', axis: 'y', sign: -1, defaultValue: 200,
  min: () => cssSize('--panel-min', 124), max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('jarvis.panel-open', v ? 1 : 0); if (v) saveSize('jarvis.panel-h', panelH.value) },
}
const toggle = (key, r) => { r.value = !r.value; saveSize(key, r.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  connect()
  window.addEventListener('hashchange', onHashChange)
  window.addEventListener('resize', onWindowResize)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
})
onBeforeUnmount(() => {
  events?.close(); frames?.close(); resizeObs?.disconnect(); themeBinding?.()
  window.removeEventListener('hashchange', onHashChange)
  window.removeEventListener('resize', onWindowResize)
})
// En vivo el pie muestra la URL en su campo: el rótulo va sin ella.
const liveStatusLabel = computed(() => {
  if (!connected.value) return 'sin conexión con la API'
  if (askState.value.running) return askState.value.waiting ? 'Claude espera tu respuesta' : 'Claude trabajando'
  if (replayActive.value) return `reproduciendo · paso ${replay.value.index + 1} de ${replay.value.total}`
  return 'en vivo'
})
const status = computed(() => {
  if (!connected.value) return 'sin conexión con la API'
  if (askState.value.running) return askState.value.waiting ? 'Claude espera tu respuesta' : 'Claude trabajando…'
  if (replayActive.value) return `reproduciendo · paso ${replay.value.index + 1} de ${replay.value.total}`
  if (isLive.value) return `en vivo · ${liveState.value.url}`
  return 'listo'
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-if="shown.sidebar" class="sidebar" aria-label="Proyectos y flujos">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>

      <!-- abrir cualquier página en vivo (por ejemplo, para loguearse a mano con Google) -->
      <form class="open-url" @submit.prevent="openURL(urlInput)">
        <input v-model="urlInput" class="input input-sm" type="text" inputmode="url" placeholder="Abrir una página: https://…" aria-label="Abrir una página" spellcheck="false" />
        <button type="submit" class="region-action" title="Abrirla en vivo" aria-label="Abrirla en vivo" :disabled="!urlInput.trim() || opening"><span class="ui-icon" data-icon="play" aria-hidden="true"></span></button>
      </form>
      <div class="region-head"><span>Proyectos</span><span class="count">{{ flowGroups.length }}</span></div>
      <div class="region-body tree" role="tree" aria-label="Proyectos">
        <p v-if="!flowGroups.length" class="none">No hay proyectos: las apps de jarvis/apps aparecen acá.</p>
        <template v-for="g in flowGroups" :key="g.app">
          <!-- la carpeta del proyecto: abrirla muestra su portada en el editor -->
          <div class="tree-row folder" role="treeitem" :aria-expanded="isOpen(g.app)" :class="{ on: view.kind === 'project' && view.app === g.app }" @click="openProject(g.app)">
            <button type="button" class="twisty" :aria-label="isOpen(g.app) ? 'Cerrar' : 'Abrir'" @click.stop="toggleOpen(g.app)"><span class="ui-icon" data-icon="chevron" :style="{ transform: isOpen(g.app) ? 'rotate(90deg)' : '' }" aria-hidden="true"></span></button>
            <span class="node-name">{{ appName(g.app) }}</span>
            <span class="node-flag">{{ g.list.length }}</span>
            <span class="node-actions">
              <button v-if="g.url" type="button" class="region-action" title="Abrirlo en vivo" aria-label="Abrirlo en vivo" @click.stop="openApp({ url: g.url })"><span class="ui-icon" data-icon="play" aria-hidden="true"></span></button>
              <button v-if="g.list.length || !g.url || g.real" type="button" class="region-action" title="Borrar el proyecto: sus flujos y sus corridas" aria-label="Borrar el proyecto" @click.stop="deleteProject(g)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
            </span>
          </div>
          <template v-if="isOpen(g.app)">
            <!-- sus flujos -->
            <div v-for="f in g.list" :key="f.id" class="tree-row leaf" role="treeitem" :class="{ on: view.kind === 'flow' && view.app === f.app && view.id === f.id }" :title="f.meta" @click="go({ kind: 'flow', app: f.app, id: f.id })">
              <span class="leaf-mark" :class="{ ok: fmtDate(f.verified) }" aria-hidden="true"></span>
              <span class="node-name">{{ f.name }}</span>
              <span class="node-flag">{{ f.steps }}</span>
              <span class="node-actions">
                <button type="button" class="region-action" title="Reproducir: los campos se llenan solos, los botones los tocás vos" aria-label="Reproducir" @click.stop="playFlowOf(f, 'fill')"><span class="ui-icon" data-icon="play" aria-hidden="true"></span></button>
                <button type="button" class="region-action" title="Borrar el flujo" aria-label="Borrar el flujo" @click.stop="deleteFlowOf(f)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
              </span>
            </div>
            <p v-if="!g.list.length" class="none tree-none">Sin flujos todavía.</p>
          </template>
        </template>
      </div>
    </aside>

    <main class="editor">
      <!-- la portada de un proyecto: sus flujos para reproducir y abrirlo en vivo -->
      <template v-if="view.kind === 'project' && project">
        <div class="region-head">
          <span class="ellipsis">Proyecto</span>
          <div class="region-actions">
            <button type="button" class="region-action" title="Volver al navegador en vivo" aria-label="Cerrar" @click="go({ kind: 'live' })"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="region-body run-body">
          <p v-if="viewError" class="err pad">{{ viewError }}</p>
          <article class="flow">
            <header class="flow-head">
              <h1>{{ appName(project.id) }}</h1>
              <p v-if="project.app" class="muted">{{ project.app.description }}</p>
              <div class="flow-actions">
                <button v-if="project.app" type="button" class="btn btn-outline" @click="openApp(project.app)">Abrir en vivo</button>
                <button v-if="project.flows.length || !project.app || project.app.real" type="button" class="btn btn-ghost" @click="deleteProject({ app: project.id, list: project.flows, url: project.app?.url, real: project.app?.real })">Borrar proyecto</button>
              </div>
            </header>
            <section>
              <h2>Flujos</h2>
              <p v-if="!project.flows.length" class="muted">Todavía no tiene. Pedíselo a Claude en la conversación: lo que aprenda en {{ appName(project.id) }} queda acá.</p>
              <div class="project-flows">
                <div v-for="f in project.flows" :key="f.id" class="pflow">
                  <button type="button" class="pflow-shot" :title="`Abrir «${f.name}»`" @click="go({ kind: 'flow', app: f.app, id: f.id })">
                    <img v-if="f.photo" :src="f.photo" alt="" loading="lazy" />
                    <span class="pflow-play" aria-hidden="true"><span class="ui-icon" data-icon="play"></span></span>
                  </button>
                  <div class="pflow-body">
                    <button type="button" class="pflow-name" @click="go({ kind: 'flow', app: f.app, id: f.id })">{{ f.name }}</button>
                    <span class="muted small">{{ f.steps }} pasos<template v-if="f.params"> · {{ f.params }} datos</template> · {{ fmtDate(f.verified) ? `verificado ${fmtDate(f.verified)}` : `creado ${fmtDate(f.created)}` }}</span>
                    <div class="flow-actions">
                      <button type="button" class="btn btn-sm" title="Llena los campos solo; los botones los tocás vos" @click="playFlowOf(f, 'fill')">Reproducir</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </article>
        </div>
      </template>

      <!-- un flujo: en el editor, sólo su video (su información y sus pasos van en el sidebar derecho) -->
      <template v-else-if="view.kind === 'flow'">
        <div class="region-head">
          <span class="ellipsis">{{ flowData?.flow.name || 'Flujo' }} · {{ appName(view.app) }}</span>
          <div class="region-actions">
            <button type="button" class="region-action" title="Volver al navegador en vivo" aria-label="Cerrar" @click="go({ kind: 'live' })"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="region-body run-body">
          <p v-if="viewError" class="err pad">{{ viewError }}</p>
          <RunViewer v-if="flowVideo" :run="flowVideo" :replayable="false" :bare="true" />
          <div v-else-if="flowData" class="home">
            <h1>Sin video todavía</h1>
            <p class="muted">Este flujo no tiene su corrida en esta máquina. Reproducilo una vez (a la derecha) y queda el video.</p>
          </div>
        </div>
      </template>

      <!-- en vivo -->
      <template v-else>
        <nav class="tabs live-tabs" aria-label="Pestañas">
          <div v-for="t in tabs" :key="t.id" class="tab" :class="{ on: t.id === viewTab }" :title="t.busy ? `Claude: ${t.meta}` : t.url">
            <button type="button" class="tab-label" @click="pickTab(t.id)">
              <span v-if="t.busy" class="tab-busy" aria-label="Claude trabajando"></span>
              <span>{{ tabLabel(t) }}</span>
            </button>
            <button type="button" class="tab-close" :aria-label="`Cerrar la pestaña ${tabLabel(t)}`" @click="closeTab(t.id)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
          </div>
          <button type="button" class="region-action new-tab" title="Pestaña nueva: otra sesión en paralelo" aria-label="Pestaña nueva" @click="newTab"><span class="ui-icon" data-icon="plus" aria-hidden="true"></span></button>
        </nav>
        <div v-if="!isLive" class="region-head"><span>Jarvis</span></div>
        <div ref="editorBody" class="region-body live-body">
          <p v-if="liveError" class="err pad">{{ liveError }}</p>
          <p v-if="viewError" class="err pad">{{ viewError }}</p>
          <div v-if="isLive" class="live-wrap" :class="{ guiding: guide || replayShown || liveState.popup }">
            <div v-if="liveState.popup" class="guide-bar popup-bar">
              <span class="bar-what">Ventana emergente: {{ hostOf(liveState.popup) }}</span>
              <span class="muted small">La manejás acá como cualquier página; cuando termina (un login), se cierra sola y vuelve la página.</span>
            </div>
            <!-- La reproducción: el paso, cómo salió el anterior y qué hacer con éste. -->
            <div v-if="replayShown" class="guide-bar">
              <div class="bar-text">
                <span class="bar-count">{{ replayActive ? `Reproduciendo · paso ${replay.index + 1} de ${replay.total}` : replay.status === 'done' ? 'Terminado' : 'Frenado' }}</span>
                <span v-if="replayActive && guide" class="bar-what">👉 {{ guide.instruction }}</span>
                <span v-else-if="replayActive" class="muted">{{ replay.status === 'person' ? 'Hacelo en la página…' : 'llenando…' }}</span>
                <span v-else class="muted">{{ replay.did }} los hizo la herramienta · {{ replay.byHand }} vos · {{ replay.skipped }} saltados</span>
                <span v-if="replay.note && replayActive" class="bar-note">{{ replay.note }}</span>
              </div>
              <template v-if="replayActive && replay.status === 'waiting'">
                <button v-if="replay.choices?.includes('do')" type="button" class="btn btn-sm" :class="{ 'btn-destructive': replay.danger }" @click="replayAnswer('do')">{{ replay.danger ? 'Sí, hacelo (irreversible)' : 'Hacelo vos' }}</button>
                <button type="button" class="btn btn-outline btn-sm" @click="replayAnswer('self')">Lo hago yo</button>
                <button type="button" class="btn btn-ghost btn-sm" @click="replayAnswer('skip')">Saltar</button>
              </template>
              <template v-else-if="replayActive && replay.status === 'person'">
                <button type="button" class="btn btn-sm" @click="replayAnswer('done')">Hecho</button>
                <button type="button" class="btn btn-ghost btn-sm" @click="replayAnswer('skip')">Saltar</button>
              </template>
              <button v-if="replayActive" type="button" class="btn btn-ghost btn-sm" @click="replayAnswer('stop')">Terminar</button>
              <template v-else>
                <button v-if="replay.flow" type="button" class="btn btn-outline btn-sm" @click="go({ kind: 'flow', app: replay.flow.split('/')[0], id: replay.flow.split('/')[1] })">Ver el flujo</button>
                <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="replayHidden = replay.report"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
              </template>
            </div>
            <!-- El paso que marca Claude en modo enseñame: va AFUERA de la página, para no tapar lo que hay que tocar. -->
            <div v-else-if="guide" class="guide-bar">
              <span class="bar-what">👉 {{ guide.instruction }}</span>
              <template v-if="!guideStuck">
                <button type="button" class="btn btn-sm" @click="answerGuide(true)">Hecho</button>
                <button type="button" class="btn btn-ghost btn-sm" @click="guideStuck = true">No lo encuentro</button>
              </template>
              <form v-else class="bar-form" @submit.prevent="answerGuide(false)">
                <input v-model="guideNote" class="input input-sm" placeholder="Qué ves (opcional)" aria-label="Qué ves" />
                <button type="submit" class="btn btn-sm">Avisar</button>
              </form>
            </div>
            <div class="live-stage" :class="{ phone: isMobile }" :style="liveFit">
              <canvas ref="liveCanvas" class="live-canvas" tabindex="0" aria-label="La página en vivo: hacé clic y escribí como en un navegador"
                @click="onCanvasClick" @wheel.prevent="onCanvasWheel" @keydown="onCanvasKey" @paste="onCanvasPaste"></canvas>
              <div v-if="guideStyle" :key="guide.id" class="guide-box" :style="guideStyle"></div>
            </div>
          </div>
          <div v-else class="home">
            <h1>Jarvis</h1>
            <p class="muted">Pedile a Claude en la conversación qué querés hacer o aprender en una app: lo hace en un navegador real y lo ves trabajar acá. Lo que aprende queda como flujo en su proyecto: se reproduce navegando de nuevo, con sus datos precargados, y para donde tenés que actuar vos.</p>
            <h2>Abrir una página</h2>
            <form class="open-url big" @submit.prevent="openURL(urlInput)">
              <input v-model="urlInput" class="input" type="text" inputmode="url" placeholder="https://… (si pide login, entrás vos acá; el perfil lo recuerda)" aria-label="Abrir una página" spellcheck="false" />
              <button type="submit" class="btn" :disabled="!urlInput.trim() || opening">Abrir en vivo</button>
            </form>
            <h2>Proyectos</h2>
            <div class="apps">
              <button v-for="a in apps" :key="a.id" type="button" class="card app-card" @click="openApp(a)">
                <strong>{{ a.name }}</strong>
                <span class="muted small">{{ a.description }}</span>
                <span class="muted small">{{ flows.filter((f) => f.app === a.id).length }} flujos · abrir en vivo</span>
              </button>
            </div>
          </div>
        </div>
      </template>
    </main>

    <aside v-if="shown.aux" class="auxiliarybar" :aria-label="auxShows === 'flow' ? 'El flujo' : 'Claude trabajando'">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <nav v-if="flowOpen && agentShown" class="tabs">
        <button type="button" class="tab" :class="{ on: auxShows === 'flow' }" @click="auxTab = 'flow'">Flujo</button>
        <button type="button" class="tab" :class="{ on: auxShows === 'agent' }" @click="auxTab = 'agent'">Claude</button>
      </nav>
      <template v-if="auxShows === 'flow'">
        <div class="region-head">
          <span>Flujo</span>
          <div class="region-actions">
            <button type="button" class="region-action" title="Eliminar el flujo" aria-label="Eliminar el flujo" @click="deleteFlow"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="region-body">
      <article class="flow side">
        <header class="flow-head">
          <h1 class="editable" contenteditable="plaintext-only" spellcheck="false" title="Clic para cambiarle el nombre" @keydown.enter.prevent="$event.target.blur()" @blur="renameFlow($event.target.innerText)">{{ flowData.flow.name }}</h1>
          <p class="muted">{{ flowSteps.length }} pasos<template v-if="flowData.flow.device === 'mobile'"> · móvil</template> · creado {{ fmtDate(flowData.flow.created) }}
            <template v-if="fmtDate(flowData.flow.verified)"> · verificado {{ fmtDate(flowData.flow.verified) }}</template></p>
          <p class="muted small"><code>jarvis/flows/{{ flowData.app }}/{{ flowData.id }}.json</code></p>
          <div class="flow-actions">
            <button type="button" class="btn" title="Llena los campos solo con estos datos; en cada botón para y lo tocás vos" @click="playFlow('fill')">Reproducir</button>
          </div>
        </header>

        <section v-if="flowParams.length" class="flow-data">
          <h2>Datos del flujo</h2>
          <p class="muted small">Al reproducir se escriben solos y los botones los tocás vos. Cambialos acá; marcá «lo escribo yo» para que pare y lo escribas vos.</p>
          <div v-for="p in flowParams" :key="p.i" class="data-row">
            <label :for="`dato-${p.i}`">{{ p.param }}</label>
            <input :id="`dato-${p.i}`" class="input input-sm" :value="p.value" :disabled="p.pause" @change="saveFlowStep(p.i, { value: $event.target.value })" />
            <label class="check"><input type="checkbox" :checked="p.pause" @change="saveFlowStep(p.i, { pause: $event.target.checked })" /> lo escribo yo</label>
          </div>
        </section>

        <section>
          <h2>Pasos</h2>
          <ol class="flow-steps">
            <li v-for="(s, i) in flowSteps" :key="i" :class="{ stop: s.pause }">
              <span class="flow-n">{{ i + 1 }}</span>
              <div class="flow-step-body">
                <div class="flow-what editable" contenteditable="plaintext-only" spellcheck="false" title="Clic para cambiar el texto del paso" @keydown.enter.prevent="$event.target.blur()" @blur="editStepText(i, $event.target)">{{ s.instruction || s.action }}</div>
                <div v-if="s.why" class="muted small">{{ s.why }}</div>
              </div>
              <label v-if="!s.param && !s.secret && ['click', 'dblclick', 'check', 'uncheck', 'select', 'press'].includes(s.action)" class="check small" title="Que pare acá y lo haga la persona">
                <input type="checkbox" :checked="s.pause" @change="saveFlowStep(i, { pause: $event.target.checked })" /> lo hago yo
              </label>
              <span v-else-if="s.secret" class="muted small">lo escribe la persona</span>
              <button type="button" class="region-action step-del" title="Sacar este paso del flujo" :aria-label="`Sacar el paso ${i + 1}`" @click="removeStep(i)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
            </li>
          </ol>
        </section>
          </article>
        </div>
      </template>
      <template v-else>
      <div class="region-head">
        <span>Claude</span>
        <span v-if="askState.running" class="badge badge-xs" :class="askState.waiting ? 'kw-ask' : 'kw-none'">{{ askState.waiting ? 'espera tu respuesta' : askState.external ? 'desde la conversación' : 'trabajando…' }}</span>
        <div class="region-actions">
          <button v-if="askState.running" type="button" class="region-action" title="Frenar" aria-label="Frenar" @click="stopAsk"><span class="ui-icon" data-icon="stop" aria-hidden="true"></span></button>
          <button v-else type="button" class="region-action" title="Limpiar" aria-label="Limpiar" @click="askEvents = []"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
        </div>
      </div>
      <div class="region-body agent">
        <p class="agent-goal">{{ askState.meta }}</p>
        <template v-for="e in timeline" :key="e.n">
          <p v-if="e.k === 'think'" class="ev-think">{{ plainText(e.t) }}</p>
          <p v-else-if="e.k === 'act' && guideText(e.t)" class="ev-guide">👉 {{ guideText(e.t) }}</p>
          <code v-else-if="e.k === 'act'" class="ev-act">{{ e.t }}</code>
          <p v-else-if="e.k === 'look'" class="ev-note">mira la pantalla</p>
          <code v-else-if="e.k === 'fail' || e.k === 'err'" class="ev-fail">✗ {{ e.t }}</code>
          <div v-else-if="e.k === 'result'" class="ev-result">
            <span class="badge badge-xs kw" :class="KW_CLASS[keywordOf(e.t)] || 'kw-none'">{{ keywordOf(e.t) || '¿?' }}</span>
            <div class="ev-result-text">{{ stripKeyword(e.t) }}</div>
          </div>
          <p v-else-if="e.k === 'answer'" class="ev-answer">› {{ e.t }}</p>
          <p v-else class="ev-note">{{ e.t }}</p>
        </template>
        <div v-if="askState.waiting" class="card ask-card">
          <div class="ask-head"><span class="badge badge-xs kw kw-ask">{{ askKeyword }}</span> Te pregunta:</div>
          <div class="ev-result-text">{{ askQuestion }}</div>
          <div v-if="askKeyword === 'CONFIRMAR'" class="bar-form">
            <button type="button" class="btn btn-destructive btn-sm" @click="answerAsk('sí')">Sí, hacelo</button>
            <button type="button" class="btn btn-outline btn-sm" @click="answerAsk('no')">No</button>
          </div>
          <form class="bar-form" @submit.prevent="askReply.trim() && answerAsk(askReply)">
            <input v-model="askReply" class="input input-sm" :placeholder="askKeyword === 'CONFIRMAR' ? 'u otra respuesta…' : 'tu respuesta…'" aria-label="Tu respuesta" />
            <button type="submit" class="btn btn-outline btn-sm" :disabled="!askReply.trim()">Enviar</button>
          </form>
          <button type="button" class="btn btn-ghost btn-sm" @click="answerAsk('')">Terminar sin contestar</button>
        </div>
        <p v-if="askError" class="err">{{ askError }}</p>
        <p v-if="!askState.running && askState.exit" class="err">El proceso terminó: {{ askState.exit }}</p>
        <div v-if="!askState.running && askFlow" class="agent-done">
          <button v-if="askFlow" type="button" class="btn btn-sm" @click="go({ kind: 'flow', app: askFlow.split('/')[0], id: askFlow.split('/')[1] })">Abrir el flujo</button>
        </div>
      </div>
      </template>
    </aside>

    <section v-if="shown.panel" class="panel" aria-label="Pasos de la sesión">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <nav class="tabs">
        <button type="button" class="tab" :class="{ on: panelTab === 'steps' }" @click="panelTab = 'steps'">Pasos <span class="count">{{ (liveState.steps || []).length }}</span></button>
        <button type="button" class="tab" :class="{ on: panelTab === 'script' }" @click="panelTab = 'script'">Script</button>
      </nav>
      <div class="region-body">
        <template v-if="panelTab === 'steps'">
          <p v-if="!(liveState.steps || []).length" class="none">Los pasos de la sesión en vivo, con su línea de Playwright.</p>
          <div v-for="(s, i) in liveState.steps || []" :key="i" class="log-line" :data-kind="s.ok ? 'ok' : 'warn'">
            <span class="what wrap">{{ s.manual ? '👉' : s.ok ? '✓' : '✗' }} {{ s.code }}<template v-if="s.error"> · {{ s.error }}</template></span>
          </div>
        </template>
        <pre v-else class="script">{{ script || 'Sin pasos todavía.' }}</pre>
      </div>
    </section>

    <footer class="statusbar">
      <!-- En vivo, la URL vive acá: un campo que se lee como texto y se edita como dirección (Enter navega). -->
      <template v-if="isLive && view.kind === 'live'">
        <div class="layout-controls nav-controls" role="group" aria-label="Navegación">
          <button type="button" class="region-action" title="Atrás" aria-label="Atrás" @click="liveNav('back')"><span class="ui-icon" data-icon="chevron" aria-hidden="true" style="transform: rotate(180deg)"></span></button>
        </div>
        <!-- El punto dice si la página en vivo está conectada (verde) o no (gris). El texto aparece sólo cuando dice
             algo más que «en vivo»: Claude trabajando, una reproducción. -->
        <!-- El punto también recarga: en reposo dice el estado y, con el mouse o el foco encima, se vuelve ⟳. -->
        <button type="button" class="sb-dot-btn" :class="{ on: connected }" :title="`${connected ? liveStatusLabel : 'sin conexión con la API'} · clic para recargar`" :aria-label="`${connected ? liveStatusLabel : 'sin conexión con la API'}: recargar la página`" @click="liveNav('reload')">
          <span class="sb-dot" aria-hidden="true"></span>
          <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
        </button>
        <span v-if="liveStatusLabel !== 'en vivo'" class="sb-state">{{ liveStatusLabel }} ·</span>
        <form class="sb-url" @submit.prevent="liveNav('goto', liveURL)">
          <input id="live-url" v-model="liveURL" aria-label="URL de la página en vivo (Enter para ir)" spellcheck="false" autocomplete="off" />
        </form>
      </template>
      <span v-else class="ellipsis">{{ status }}</span>
      <div v-if="isLive && view.kind === 'live'" class="layout-controls device-controls" role="group" aria-label="Sesión en vivo">
        <button type="button" class="region-action" title="Cerrar la sesión en vivo" aria-label="Cerrar la sesión en vivo" @click="liveStop"><span class="ui-icon" data-icon="stop" aria-hidden="true"></span></button>
      </div>
      <!-- Seguir a Claude: un punto antes del tema y las regiones (ésos van al final del pie, como en todas las herramientas). Naranja sigue, gris quieto; el clic alterna y el tooltip explica. -->
      <button type="button" class="follow-dot-btn" :class="{ on: followClaude }" :aria-pressed="followClaude"
        :title="followClaude ? 'Siguiendo a Claude: la vista salta a la pestaña donde trabaja (si elegís una a mano, se respeta 20 s). Clic para quedarte quieto' : 'Quieto: la vista no cambia de pestaña sola. Clic para seguir a Claude'"
        :aria-label="followClaude ? 'Siguiendo a Claude (clic para quedarte quieto)' : 'Quieto (clic para seguir a Claude)'" @click="followClaude = !followClaude">
        <span class="follow-dot" aria-hidden="true"></span>
      </button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Proyectos y flujos" aria-label="Mostrar u ocultar la barra lateral" @click="toggle('jarvis.sidebar-open', sidebarOpen)"><span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Pasos y script" aria-label="Mostrar u ocultar los pasos" @click="toggle('jarvis.panel-open', panelOpen)"><span class="ui-icon" data-icon="console" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" :disabled="!agentShown && !flowOpen" title="El flujo o Claude trabajando" aria-label="Mostrar u ocultar el panel de Claude" @click="toggle('jarvis.aux-open', auxOpen)"><span class="ui-icon" data-icon="detail" aria-hidden="true"></span></button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Regiones, filas, pestañas, grupos, líneas y pie son de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.muted { color: var(--fg-3) }
.small { font-size: var(--text-sm) }
.err { color: var(--status-bad); font-size: var(--text-sm); margin: 0 }
.pad { padding: var(--space-3) var(--gutter) }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0 }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
.check { display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap }
.kw { flex: none }
.kw-ok { background: var(--kw-ok); color: var(--kw-ink) }
.kw-bad { background: var(--kw-bad); color: var(--kw-ink) }
.kw-ask { background: var(--kw-ask); color: var(--kw-ink) }
.kw-none { background: var(--hover); color: var(--fg-2) }

.run-top { display: flex; align-items: center; gap: var(--space-2); min-width: 0 }

/* abrir una página */
.open-url { display: flex; gap: var(--space-1); align-items: center; padding: var(--space-2) var(--gutter); border-bottom: 1px solid var(--border) }
.open-url .input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--text-sm) }
.open-url.big { padding: 0; border: 0; gap: var(--space-2) }
.popup-bar { border-color: var(--kw-ask) }
/* el árbol: proyectos como carpetas, con sus flujos adentro */
.tree { padding: var(--space-1) 0 var(--space-3) }
.tree-row { display: flex; align-items: center; gap: var(--space-1); min-height: 28px; padding: 0 var(--space-2) 0 var(--gutter); cursor: pointer; min-width: 0 }
.tree-row:hover { background: var(--hover) }
.tree-row.on { background: var(--selection, var(--hover)); box-shadow: inset 2px 0 0 var(--primary) }
.tree-row.folder > .node-name { font-weight: 600 }
.tree-row.folder.sub > .node-name { font-weight: 400; color: var(--fg-2) }
.tree-row.sub, .tree-row.leaf { padding-left: calc(var(--gutter) + 18px) }
.tree-row.deep { padding-left: calc(var(--gutter) + 36px) }
.twisty { flex: none; width: var(--icon-size); height: var(--icon-size); display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; background: none; color: var(--fg-2); cursor: pointer }
.twisty .ui-icon { transition: transform .15s }
.node-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.node-flag { flex: none; font-size: var(--text-xs); color: var(--fg-3) }
.node-actions { display: none; flex: none; gap: 2px }
.tree-row:hover > .node-actions, .tree-row.on > .node-actions { display: inline-flex }
.tree-row:hover > .node-flag, .tree-row.on > .node-flag { display: none }
.tree-row.leaf .node-flag { font-variant-numeric: tabular-nums }
.leaf-mark { flex: none; width: 8px; height: 8px; margin: 0 4px; border-radius: 2px; border: 1.5px solid var(--fg-3) }
.leaf-mark.ok { background: var(--kw-ok); border-color: var(--kw-ok) }
.run-dot { flex: none; width: 8px; height: 8px; margin: 0 4px; border-radius: 50% }
.tree-none { padding-left: calc(var(--gutter) + 22px) }
/* la portada de un proyecto */
.project-flows { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-3) }
.pflow { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius-control); overflow: hidden; background: var(--card) }
.pflow-shot { position: relative; padding: 0; border: 0; background: var(--stage-bg); aspect-ratio: 16 / 9; cursor: pointer; overflow: hidden }
.pflow-shot img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; opacity: .85 }
.pflow-shot:hover img { opacity: 1 }
.pflow-play { position: absolute; inset: 0; margin: auto; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; background: var(--stage-chip); color: var(--stage-ink) }
.pflow-body { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3) }
.pflow-body .flow-actions { margin-top: var(--space-2) }
.pflow-name { padding: 0; border: 0; background: none; color: inherit; font: inherit; font-weight: 600; text-align: left; cursor: pointer }
.pflow-name:hover { text-decoration: underline }

/* en vivo */
/* La URL en el pie: casi imperceptible hasta que se la toca. Hereda el tamaño y el color del pie. */
.sb-state { flex: none; white-space: nowrap; margin-left: var(--space-1) }
.sb-dot-btn { flex: none; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: var(--radius-control);
  background: none; color: var(--fg-2); cursor: pointer }
.sb-dot-btn > * { grid-area: 1 / 1 }
.sb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-3) }
.sb-dot-btn.on .sb-dot { background: var(--kw-ok-ink) }
.sb-dot-btn .ui-icon { visibility: hidden }
.sb-dot-btn:hover, .sb-dot-btn:focus-visible { background: var(--hover); color: var(--foreground) }
.sb-dot-btn:hover .sb-dot, .sb-dot-btn:focus-visible .sb-dot { visibility: hidden }
.sb-dot-btn:hover .ui-icon, .sb-dot-btn:focus-visible .ui-icon { visibility: visible }
.sb-url { flex: 1; min-width: 0; display: flex; margin-left: var(--space-1) }
.sb-url input { flex: 1; min-width: 0; height: 22px; padding: 0 var(--space-1); border: 1px solid transparent; border-radius: var(--radius-control);
  background: transparent; color: inherit; font: inherit; text-overflow: ellipsis }
.sb-url input:hover { border-color: var(--border) }
.sb-url input:focus { outline: none; border-color: var(--primary); color: var(--foreground) }
.device-controls { margin-left: var(--space-2) }
.sb-url + .device-controls { margin-left: auto }
.nav-controls { flex: none; margin-right: var(--space-1) }
.live-tabs .new-tab { align-self: center; margin-left: var(--space-1) }
.follow-dot-btn { flex: none; display: grid; place-items: center; width: 22px; height: 22px; margin-left: var(--space-1); padding: 0; border: 0;
  border-radius: var(--radius-control); background: none; cursor: pointer }
.follow-dot-btn:hover, .follow-dot-btn:focus-visible { background: var(--hover) }
.follow-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-3) }
.follow-dot-btn.on .follow-dot { background: var(--primary) }
.tab-busy { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--primary); animation: tab-pulse 1.4s ease-in-out infinite }
@keyframes tab-pulse { 50% { opacity: .35 } }
@media (prefers-reduced-motion: reduce) { .tab-busy { animation: none } }
.live-body { overflow: hidden }
.live-wrap { height: 100%; display: grid; place-items: center }
.live-wrap.guiding { grid-template-rows: auto 1fr; align-content: start; gap: var(--space-2); padding-top: var(--space-2) }
.live-stage { position: relative; box-shadow: 0 0 0 1px var(--border) }
.live-stage.phone { border-radius: 18px; box-shadow: 0 0 0 8px var(--stage-bg), 0 0 0 9px var(--border) }
.live-stage.phone .live-canvas { border-radius: 18px }
.live-canvas { display: block; width: 100%; height: 100%; background: var(--card); outline: none }
.guide-bar { justify-self: stretch; margin: 0 var(--space-3); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 2px solid var(--primary); border-radius: var(--radius-control); background: var(--card) }
.bar-text { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 2px }
.bar-count, .bar-note { font-size: var(--text-sm); color: var(--fg-3) }
.bar-what { flex: 1; min-width: 0; font-weight: 600; line-height: 1.4 }
.bar-form { display: flex; gap: var(--space-2); align-items: center }
.bar-form .input { flex: 1; min-width: 0 }
.guide-box { position: absolute; z-index: 2; pointer-events: none; border: 3px solid var(--primary); border-radius: 6px; animation: guide-pulse 1.4s ease-in-out infinite }
@keyframes guide-pulse { 50% { outline: 6px solid color-mix(in srgb, var(--primary) 35%, transparent); outline-offset: 2px } }

/* inicio */
.home { padding: var(--space-6); max-width: 900px; display: flex; flex-direction: column; gap: var(--space-3) }
.home h1 { margin: 0; font-size: var(--text-title); font-weight: 600 }
.home h2 { margin: var(--space-3) 0 0; font-size: var(--text-base); font-weight: 600 }
.home p { margin: 0 }
.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-3) }
.app-card { display: flex; flex-direction: column; gap: var(--space-1); text-align: left; padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--card); color: inherit; font: inherit; cursor: pointer }
.app-card:hover { border-color: var(--primary) }

/* un flujo */
.run-body { container-type: inline-size }
.flow { padding: var(--space-6); max-width: 1100px; display: flex; flex-direction: column; gap: var(--space-6) }
.flow h1 { margin: 0 0 var(--space-1); font-size: var(--text-title); font-weight: 600 }
.flow h2 { margin: 0 0 var(--space-2); font-size: var(--text-base); font-weight: 600 }
.flow-head p { margin: 0 }
.flow-actions { display: flex; gap: var(--space-2); margin-top: var(--space-3) }
.flow-data { display: flex; flex-direction: column; gap: var(--space-2) }
.flow.side { padding: var(--space-3) var(--gutter); gap: var(--space-4) }
.flow.side h1 { font-size: var(--text-base) }
.flow.side .flow-actions { flex-wrap: wrap }
.flow.side .data-row { grid-template-columns: 1fr auto }
.flow.side .data-row > label:first-child { grid-column: 1 / -1; margin-bottom: -6px }
.flow-data p { margin: 0 }
.data-row { display: grid; grid-template-columns: minmax(140px, 220px) 1fr auto; gap: var(--space-3); align-items: center }
.data-row > label:first-child { font-weight: 600 }
.flow-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.flow-steps li { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--border) }
.flow-steps li.stop { box-shadow: inset 3px 0 0 var(--kw-ask); padding-left: var(--space-2) }
.flow-n { flex: none; width: 24px; color: var(--fg-3); font-variant-numeric: tabular-nums }
.flow-step-body { flex: 1; min-width: 0 }
.flow-what { font-weight: 600 }
.editable { border-radius: 4px; outline: none; cursor: text }
.editable:hover { box-shadow: 0 0 0 1px var(--border) }
.editable:focus { box-shadow: 0 0 0 2px var(--primary) }
.step-del { visibility: hidden }
.flow-steps li:hover .step-del { visibility: visible }

/* Claude trabajando */
.agent { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) }
.agent p { margin: 0 }
.agent-goal { font-weight: 600 }
.ev-think { line-height: 1.5; white-space: pre-wrap }
.ev-guide { font-weight: 600; line-height: 1.45 }
.ev-act, .ev-fail { font-family: var(--font-mono); font-size: var(--text-sm); overflow-wrap: anywhere; color: var(--fg-2) }
.ev-act::before { content: '→ '; color: var(--fg-3) }
.ev-fail { color: var(--status-bad) }
.ev-note { color: var(--fg-3); font-size: var(--text-sm) }
.ev-answer { color: var(--fg-2) }
.ev-result { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-left: 2px solid var(--border); background: var(--hover) }
.ev-result .kw { align-self: flex-start }
.ev-result-text { white-space: pre-wrap; line-height: 1.5 }
.ask-card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--kw-ask); border-radius: var(--radius-control) }
.ask-head { display: flex; align-items: center; gap: var(--space-2); font-weight: 600 }
.agent-done { display: flex; flex-wrap: wrap; gap: var(--space-2) }
.script { margin: 0; padding: var(--space-2) var(--gutter); font-family: var(--font-mono); font-size: var(--text-sm); white-space: pre-wrap }
</style>
