<script setup>
/* navegador · la interfaz. Flujos para usar herramientas complejas: le decís a Claude qué querés hacer en una app,
 * lo ves trabajar en vivo (el navegador real en el editor y lo que piensa a la derecha) y lo que aprende queda como
 * FLUJO (navegador/flujos, JSON en git): se reproduce navegando de nuevo, con sus datos precargados o abiertos, y
 * para donde tiene que actuar la persona (o en lo irreversible).
 *
 * Todo llega por UN stream en tiempo real (/api/events, server/events.go); los cuadros del navegador, por el suyo
 * (/api/live/frames). La ruta: #/ (en vivo), #/corrida/<id> (una corrida como video), #/flujo/<app>/<id>. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle, readHashRoute, hashRoute, setRoute } from './workbench.js'
import RunViewer from './RunViewer.vue'

async function api(path, opts = {}) {
  const res = await fetch(path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── la ruta ──
const view = ref({ kind: 'live' }) // live · run {id} · flow {app, id}
function parseRoute() {
  const p = readHashRoute().parts
  if (p[0] === 'corrida' && p[1]) return { kind: 'run', id: p[1] }
  if (p[0] === 'flujo' && p[1] && p[2]) return { kind: 'flow', app: p[1], id: p[2] }
  return { kind: 'live' }
}
view.value = parseRoute()
function go(v) {
  view.value = v
  const parts = v.kind === 'run' ? ['corrida', v.id] : v.kind === 'flow' ? ['flujo', v.app, v.id] : []
  setRoute(hashRoute(parts), { push: true })
}
const onHashChange = () => { view.value = parseRoute() }

// ── el estado, en tiempo real ──
const liveState = ref({ active: false, steps: [] })
const askState = ref({ running: false, waiting: false, meta: '', total: 0 })
const askEvents = ref([])
const runs = ref([])
const flows = ref([])
const apps = ref([])
const connected = ref(false)
let events = null
function connect() {
  events = new EventSource('/api/events')
  events.onopen = () => { connected.value = true }
  events.onerror = () => { connected.value = false } // EventSource se reconecta solo
  const on = (kind, fn) => events.addEventListener(kind, (e) => { try { fn(JSON.parse(e.data)) } catch { /* evento roto */ } })
  on('live', (st) => { liveState.value = st })
  on('askstate', (st) => {
    if (st.total === 0) askEvents.value = [] // una meta nueva
    if (st.eventos?.length && st.eventos.length === st.total) askEvents.value = st.eventos // al conectarse: todo
    askState.value = st
  })
  on('ask', (ev) => { if (ev.n === askEvents.value.length) askEvents.value.push(ev) })
  on('runs', (v) => { runs.value = v })
  on('flows', (v) => { flows.value = v; if (view.value.kind === 'flow') loadView(view.value) })
  on('apps', (v) => { apps.value = v; if (!apps.value.some((a) => a.id === composeApp.value) && composeApp.value !== 'otra' && v.length) composeApp.value = v[0].id })
}

// ── lo que se pide: una meta, en una app, automático o enseñame ──
const goal = ref('')
const composeApp = ref(readPref('navegador.app', ''))
const otherURL = ref('')
const mode = ref(readPref('navegador.modo', 'do')) // do (automático) · guide (enseñame)
const device = ref(readPref('navegador.device', 'desktop'))
watch(composeApp, (v) => savePref('navegador.app', v))
watch(mode, (v) => savePref('navegador.modo', v))
watch(device, (v) => savePref('navegador.device', v))
const composeError = ref('')
const launching = ref(false)
const startURL = computed(() => (composeApp.value === 'otra' ? otherURL.value.trim() : apps.value.find((a) => a.id === composeApp.value)?.url || ''))
async function launch() {
  if (!goal.value.trim() || askState.value.running) return
  launching.value = true
  composeError.value = ''
  try {
    await api('/api/ask', { method: 'POST', body: JSON.stringify({ meta: goal.value, url: startURL.value, device: device.value, modo: mode.value }) })
    goal.value = ''
    go({ kind: 'live' })
    auxOpen.value = true
  } catch (e) { composeError.value = e.message } finally { launching.value = false }
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
const askRun = computed(() => askEvents.value.find((e) => e.k === 'report')?.t.match(/#\/corrida\/([^/\s]+)/)?.[1] || '')
const askFlow = computed(() => askEvents.value.find((e) => e.k === 'flow')?.t || '')
const timeline = computed(() => askEvents.value.filter((e) => !['out', 'ask', 'report', 'flow', 'site'].includes(e.k)))
function guideText(cmd) { return cmd.match(/^navegador point\s+(?:\S+|'[^']*')\s+'(.*)'\s*$/)?.[1] || '' }
const agentShown = computed(() => askState.value.running || askEvents.value.length > 0)

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
  frames = new EventSource('/api/live/frames')
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
  const w = liveState.value.width || 1280
  const h = liveState.value.height || 800
  const pad = (isMobile.value ? 48 : 16) + (guide.value || replayShown.value ? 76 : 0)
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
async function liveNav(action, url = '') { liveError.value = ''; try { await api('/api/live/nav', { method: 'POST', body: JSON.stringify({ action, url }) }) } catch (e) { liveError.value = e.message } }
async function liveStop() { try { await api('/api/live/stop', { method: 'POST' }) } catch (e) { liveError.value = e.message } }
const switching = ref(false)
async function setDevice(d) {
  device.value = d
  if (!isLive.value || liveState.value.device === d) return
  switching.value = true
  try { await api('/api/live/device', { method: 'POST', body: JSON.stringify({ device: d }) }) } catch (e) { liveError.value = e.message } finally { switching.value = false }
}
async function openApp(a) {
  liveError.value = ''
  try { await api(`/api/live/start?url=${encodeURIComponent(a.url)}&device=${device.value}`, { method: 'POST' }); go({ kind: 'live' }) } catch (e) { liveError.value = e.message }
}
// La guía de Claude (modo enseñame): «Hecho» / «No lo encuentro».
const guideNote = ref('')
const guideStuck = ref(false)
async function answerGuide(done) {
  try { await api('/api/live/guide/answer', { method: 'POST', body: JSON.stringify({ done, note: done ? '' : guideNote.value }) }); guideNote.value = ''; guideStuck.value = false } catch (e) { liveError.value = e.message }
}
// La reproducción de una corrida o un flujo.
async function replayAnswer(choice) { try { await api('/api/live/replay/answer', { method: 'POST', body: JSON.stringify({ choice }) }) } catch (e) { liveError.value = e.message } }
const viewError = ref('')
async function replayRun(id, m = 'auto') {
  viewError.value = ''
  try { await api('/api/live/replay/start', { method: 'POST', body: JSON.stringify({ run: id, mode: m }) }); go({ kind: 'live' }) } catch (e) { viewError.value = e.message }
}

// ── una corrida o un flujo, abiertos ──
const runData = ref(null)
const flowData = ref(null)
const flowVideo = ref(null)
async function loadView(v) {
  viewError.value = ''
  try {
    if (v.kind === 'run') runData.value = await api(`/api/runs/${encodeURIComponent(v.id)}`)
    if (v.kind === 'flow') {
      flowData.value = await api(`/api/flows/${v.app}/${v.id}`)
      const src = flowData.value.flujo.ultima_corrida || flowData.value.flujo.corrida
      flowVideo.value = src ? await api(`/api/runs/${encodeURIComponent(src)}`).catch(() => null) : null
    }
  } catch (e) { viewError.value = e.message }
}
watch(view, (v) => { runData.value = flowData.value = flowVideo.value = null; loadView(v) }, { immediate: true })
const savingFlow = ref(false)
async function saveAsFlow() {
  const name = prompt('Nombre del flujo', runData.value?.corrida?.meta?.replace(/^Repetición · /, '') || '')
  if (!name) return
  savingFlow.value = true
  try { const f = await api('/api/flows', { method: 'POST', body: JSON.stringify({ run: view.value.id, name }) }); go({ kind: 'flow', app: f.app, id: f.id }) } catch (e) { viewError.value = e.message } finally { savingFlow.value = false }
}
// Lo que se edita de un flujo: el valor de cada dato y si el paso para para que lo haga la persona.
const flowSteps = computed(() => flowData.value?.flujo.pasos || [])
const flowParams = computed(() => flowSteps.value.map((s, i) => ({ ...s, i })).filter((s) => s.dato))
async function saveFlowStep(i, patch) {
  const pasos = flowSteps.value.map((_, j) => (j === i ? patch : {}))
  try { await api(`/api/flows/${view.value.app}/${view.value.id}`, { method: 'PUT', body: JSON.stringify({ pasos }) }) } catch (e) { viewError.value = e.message }
}
async function playFlow(m) {
  viewError.value = ''
  try { await api(`/api/flows/${view.value.app}/${view.value.id}/replay`, { method: 'POST', body: JSON.stringify({ mode: m }) }); go({ kind: 'live' }) } catch (e) { viewError.value = e.message }
}
async function deleteFlow() {
  if (!confirm(`¿Eliminar el flujo «${flowData.value.flujo.nombre}»? Se borra su archivo de navegador/flujos.`)) return
  try { await api(`/api/flows/${view.value.app}/${view.value.id}`, { method: 'DELETE' }); go({ kind: 'live' }) } catch (e) { viewError.value = e.message }
}
const stopsCount = computed(() => flowSteps.value.filter((s) => s.pausa).length)

// ── la barra lateral ──
const sideTab = ref(readPref('navegador.lado', 'flows'))
watch(sideTab, (v) => savePref('navegador.lado', v))
const appName = (id) => apps.value.find((a) => a.id === id)?.nombre || id
// Los proyectos: cada app del registro (aunque todavía no tenga flujos) y los sitios reales que ya tienen alguno.
const flowGroups = computed(() => {
  const g = Object.fromEntries(apps.value.map((a) => [a.id, []]))
  for (const f of flows.value) (g[f.app] ||= []).push(f)
  return Object.entries(g).map(([app, list]) => ({ app, list, url: apps.value.find((a) => a.id === app)?.url }))
})
const projectOpen = ref(readPref('navegador.proyectos', {}))
watch(projectOpen, (v) => savePref('navegador.proyectos', v), { deep: true })
function newFlowIn(app) { composeApp.value = app; document.getElementById('compose-goal')?.focus() }
const fmtDate = (t) => (t && !t.startsWith('0001') ? new Date(t).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

// ── el panel de abajo: los pasos de la sesión y su script ──
const panelTab = ref('steps')
const script = ref('')
async function loadScript() { try { script.value = await fetch('/api/live/script').then((r) => r.text()) } catch { script.value = '' } }
watch([panelTab, () => liveState.value.steps?.length], () => { if (panelTab.value === 'script') loadScript() })

// ── las regiones (workbench) ──
const sidebarOpen = ref(readSize('navegador.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('navegador.sidebar-w', 320))
const auxOpen = ref(readSize('navegador.aux-open', 1) !== 0)
const auxW = ref(readSize('navegador.aux-w', 380))
const panelOpen = ref(readSize('navegador.panel-open', 0) !== 0)
const panelH = ref(readSize('navegador.panel-h', 200))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 240)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: auxOpen.value && agentShown.value ? auxW.value : 0, min },
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
  commit: (v) => { saveSize('navegador.sidebar-open', v ? 1 : 0); if (v) saveSize('navegador.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho del panel de Claude', sign: -1, defaultValue: 380,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('navegador.aux-open', v ? 1 : 0); if (v) saveSize('navegador.aux-w', auxW.value) },
}
const panelResize = {
  label: 'Alto del panel de pasos', axis: 'y', sign: -1, defaultValue: 200,
  min: () => cssSize('--panel-min', 124), max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('navegador.panel-open', v ? 1 : 0); if (v) saveSize('navegador.panel-h', panelH.value) },
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
    <aside v-if="shown.sidebar" class="sidebar" aria-label="Flujos y corridas">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <form class="compose" @submit.prevent="launch">
        <textarea id="compose-goal" v-model="goal" class="input compose-goal" rows="3" aria-label="Qué querés hacer"
          placeholder="¿Qué querés hacer o aprender? «agregá Crédito Ya como medio de pago, en modo pruebas»" @keydown.enter.exact.prevent="launch"></textarea>
        <div class="compose-row">
          <select v-model="composeApp" class="input input-sm" aria-label="En qué proyecto">
            <option v-for="a in apps" :key="a.id" :value="a.id">{{ a.nombre }}</option>
            <option value="otra">Otra URL…</option>
          </select>
          <select v-model="device" class="input input-sm compose-device" aria-label="Dispositivo">
            <option value="desktop">Escritorio</option>
            <option value="mobile">Móvil</option>
          </select>
        </div>
        <input v-if="composeApp === 'otra'" v-model="otherURL" class="input input-sm" type="url" placeholder="https://… (vacío: la sesión abierta)" aria-label="URL" />
        <div class="compose-row">
          <div class="seg-toggle" role="group" aria-label="Cómo trabaja">
            <button type="button" :aria-pressed="mode === 'do'" title="Claude lo hace solo y frena únicamente antes de algo irreversible (borrar, desactivar, pagar, enviar)" @click="mode = 'do'">Automático</button>
            <button type="button" :aria-pressed="mode === 'guide'" title="Claude te marca cada paso en la página y vos lo hacés" @click="mode = 'guide'">Enseñame</button>
          </div>
          <button type="submit" class="btn btn-sm compose-go" :disabled="!goal.trim() || askState.running || launching">{{ askState.running ? 'Trabajando…' : 'Hacerlo' }}</button>
        </div>
        <p v-if="composeError" class="err">{{ composeError }}</p>
      </form>

      <nav class="tabs">
        <button type="button" class="tab" :class="{ on: sideTab === 'flows' }" @click="sideTab = 'flows'">Proyectos <span class="count">{{ flowGroups.length }}</span></button>
        <button type="button" class="tab" :class="{ on: sideTab === 'runs' }" @click="sideTab = 'runs'">Corridas <span class="count">{{ runs.length }}</span></button>
      </nav>
      <div v-if="sideTab === 'flows'" class="region-body">
        <p v-if="!flowGroups.length" class="none">No hay proyectos: las apps de navegador/apps aparecen acá.</p>
        <template v-for="g in flowGroups" :key="g.app">
          <div class="region-head group project-head" @click="projectOpen[g.app] = projectOpen[g.app] === false">
            <span class="ui-icon twisty" data-icon="chevron" :style="{ transform: projectOpen[g.app] === false ? '' : 'rotate(90deg)' }" aria-hidden="true"></span>
            <span class="ellipsis">{{ appName(g.app) }}</span><span class="count">{{ g.list.length }}</span>
            <div class="region-actions">
              <button v-if="g.url" type="button" class="region-action" title="Abrirlo en vivo" aria-label="Abrirlo en vivo" @click.stop="openApp({ url: g.url })"><span class="ui-icon" data-icon="play" aria-hidden="true"></span></button>
              <button type="button" class="region-action" title="Un flujo nuevo en este proyecto: escribí qué querés hacer arriba" aria-label="Flujo nuevo" @click.stop="newFlowIn(g.app)"><span class="ui-icon" data-icon="plus" aria-hidden="true"></span></button>
            </div>
          </div>
          <p v-if="projectOpen[g.app] !== false && !g.list.length" class="none">Sin flujos todavía. Pedile a Claude algo para hacer acá (el + lo elige arriba).</p>
          <div v-if="projectOpen[g.app] !== false && g.list.length" class="cards">
            <button v-for="f in g.list" :key="f.id" type="button" class="flow-card" :class="{ on: view.kind === 'flow' && view.app === f.app && view.id === f.id }" @click="go({ kind: 'flow', app: f.app, id: f.id })">
              <img v-if="f.foto" :src="f.foto" alt="" loading="lazy" />
              <span class="flow-card-name">{{ f.nombre }}</span>
              <span class="row-desc">{{ f.pasos }} pasos<template v-if="f.datos"> · {{ f.datos }} datos</template> · {{ fmtDate(f.verificado) ? `✓ ${fmtDate(f.verificado)}` : fmtDate(f.creado) }}</span>
            </button>
          </div>
        </template>
      </div>
      <div v-else class="region-body">
        <p v-if="!runs.length" class="none">Cada vez que Claude trabaja o se reproduce un flujo queda una corrida: se ve como video.</p>
        <button v-for="r in runs" :key="r.id" type="button" class="row stacked" :class="{ on: view.kind === 'run' && view.id === r.id }" @click="go({ kind: 'run', id: r.id })">
          <span class="run-top"><span class="badge badge-xs kw" :class="KW_CLASS[r.palabra] || 'kw-none'">{{ r.palabra || '—' }}</span><span class="ellipsis">{{ r.meta || '(sin meta)' }}</span></span>
          <span class="row-desc">{{ fmtDate(r.fecha) }} · {{ r.pasos }} pasos<template v-if="r.usd"> · US$ {{ r.usd.toFixed(2) }}</template></span>
        </button>
      </div>
    </aside>

    <main class="editor">
      <!-- una corrida, como video -->
      <template v-if="view.kind === 'run'">
        <div class="region-head">
          <span class="ellipsis">Corrida</span>
          <div class="region-actions">
            <button type="button" class="btn btn-ghost btn-sm" :disabled="savingFlow || !runData" title="Guardarla como flujo en navegador/flujos" @click="saveAsFlow">Guardar como flujo</button>
            <button type="button" class="region-action" title="Volver al navegador en vivo" aria-label="Cerrar" @click="go({ kind: 'live' })"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="region-body run-body">
          <p v-if="viewError" class="err pad">{{ viewError }}</p>
          <RunViewer v-if="runData" :run="runData" @replay="replayRun(view.id)" />
        </div>
      </template>

      <!-- un flujo: sus datos, dónde para, y reproducirlo -->
      <template v-else-if="view.kind === 'flow'">
        <div class="region-head">
          <span class="ellipsis">Flujo · {{ appName(view.app) }}</span>
          <div class="region-actions">
            <button v-if="flowData" type="button" class="region-action" title="Eliminar el flujo" aria-label="Eliminar el flujo" @click="deleteFlow"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
            <button type="button" class="region-action" title="Volver al navegador en vivo" aria-label="Cerrar" @click="go({ kind: 'live' })"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="region-body run-body">
          <p v-if="viewError" class="err pad">{{ viewError }}</p>
          <article v-if="flowData" class="flow">
            <header class="flow-head">
              <h1>{{ flowData.flujo.nombre }}</h1>
              <p class="muted">{{ flowSteps.length }} pasos<template v-if="flowData.flujo.dispositivo === 'mobile'"> · móvil</template> · creado {{ fmtDate(flowData.flujo.creado) }}
                <template v-if="fmtDate(flowData.flujo.verificado)"> · verificado {{ fmtDate(flowData.flujo.verificado) }}</template></p>
              <p class="muted small"><code>navegador/flujos/{{ flowData.app }}/{{ flowData.id }}.json</code></p>
              <div class="flow-actions">
                <button type="button" class="btn" title="Navega de nuevo con estos datos y para sólo donde marcaste, en una llave, en lo irreversible o si algo cambió" @click="playFlow('auto')">Reproducir{{ stopsCount ? ` (para en ${stopsCount})` : ' (automático)' }}</button>
                <button type="button" class="btn btn-outline" title="Cada paso lo hacés vos, con la instrucción y el elemento marcados" @click="playFlow('teach')">Enseñame</button>
              </div>
            </header>

            <section v-if="flowParams.length" class="flow-data">
              <h2>Datos del flujo</h2>
              <p class="muted small">Se precargan al reproducir. Cambialos acá; marcá «lo escribo yo» para que pare y lo escribas vos.</p>
              <div v-for="p in flowParams" :key="p.i" class="data-row">
                <label :for="`dato-${p.i}`">{{ p.dato }}</label>
                <input :id="`dato-${p.i}`" class="input input-sm" :value="p.valor" :disabled="p.pausa" @change="saveFlowStep(p.i, { valor: $event.target.value })" />
                <label class="check"><input type="checkbox" :checked="p.pausa" @change="saveFlowStep(p.i, { pausa: $event.target.checked })" /> lo escribo yo</label>
              </div>
            </section>

            <section>
              <h2>Pasos</h2>
              <ol class="flow-steps">
                <li v-for="(s, i) in flowSteps" :key="i" :class="{ stop: s.pausa }">
                  <span class="flow-n">{{ i + 1 }}</span>
                  <div class="flow-step-body">
                    <div class="flow-what">{{ s.instruccion || s.accion }}</div>
                    <div v-if="s.porque" class="muted small">{{ s.porque }}</div>
                  </div>
                  <label v-if="!s.dato && !s.secreto && ['click', 'dblclick', 'check', 'uncheck', 'select', 'press'].includes(s.accion)" class="check small" title="Que pare acá y lo haga la persona">
                    <input type="checkbox" :checked="s.pausa" @change="saveFlowStep(i, { pausa: $event.target.checked })" /> lo hago yo
                  </label>
                  <span v-else-if="s.secreto" class="muted small">lo escribe la persona</span>
                </li>
              </ol>
            </section>

            <section v-if="flowVideo">
              <h2>Cómo se hizo</h2>
              <RunViewer :run="flowVideo" />
            </section>
          </article>
        </div>
      </template>

      <!-- en vivo -->
      <template v-else>
        <div v-if="isLive" class="region-head live-head">
          <button type="button" class="region-action" title="Atrás" aria-label="Atrás" @click="liveNav('back')"><span class="ui-icon" data-icon="chevron" aria-hidden="true" style="transform: rotate(180deg)"></span></button>
          <button type="button" class="region-action" title="Recargar" aria-label="Recargar" @click="liveNav('reload')"><span class="ui-icon" data-icon="refresh" aria-hidden="true"></span></button>
          <form class="live-url" @submit.prevent="liveNav('goto', liveURL)">
            <input id="live-url" v-model="liveURL" class="input input-sm" aria-label="URL" spellcheck="false" />
          </form>
          <div class="seg-toggle" role="group" aria-label="Dispositivo">
            <button type="button" :aria-pressed="liveState.device !== 'mobile'" :disabled="switching" @click="setDevice('desktop')">Escritorio</button>
            <button type="button" :aria-pressed="liveState.device === 'mobile'" :disabled="switching" title="Un teléfono (Pixel 7). Cambiar reabre la sesión en la misma página" @click="setDevice('mobile')">Móvil</button>
          </div>
          <button type="button" class="region-action" title="Cerrar la sesión en vivo" aria-label="Cerrar la sesión en vivo" @click="liveStop"><span class="ui-icon" data-icon="stop" aria-hidden="true"></span></button>
        </div>
        <div v-else class="region-head"><span>navegador</span></div>
        <div ref="editorBody" class="region-body live-body">
          <p v-if="liveError" class="err pad">{{ liveError }}</p>
          <p v-if="viewError" class="err pad">{{ viewError }}</p>
          <div v-if="isLive" class="live-wrap" :class="{ guiding: guide || replayShown }">
            <!-- La reproducción: el paso, cómo salió el anterior y qué hacer con éste. -->
            <div v-if="replayShown" class="guide-bar">
              <div class="bar-text">
                <span class="bar-count">{{ replayActive ? `${replay.mode === 'teach' ? 'Enseñame' : 'Reproduciendo'} · paso ${replay.index + 1} de ${replay.total}` : replay.status === 'done' ? 'Terminado' : 'Frenado' }}</span>
                <span v-if="replayActive && guide" class="bar-what">👉 {{ guide.instruction }}</span>
                <span v-else-if="replayActive" class="muted">{{ replay.status === 'person' ? 'Hacelo en la página…' : 'trabajando…' }}</span>
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
                <button v-if="replay.report" type="button" class="btn btn-outline btn-sm" @click="go({ kind: 'run', id: replay.report })">Ver la corrida</button>
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
                @click="onCanvasClick" @wheel.prevent="onCanvasWheel" @keydown="onCanvasKey"></canvas>
              <div v-if="guideStyle" :key="guide.id" class="guide-box" :style="guideStyle"></div>
            </div>
          </div>
          <div v-else class="home">
            <h1>¿Qué querés hacer o aprender?</h1>
            <p class="muted">Escribilo arriba a la izquierda y elegí la app. Claude lo hace en un navegador real (o te enseña paso a paso) y lo ves trabajar acá. Lo que aprende queda como flujo: se reproduce navegando de nuevo, con sus datos precargados, y para donde tenés que actuar vos.</p>
            <h2>Proyectos</h2>
            <div class="apps">
              <button v-for="a in apps" :key="a.id" type="button" class="card app-card" @click="openApp(a)">
                <strong>{{ a.nombre }}</strong>
                <span class="muted small">{{ a.descripcion }}</span>
                <span class="muted small">{{ flows.filter((f) => f.app === a.id).length }} flujos · abrir en vivo</span>
              </button>
            </div>
          </div>
        </div>
      </template>
    </main>

    <aside v-if="shown.aux" class="auxiliarybar" aria-label="Claude trabajando">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>Claude</span>
        <span v-if="askState.running" class="badge badge-xs" :class="askState.waiting ? 'kw-ask' : 'kw-none'">{{ askState.waiting ? 'espera tu respuesta' : 'trabajando…' }}</span>
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
        <p v-if="!askState.running && askState.salida" class="err">El proceso terminó: {{ askState.salida }}</p>
        <div v-if="!askState.running && (askFlow || askRun)" class="agent-done">
          <button v-if="askFlow" type="button" class="btn btn-sm" @click="go({ kind: 'flow', app: askFlow.split('/')[0], id: askFlow.split('/')[1] })">Abrir el flujo</button>
          <button v-if="askRun" type="button" class="btn btn-outline btn-sm" @click="go({ kind: 'run', id: askRun })">Ver cómo lo hizo</button>
        </div>
      </div>
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
      <span class="ellipsis">{{ status }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Flujos y corridas" aria-label="Mostrar u ocultar la barra lateral" @click="toggle('navegador.sidebar-open', sidebarOpen)"><span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Pasos y script" aria-label="Mostrar u ocultar los pasos" @click="toggle('navegador.panel-open', panelOpen)"><span class="ui-icon" data-icon="bottom" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" :disabled="!agentShown" title="Claude trabajando" aria-label="Mostrar u ocultar el panel de Claude" @click="toggle('navegador.aux-open', auxOpen)"><span class="ui-icon" data-icon="detail" aria-hidden="true"></span></button>
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

/* el compositor */
.compose { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--gutter); border-bottom: 1px solid var(--border) }
.compose-goal { resize: vertical; min-height: 64px; font: inherit }
.compose-row { display: flex; gap: var(--space-2); align-items: center }
.compose-row > select:first-child { flex: 1; min-width: 0 }
.compose-device { flex: none; width: auto }
.compose-go { margin-left: auto }
.seg-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-control); overflow: hidden; flex: none }
.seg-toggle button { border: 0; background: transparent; color: var(--fg-2); font: inherit; font-size: var(--text-sm); padding: 2px var(--space-2); cursor: pointer }
.seg-toggle button + button { border-left: 1px solid var(--border) }
.seg-toggle button[aria-pressed="true"] { background: var(--hover); color: var(--foreground) }
.seg-toggle button:disabled { opacity: .5; cursor: progress }
.run-top { display: flex; align-items: center; gap: var(--space-2); min-width: 0 }

/* la galería de flujos */
.project-head { cursor: pointer; gap: var(--space-1) }
.project-head .twisty { flex: none; transition: transform .15s }
.cards { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) var(--gutter) var(--space-3) }
.flow-card { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--card); color: inherit; font: inherit; cursor: pointer }
.flow-card:hover { border-color: color-mix(in srgb, var(--primary) 50%, var(--border)) }
.flow-card.on { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary) }
.flow-card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; object-position: top; border-radius: 4px; margin-bottom: var(--space-1) }
.flow-card-name { font-weight: 600; line-height: 1.35 }

/* en vivo */
.live-head { gap: var(--space-1) }
.live-url { flex: 1; min-width: 0; display: flex }
.live-url .input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--text-sm) }
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
.flow-data p { margin: 0 }
.data-row { display: grid; grid-template-columns: minmax(140px, 220px) 1fr auto; gap: var(--space-3); align-items: center }
.data-row > label:first-child { font-weight: 600 }
.flow-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.flow-steps li { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-2) 0; border-top: 1px solid var(--border) }
.flow-steps li.stop { box-shadow: inset 3px 0 0 var(--kw-ask); padding-left: var(--space-2) }
.flow-n { flex: none; width: 24px; color: var(--fg-3); font-variant-numeric: tabular-nums }
.flow-step-body { flex: 1; min-width: 0 }
.flow-what { font-weight: 600 }

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
