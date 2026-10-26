<script setup>
/* tests · la interfaz. Se escribe el celular del cliente de prueba (también sirve la URL del wizard o el número de la
 * solicitud y dice, contra local o qa: de qué comercio y sucursal viene, qué mandó la tienda, a qué usuario
 * quedó pegada y con qué datos, y por qué estados pasó.
 *
 * Todo sale de la API en Go (`tests/server`): acá no se calcula nada, se pinta. Lo único que escribe es la
 * basura (borrar una solicitud de prueba y lo que cuelga), y las guardas viven en el servidor (delete.go). Los avisos
 * («la tienda mandó otro nombre», «el celular lo tienen dos usuarios») también los arma el servidor.
 * El ambiente y la búsqueda viven en la URL; el tamaño de las regiones, en el navegador. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, bindMenu,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const DEFAULT_TARGET = 'qa'
const TARGET_LABEL = { local: 'local · tu Docker', qa: 'qa · la base compartida de dev, qa y staging' }
// Estados finales: el color del estado en la consola y en la banda.
const FINAL = { 11: 'ok', 5: 'ok', 6: 'fail', 7: 'fail', 8: 'fail' }
const PROFILE = { 1: 'cliente', 2: 'asesor', 3: 'admin' }

// ── la ruta: #/?target=qa&q=3016992677&req=504059 (con celular, `req` dice cuál de sus solicitudes se mira) ──
const route = readHashRoute()
const target = ref(route.params.get('target') || DEFAULT_TARGET)
const query = ref(route.params.get('q') || '')
const req = ref(route.params.get('req') || '')
const draft = ref(query.value)
function writeRoute(push) {
  setRoute(hashRoute([], { target: target.value, q: query.value, req: req.value }, { target: DEFAULT_TARGET, q: '', req: '' }), { push })
}
function onHashChange() {
  const r = readHashRoute()
  target.value = r.params.get('target') || DEFAULT_TARGET
  const q = r.params.get('q') || ''
  const n = r.params.get('req') || ''
  if (q !== query.value || n !== req.value) { req.value = n; query.value = q; draft.value = q }
}

// ── la búsqueda ──
const result = ref(null)
const editorBody = ref(null)
const error = ref('')
const loading = ref(false)
let seq = 0
async function lookup() {
  if (!query.value) { result.value = null; error.value = ''; return }
  const mine = ++seq
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/lookup?target=${encodeURIComponent(target.value)}&q=${encodeURIComponent(query.value)}&request=${encodeURIComponent(req.value)}`)
    const body = await res.json().catch(() => ({}))
    if (mine !== seq) return
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    result.value = body
    // El campo queda con lo que se buscó, limpio: el celular sin indicativo, el correo en minúsculas.
    const clean = body.input?.phone || body.input?.email || body.input?.document
    if (clean && draft.value !== clean) draft.value = clean
    // Otra solicitud se lee desde arriba: los avisos son lo primero.
    nextTick(() => { if (editorBody.value) editorBody.value.scrollTop = 0 })
  } catch (e) {
    if (mine !== seq) return
    result.value = null
    error.value = e.message === 'Failed to fetch'
      ? 'No contesta la API. ¿Está arriba? (make tests levanta las dos partes)' : e.message
  } finally {
    if (mine === seq) loading.value = false
  }
}
function submit() {
  const q = draft.value.trim()
  if (!q) return
  req.value = ''
  if (q === query.value) lookup(); else query.value = q
}
// Abrir otra solicitud: si se buscó a una persona (celular, correo o cédula), se queda en ella y cambia `req`.
function open(id) {
  if (result.value?.input?.who) { req.value = String(id); return }
  draft.value = String(id)
  query.value = String(id)
}

// ── lo que se pinta ──
const r = computed(() => result.value)
// La tabla de abajo: con celular, todas las de ese número (de todos sus usuarios); si no, las del usuario.
const listed = computed(() => (r.value?.input?.who ? r.value.phoneRequests : r.value?.requests) || [])

const money = (v) => (v === null || v === undefined || v === '' ? '—'
  : `$${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`)
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v)
const stateOf = (id) => FINAL[id] || 'open'

// La consola: el historial y, si el estado de hoy no está en él, una línea más que lo dice.
const lines = computed(() => {
  if (!r.value?.request) return []
  const out = r.value.records.map((x) => ({
    key: x.id, time: x.created_at, id: x.status_id, name: x.status,
    by: x.by_name ? `${x.by_name} (${PROFILE[x.by_profile] || `perfil ${x.by_profile}`})` : x.update_by ? `usuario ${x.update_by}` : '',
    comment: x.comment,
  }))
  const last = out[out.length - 1]
  if (!last || String(last.id) !== String(r.value.request.status_id)) {
    out.push({ key: 'now', time: r.value.request.updated_at, id: r.value.request.status_id, name: r.value.request.status,
      by: 'sin registro en el historial', comment: '', ghost: true })
  }
  return out
})

// ── borrar: la ÚNICA escritura. Una ventana pregunta si de verdad; si era la última solicitud del usuario,
// pregunta además si darlo de baja. El servidor arma el plan y vuelve a comprobar las guardas al borrar ──
const dialog = ref(null)
const del = ref(null) // { request, users, lastOf, plan, loading, error, running }
const deleted = ref(null) // el último borrado, para decirlo arriba del editor
async function loadPlan() {
  const d = del.value
  if (!d) return
  d.loading = true; d.error = ''
  try {
    const res = await fetch(`/api/delete/plan?target=${encodeURIComponent(target.value)}&request=${d.request}&users=${d.users ? 1 : 0}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    if (del.value === d) { d.plan = body; d.lastOf = body.lastOf || d.lastOf }
  } catch (e) {
    if (del.value === d) d.error = e.message
  } finally {
    if (del.value === d) d.loading = false
  }
}
function openDelete(id) {
  del.value = { request: Number(id), users: false, lastOf: '', plan: null, loading: false, error: '', running: false }
  dialog.value?.showModal()
  loadPlan()
}
// Las filas que caen fuera de la solicitud misma y de la baja del usuario.
const otherRows = computed(() => (del.value?.plan?.tables || [])
  .filter((t) => t.table !== 'user_requests' && t.table !== 'users (baja)').reduce((n, t) => n + t.rows, 0))
function closeDelete() { dialog.value?.close(); del.value = null }
function toggleUsers() { if (del.value) { del.value.users = !del.value.users; loadPlan() } }
const canDelete = computed(() => !!(del.value?.plan && !del.value.plan.blocked && !del.value.loading && !del.value.running))
async function runDelete() {
  const d = del.value
  if (!canDelete.value) return
  d.running = true; d.error = ''
  try {
    const res = await fetch('/api/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // La ventana ES la confirmación: el número viaja solo y el servidor lo vuelve a comprobar.
      body: JSON.stringify({ target: target.value, request: d.request, users: d.users, confirm: d.plan.confirm }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    deleted.value = body
    closeDelete()
    if (result.value?.input?.who) { if (req.value) req.value = ''; else lookup() }
    else if (result.value?.request && body.requests.includes(result.value.request.id)) { result.value = null; query.value = ''; draft.value = '' }
    else lookup()
  } catch (e) {
    d.error = e.message
  } finally {
    d.running = false
  }
}

// ── dar de baja a una persona sin pasar por una solicitud: la que no tiene ninguna y estorba (un correo, una
// cédula o un celular tomados). Otra ventana, las mismas reglas en el servidor ──
const userDialog = ref(null)
const baja = ref(null) // { person, purge, running, error }
// Activo: se da de baja (libera correo, celular y cédula). Ya dado de baja: se borra del todo.
function openBaja(person) {
  baja.value = { person, purge: String(person.status) !== '1', running: false, error: '' }
  userDialog.value?.showModal()
}
function closeBaja() { userDialog.value?.close(); baja.value = null }
async function runBaja() {
  const b = baja.value
  if (!b || b.running) return
  b.running = true; b.error = ''
  try {
    const res = await fetch(b.purge ? '/api/user/purge' : '/api/user/disable', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: target.value, user: b.person.id }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    deleted.value = body
    closeBaja()
    lookup()
  } catch (e) {
    b.error = e.message
  } finally {
    if (baja.value === b) b.running = false
  }
}
// La basura va en todo cliente; una cuenta del equipo (administrador, asesor, operaciones…) no se toca acá.
const isClient = (p) => String(p.user_profile_id) === '1'

// ── las tablas de la solicitud que se mira: cuántas filas tiene en cada una. Sólo lee ──
const tables = ref([])
const tablesError = ref('')
// Las filas de cada tabla, para pintarlas en el editor: tabla → { loading, error, data }.
const tableRows = ref({})
async function loadTables() {
  tables.value = []; tablesError.value = ''; tableRows.value = {}
  const id = result.value?.request?.id
  if (!id) return
  try {
    const res = await fetch(`/api/tables?target=${encodeURIComponent(target.value)}&request=${id}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    if (result.value?.request?.id === id) { tables.value = body; body.forEach((t) => loadRows(t.table, id)) }
  } catch (e) {
    tablesError.value = e.message
  }
}
async function loadRows(name, id) {
  tableRows.value = { ...tableRows.value, [name]: { loading: true, error: '', data: null } }
  try {
    const res = await fetch(`/api/table-rows?target=${encodeURIComponent(target.value)}&request=${id}&table=${encodeURIComponent(name)}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    if (result.value?.request?.id === id) tableRows.value = { ...tableRows.value, [name]: { loading: false, error: '', data: body } }
  } catch (e) {
    if (result.value?.request?.id === id) tableRows.value = { ...tableRows.value, [name]: { loading: false, error: e.message, data: null } }
  }
}
watch(() => result.value?.request?.id, loadTables)
const tablesTotal = computed(() => tables.value.reduce((n, t) => n + t.rows, 0))

// ── el sidebar derecho: la consulta de la tabla cuyo título se tocó, para correrla en otro lado ──
const openTable = ref(null) // nombre de la tabla
function showTable(name) { openTable.value = openTable.value === name ? null : name }
const openQuery = computed(() => (openTable.value ? tableRows.value[openTable.value]?.data?.query || '' : ''))
const copied = ref(false)
async function copyQuery() {
  try { await navigator.clipboard.writeText(openQuery.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}
// Otra solicitud u otro ambiente: la consulta abierta era de la anterior.
watch([() => result.value?.request?.id, target], () => { openTable.value = null })
// Las fechas de alta y de cambio de cada fila son ruido para una prueba: no se muestran (la consulta las trae).
const HIDDEN_COLUMNS = new Set(['created_at', 'updated_at'])
const shownColumns = (data) => data.columns.filter((c) => !HIDDEN_COLUMNS.has(c))
const cellText = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v))

// ── el ambiente: el selector del pie ──
const targets = ref(['local', 'qa'])
const targetTrigger = ref(null)
let targetMenu = null
const targetItems = computed(() => targets.value.map((t) => ({ id: t, label: TARGET_LABEL[t] || t, selected: t === target.value })))
watch(targetItems, () => targetMenu?.refresh(), { deep: true, flush: 'post' })

watch(target, () => { deleted.value = null; writeRoute(true); lookup() })
watch([query, req], () => { writeRoute(true); lookup() })

// ── las regiones: las búsquedas a la izquierda y los estados abajo, con el contrato de la base ──
const sidebarOpen = ref(readSize('tests.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('tests.sidebar-w', 300))
const panelOpen = ref(readSize('tests.panel-open', 1) !== 0)
const panelH = ref(readSize('tests.panel-h', 200))
const auxW = ref(readSize('tests.aux-w', 380))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  // Si no entran, se pliega primero el de las búsquedas: el de la derecha es lo que se acaba de abrir.
  const [sidebar, aux] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
    { size: openTable.value ? auxW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  const [panel] = fitRegions(viewportH.value - 200, [
    { size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) },
  ])
  return { sidebar, panel, aux }
})
const layoutVars = computed(() => ({
  '--sidebar-w': `${shown.value.sidebar}px`, '--panel-h': `${shown.value.panel}px`, '--auxiliarybar-w': `${shown.value.aux}px`,
}))
const sidebarResize = {
  label: 'Ancho de las búsquedas', sign: 1, defaultValue: 300,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('tests.sidebar-open', v ? 1 : 0); if (v) saveSize('tests.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho de la consulta', sign: -1, defaultValue: 380,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360) - shown.value.sidebar,
  get: () => shown.value.aux,
  set: (v) => { if (!v) openTable.value = null; else auxW.value = v },
  reopen: () => auxW.value,
  commit: (v) => { if (v) saveSize('tests.aux-w', auxW.value) },
}
const panelResize = {
  label: 'Alto de los estados', axis: 'y', sign: -1, defaultValue: 200,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('tests.panel-open', v ? 1 : 0); if (v) saveSize('tests.panel-h', panelH.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('tests.sidebar-open', sidebarOpen.value ? 1 : 0) }
function togglePanel() { panelOpen.value = !shown.value.panel; saveSize('tests.panel-open', panelOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  targetMenu = bindMenu(targetTrigger.value, {
    label: 'Contra qué base se busca', getItems: () => targetItems.value,
    onSelect: (id) => { target.value = id },
  })
  try { targets.value = await (await fetch('/api/targets')).json() } catch { /* se quedan los de siempre */ }
  lookup()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  themeBinding?.destroy?.()
  targetMenu?.destroy()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Búsquedas">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Solicitudes</span>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="!query || loading" title="Volver a leer" aria-label="Volver a leer" @click="lookup">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <form class="search" @submit.prevent="submit">
          <label class="label" for="q">Celular, correo o cédula</label>
          <div class="input-group">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
            <input id="q" v-model="draft" class="input" placeholder="3016992677 · correo · cédula" autocomplete="off" spellcheck="false" />
          </div>
          <button type="submit" class="btn btn-sm" :disabled="!draft.trim() || loading">{{ loading ? 'Leyendo…' : `Buscar en ${target}` }}</button>
        </form>
        <template v-if="r?.input?.who">
          <div class="region-head group"><span>Personas con {{ r.input.who }}</span><span class="count">{{ r.people.length }}</span></div>
          <div v-for="p in r.people" :key="p.id" class="row person" :title="`${p.document_number} · ${p.email || 'sin correo'} · ${p.cell_phone || 'sin celular'}`">
            <i class="dot" :data-state="String(p.status) === '1' ? 'ok' : 'off'" aria-hidden="true"></i>
            <span class="label">{{ p.name || `usuario ${p.id}` }} <span class="muted">· {{ String(p.status) === '1' ? p.profile : 'dado de baja' }}</span></span>
            <span class="row-meta">{{ p.requests }} sol.</span>
            <span v-if="isClient(p)" class="row-actions">
              <button type="button" class="region-action" :title="`${String(p.status) === '1' ? 'Dar de baja' : 'Borrar del todo'} a ${p.name}`" :aria-label="`${String(p.status) === '1' ? 'Dar de baja' : 'Borrar del todo'} a ${p.name}`" @click.stop="openBaja(p)">
                <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
              </button>
            </span>
          </div>
          <div v-if="r.phoneRequests.length" class="region-head group"><span>Solicitudes</span><span class="count">{{ r.phoneRequests.length }}</span></div>
          <div v-for="q in r.phoneRequests" :key="q.id" class="row" role="button" tabindex="0" :class="{ on: q.id === r.request?.id }"
            :title="`${q.user} · ${q.allied || 'sin comercio'}`" @click="open(q.id)" @keydown.enter="open(q.id)">
            <i class="dot" :data-state="stateOf(q.status_id)" aria-hidden="true"></i>
            <span class="label">{{ q.id }} <span class="muted">· {{ q.status }}</span></span>
            <span class="row-meta">{{ q.allied }}</span>
            <span class="row-actions">
              <button type="button" class="region-action" :title="`Borrar la solicitud ${q.id}`" :aria-label="`Borrar la solicitud ${q.id}`"
                @click.stop="openDelete(q.id)">
                <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
              </button>
            </span>
          </div>
        </template>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ r?.request ? `Solicitud ${r.request.id}` : r ? r.input.who : 'tests' }}</span>
        <span v-if="r?.request && r.input.who" class="count">{{ r.input.who }}</span>
        <span v-if="r?.request" class="count">{{ r.request.status_id }} · {{ r.request.status }}</span>
        <div v-if="r?.request" class="region-actions">
          <button type="button" class="region-action" title="Borrar la solicitud" aria-label="Borrar la solicitud" @click="openDelete(r.request.id)">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div ref="editorBody" class="region-body">
        <div v-if="deleted" class="alert done" data-level="ok">
          <div v-if="!deleted.requests.length && deleted.tables.some((t) => t.table === 'users')" class="alert-desc"><p>Se borró del todo al usuario {{ deleted.users.join(', ') }} ({{ deleted.total }} filas). Copia en <code>{{ deleted.backup }}</code>.</p></div>
          <div v-else-if="!deleted.requests.length" class="alert-desc"><p>Se dio de baja al usuario {{ deleted.users.join(', ') }}: su correo, celular y cédula quedan libres. Copia en <code>{{ deleted.backup }}</code>.</p></div>
          <div v-else class="alert-desc"><p>Se borró {{ deleted.requests.length > 1 ? `las solicitudes ${deleted.requests.join(', ')}` : `la solicitud ${deleted.requests[0]}` }} ({{ deleted.total }} filas en {{ deleted.tables.length }} tablas){{ deleted.users.length ? ` y se dio de baja al usuario ${deleted.users.join(', ')}` : '' }}. Copia en <code>{{ deleted.backup }}</code>.</p></div>
          <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="deleted = null"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
        </div>
        <p v-if="error" class="none hot">{{ error }}</p>
        <p v-else-if="loading && !r" class="none">Leyendo la base de {{ target }}…</p>
        <div v-else-if="!r" class="empty">
          <div class="empty-head">
            <div class="empty-title">Pegá una solicitud</div>
            <div class="empty-desc">Escribí el celular con el que hiciste la prueba (<code>3016992677</code>, los 10 dígitos). Muestra su solicitud más nueva —de qué comercio viene, qué mandó la tienda, a qué usuario quedó pegada y por qué estados pasó— y la lista de todas las de ese número. Contra <b>local</b> o <b>qa</b> (la base compartida de dev, qa y staging). También sirve la URL del wizard o el número de solicitud.</div>
          </div>
        </div>
        <div v-else-if="!r.request" class="empty">
          <div class="empty-head">
            <div class="empty-title">Sin solicitudes</div>
            <div class="empty-desc">{{ r.people.length === 1 ? 'La persona' : `Las ${r.people.length} personas` }} con {{ r.input.who }} no {{ r.people.length === 1 ? 'tiene' : 'tienen' }} solicitudes. Con la basura de la izquierda: a una activa se la da de baja (libera su correo, celular y cédula) y a una ya dada de baja se la borra del todo. Sólo clientes: una cuenta de administrador o de asesor no se toca desde acá.</div>
          </div>
        </div>
        <template v-else>
          <section>
            <div class="region-head group"><span>Tablas de esta solicitud</span><span class="count">{{ tables.length ? `${tablesTotal} filas en ${tables.length} tablas` : '' }}</span></div>
            <p v-if="tablesError" class="none hot">{{ tablesError }}</p>
            <p v-else-if="!tables.length" class="none">Contando…</p>
            <div v-for="t in tables" v-else :key="t.table" class="db-table">
              <!-- El título es un botón: abre a la derecha la consulta que trae estas filas. -->
              <button type="button" class="db-table-head" :class="{ on: openTable === t.table }" :title="`Ver la consulta de ${t.table}`" @click="showTable(t.table)">
                <code>{{ t.table }}</code>
                <span class="count">{{ t.rows }} {{ t.rows === 1 ? 'fila' : 'filas' }}{{ t.table === 'users' ? ' · el usuario de la solicitud: no se borra con ella' : '' }}</span>
                <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
              </button>
              <p v-if="tableRows[t.table]?.loading" class="none">Leyendo…</p>
              <p v-else-if="tableRows[t.table]?.error" class="none hot">{{ tableRows[t.table].error }}</p>
              <div v-else-if="tableRows[t.table]?.data" class="table-scroll">
                <table class="table db">
                  <thead><tr><th v-for="c in shownColumns(tableRows[t.table].data)" :key="c">{{ c }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(row, i) in tableRows[t.table].data.rows" :key="row.id ?? i">
                      <td v-for="c in shownColumns(tableRows[t.table].data)" :key="c" :class="{ muted: row[c] === null }" :title="cellText(row[c])">{{ cellText(row[c]) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="tableRows[t.table]?.data?.truncated" class="none warn">Se muestran las primeras {{ tableRows[t.table].data.rows.length }}.</p>
            </div>
          </section>

          <section v-if="listed.length && !r.input.who">
            <div class="region-head group"><span>{{ r.input.phone ? `Solicitudes del celular ${r.input.phone}` : 'Solicitudes del usuario' }}</span><span class="count">{{ listed.length }}</span></div>
            <table class="table">
              <thead><tr><th>solicitud</th><th v-if="r.input.phone">usuario</th><th>estado</th><th>sucursal</th><th>monto</th><th>creada</th><th></th></tr></thead>
              <tbody>
                <tr v-for="q in listed" :key="q.id" :class="{ on: q.id === r.request.id }">
                  <td><button type="button" class="btn-link" @click="open(q.id)">{{ q.id }}</button></td>
                  <td v-if="r.input.phone" :class="{ muted: Number(q.user_status) !== 1 }" :title="Number(q.user_status) !== 1 ? 'usuario dado de baja' : ''">{{ q.user }}</td>
                  <td><i class="dot" :data-state="stateOf(q.status_id)" aria-hidden="true"></i>{{ q.status_id }} · {{ q.status }}</td>
                  <td><code>{{ dash(q.hash) }}</code></td><td>{{ money(q.amount) }}</td><td>{{ q.created_at }}</td>
                  <td class="cell-action">
                    <button type="button" class="region-action" :title="`Borrar la solicitud ${q.id}`" :aria-label="`Borrar la solicitud ${q.id}`" @click="openDelete(q.id)">
                      <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>
      </div>
    </main>

    <aside v-if="shown.aux" class="auxiliarybar" :aria-label="`Consulta de ${openTable}`">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <code>{{ openTable }}</code>
        <span class="count">consulta</span>
        <div class="region-actions">
          <button type="button" class="region-action" :title="copied ? 'Copiada' : 'Copiar la consulta'" aria-label="Copiar la consulta" :disabled="!openQuery" @click="copyQuery">
            <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="openTable = null">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <p v-if="!openQuery" class="none">Leyendo…</p>
        <template v-else>
          <pre class="sql"><code>{{ openQuery }}</code></pre>
          <p class="none">Sólo lee. Es la misma condición con que tests cuenta y borra las filas de esta tabla. <span v-if="copied" class="ok">Copiada.</span></p>
        </template>
      </div>
    </aside>

    <section v-if="shown.panel" class="panel" aria-label="Estados">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <div class="region-head">
        <span>Estados</span>
        <span v-if="r" class="count">{{ lines.length }}</span>
      </div>
      <div class="region-body">
        <p v-if="!r" class="none">Por qué estados pasó la solicitud, quién la movió y cuándo.</p>
        <div v-for="l in lines" :key="l.key" class="log-line" :class="{ ghost: l.ghost }">
          <span class="log-time">{{ l.time }}</span>
          <i class="dot" :data-state="stateOf(l.id)" aria-hidden="true"></i>
          <span class="status">{{ l.id }} · {{ l.name }}</span>
          <span class="what">{{ l.by }}<template v-if="l.comment"> · {{ l.comment }}</template></span>
        </div>
      </div>
    </section>

    <dialog ref="dialog" class="confirm-dialog" aria-labelledby="del-title" @close="del = null" @cancel="del = null">
      <form v-if="del" method="dialog" @submit.prevent="runDelete">
        <h2 id="del-title">¿Borrar la solicitud {{ del.request }}?</h2>
        <p v-if="del.loading && !del.plan" class="muted">Contando lo que cuelga…</p>
        <template v-if="del.plan">
          <p>Se eliminan la solicitud y sus <b>{{ otherRows }}</b> filas en otras tablas. No se puede deshacer.</p>
          <p v-if="del.plan.requests[0]?.warning" class="warn">⚠ Ojo, {{ del.plan.requests[0].warning }}. Puede ser de otra persona del equipo.</p>
          <label v-if="del.lastOf" class="checkbox-row">
            <input type="checkbox" class="checkbox" :checked="del.users" :disabled="del.loading || del.running" @change="toggleUsers" />
            <span>Es la última solicitud de <b>{{ del.lastOf }}</b>. ¿Borrar también al usuario? <span class="muted">(se da de baja, como en el admin, para empezar de cero)</span></span>
          </label>
          <p v-if="del.users && del.plan.users.some((u) => u.protected)" class="hot">El usuario no se puede dar de baja: {{ del.plan.users.find((u) => u.protected).protected }}.</p>
          <p v-if="del.users && del.plan.users.some((u) => u.warning)" class="warn">⚠ El usuario {{ del.plan.users.find((u) => u.warning).warning }}.</p>
          <p class="muted small">Antes de borrar se guarda una copia de cada fila en <code>tests/.backups/</code>.</p>
          <p v-if="del.plan.blocked" class="hot">{{ del.plan.blocked }}</p>
        </template>
        <p v-if="del.error" class="hot">{{ del.error }}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-sm btn-outline" @click="closeDelete">Cancelar</button>
          <button type="submit" class="btn btn-sm btn-danger" :disabled="!canDelete">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>{{ del.running ? 'Borrando…' : 'Borrar' }}
          </button>
        </div>
      </form>
    </dialog>

    <dialog ref="userDialog" class="confirm-dialog" aria-labelledby="baja-title" @close="baja = null" @cancel="baja = null">
      <form v-if="baja" method="dialog" @submit.prevent="runBaja">
        <h2 id="baja-title">¿{{ baja.purge ? 'Borrar del todo' : 'Dar de baja' }} a {{ baja.person.name || `usuario ${baja.person.id}` }}?</h2>
        <p v-if="baja.purge">Ya está dado de baja (<code>{{ baja.person.document_number }}</code>). Se borra su fila de <code>users</code> y las suyas de toda tabla con <code>user_id</code> (códigos OTP, términos aceptados…). No se puede deshacer; se guarda una copia antes.</p>
        <p v-else>Queda como en la papelera del admin: dado de baja, la cédula pasa a <code>{{ baja.person.document_number }}-t…</code> y pierde el correo y el celular. Así quedan libres para registrarse de nuevo. Se guarda una copia antes.</p>
        <p v-if="baja.purge && Number(baja.person.requests) > 0" class="hot">Tiene {{ baja.person.requests }} solicitudes: borralas antes, con la basura de cada una.</p>
        <p class="muted small">{{ baja.person.email || 'sin correo' }} · {{ baja.person.cell_phone || 'sin celular' }} · {{ baja.person.requests }} solicitudes</p>
        <p v-if="target !== 'local' && String(baja.person.is_test) !== '1'" class="warn">⚠ No está marcado de prueba: puede ser de otra persona del equipo.</p>
        <p v-if="baja.error" class="hot">{{ baja.error }}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-sm btn-outline" @click="closeBaja">Cancelar</button>
          <button type="submit" class="btn btn-sm btn-danger" :disabled="baja.running || (baja.purge && Number(baja.person.requests) > 0)">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>{{ baja.running ? '…' : baja.purge ? 'Borrar del todo' : 'Dar de baja' }}
          </button>
        </div>
      </form>
    </dialog>

    <footer class="statusbar">
      <button ref="targetTrigger" type="button" class="statusbar-item env" title="Contra qué base se busca">
        <span class="ui-icon" data-icon="server" aria-hidden="true"></span>
        <span>Base: {{ target }}</span>
        <span class="ui-icon" data-icon="down" aria-hidden="true"></span>
      </button>
      <span v-if="loading">leyendo…</span>
      <span v-else-if="r" :title="r.source">leído a las {{ r.readAt.slice(11, 16) }} · {{ r.source }}</span>
      <span class="muted">lee siempre · borra sólo con confirmación</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las búsquedas" aria-label="Mostrar u ocultar las búsquedas" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Mostrar u ocultar los estados" aria-label="Mostrar u ocultar los estados" @click="togglePanel">
          <span class="ui-icon" data-icon="bottom" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Bandas, filas, grupos, avisos, tablas, líneas de log y pie son de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.hot { color: var(--tests-fail) }
.muted { color: var(--fg-3) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
code.wrap { word-break: break-all }
.env { flex: none }
/* El buscador: etiqueta, campo y botón, apilados en el ancho del sidebar. */
.search { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--gutter) }
.search .btn { align-self: flex-start }
/* La lista del celular: una fila por solicitud, con el comercio a la derecha y la basura al pasar. */
.sidebar .row[role="button"] { cursor: pointer }
.sidebar .row .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sidebar .row .row-meta { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
/* Los avisos: el de la base con la barra en ámbar (no cuadra) o en el color de la marca (para saber). */
.warnings { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--gutter) }
.alert[data-level="warn"] { border-left-color: var(--tests-warn); background: color-mix(in oklab, var(--tests-warn) 10%, transparent) }
.alert[data-level="warn"] .alert-icon { color: var(--tests-warn) }
.alert-desc p { color: var(--foreground) }
/* Clave y valor en dos columnas; el valor que contradice a la tienda va en rojo. */
.kv { display: grid; grid-template-columns: minmax(120px, 180px) 1fr; column-gap: var(--space-3); row-gap: var(--space-1);
  margin: 0; padding: var(--space-2) var(--gutter) var(--space-3) }
.kv dt { color: var(--fg-2) }
.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere }
.table tr.on td { background: var(--hover) }
.table .dot { margin-right: var(--space-1) }
/* El estado es un punto (un <i>: la base estira todo <span> de una fila). */
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.dot[data-state="ok"] { background: var(--tests-ok) }
.dot[data-state="fail"] { background: var(--tests-fail) }
.row .dot { margin-right: var(--space-2) }
/* La consola: hora, punto, estado y quién lo movió. La línea sin registro va atenuada y en cursiva. */
.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .dot { align-self: center }
.log-line .status { flex: none; min-width: 200px }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2) }
.log-line.ghost .what { font-style: italic; color: var(--tests-warn) }
/* Borrar: una ventana nativa (<dialog>) con la pregunta, el conteo y dos botones. */
.confirm-dialog { width: min(440px, calc(100vw - 32px)); padding: var(--space-4); border: 1px solid var(--border);
  border-radius: var(--radius-control); background: var(--background); color: var(--foreground) }
.confirm-dialog::backdrop { background: color-mix(in oklab, black 45%, transparent) }
.confirm-dialog h2 { margin: 0 0 var(--space-2); font-size: var(--text-body); font-weight: 600 }
.confirm-dialog p { margin: 0 0 var(--space-2); line-height: 1.5 }
.confirm-dialog .checkbox-row { align-items: flex-start; margin-bottom: var(--space-2) }
.confirm-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3) }
/* El rojo es el de tests, no `--destructive`: en el tema Darkmatter ése es un verde azulado apagado. */
.btn-danger { background: var(--tests-fail); color: var(--background) }
.btn-danger:hover { background: color-mix(in oklab, var(--tests-fail) 88%, transparent) }
/* El aviso de lo borrado, arriba del editor, con su ✕. */
.alert.done { margin: var(--space-2) var(--gutter) 0; width: auto; grid-template-columns: 1fr auto }
.alert.done .alert-desc { grid-column: 1 }
.alert.done > .region-action { grid-column: 2; grid-row: 1 }
.alert[data-level="ok"] { border-left-color: var(--tests-ok); background: color-mix(in oklab, var(--tests-ok) 10%, transparent) }
/* Cada tabla de la solicitud: su título (un botón que abre la consulta) y sus filas con todas las columnas.
   Las tablas son anchas (user_requests tiene ~40 columnas): scrollea la tabla, no el editor. */
.db-table { margin: 0 0 var(--space-3) }
.db-table-head { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--row-h);
  padding: 0 var(--gutter); border: 0; background: transparent; color: var(--foreground); font: inherit; text-align: left; cursor: pointer }
.db-table-head:hover, .db-table-head.on { background: var(--hover) }
.db-table-head code { font-weight: 600 }
.db-table-head .ui-icon { margin-left: auto; color: var(--fg-3) }
.table-scroll { overflow-x: auto; margin: 0 var(--gutter); border: 1px solid var(--border); border-radius: var(--radius-control) }
.table.db th, .table.db td { white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis;
  font-family: var(--font-mono); font-size: var(--text-sm) }
.table.db th { font-family: var(--font-sans) }
/* La consulta, en el sidebar derecho: mono, que se corta en renglones y se puede seleccionar. */
.sql { margin: 0; padding: var(--space-3) var(--gutter); white-space: pre-wrap; word-break: break-word;
  font-family: var(--font-mono); font-size: var(--text-sm); line-height: 1.6; user-select: text }
.ok { color: var(--tests-ok) }
.warn { color: var(--tests-warn) }
.small { font-size: var(--text-sm) }
.cell-action { width: 32px; text-align: right }
</style>
