<script setup>
/* keyring · la interfaz. Muestra las MISMAS filas que la consola (`make keyring`), que salen de la API en
 * Go: acá no se prueba nada, se pinta. Pide los grupos a la vez y pinta cada uno cuando llega, porque la
 * red contesta en milisegundos y una base sin VPN tarda hasta el tope. El grupo elegido y el filtro viven
 * en la URL. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const ALL = 'all'
const STATE_LABEL = { ok: 'ok', warn: 'vence pronto', fail: 'falla', off: 'no aplica' }
const STATE_RANK = { fail: 0, warn: 1, ok: 2, off: 3 }

// ── la ruta: #/<grupo>?failing=1 ──
const route = readHashRoute()
const selected = ref(route.parts[0] || ALL)
const failingOnly = ref(route.params.get('failing') === '1')
function writeRoute(push) {
  setRoute(hashRoute([selected.value], { failing: failingOnly.value ? 1 : 0 }, { failing: 0 }), { push })
}
function onHashChange() {
  const r = readHashRoute()
  selected.value = r.parts[0] || ALL
  failingOnly.value = r.params.get('failing') === '1'
}

// ── los datos: la lista de grupos, y las filas de cada uno según van llegando ──
const groups = ref([])
const rows = ref({}) // grupo → filas
const pending = ref({}) // grupo → true mientras se prueba
const errors = ref({}) // grupo → mensaje
const checkedAt = ref(null)
const apiError = ref('')

async function getJSON(path) {
  const res = await fetch(path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}
async function loadGroup(id) {
  pending.value = { ...pending.value, [id]: true }
  try {
    const body = await getJSON(`/api/checks?group=${encodeURIComponent(id)}`)
    rows.value = { ...rows.value, [id]: body }
    errors.value = { ...errors.value, [id]: '' }
  } catch (e) {
    errors.value = { ...errors.value, [id]: e.message }
  } finally {
    pending.value = { ...pending.value, [id]: false }
  }
}
async function loadAll() {
  apiError.value = ''
  try {
    if (!groups.value.length) groups.value = await getJSON('/api/groups')
  } catch (e) {
    apiError.value = `No se pudo leer: ${e.message}. ¿Está la API arriba? (make keyring-ui levanta las dos partes)`
    return
  }
  // Siempre todos: el lateral resume cada grupo aunque se esté mirando uno.
  await Promise.all(groups.value.map((g) => loadGroup(g.id)))
  checkedAt.value = new Date()
}
const anyPending = computed(() => Object.values(pending.value).some(Boolean))

// ── lo que se muestra ──
function worst(list) {
  if (!list?.length) return null
  return list.reduce((w, r) => (STATE_RANK[r.state] < STATE_RANK[w] ? r.state : w), 'off')
}
const sidebarRows = computed(() => groups.value.map((g) => {
  const list = rows.value[g.id] || []
  const ok = list.filter((r) => r.state === 'ok').length
  const live = list.filter((r) => r.state !== 'off').length
  return { ...g, state: worst(list), summary: list.length ? `${ok}/${live}` : '', pending: !!pending.value[g.id] }
}))
const allState = computed(() => worst(Object.values(rows.value).flat()))
const visibleGroups = computed(() => {
  const chosen = selected.value === ALL ? groups.value : groups.value.filter((g) => g.id === selected.value)
  return chosen.map((g) => {
    const list = rows.value[g.id] || []
    const shown = failingOnly.value ? list.filter((r) => r.state === 'fail' || r.state === 'warn') : list
    return { ...g, rows: shown, total: list.length, pending: !!pending.value[g.id], error: errors.value[g.id] }
  }).filter((g) => !(failingOnly.value && selected.value === ALL && !g.rows.length && !g.pending && !g.error))
})
const shownCount = computed(() => visibleGroups.value.reduce((n, g) => n + g.rows.length, 0))
// El total es el del grupo elegido, sin filtro: con el filtro puesto el encabezado dice «2 / 31», no «2 / 3».
const totalCount = computed(() => (selected.value === ALL ? groups.value : groups.value.filter((g) => g.id === selected.value))
  .reduce((n, g) => n + (rows.value[g.id]?.length || 0), 0))
const counts = computed(() => {
  const c = { ok: 0, warn: 0, fail: 0, off: 0 }
  for (const r of Object.values(rows.value).flat()) c[r.state]++
  return c
})
const title = computed(() => (selected.value === ALL ? 'Todo' : groups.value.find((g) => g.id === selected.value)?.label || selected.value))

// El vencimiento se relee cada 30 s: «vence en 40′» no puede quedar congelado mientras la pestaña está abierta.
const now = ref(Date.now())
let clock = null
function until(t) {
  const d = new Date(t).getTime() - now.value
  const abs = Math.abs(d)
  const mins = Math.floor(abs / 60000)
  const text = mins < 60 ? `${mins}′` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${Math.floor(mins / 1440)}d`
  return d <= 0 ? `venció hace ${text}` : `en ${text}`
}
const soon = (t) => { const d = new Date(t).getTime() - now.value; return d > 0 && d < 3600000 }
const fmtFull = (t) => (t ? new Date(t).toLocaleString('es-CO') : '')
const fmtTime = (t) => (t ? t.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '')

function pick(id) { selected.value = id }
function toggleFailing() { failingOnly.value = !failingOnly.value }
watch(selected, () => writeRoute(true))
watch(failingOnly, () => writeRoute(false))

// ── las regiones, con el contrato de la base: se guarda lo que eligió la persona, se pinta con fitRegions ──
const sidebarOpen = ref(readSize('keyring.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('keyring.sidebar-w', 260))
const viewportW = ref(window.innerWidth)
const onWindowResize = () => { viewportW.value = window.innerWidth }
const shown = computed(() => {
  const [sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  return { sidebar }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px` }))
const sidebarResize = {
  label: 'Ancho de los grupos', sign: 1, defaultValue: 260,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('keyring.sidebar-open', v ? 1 : 0); if (v) saveSize('keyring.sidebar-w', sidebarW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('keyring.sidebar-open', sidebarOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  clock = setInterval(() => { now.value = Date.now() }, 30000)
  writeRoute(false)
  loadAll()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearInterval(clock)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Grupos">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head"><span>Grupos</span></div>
      <div class="region-body">
        <button type="button" class="row" :class="{ on: selected === 'all' }" :aria-current="selected === 'all' ? 'page' : undefined" @click="pick('all')">
          <i class="dot" :data-state="allState" aria-hidden="true"></i>
          <span>Todo</span>
          <span class="row-meta">{{ counts.fail ? `${counts.fail} fallan` : '' }}</span>
        </button>
        <button v-for="g in sidebarRows" :key="g.id" type="button" class="row" :class="{ on: g.id === selected }"
          :aria-current="g.id === selected ? 'page' : undefined" @click="pick(g.id)">
          <i class="dot" :data-state="g.pending ? 'pending' : g.state" aria-hidden="true"></i>
          <span class="label">{{ g.label }}</span>
          <span class="row-meta" :title="g.summary ? 'con acceso / que aplican' : ''">{{ g.pending ? '…' : g.summary }}</span>
        </button>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ title }}</span>
        <span class="count" :class="{ filtered: failingOnly }">{{ failingOnly ? `${shownCount} / ${totalCount}` : totalCount }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" :aria-pressed="failingOnly"
            :title="failingOnly ? 'Mostrar todo' : 'Mostrar sólo lo que falla o vence pronto'"
            :aria-label="failingOnly ? 'Mostrar todo' : 'Mostrar sólo lo que falla o vence pronto'" @click="toggleFailing">
            <span class="ui-icon" data-icon="filter" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" :disabled="anyPending" title="Volver a probar" aria-label="Volver a probar" @click="loadAll">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <div v-if="apiError" class="alert alert-destructive" role="alert">
          <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
          <div class="alert-title">{{ apiError }}</div>
        </div>
        <section v-for="g in visibleGroups" v-else :key="g.id">
          <div class="region-head group">
            <span>{{ g.label }}</span>
            <span class="count">{{ g.pending && !g.total ? 'probando…' : g.rows.length }}</span>
          </div>
          <p v-if="g.error" class="none hot">{{ g.error }}</p>
          <p v-else-if="g.pending && !g.total" class="none">Probando{{ g.quick ? '' : ' (hasta 12 s sin VPN)' }}…</p>
          <table v-else-if="g.rows.length" class="table">
            <thead><tr><th>Estado</th><th>Acceso</th><th>Qué contestó</th><th>Vence</th><th class="num">ms</th></tr></thead>
            <tbody>
              <tr v-for="r in g.rows" :key="r.name" :data-state="r.state">
                <td class="nowrap"><i class="dot" :data-state="r.state" aria-hidden="true"></i> <span class="state">{{ STATE_LABEL[r.state] }}</span></td>
                <td class="nowrap">{{ r.name }}</td>
                <td class="detail">{{ r.detail }}</td>
                <td class="nowrap" :class="{ soon: r.expires && soon(r.expires), hot: r.expires && r.state === 'fail' }"
                  :title="r.expires ? fmtFull(r.expires) : ''">{{ r.expires ? until(r.expires) : '—' }}</td>
                <td class="num">{{ r.ms }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="none">{{ failingOnly ? 'Nada falla acá.' : 'Sin filas.' }}</p>
        </section>
      </div>
    </main>

    <footer class="statusbar">
      <span v-if="checkedAt" :title="fmtFull(checkedAt)">probado a las {{ fmtTime(checkedAt) }}</span>
      <span>{{ counts.ok }} ok · {{ counts.warn }} por vencer · {{ counts.fail }} fallan · {{ counts.off }} no aplican</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar los grupos" aria-label="Mostrar u ocultar los grupos" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Todo lo demás —bandas, filas, tabla, grupos, avisos, pie— es de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.nowrap { white-space: nowrap }
.alert { margin: var(--space-2) var(--gutter) }
.label { flex: 1; min-width: 0 }
/* lo que contestó es lo que se lee: se parte en renglones antes que empujar las demás columnas afuera */
.detail { width: 100%; overflow-wrap: anywhere; color: var(--fg-2) }
.state { color: var(--fg-2) }
.hot { color: var(--access-fail) }
.soon { color: var(--access-warn) }
/* El estado es un punto (un <i>: la base estira todo <span> de una fila): la forma no cambia, sólo el color, y el texto de al lado lo dice para quien no lo ve. */
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--access-off) }
.dot[data-state="ok"] { background: var(--access-ok) }
.dot[data-state="warn"] { background: var(--access-warn) }
.dot[data-state="fail"] { background: var(--access-fail) }
.dot[data-state="pending"] { background: transparent; box-shadow: inset 0 0 0 1px var(--access-off) }
tr[data-state="off"] td { color: var(--fg-3) }
</style>
