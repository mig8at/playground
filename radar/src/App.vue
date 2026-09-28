<script setup>
/* radar · la interfaz. Muestra las MISMAS cuatro vistas que la consola (`make radar-*`), que salen de la
 * API en Go: acá no se calcula nada, se pinta. La vista, el período y la sesión elegida viven en la URL. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const VIEWS = [
  { id: 'usage', label: 'Uso', hint: 'qué herramientas se usan de verdad' },
  { id: 'friction', label: 'Fricción', hint: 'lo que no terminó bien' },
  { id: 'drift', label: 'Deriva', hint: 'lo documentado contra lo usado, con fechas' },
  { id: 'sessions', label: 'Sesiones', hint: 'cada sesión y su recorrido' },
]
const PERIODS = [7, 30, 90]
const DEFAULTS = { days: 30 }

// ── la ruta: #/<vista>?days=30&session=<id> ──
const route = readHashRoute()
const view = ref(VIEWS.some((v) => v.id === route.parts[0]) ? route.parts[0] : 'usage')
const days = ref(PERIODS.includes(Number(route.params.get('days'))) ? Number(route.params.get('days')) : DEFAULTS.days)
const sessionId = ref(route.params.get('session') || '')
function writeRoute(push) {
  setRoute(hashRoute([view.value], { days: days.value, session: sessionId.value }, DEFAULTS), { push })
}
function onHashChange() {
  const r = readHashRoute()
  if (VIEWS.some((v) => v.id === r.parts[0])) view.value = r.parts[0]
  days.value = PERIODS.includes(Number(r.params.get('days'))) ? Number(r.params.get('days')) : DEFAULTS.days
  sessionId.value = r.params.get('session') || ''
}

// ── los datos ──
const data = ref(null)
const loading = ref(false)
const error = ref('')
const reread = ref(null) // cuántas transcripciones leyó de nuevo el último pedido
const skipped = ref(0) // corridas automáticas que quedaron afuera
async function getJSON(path) {
  const res = await fetch(path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  reread.value = Number(res.headers.get('X-Radar-Read') ?? 0)
  skipped.value = Number(res.headers.get('X-Radar-Skipped') ?? 0)
  return body
}
// Al cambiar de vista se limpia lo anterior: los datos de «Uso» leídos como «Fricción» se pintaban como
// «nada en el período». Y sólo se acepta la respuesta del ÚLTIMO pedido, para que una lenta no pise a otra.
let requestSeq = 0
async function load() {
  const seq = ++requestSeq
  const path = `/api/${view.value}?days=${days.value}`
  data.value = null
  loading.value = true
  error.value = ''
  try {
    const body = await getJSON(path)
    if (seq === requestSeq) data.value = body
  } catch (e) {
    if (seq === requestSeq) error.value = `No se pudo leer: ${e.message}. ¿Está la API arriba? (make radar levanta las dos partes)`
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}
const session = ref(null)
const sessionError = ref('')
async function loadSession() {
  session.value = null
  sessionError.value = ''
  if (!sessionId.value) return
  try {
    session.value = await getJSON(`/api/session?id=${encodeURIComponent(sessionId.value)}&days=${days.value}`)
  } catch (e) {
    sessionError.value = e.message
  }
}
watch([view, days], () => { writeRoute(false); load() })
watch(sessionId, () => { writeRoute(true); loadSession() })

function pick(v) { view.value = v }
function pickSession(id) { sessionId.value = id; panelOpen.value = true; saveSize('radar.panel-open', 1) }
function closeSession() { sessionId.value = '' }

// ── lo que se muestra de cada vista ──
const groups = computed(() => {
  const d = data.value
  if (!d) return []
  switch (view.value) {
    case 'usage': return [
      { title: 'Targets de make', rows: d.make },
      { title: 'Skills cargadas', rows: d.skills },
      { title: 'Subagentes', rows: d.agents },
      { title: 'Conectores (pg) y MCP', rows: d.other },
    ]
    case 'friction': return [
      { title: 'Pidió aprobación y no la tuvo', rows: d.denied },
      { title: 'Miguel dijo que no', rows: d.rejected },
      { title: 'Lo frenó un hook', rows: d.blocked },
      { title: 'Terminó en error', rows: d.errors },
    ]
    case 'drift': return [
      { title: 'Se siguieron invocando después de salir del Makefile', rows: d.usedAfterRemoval },
      { title: 'Invocados sin haber existido nunca en el Makefile', rows: d.neverExisted },
      { title: 'Nombres viejos que se siguen usando', rows: d.oldNames },
    ]
    default: return []
  }
})
const sessions = computed(() => (view.value === 'sessions' && Array.isArray(data.value) ? data.value : []))
const total = computed(() => {
  if (view.value === 'sessions') return sessions.value.length
  return groups.value.reduce((n, g) => n + (g.rows?.length || 0), 0)
})
const currentView = computed(() => VIEWS.find((v) => v.id === view.value))

// ── fechas ──
const fmtDay = (t) => (t ? new Date(t).toLocaleDateString('es-CO', { day: 'numeric', month: 'numeric' }) : '')
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '')
const fmtFull = (t) => (t ? new Date(t).toLocaleString('es-CO') : '')
const MARKS = { ok: '', denied: 'pidió aprobación', rejected: 'rechazada', blocked: 'frenada', error: 'error' }

// ── las regiones, con el contrato de la base: se guarda lo que eligió la persona, se pinta con fitRegions ──
const sidebarOpen = ref(readSize('radar.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('radar.sidebar-w', 260))
const panelOpen = ref(readSize('radar.panel-open', 1) !== 0)
const panelH = ref(readSize('radar.panel-h', 280))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const [sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  const [panel] = fitRegions(viewportH.value - 200, [
    { size: panelOpen.value && sessionId.value ? panelH.value : 0, min: cssSize('--panel-min', 124) },
  ])
  return { sidebar, panel }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--panel-h': `${shown.value.panel}px` }))
const sidebarResize = {
  label: 'Ancho de las vistas', sign: 1, defaultValue: 260,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('radar.sidebar-open', v ? 1 : 0); if (v) saveSize('radar.sidebar-w', sidebarW.value) },
}
const panelResize = {
  label: 'Alto del recorrido', axis: 'y', sign: -1, defaultValue: 280,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('radar.panel-open', v ? 1 : 0); if (v) saveSize('radar.panel-h', panelH.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('radar.sidebar-open', sidebarOpen.value ? 1 : 0) }
function togglePanel() { panelOpen.value = !shown.value.panel; saveSize('radar.panel-open', panelOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  writeRoute(false)
  load()
  loadSession()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Vistas">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head"><span>Vistas</span></div>
      <div class="region-body">
        <button v-for="v in VIEWS" :key="v.id" type="button" class="row stacked" :class="{ on: v.id === view }"
          :aria-current="v.id === view ? 'page' : undefined" @click="pick(v.id)">
          <span>{{ v.label }}</span>
          <span class="row-desc">{{ v.hint }}</span>
        </button>
        <div class="region-head group"><span>Período</span></div>
        <div class="period toggle-group" role="group" aria-label="Período">
          <button v-for="p in PERIODS" :key="p" type="button" class="toggle toggle-sm" :aria-pressed="p === days" @click="days = p">
            {{ p }} días
          </button>
        </div>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ currentView.label }}</span>
        <span v-if="!loading && data" class="count">{{ total }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Volver a leer" aria-label="Volver a leer" @click="load">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <div v-if="error" class="alert alert-destructive" role="alert">
          <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
          <div class="alert-title">{{ error }}</div>
        </div>
        <div v-else-if="loading || !data" class="empty"><div class="empty-desc">Leyendo las transcripciones…</div></div>

        <template v-else-if="view === 'sessions'">
          <table class="table">
            <thead><tr><th>Empezó</th><th class="num">Llamadas</th><th class="num">Fricción</th><th>Skills</th><th>Cómo se lanzó</th></tr></thead>
            <tbody>
              <tr v-for="s in sessions" :key="s.id" :aria-selected="s.id === sessionId" tabindex="0" class="clickable"
                @click="pickSession(s.id)" @keydown.enter="pickSession(s.id)">
                <td :title="s.id">{{ fmtFull(s.start) }}</td>
                <td class="num">{{ s.calls }}</td>
                <td class="num" :class="{ hot: s.friction }">{{ s.friction || '' }}</td>
                <td class="muted">{{ (s.skills || []).join(' · ') }}</td>
                <td class="muted">{{ s.entrypoint }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="!sessions.length" class="empty"><div class="empty-desc">No hay sesiones en el período.</div></div>
        </template>

        <template v-else-if="data">
          <div v-if="view === 'friction'" class="alert" role="note">
            <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
            <div class="alert-desc">Un permiso aprobado no deja marca en la transcripción, así que acá no aparece: sólo lo negado, lo rechazado, lo frenado y lo que falló.</div>
          </div>
          <section v-for="g in groups" :key="g.title">
            <div class="region-head group"><span>{{ g.title }}</span><span class="count">{{ g.rows?.length || 0 }}</span></div>
            <table v-if="g.rows?.length" class="table">
              <thead><tr><th class="num">Llamadas</th><th>Herramienta</th><th class="num">Sesiones</th><th>Última</th><th>Nota</th></tr></thead>
              <tbody>
                <tr v-for="r in g.rows" :key="r.key">
                  <td class="num">{{ r.calls }}</td>
                  <td :title="r.example || ''"><code>{{ r.key }}</code></td>
                  <td class="num">{{ r.sessions }}</td>
                  <td class="nowrap" :title="fmtFull(r.last)">{{ fmtDay(r.last) }}</td>
                  <td class="muted">{{ r.note }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="none">Nada en el período.</p>
          </section>
          <template v-if="view === 'drift'">
            <div class="region-head group"><span>Documentados sin ninguna llamada</span><span class="count">{{ data.unusedTargets?.length || 0 }}</span></div>
            <p class="none">Una señal, no un veredicto: los que abre Miguel —tablero, panel, visor— no pasan por el agente.</p>
            <table v-if="data.unusedTargets?.length" class="table">
              <thead><tr><th>Target</th><th>Existe desde</th></tr></thead>
              <tbody><tr v-for="u in data.unusedTargets" :key="u.target"><td><code>make {{ u.target }}</code></td><td class="nowrap">{{ fmtDay(u.since) }}</td></tr></tbody>
            </table>
            <div class="region-head group"><span>Skills que no se cargaron</span><span class="count">{{ data.unusedSkills?.length || 0 }}</span></div>
            <p class="none">{{ data.unusedSkills?.length ? data.unusedSkills.join(' · ') : 'Todas se cargaron al menos una vez.' }}</p>
          </template>
        </template>
      </div>
    </main>

    <section v-if="shown.panel" class="panel" aria-label="Recorrido de la sesión">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <div class="region-head">
        <span>Recorrido</span>
        <span v-if="session" class="count">{{ session.calls.length }}</span>
        <span v-if="session" class="muted head-note">{{ fmtFull(session.start) }} · {{ session.entrypoint }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Cerrar el recorrido" aria-label="Cerrar el recorrido" @click="closeSession">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <p v-if="sessionError" class="none">{{ sessionError }}</p>
        <div v-for="(c, i) in session?.calls || []" :key="i" class="log-line" :data-outcome="c.outcome">
          <span class="log-time">{{ fmtTime(c.time) }}</span>
          <span class="tool">{{ c.tool }}</span>
          <span class="what">{{ c.command || c.keys.join(' · ') }}</span>
          <span v-if="c.outcome !== 'ok'" class="badge badge-outline mark">{{ MARKS[c.outcome] }}<template v-if="c.hook"> · {{ c.hook }}</template></span>
        </div>
      </div>
    </section>

    <footer class="statusbar">
      <span>{{ days }} días</span>
      <span v-if="skipped" title="Sesiones donde nadie escribió (claude -p, bancos de prueba): no cuentan">sin {{ skipped }} corridas automáticas</span>
      <span v-if="reread !== null" title="Transcripciones que cambiaron desde la última lectura">{{ reread }} leídas de nuevo</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las vistas" aria-label="Mostrar u ocultar las vistas" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" :disabled="!sessionId" title="Mostrar u ocultar el recorrido" aria-label="Mostrar u ocultar el recorrido" @click="togglePanel">
          <span class="ui-icon" data-icon="bottom" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Todo lo demás —bandas, filas, tabla, grupos, avisos, líneas, pie— es de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.period { padding: var(--space-2) var(--gutter) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.muted { color: var(--fg-3) }
.head-note { font-size: var(--text-sm); margin-left: var(--space-2) }
.clickable { cursor: pointer }
.nowrap { white-space: nowrap }
.hot { color: var(--outcome-error) }
.alert { margin: var(--space-2) var(--gutter) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .tool { color: var(--fg-3); min-width: 56px }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-sm) }
.log-line[data-outcome="denied"] .mark { color: var(--outcome-denied) }
.log-line[data-outcome="blocked"] .mark, .log-line[data-outcome="error"] .mark, .log-line[data-outcome="rejected"] .mark { color: var(--outcome-error) }
</style>
