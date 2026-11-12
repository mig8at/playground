<script setup>
/* SENTINEL: el vigía de producción. A la izquierda toda la originación y LO QUE SE SIGUE (comercios o entidades que se
 * agregan a mano, cada uno con su curva chica de hoy); al centro el elegido, con su curva del día contra lo normal y las
 * marcas de los despliegues a producción; abajo, en la consola, la tabla con TODAS las señales (errores, entidades y
 * comercios: la última hora contra la misma hora de los días comparables); a la derecha lo que pide atención, los avisos
 * y los despliegues. Lo que se sigue vive en el servidor (following.go): decide además de qué comercios avisa macOS.
 *
 * Sólo lee: la API (sentinel/server) guarda cuatro semanas en disco y cada 5 minutos pide sólo lo que falta. La ruta es
 * `#/lender/<id>`, `#/merchant/<id>`, `#/service/<nombre>`, `#/queue` o vacía (toda la originación). */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, regionSize, reopenSize, bindThemeToggle, bindPanelMaximize, readHashRoute, setRoute } from './workbench.js'

const data = ref(null)       // el Overview de la API
const apiError = ref('')
const running = ref(false)
const loading = ref('')      // la carga inicial de la historia, mientras corre
const stale = ref(false)     // lo que se ve es lo guardado de la última vez; la lectura de ahora sigue
const query = ref('')
const following = ref([])   // las señales que se siguen («merchant:94»), en el orden en que se agregaron
const route = ref({ kind: 'all', id: 0 })

async function load() {
  try {
    const res = await fetch('/api/overview')
    const body = await res.json()
    data.value = body.overview || data.value
    apiError.value = body.error || ''
    running.value = !!body.running
    loading.value = body.loading || ''
    stale.value = !!body.stale
    following.value = body.following || []
  } catch {
    apiError.value = 'No contesta la API. ¿Está arriba? (make sentinel levanta las dos partes)'
  }
}
async function refresh() {
  running.value = true
  try { await fetch('/api/refresh', { method: 'POST' }) } catch { /* lo dice load */ }
  setTimeout(load, 1500)
}
let timer = null

// ── lo elegido ──
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const filtered = (list) => (query.value.trim() ? (list || []).filter((s) => fold(s.name).includes(fold(query.value))) : list || [])
// Sin movimiento: lo normal a esta hora es 0 y hoy tampoco entró nada. Van plegados al final de su grupo: son la
// mayoría de las entidades a cualquier hora y tapaban las que sí se mueven.
const idle = (s) => s.median === 0 && s.now.total === 0
const everything = computed(() => [...(data.value?.services || []), ...(data.value?.lenders || []), ...(data.value?.merchants || [])])
const bySignal = computed(() => new Map(everything.value.map((s) => [s.signal, s])))
const followed = computed(() => following.value.map((sig) => bySignal.value.get(sig) || { signal: sig, name: sig, kind: sig.split(':')[0], id: Number(sig.split(':')[1]), state: 'quiet', now: { total: 0 }, median: 0, why: 'Sin datos todavía: no aparece en lo guardado.' }))
// Lo que se sigue, en dos secciones: entidades primero (son menos y cada una cruza varios comercios), después comercios.
const followedGroups = computed(() => [{ kind: 'lender', title: 'Entidades que sigo' }, { kind: 'merchant', title: 'Comercios que sigo' }]
  .map((g) => ({ ...g, list: followed.value.filter((s) => s.kind === g.kind) })).filter((g) => g.list.length))
const isFollowed = (s) => following.value.includes(s.signal)
const canFollow = (s) => s.kind === 'lender' || s.kind === 'merchant'
// Lo que propone el buscador del sidebar: comercios y entidades que todavía no se siguen, primero los que se mueven.
const suggestions = computed(() => {
  if (!query.value.trim()) return []
  return filtered([...(data.value?.merchants || []), ...(data.value?.lenders || [])])
    .filter((s) => !isFollowed(s)).sort((a, b) => b.now.total + b.median - (a.now.total + a.median)).slice(0, 8)
})
async function setFollow(s, on) {
  try {
    const res = await fetch(on ? '/api/following' : `/api/following?signal=${encodeURIComponent(s.signal)}`,
      on ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signal: s.signal }) } : { method: 'DELETE' })
    const body = await res.json()
    if (body.error) { apiError.value = body.error; return }
    following.value = body.following || []
    if (on) query.value = ''
  } catch { apiError.value = 'No contesta la API: no se pudo cambiar lo que se sigue.' }
}
// La curva chica de una fila: hoy (hasta la hora en curso) contra la mediana, en una caja de 72×22.
function spark(s) {
  if (!s?.normal?.length) return null
  const top = Math.max(1, ...s.normal, ...(s.today || []))
  const x = (h) => 1 + (h / 23) * 70
  const y = (v) => 21 - (v / top) * 19
  return { normal: s.normal.map((v, h) => `${x(h)},${y(v)}`).join(' '), today: (s.today || []).map((v, h) => `${x(h)},${y(v)}`).join(' ') }
}

// ── la tabla de la consola: todas las señales ──
const KIND_TABS = [{ id: 'all', label: 'Todas' }, { id: 'errors', label: 'Errores' }, { id: 'lender', label: 'Entidades' }, { id: 'merchant', label: 'Comercios' }]
const tableKind = ref('all')
const tableQuery = ref('')
const showIdle = ref(false)
const sortBy = ref({ key: 'state', dir: 1 })
const SEVERITY = { alert: 0, warn: 1, ok: 2, quiet: 3 }
const ofKind = (s, k) => k === 'all' || (k === 'errors' ? isErrors(s) : s.kind === k)
const kindCount = (k) => everything.value.filter((s) => ofKind(s, k) && (showIdle.value || !idle(s))).length
const SORTS = {
  state: (s) => [SEVERITY[s.state] ?? 9, -Math.abs(s.z || 0)],
  name: (s) => [fold(s.name)],
  kind: (s) => [s.kind, fold(s.name)],
  now: (s) => [-s.now.total],
  median: (s) => [-s.median],
  z: (s) => [-Math.abs(s.z || 0)],
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1 } return 0 }
const tableRows = computed(() => {
  const q = fold(tableQuery.value.trim())
  const key = SORTS[sortBy.value.key] || SORTS.state
  return everything.value
    .filter((s) => ofKind(s, tableKind.value) && (showIdle.value || q || !idle(s)) && (!q || fold(s.name).includes(q)))
    .sort((a, b) => sortBy.value.dir * cmp(key(a), key(b)))
})
function sortOn(key) { sortBy.value = sortBy.value.key === key ? { key, dir: -sortBy.value.dir } : { key, dir: 1 } }
const ariaSort = (key) => (sortBy.value.key === key ? (sortBy.value.dir > 0 ? 'ascending' : 'descending') : 'none')
const selected = computed(() => {
  const d = data.value
  if (!d) return null
  if (route.value.kind === 'queue') return d.services?.find((s) => s.kind === 'queue') || d.all
  if (route.value.kind === 'service') return d.services?.find((s) => s.name === route.value.name) || d.all
  if (route.value.kind === 'lender') return d.lenders?.find((s) => s.id === route.value.id) || d.all
  if (route.value.kind === 'merchant') return d.merchants?.find((s) => s.id === route.value.id) || d.all
  return d.all
})
const attention = computed(() => [...(data.value?.services || []), ...(data.value?.lenders || []), ...(data.value?.merchants || [])]
  .filter((s) => s.state === 'alert' || s.state === 'warn'))

function readRoute() {
  const { parts } = readHashRoute()
  if (parts[0] === 'queue') route.value = { kind: 'queue', id: 0 }
  else if (parts[0] === 'service' && parts[1]) route.value = { kind: 'service', id: 0, name: decodeURIComponent(parts[1]) }
  else route.value = (parts[0] === 'lender' || parts[0] === 'merchant') && parts[1] ? { kind: parts[0], id: Number(parts[1]) } : { kind: 'all', id: 0 }
}
function pick(s) {
  if (!s || s.kind === 'all') setRoute([])
  else if (s.kind === 'queue') setRoute(['queue'])
  else if (s.kind === 'service') setRoute(['service', s.name])
  else setRoute([s.kind, String(s.id)])
  readRoute()
}
const isOn = (s) => route.value.kind === s.kind && (s.kind === 'queue' || (s.kind === 'service' ? route.value.name === s.name : route.value.id === s.id))

// El último despliegue a producción de un servicio: los servicios de Loki se llaman como sus repos.
const lastDeployOf = (name) => (data.value?.deploys || []).find((d) => d.repo === name)
const ago = (iso) => {
  const h = Math.round((Date.now() - new Date(iso)) / 3600000)
  return h < 1 ? 'hace menos de una hora' : h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`
}

// ── textos ──
const STATE_LABEL = { alert: 'alerta', warn: 'para mirar', ok: 'normal', quiet: 'poco volumen' }
// En la tabla, corto: es una columna.
const TABLE_KIND = { lender: 'Entidad', merchant: 'Comercio', service: 'Logs', queue: 'Cola', all: 'Producción' }
const KIND_LABEL = { lender: 'Entidad', merchant: 'Comercio', all: 'Producción', service: 'Errores en los logs', queue: 'La cola' }
const NOTICE_LABEL = { alert: 'Alerta', warn: 'Para mirar', recovered: 'Volvió a lo normal', stale: 'Sin leer producción' }
const NOTICE_DOT = { alert: 'alert', warn: 'warn', recovered: 'ok', stale: 'warn' }
// Un aviso lleva a su señal: «lender:6», «service:legacy-backend», «queue:failed»; «sentinel» y «all» a la vista general.
function pickSignal(sig) {
  const [kind, key] = String(sig).split(':')
  if (kind === 'lender' || kind === 'merchant') setRoute([kind, key])
  else if (kind === 'service') setRoute(['service', key])
  else if (kind === 'queue') setRoute(['queue'])
  else setRoute([])
  readRoute()
}
// La ventana que mira una señal: una hora, o más para lo que se sigue y es chico (FollowedWindows en el servidor).
const hours = (s) => Math.round((s?.windowMinutes || 60) / 60)
const spanLabel = (s) => (hours(s) === 1 ? 'Última hora' : `Últimas ${hours(s)} horas`) // 24 h: un día móvil, no «hoy»
const spanShort = (s) => (hours(s) === 1 ? '' : ` (${hours(s)} h)`)
// Desde cuándo hasta cuándo mira: con 24 horas, la hora sola se repite («10:54–10:54»), así que va con el día.
function windowRange(s) {
  const from = new Date(new Date(data.value.windowTo) - (s.windowMinutes || 60) * 60000).toISOString()
  return hours(s) >= 24 ? `${dayClock(from)} – ${dayClock(data.value.windowTo)}` : `${clock(from)}–${clock(data.value.windowTo)}`
}
const isErrors = (s) => s?.kind === 'service' || s?.kind === 'queue'
const shortDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })
// El cambio de nivel: no es alerta, es que lo normal se movió y se quedó (la última semana contra las anteriores).
const shiftText = (s) => s?.shift && `Cambio de nivel: ×${fmt(s.shift.ratio)} por día (de ${fmt(s.shift.before)} a ${fmt(s.shift.after)}), la última semana contra las anteriores. Ya cuenta como lo normal; si nadie lo explicó, vale la pena mirarlo.`
const dayBarMax = computed(() => Math.max(1, selected.value?.now?.total || 0, ...(selected.value?.samples || []).map((x) => x.n)))
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const dayClock = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const pct = (x) => `${Math.round((x || 0) * 100)} %`
const fmt = (x) => (Number.isInteger(x) ? String(x) : (x || 0).toFixed(1))
const repoShort = (r) => r.replace('legacy-', '')

// ── la curva: hoy contra lo normal (mediana y rango de los 7 días anteriores), por hora ──
const W = 720
const H = 220
const PAD = { l: 34, r: 12, t: 12, b: 24 }
const chart = computed(() => {
  const s = selected.value
  if (!s?.normal) return null
  const top = Math.max(4, ...s.normalHigh, ...(s.today || [])) * 1.1
  const x = (h) => PAD.l + (h / 23) * (W - PAD.l - PAD.r)
  const y = (v) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b)
  const band = s.normalHigh.map((v, h) => `${x(h)},${y(v)}`).concat(s.normalLow.map((v, h) => `${x(h)},${y(v)}`).reverse()).join(' ')
  const median = s.normal.map((v, h) => `${x(h)},${y(v)}`).join(' ')
  const today = (s.today || []).map((v, h) => `${x(h)},${y(v)}`).join(' ')
  const last = (s.today || []).length - 1
  const ticks = [0, Math.round(top / 2), Math.round(top)].map((v) => ({ v, y: y(v) }))
  // Los despliegues de HOY, en su hora. Los de ayer se listan a la derecha.
  const todayStr = new Date().toDateString()
  const marks = (data.value?.deploys || []).filter((d) => new Date(d.at).toDateString() === todayStr).map((d) => {
    const t = new Date(d.at)
    return { ...d, x: x(t.getHours() + t.getMinutes() / 60) }
  })
  return { band, median, today, ticks, marks, lastX: last >= 0 ? x(last) : 0, lastY: last >= 0 ? y(s.today[last]) : 0, hours: [0, 6, 12, 18, 23].map((h) => ({ h, x: x(h) })) }
})

// ── las regiones, con el contrato de la base ──
const sidebarOpen = ref(readSize('sentinel.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('sentinel.sidebar-w', 300))
const auxOpen = ref(readSize('sentinel.aux-open', 1) !== 0)
const auxW = ref(readSize('sentinel.aux-w', 320))
const viewportW = ref(window.innerWidth)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 240)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: auxOpen.value ? auxW.value : 0, min },
    { size: sidebarOpen.value ? sidebarW.value : 0, min },
  ])
  return { sidebar, aux }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px` }))
const sidebarResize = {
  label: 'Ancho de la lista', sign: 1, defaultValue: 300,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('sentinel.sidebar-open', v ? 1 : 0); if (v) saveSize('sentinel.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho de las alertas', sign: -1, defaultValue: 320,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('sentinel.aux-open', v ? 1 : 0); if (v) saveSize('sentinel.aux-w', auxW.value) },
}
// La consola: la tabla de todas las señales, debajo del editor. Mínimo o nada en alto, como en el tablero.
const viewportH = ref(window.innerHeight)
const panelOpen = ref(readSize('sentinel.panel-open', 1) !== 0)
const panelH = ref(readSize('sentinel.panel-h', 300))
const panelMax = () => Math.max(cssSize('--panel-min', 124), viewportH.value - 260)
const panelShown = computed(() => (panelOpen.value ? regionSize(panelH.value, cssSize('--panel-min', 124), panelMax()) : 0))
const panelResize = {
  label: 'Alto de la tabla de señales', axis: 'y', sign: -1, defaultValue: 300,
  min: () => cssSize('--panel-min', 124), max: panelMax,
  get: () => panelShown.value,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('sentinel.panel-open', v ? 1 : 0); if (v) saveSize('sentinel.panel-h', panelH.value) },
}
function togglePanel() {
  if (panelShown.value) { panelOpen.value = false } else { panelH.value = reopenSize(panelH.value, cssSize('--panel-min', 124), panelMax(), 300); panelOpen.value = true }
  saveSize('sentinel.panel-open', panelOpen.value ? 1 : 0)
}
const panelMaxButton = ref(null)
let panelMaxBinding = null
watch(panelMaxButton, (el) => { panelMaxBinding?.destroy?.(); panelMaxBinding = el ? bindPanelMaximize(el) : null })

function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('sentinel.sidebar-open', sidebarOpen.value ? 1 : 0) }
function toggleAux() { auxOpen.value = !shown.value.aux; saveSize('sentinel.aux-open', auxOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  readRoute()
  load()
  timer = setInterval(load, 30_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  clearInterval(timer)
  themeBinding?.destroy?.()
  panelMaxBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Lo que se sigue">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Sentinel</span>
        <span v-if="attention.length" class="count attention">{{ attention.length }} para mirar</span>
      </div>
      <div class="search">
        <input v-model="query" class="input" type="search" placeholder="Seguir un comercio o una entidad…" aria-label="Buscar un comercio o una entidad para seguir" />
      </div>
      <div class="region-body">
        <template v-if="query.trim()">
          <div class="region-head group"><span>Para seguir</span><span class="count">{{ suggestions.length }}</span></div>
          <p v-if="data && !suggestions.length" class="none">Nada con «{{ query }}» que no sigas ya.</p>
          <div v-for="s in suggestions" :key="`q-${s.signal}`" class="row subject suggestion">
            <button type="button" class="subject-open" :title="s.why" @click="pick(s)">
              <i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>
              <span class="subject-name">{{ s.name }}</span>
              <small class="subject-kind">{{ KIND_LABEL[s.kind].toLowerCase() }}</small>
            </button>
            <button type="button" class="region-action" :title="`Seguir ${s.name}`" :aria-label="`Seguir ${s.name}`" @click="setFollow(s, true)">
              <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <button type="button" class="row subject" :class="{ on: route.kind === 'all' }" @click="pick(null)">
          <i class="dot" :class="`is-${data?.all?.state}`" aria-hidden="true"></i>
          <span class="subject-name">Toda la originación</span>
          <svg v-if="spark(data?.all)" class="spark" viewBox="0 0 72 22" aria-hidden="true"><polyline class="spark-normal" :points="spark(data.all).normal" /><polyline class="spark-today" :points="spark(data.all).today" /></svg>
          <small v-if="data?.all" class="subject-nums" title="en la última hora · lo normal a esta hora">{{ data.all.now.total }} · {{ fmt(data.all.median) }}</small>
        </button>
        <p v-if="data && !followed.length" class="none">Todavía no seguís ninguno. Buscá un comercio o una entidad arriba y tocá + para seguirlo: de los comercios, sólo los que seguís avisan por macOS.</p>
        <template v-for="group in followedGroups" :key="group.kind">
          <div class="region-head group"><span>{{ group.title }}</span><span class="count">{{ group.list.length }}</span></div>
          <div v-for="s in group.list" :key="`f-${s.signal}`" class="row subject followed" :class="{ on: isOn(s), 'is-quiet': s.state === 'quiet' }">
            <button type="button" class="subject-open" :title="s.why" @click="pick(s)">
              <i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>
              <span class="subject-name">{{ s.name }}</span>
              <svg v-if="spark(s)" class="spark" viewBox="0 0 72 22" aria-hidden="true"><polyline class="spark-normal" :points="spark(s).normal" /><polyline class="spark-today" :points="spark(s).today" /></svg>
              <small class="subject-nums" :title="`${spanLabel(s).toLowerCase()} · lo normal en esa ventana`">{{ s.now.total }} · {{ fmt(s.median) }}</small>
            </button>
            <button type="button" class="region-action unfollow" :title="`Dejar de seguir ${s.name}`" :aria-label="`Dejar de seguir ${s.name}`" @click="setFollow(s, false)">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <p v-if="!data && !apiError" class="none">{{ loading || 'Leyendo producción…' }}</p>
        <p v-if="apiError && !data" class="none">{{ apiError }}</p>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ selected ? selected.name : 'Sentinel' }}</span>
        <span v-if="selected" class="count">{{ KIND_LABEL[selected.kind] }} · {{ spanLabel(selected).toLowerCase() }} {{ windowRange(selected) }}</span>
      </div>
      <div class="region-body">
        <div v-if="selected" class="view">
          <p class="verdict" :class="`is-${selected.state}`">
            <i class="dot" :class="`is-${selected.state}`" aria-hidden="true"></i>
            <b>{{ STATE_LABEL[selected.state] }}</b> · {{ selected.why }}
          </p>
          <p v-if="selected.raw !== selected.state && (selected.raw === 'alert' || selected.raw === 'warn')" class="note">
            Ahora mismo daría «{{ STATE_LABEL[selected.raw] }}», pero todavía no se sostuvo: se avisa cuando dura {{ data.rules.sustain }} lecturas seguidas ({{ data.rules.sustain * data.rules.stepMinutes }} min).</p>
          <p v-if="hours(selected) > 1" class="note">Mira las últimas {{ hours(selected) }} horas y no una: es de lo que seguís, y en una hora entra tan poco que no hay con qué comparar.</p>
          <p v-if="selected.shift" class="note">{{ shiftText(selected) }}</p>

          <div class="cards">
            <div class="card-num"><span class="card-label">{{ spanLabel(selected) }}</span><span class="card-value">{{ selected.now.total }}</span>
              <span class="card-what">{{ selected.kind === 'service' ? 'errores en los logs de producción' : selected.kind === 'queue' ? 'trabajos fallidos en la cola' : 'solicitudes que entraron' }}</span></div>
            <div class="card-num"><span class="card-label">Lo normal</span><span class="card-value">{{ fmt(selected.median) }}</span>
              <span class="card-what">casi siempre entre {{ selected.low }} y {{ selected.high }} {{ hours(selected) === 1 ? 'a esta hora' : `en estas ${hours(selected)} horas` }}, en {{ selected.samples?.length || 0 }} días comparables</span></div>
            <div v-if="selected.kind === 'service'" class="card-num"><span class="card-label">Último despliegue a producción</span>
              <template v-if="lastDeployOf(selected.name)">
                <span class="card-value">{{ lastDeployOf(selected.name).version }}</span>
                <span class="card-what">{{ ago(lastDeployOf(selected.name).at) }} · {{ dayClock(lastDeployOf(selected.name).at) }}</span>
              </template>
              <span v-else class="card-what">ninguno en los últimos días</span></div>
            <div v-else-if="!isErrors(selected)" class="card-num"><span class="card-label">Aprobadas · negadas</span><span class="card-value">{{ selected.now.approved }} · {{ selected.now.denied }}</span>
              <span class="card-what">negadas {{ pct(selected.deniedRate) }} de las que terminaron; lo de hoy todavía avanza</span></div>
          </div>

          <section class="chart-box">
            <div class="chart-head">
              <h3>Hoy, hora por hora</h3>
              <span class="legend"><i class="sw today" aria-hidden="true"></i>hoy <i class="sw normal" aria-hidden="true"></i>lo normal (mediana)
                <i class="sw band" aria-hidden="true"></i>casi siempre (días comparables) <i class="sw deploy" aria-hidden="true"></i>despliegue a producción</span>
            </div>
            <svg v-if="chart" class="chart" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${selected.kind === 'service' ? 'Errores' : 'Solicitudes'} por hora de ${selected.name}, hoy contra lo normal`">
              <g class="grid">
                <line v-for="t in chart.ticks" :key="t.v" :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y" />
                <text v-for="t in chart.ticks" :key="`l${t.v}`" :x="PAD.l - 6" :y="t.y + 4" text-anchor="end">{{ t.v }}</text>
                <text v-for="h in chart.hours" :key="`h${h.h}`" :x="h.x" :y="H - 6" text-anchor="middle">{{ h.h }}h</text>
              </g>
              <polygon class="band" :points="chart.band" />
              <polyline class="median" :points="chart.median" />
              <g v-for="m in chart.marks" :key="m.url" class="deploy-mark">
                <line :x1="m.x" :x2="m.x" :y1="PAD.t" :y2="H - PAD.b" />
                <text :x="m.x + 4" :y="PAD.t + 10">{{ repoShort(m.repo) }} {{ m.version }}</text>
              </g>
              <polyline class="today" :points="chart.today" />
              <circle class="now" :cx="chart.lastX" :cy="chart.lastY" r="4"><title>hora en curso: todavía se está llenando</title></circle>
            </svg>
            <p class="chart-note">El último punto es la hora en curso: todavía se está llenando.</p>
          </section>

          <section v-if="selected.samples?.length" class="days">
            <h3>{{ hours(selected) === 1 ? 'Esta misma hora' : `Estas mismas ${hours(selected)} horas` }}, los días comparables</h3>
            <div class="day-bars">
              <div v-for="x in [...selected.samples].reverse()" :key="x.date" class="day-bar" :title="`${x.date}: ${x.n}`">
                <span class="bar" :style="{ height: `${Math.max(4, (x.n / dayBarMax) * 64)}px` }"></span>
                <small>{{ shortDate(x.date) }}</small>
              </div>
              <div class="day-bar today" :title="`hoy: ${selected.now.total}`">
                <span class="bar" :style="{ height: `${Math.max(4, (selected.now.total / dayBarMax) * 64)}px` }"></span>
                <small>hoy</small>
              </div>
            </div>
          </section>
        </div>
        <div v-else class="empty-state">
          <p class="empty-title">Sentinel</p>
          <p>{{ apiError || loading || 'Leyendo producción…' }}</p>
        </div>
      </div>
    </main>

    <section v-if="panelShown" class="panel signals-panel" :style="{ height: `${panelShown}px` }" aria-label="Todas las señales">
      <div class="rsz rsz-edge-top" data-rsz="panel" v-resize="panelResize"></div>
      <nav class="tabs" role="tablist" aria-label="Qué señales">
        <button v-for="t in KIND_TABS" :key="t.id" type="button" role="tab" class="tab" :aria-selected="tableKind === t.id" @click="tableKind = t.id">
          <span>{{ t.label }}</span><span class="count">{{ kindCount(t.id) }}</span>
        </button>
        <div class="region-actions">
          <input v-model="tableQuery" class="input table-search" type="search" placeholder="Filtrar…" aria-label="Filtrar la tabla" />
          <label class="idle-check" title="Las que a esta hora no tienen movimiento: lo normal es 0 y hoy tampoco entró nada">
            <input v-model="showIdle" type="checkbox" /> sin movimiento
          </label>
          <button ref="panelMaxButton" type="button" class="region-action"></button>
          <button type="button" class="region-action" title="Cerrar la tabla" aria-label="Cerrar la tabla" @click="togglePanel">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </nav>
      <div class="region-body table-wrap">
        <table class="table signals">
          <thead>
            <tr>
              <th :aria-sort="ariaSort('state')"><button type="button" class="th-sort" @click="sortOn('state')">Estado</button></th>
              <th :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortOn('name')">Señal</button></th>
              <th :aria-sort="ariaSort('kind')"><button type="button" class="th-sort" @click="sortOn('kind')">Tipo</button></th>
              <th class="num" :aria-sort="ariaSort('now')"><button type="button" class="th-sort" @click="sortOn('now')">Última hora</button></th>
              <th class="num" :aria-sort="ariaSort('median')"><button type="button" class="th-sort" @click="sortOn('median')">Lo normal</button></th>
              <th class="num">Casi siempre</th>
              <th class="num" :aria-sort="ariaSort('z')"><button type="button" class="th-sort" @click="sortOn('z')">z</button></th>
              <th class="num">Aprob. · neg.</th>
              <th class="follow-col"><span class="sr-only">Seguir</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in tableRows" :key="`t-${s.signal}`" :class="{ on: isOn(s) }" :title="s.why" @click="pick(s)">
              <td><i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>{{ STATE_LABEL[s.state] }}</td>
              <td class="name-cell">{{ s.name }}</td>
              <td class="muted">{{ TABLE_KIND[s.kind] }}</td>
              <td class="num">{{ s.now.total }}<small v-if="hours(s) > 1" class="muted">{{ spanShort(s) }}</small></td>
              <td class="num">{{ fmt(s.median) }}</td>
              <td class="num muted">{{ s.low }}–{{ s.high }}</td>
              <td class="num">{{ s.z ? s.z.toFixed(1) : '·' }}</td>
              <td class="num muted">{{ isErrors(s) ? '' : `${s.now.approved} · ${s.now.denied}` }}</td>
              <td class="follow-col">
                <button v-if="canFollow(s)" type="button" class="region-action" :class="{ following: isFollowed(s) }"
                        :aria-pressed="isFollowed(s)" :title="isFollowed(s) ? `Dejar de seguir ${s.name}` : `Seguir ${s.name}`"
                        :aria-label="isFollowed(s) ? `Dejar de seguir ${s.name}` : `Seguir ${s.name}`" @click.stop="setFollow(s, !isFollowed(s))">
                  <span class="ui-icon" :data-icon="isFollowed(s) ? 'check' : 'plus'" aria-hidden="true"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="data && !tableRows.length" class="none">Nada con ese filtro.</p>
      </div>
    </section>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="Alertas y despliegues">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>Para mirar</span>
        <span class="count">{{ attention.length }}</span>
      </div>
      <div class="region-body">
        <p v-if="data && !attention.length" class="none">Nada fuera de lo normal en la última hora.</p>
        <button v-for="s in attention" :key="`a-${s.signal}`" type="button" class="row stacked attention-row" :class="`is-${s.state}`" @click="pick(s)">
          <span><i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>{{ s.name }} <small class="muted">· {{ KIND_LABEL[s.kind].toLowerCase() }}</small></span>
          <small class="row-desc">{{ s.why }}</small>
        </button>

        <div class="region-head group"><span>Avisos</span><span class="count">{{ data?.notices?.length || 0 }}</span></div>
        <p v-if="data && !data.notices?.length" class="none">Ninguno todavía. Avisa macOS cuando algo pasa a alerta, una vez por episodio, y cuando vuelve.</p>
        <button v-for="n in data?.notices || []" :key="`${n.at}-${n.signal}`" type="button" class="row stacked" :title="n.text" @click="pickSignal(n.signal)">
          <span><i class="dot" :class="`is-${NOTICE_DOT[n.level]}`" aria-hidden="true"></i>{{ NOTICE_LABEL[n.level] }} · {{ n.name }}</span>
          <small class="row-desc">{{ dayClock(n.at) }}{{ n.sent ? '' : ' · no salió' }} · {{ n.text }}</small>
        </button>

        <div class="region-head group"><span>Despliegues a producción</span><span class="count">{{ data?.deploys?.length || 0 }}</span></div>
        <p v-if="data && !data.deploys?.length" class="none">Ninguno en los últimos días.</p>
        <a v-for="d in data?.deploys || []" :key="d.url" class="row stacked" :href="d.url" target="_blank" rel="noopener">
          <span><i class="dot" :class="d.ok ? 'is-ok' : 'is-alert'" aria-hidden="true"></i>{{ repoShort(d.repo) }} <b>{{ d.version }}</b></span>
          <small class="row-desc">{{ dayClock(d.at) }} · {{ d.title }}</small>
        </a>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="data">{{ data.source }} · leído a las {{ clock(data.checkedAt) }} ({{ fmt(data.seconds) }} s) · {{ data.history.days }} días guardados desde el {{ data.history.from }}</span>
      <span v-else>{{ apiError || 'leyendo producción…' }}</span>
      <span v-if="apiError && data" class="statusbar-item warn-text">{{ apiError }}</span>
      <span v-if="loading && data" class="statusbar-item">{{ loading }}</span>
      <span v-else-if="stale" class="statusbar-item">lo guardado de las {{ clock(data.checkedAt) }}; leyendo lo de ahora…</span>
      <button type="button" class="statusbar-item linkish" :disabled="running" @click="refresh">{{ running ? 'leyendo…' : 'leer ahora' }}</button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar la lista" aria-label="Mostrar u ocultar la lista" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!panelShown" title="Mostrar u ocultar la tabla de señales" aria-label="Mostrar u ocultar la tabla de señales" @click="togglePanel">
          <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar las alertas" aria-label="Mostrar u ocultar las alertas" @click="toggleAux">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.search { padding: 0 var(--space-3) var(--space-2) }
.search .input { width: 100%; box-sizing: border-box }
.none { margin: 0; padding: var(--space-3); color: var(--fg-2); font-size: var(--text-sm) }
.count.attention { color: var(--sentinel-warn) }
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3); margin-right: 6px; vertical-align: 1px }
.dot.is-alert { background: var(--sentinel-alert) }
.dot.is-warn { background: var(--sentinel-warn) }
.dot.is-ok { background: var(--sentinel-ok) }
.dot.is-quiet { background: color-mix(in oklab, var(--fg-3) 60%, transparent) }
.subject { display: flex; align-items: center; gap: 2px }
.subject-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.subject-nums { flex: none; color: var(--fg-3); font-variant-numeric: tabular-nums }
.subject.is-quiet .subject-name { color: var(--fg-2) }
.subject-kind { flex: none; color: var(--fg-3); font-size: var(--text-xs) }
/* Una fila que se sigue: abrirla es la fila entera; dejar de seguirla, la ✕ que aparece al pasar. */
.followed, .suggestion { padding-right: var(--space-1) }
.subject-open { display: flex; flex: 1; min-width: 0; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer }
.followed .unfollow { visibility: hidden }
.followed:hover .unfollow, .followed:focus-within .unfollow { visibility: visible }
.spark { flex: none; width: 72px; height: 22px }
.spark-normal { fill: none; stroke: var(--fg-3); stroke-width: 1; stroke-dasharray: 2 2 }
.spark-today { fill: none; stroke: var(--primary); stroke-width: 1.5; stroke-linejoin: round }

.signals-panel { display: flex; flex-direction: column }
.table-wrap { flex: 1; min-height: 0; overflow: auto }
.table-search { width: 160px; height: var(--control-xs) }
.idle-check { display: inline-flex; align-items: center; gap: 4px; padding: 0 var(--space-2); font-size: var(--text-sm); color: var(--fg-2); white-space: nowrap }
.signals thead th { position: sticky; top: 0; z-index: 1; background: var(--region-bg, var(--background)) }
.signals th, .signals td { white-space: nowrap }
.signals tbody tr { cursor: pointer }
.signals tbody tr:hover td { background: var(--hover) }
.signals .name-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.th-sort { padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer }
th[aria-sort="ascending"] .th-sort::after { content: ' ↑' }
th[aria-sort="descending"] .th-sort::after { content: ' ↓' }
.follow-col { width: 36px; text-align: right }
.region-action.following { color: var(--primary) }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0) }

.view { display: flex; flex-direction: column; gap: var(--space-6); padding: var(--space-6); max-width: 980px }
.verdict { margin: 0; display: flex; align-items: center; gap: 4px; font-size: var(--text-body); color: var(--fg-2) }
.verdict b { color: var(--foreground) }
.verdict.is-alert b { color: var(--sentinel-alert) }
.verdict.is-warn b { color: var(--sentinel-warn) }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-3) }
.card-num { display: flex; flex-direction: column; gap: 2px; padding: var(--space-3) var(--space-4); border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px); background: var(--card) }
.card-label { font-size: var(--text-xs); font-weight: 600; color: var(--fg-3); text-transform: uppercase; letter-spacing: .04em }
.card-value { font-size: calc(var(--text-title) * 1.5); font-weight: 600; font-variant-numeric: tabular-nums }
.card-what { font-size: var(--text-sm); color: var(--fg-2) }

.chart-box, .days { display: flex; flex-direction: column; gap: var(--space-2) }
.chart-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap }
h3 { margin: 0; font-size: var(--text-xs); font-weight: 600; color: var(--fg-3); text-transform: uppercase; letter-spacing: .04em }
.legend { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--text-xs); color: var(--fg-2) }
.sw { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-left: 6px }
.sw.today { background: var(--primary) }
.sw.normal { background: var(--fg-3) }
.sw.band { height: 10px; background: color-mix(in oklab, var(--fg-3) 25%, transparent) }
.sw.deploy { width: 2px; height: 10px; background: var(--sentinel-warn) }
.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: calc(var(--radius) + 4px); background: var(--card) }
.chart .grid line { stroke: var(--border); stroke-width: 1 }
.chart .grid text { fill: var(--fg-3); font-size: 10px }
.chart .band { fill: color-mix(in oklab, var(--fg-3) 18%, transparent); stroke: none }
.chart .median { fill: none; stroke: var(--fg-3); stroke-width: 1.5; stroke-dasharray: 4 4 }
.chart .today { fill: none; stroke: var(--primary); stroke-width: 2.5; stroke-linejoin: round }
.chart .now { fill: var(--card); stroke: var(--primary); stroke-width: 2 }
.chart .deploy-mark line { stroke: var(--sentinel-warn); stroke-width: 1.5; stroke-dasharray: 2 3 }
.chart .deploy-mark text { fill: var(--sentinel-warn); font-size: 10px }
.chart-note { margin: 0; font-size: var(--text-xs); color: var(--fg-3) }
.day-bars { display: flex; align-items: flex-end; gap: var(--space-3); height: 90px; padding: var(--space-2) 0 }
.day-bar { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--fg-3) }
.day-bar .bar { width: 28px; border-radius: 4px 4px 0 0; background: color-mix(in oklab, var(--fg-3) 35%, transparent) }
.day-bar.today .bar { background: var(--primary) }
.day-bar.today small { color: var(--foreground); font-weight: 600 }

.attention-row .row-desc { white-space: normal }
.note { margin: calc(var(--space-3) * -1) 0 0; font-size: var(--text-sm); color: var(--fg-2) }
.muted { color: var(--fg-3) }
.linkish { border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-decoration: underline }
.linkish:disabled { cursor: default; text-decoration: none; color: var(--fg-3) }
.empty-state { padding: var(--space-6) }
.empty-title { margin: 0 0 var(--space-2); font-size: var(--text-title); font-weight: 600 }
</style>
