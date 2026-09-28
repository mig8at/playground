<script setup>
/* keyring · la interfaz. Qué puede hacer cada perfil de ~/.aws en cada servicio de AWS.
 *
 * El sidebar es un árbol, como carpetas y archivos: una carpeta por categoría y un archivo por servicio,
 * con la marca corta de su acceso (RW, R, —). El editor, por ahora, dice sólo eso del servicio elegido:
 * lectura y escritura, por perfil. La lectura se mide en vivo (una llamada List/Describe); la escritura es
 * la medición registrada a mano (`check/data/writes.json`), y se muestra con su fecha, nunca como si fuera
 * de ahora. Qué perfil se mira lo elige el pie; abajo, en la consola, el resto de los accesos.
 *
 * Todo sale de la API en Go: acá no se prueba nada, se pinta. Perfil, servicio, filtro y pestaña viven en
 * la URL; las carpetas plegadas, en el navegador. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RegionMenu from './RegionMenu.vue'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, bindMenu,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const COMPARE = 'compare'
const READ_LABEL = { yes: 'sí', no: 'no', error: 'no se supo', unmeasured: 'sin medir' }
const WRITE_LABEL = { yes: 'sí', no: 'no', unreliable: 'no confiable', unmeasured: 'sin medir' }
const WRITE_WHY = {
  unreliable: 'el servicio busca el recurso antes de autorizar: «no encontrado» no prueba el permiso',
  unmeasured: 'no se probó',
}
const STATE_LABEL = { ok: 'ok', warn: 'vence pronto', fail: 'falla', off: 'no aplica' }
const STATE_RANK = { fail: 0, warn: 1, ok: 2, off: 3 }
const FILTERS = [
  { id: 'all', label: 'Todos los servicios' },
  { id: 'access', label: 'Con lectura' },
  { id: 'diff', label: 'Donde los perfiles difieren' },
]

// ── la ruta: #/?env=dev&service=ecs&filter=access&tab=databases ──
const route = readHashRoute()
const env = ref(route.params.get('env') || COMPARE)
const filter = ref(FILTERS.some((f) => f.id === route.params.get('filter')) ? route.params.get('filter') : 'all')
const selectedId = ref(route.params.get('service') || '')
const tab = ref(route.params.get('tab') || '')
function writeRoute(push) {
  setRoute(hashRoute([], { env: env.value, service: selectedId.value, filter: filter.value, tab: tab.value },
    { env: COMPARE, service: '', filter: 'all', tab: '' }), { push })
}
function onHashChange() {
  const r = readHashRoute()
  env.value = r.params.get('env') || COMPARE
  filter.value = FILTERS.some((f) => f.id === r.params.get('filter')) ? r.params.get('filter') : 'all'
  selectedId.value = r.params.get('service') || ''
  tab.value = r.params.get('tab') || tab.value
}

async function getJSON(path) {
  const res = await fetch(path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── AWS: la lista de perfiles, cada perfil por separado y la escritura registrada ──
const meta = ref(null) // { categories, services, profiles }
const accounts = ref({}) // perfil → cuenta medida
const measuring = ref({}) // perfil → true mientras se mide
const writes = ref([]) // mediciones de escritura registradas, por cuenta
const awsError = ref('')
async function loadAccount(profile) {
  measuring.value = { ...measuring.value, [profile]: true }
  try {
    const body = await getJSON(`/api/aws/account?profile=${encodeURIComponent(profile)}`)
    accounts.value = { ...accounts.value, [profile]: body }
  } catch (e) {
    accounts.value = { ...accounts.value, [profile]: { profile, error: e.message, services: [] } }
  } finally {
    measuring.value = { ...measuring.value, [profile]: false }
  }
}
async function loadAWS() {
  awsError.value = ''
  try {
    ;[meta.value, writes.value] = await Promise.all([getJSON('/api/aws/profiles'), getJSON('/api/aws/writes').catch(() => [])])
  } catch (e) {
    awsError.value = `No se pudo leer: ${e.message}. ¿Está la API arriba? (make keyring-ui levanta las dos partes)`
    return
  }
  await Promise.all(meta.value.profiles.map(loadAccount))
}
// Un perfil sin credenciales propias (un `default` que sólo guarda la región) no es un acceso: no cuenta;
// el selector del pie lo muestra deshabilitado, para que se vea que existe y por qué no.
// Un perfil aparece recién cuando se sabe que tiene credenciales: antes, `default` asomaba como columna
// mientras se medía y desaparecía al contestar.
const profiles = computed(() => (meta.value?.profiles || []).filter((p) => accounts.value[p] && !accounts.value[p].noCredentials))
const hidden = computed(() => (meta.value?.profiles || []).filter((p) => accounts.value[p]?.noCredentials))
const services = computed(() => (meta.value?.services || []).map((s, index) => ({ ...s, index })))
const readOf = (profile, s) => accounts.value[profile]?.services?.[s.index]?.read || null
const writeRecord = (profile) => writes.value.find((w) => w.account === accounts.value[profile]?.account) || null
const writeOf = (profile, s) => writeRecord(profile)?.results?.[s.id] || 'unmeasured'
const measured = computed(() => profiles.value.filter((p) => accounts.value[p]?.services?.length))
const broken = computed(() => profiles.value.filter((p) => accounts.value[p]?.error))

// ── qué perfil se mira: comparar, o uno. Un perfil que ya no está (se quitó de ~/.aws) vuelve a comparar ──
const single = computed(() => (env.value !== COMPARE && profiles.value.includes(env.value) ? env.value : ''))
const columns = computed(() => (single.value ? [single.value] : profiles.value))

// La marca corta de un archivo del árbol: RW, R, W (raro), — o ? mientras no se sabe.
function badge(profile, s) {
  const r = readOf(profile, s)
  if (!r) return measuring.value[profile] ? '…' : '?'
  const w = writeOf(profile, s) === 'yes'
  if (r === 'yes') return w ? 'RW' : 'R'
  if (r === 'no') return w ? 'W' : '—'
  return '?'
}

// ── el filtro: va al menú de la barra del árbol; el contador lo delata ──
const hasAccess = (s) => columns.value.some((p) => readOf(p, s) === 'yes')
// Sólo entre perfiles medidos: uno vencido o todavía midiendo no es una diferencia de permisos.
const differs = (s) => new Set(measured.value.map((p) => badge(p, s))).size > 1
const filters = computed(() => (single.value ? FILTERS.filter((f) => f.id !== 'diff') : FILTERS))
const activeFilter = computed(() => (filters.value.some((f) => f.id === filter.value) ? filter.value : 'all'))
const passes = (s) => (activeFilter.value === 'access' ? hasAccess(s) : activeFilter.value === 'diff' ? differs(s) : true)
const shownCount = computed(() => services.value.filter(passes).length)
const filterMenu = computed(() => filters.value.map((f) => ({
  id: f.id, label: f.label, checked: activeFilter.value === f.id,
  count: f.id === 'all' ? services.value.length : services.value.filter(f.id === 'access' ? hasAccess : differs).length,
})))

// ── el árbol: una carpeta por categoría, plegable; lo plegado se recuerda en el navegador ──
const collapsed = ref(new Set(JSON.parse(localStorage.getItem('keyring.collapsed') || '[]')))
function toggleFolder(id) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  collapsed.value = next
  try { localStorage.setItem('keyring.collapsed', JSON.stringify([...next])) } catch { /* sin almacenamiento, sólo no se recuerda */ }
}
const folders = computed(() => (meta.value?.categories || []).map((c) => {
  const all = services.value.filter((s) => s.category === c)
  return { id: c, files: all.filter(passes), total: all.length, open: !collapsed.value.has(c) }
}).filter((f) => f.files.length))

// ── el servicio elegido: el editor dice su lectura y su escritura ──
const selected = computed(() => services.value.find((s) => s.id === selectedId.value) || null)
function pick(id) { selectedId.value = id }

// ── el selector del pie ──
const envTrigger = ref(null)
let envMenu = null
const readCount = (profile) => (accounts.value[profile]?.services || []).filter((s) => s.read === 'yes').length
const envMenuItems = computed(() => {
  const items = [{ id: COMPARE, label: 'Comparar perfiles', selected: !single.value, count: profiles.value.length }, { separator: true }]
  for (const p of profiles.value) {
    const a = accounts.value[p]
    const why = a?.error ? 'la sesión no sirve' : a?.permissionSet || (measuring.value[p] ? 'midiendo…' : '')
    items.push({ id: p, label: `${p} · ${why}`, selected: single.value === p,
      count: a?.services?.length ? `${readCount(p)}/${services.value.length}` : undefined,
      title: a?.error || (a ? `${a.account} · ${a.accountLabel}` : '') })
  }
  for (const p of hidden.value) items.push({ id: p, label: `${p} · sin credenciales`, disabled: true, title: 'sólo tiene configuración en ~/.aws: no da acceso a nada' })
  return items
})
watch(envMenuItems, () => envMenu?.refresh(), { deep: true, flush: 'post' })

// ── los demás accesos: la consola ──
const groups = ref([])
const rows = ref({})
const pending = ref({})
const errors = ref({})
async function loadGroup(id) {
  pending.value = { ...pending.value, [id]: true }
  try {
    // Primero la respuesta, después la copia: copiar antes del await pisa con un objeto viejo lo que los
    // otros grupos escribieron mientras tanto (pasó: sólo quedaba el último en llegar).
    const body = await getJSON(`/api/checks?group=${encodeURIComponent(id)}`)
    rows.value = { ...rows.value, [id]: body }
    errors.value = { ...errors.value, [id]: '' }
  } catch (e) {
    errors.value = { ...errors.value, [id]: e.message }
  } finally {
    pending.value = { ...pending.value, [id]: false }
  }
}
async function loadGroups() {
  try {
    // La identidad de AWS ya está en el pie y en el editor: la consola no la repite.
    if (!groups.value.length) groups.value = (await getJSON('/api/groups')).filter((g) => g.id !== 'aws')
  } catch { return }
  if (!groups.value.some((g) => g.id === tab.value)) tab.value = groups.value[0]?.id || ''
  await Promise.all(groups.value.map((g) => loadGroup(g.id)))
}
function worst(list) {
  if (!list?.length) return null
  return list.reduce((w, r) => (STATE_RANK[r.state] < STATE_RANK[w] ? r.state : w), 'off')
}
const tabs = computed(() => groups.value.map((g) => ({
  ...g, state: pending.value[g.id] ? 'pending' : worst(rows.value[g.id]),
  fails: (rows.value[g.id] || []).filter((r) => r.state === 'fail').length,
})))
const tabRows = computed(() => rows.value[tab.value] || [])
const failTotal = computed(() => Object.values(rows.value).flat().filter((r) => r.state === 'fail').length)

const checkedAt = ref(null)
async function loadAll() {
  await Promise.all([loadAWS(), loadGroups()])
  checkedAt.value = new Date()
}
const busy = computed(() => Object.values(measuring.value).some(Boolean) || Object.values(pending.value).some(Boolean))

// El vencimiento se relee cada 30 s: «vence en 40′» no puede quedar congelado mientras la pestaña está abierta.
const now = ref(Date.now())
let clock = null
function until(t) {
  const d = new Date(t).getTime() - now.value
  const mins = Math.floor(Math.abs(d) / 60000)
  const text = mins < 60 ? `${mins}′` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${Math.floor(mins / 1440)}d`
  return d <= 0 ? `venció hace ${text}` : `vence en ${text}`
}
const fmtFull = (t) => (t ? new Date(t).toLocaleString('es-CO') : '')
const fmtTime = (t) => (t ? t.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '')
const fmtDay = (d) => (d ? d.split('-').reverse().slice(0, 2).join('/') : '')

watch(tab, () => writeRoute(false))
watch(filter, () => writeRoute(false))
watch(env, () => writeRoute(true))
watch(selectedId, () => writeRoute(true))

// ── las regiones: el árbol a la izquierda y la consola abajo, con el contrato de la base ──
const sidebarOpen = ref(readSize('keyring.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('keyring.sidebar-w', 280))
const panelOpen = ref(readSize('keyring.panel-open', 1) !== 0)
const panelH = ref(readSize('keyring.panel-h', 200))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const [sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  const [panel] = fitRegions(viewportH.value - 200, [
    { size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) },
  ])
  return { sidebar, panel }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--panel-h': `${shown.value.panel}px` }))
const sidebarResize = {
  label: 'Ancho del árbol', sign: 1, defaultValue: 280,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('keyring.sidebar-open', v ? 1 : 0); if (v) saveSize('keyring.sidebar-w', sidebarW.value) },
}
const panelResize = {
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 200,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('keyring.panel-open', v ? 1 : 0); if (v) saveSize('keyring.panel-h', panelH.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('keyring.sidebar-open', sidebarOpen.value ? 1 : 0) }
function togglePanel() { panelOpen.value = !shown.value.panel; saveSize('keyring.panel-open', panelOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  envMenu = bindMenu(envTrigger.value, {
    label: 'Qué perfil de AWS se mira', getItems: () => envMenuItems.value,
    onSelect: (id) => { env.value = id },
  })
  clock = setInterval(() => { now.value = Date.now() }, 30000)
  loadAll()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearInterval(clock)
  themeBinding?.destroy?.()
  envMenu?.destroy()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Servicios de AWS">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Servicios</span>
        <span v-if="meta" class="count" :class="{ filtered: activeFilter !== 'all' }">
          {{ activeFilter === 'all' ? services.length : `${shownCount} / ${services.length}` }}
        </span>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="busy" title="Volver a probar" aria-label="Volver a probar" @click="loadAll">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
          <RegionMenu :items="filterMenu" :active="activeFilter !== 'all'" title="Qué servicios se ven" icon="filter" @select="(id) => (filter = id)" />
        </div>
      </div>
      <div class="region-body">
        <p v-if="awsError" class="none hot">{{ awsError }}</p>
        <p v-else-if="!meta" class="none">Leyendo los perfiles de ~/.aws…</p>
        <template v-else>
        <!-- En «comparar» hay una marca por perfil: esta fila dice de quién es cada columna. -->
        <div v-if="columns.length > 1" class="tree-columns" aria-hidden="true">
          <span v-for="p in columns" :key="p" class="badge-access">{{ p }}</span>
        </div>
        <ul class="tree" role="tree" aria-label="Servicios por categoría">
          <li v-for="f in folders" :key="f.id" role="treeitem" :aria-expanded="f.open" class="folder">
            <button type="button" class="row" @click="toggleFolder(f.id)">
              <span class="ui-icon chevron" :class="{ open: f.open }" data-icon="chevron" aria-hidden="true"></span>
              <span class="label">{{ f.id }}</span>
              <span class="row-meta">{{ f.files.length === f.total ? f.total : `${f.files.length}/${f.total}` }}</span>
            </button>
            <ul v-if="f.open" role="group">
              <li v-for="s in f.files" :key="s.id" role="treeitem" :aria-selected="s.id === selectedId">
                <button type="button" class="row file" :class="{ on: s.id === selectedId }" @click="pick(s.id)">
                  <span class="label">{{ s.label }}</span>
                  <span class="row-meta badges">
                    <span v-for="p in columns" :key="p" class="badge-access" :data-badge="badge(p, s)"
                      :title="`${p}: ${badge(p, s)}`">{{ badge(p, s) }}</span>
                  </span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
        </template>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ selected ? selected.label : 'AWS' }}</span>
        <span v-if="selected" class="count">{{ selected.category }}</span>
      </div>
      <div class="region-body">
        <div v-if="!selected" class="empty">
          <div class="empty-head">
            <div class="empty-title">Elegí un servicio</div>
            <div class="empty-desc">El árbol de la izquierda marca cada servicio con lo que permite: <b>RW</b> leer y escribir, <b>R</b> sólo leer, <b>—</b> nada.</div>
          </div>
        </div>
        <template v-else>
          <section v-for="p in columns" :key="p" class="access-card">
            <div class="region-head group">
              <span><code>{{ p }}</code></span>
              <span class="count">{{ accounts[p]?.permissionSet || '' }}</span>
            </div>
            <p v-if="accounts[p]?.error" class="none hot">{{ accounts[p].error }}</p>
            <dl v-else class="access-list">
              <div class="access-row" :data-value="readOf(p, selected) || 'none'">
                <dt>Lectura</dt>
                <dd><i class="dot" :data-v="readOf(p, selected)" aria-hidden="true"></i>{{ readOf(p, selected) ? READ_LABEL[readOf(p, selected)] : (measuring[p] ? 'midiendo…' : '—') }}</dd>
                <dd class="source">medida ahora</dd>
              </div>
              <div class="access-row" :data-value="writeOf(p, selected)">
                <dt>Escritura</dt>
                <dd><i class="dot" :data-v="writeOf(p, selected)" aria-hidden="true"></i>{{ WRITE_LABEL[writeOf(p, selected)] }}</dd>
                <dd class="source" :title="writeRecord(p) ? `sonda ${writeRecord(p).probe} · ${writeRecord(p).by}` : ''">
                  {{ writeRecord(p) && writeOf(p, selected) !== 'unmeasured' ? `medida a mano el ${fmtDay(writeRecord(p).date)}` : '' }}{{ WRITE_WHY[writeOf(p, selected)] && writeRecord(p) && writeOf(p, selected) !== 'unmeasured' ? ' · ' : '' }}{{ WRITE_WHY[writeOf(p, selected)] || '' }}
                </dd>
              </div>
            </dl>
          </section>
        </template>
      </div>
    </main>

    <section v-if="shown.panel" class="panel" aria-label="Otros accesos">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <nav class="tabs" role="tablist" aria-label="Otros accesos">
        <button v-for="t in tabs" :key="t.id" type="button" role="tab" class="tab" :class="{ on: t.id === tab }"
          :aria-selected="t.id === tab" @click="tab = t.id">
          <i class="dot" :data-state="t.state" aria-hidden="true"></i>
          {{ t.label }}
          <span v-if="t.fails" class="count">{{ t.fails }}</span>
        </button>
      </nav>
      <div class="region-body">
        <p v-if="errors[tab]" class="none hot">{{ errors[tab] }}</p>
        <p v-else-if="pending[tab] && !tabRows.length" class="none">Probando…</p>
        <div v-for="r in tabRows" :key="r.name" class="log-line" :data-state="r.state">
          <i class="dot" :data-state="r.state" aria-hidden="true"></i>
          <span class="name">{{ r.name }}</span>
          <span class="state">{{ STATE_LABEL[r.state] }}</span>
          <span class="what">{{ r.detail }}</span>
          <span v-if="r.expires" class="log-time" :title="fmtFull(r.expires)">{{ until(r.expires) }}</span>
        </div>
      </div>
    </section>

    <footer class="statusbar">
      <!-- El selector de perfil, como la rama en la barra de estado de VS Code. Un perfil que no sirve lo delata. -->
      <button ref="envTrigger" type="button" class="statusbar-item env" :title="broken.length ? `sin sesión: ${broken.join(', ')}` : 'Qué perfil de AWS se mira'">
        <span class="ui-icon" data-icon="server" aria-hidden="true"></span>
        <span>AWS: {{ single || 'comparar' }}</span>
        <i v-if="broken.length" class="dot" data-state="fail" aria-hidden="true"></i>
        <span class="ui-icon" data-icon="down" aria-hidden="true"></span>
      </button>
      <span v-if="busy">probando…</span>
      <span v-else-if="checkedAt" :title="fmtFull(checkedAt)">probado a las {{ fmtTime(checkedAt) }}</span>
      <span v-if="failTotal" class="hot">{{ failTotal }} accesos fallan en la consola</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar el árbol" aria-label="Mostrar u ocultar el árbol" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Mostrar u ocultar la consola" aria-label="Mostrar u ocultar la consola" @click="togglePanel">
          <span class="ui-icon" data-icon="bottom" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Todo lo demás —bandas, filas, pestañas, grupos, estado vacío, líneas, pie— es de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.hot { color: var(--access-fail) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
/* El selector de perfil es lo que más importa del pie: no se encoge; lo que sobra se corta en los demás. */
.env { flex: none }
.env .dot { margin-right: 0 }
/* El árbol: carpetas y archivos con la fila de la base; el archivo se sangra bajo su carpeta. */
.tree, .tree ul { list-style: none; margin: 0; padding: 0 }
.tree .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.tree .folder > .row { font-weight: 600 }
.tree .file { padding-left: calc(var(--space-2) + 16px) }
/* El icono apunta a la derecha (cerrada); abierta, gira hacia abajo. */
.chevron { transition: transform .12s }
.chevron.open { transform: rotate(90deg) }
.badges { flex: none; display: flex; gap: var(--space-1) }
.tree-columns { position: sticky; top: 0; z-index: 1; display: flex; justify-content: flex-end; gap: var(--space-1);
  padding: var(--space-1) calc(var(--space-1) + var(--space-2)); background: var(--region-bg, var(--sidebar)) }
.tree-columns .badge-access { color: var(--fg-3) }
/* La marca de acceso: un rótulo mono de ancho fijo, así las columnas de los perfiles quedan alineadas. */
.badge-access { min-width: 22px; text-align: center; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--fg-3) }
.badge-access[data-badge="RW"] { color: var(--access-ok); font-weight: 600 }
.badge-access[data-badge="R"] { color: var(--access-ok) }
.badge-access[data-badge="W"], .badge-access[data-badge="?"] { color: var(--access-warn) }
.row.on .badge-access { color: var(--accent-foreground) }
/* El editor: por perfil, dos renglones —lectura y escritura— y de dónde sale cada uno. */
.access-list { margin: 0; padding: var(--space-2) var(--gutter) }
.access-row { display: grid; grid-template-columns: 96px 120px 1fr; align-items: baseline; gap: var(--space-2); min-height: var(--row-h) }
.access-row dt { color: var(--fg-2) }
.access-row dd { margin: 0 }
.access-row[data-value="yes"] dd:not(.source) { color: var(--access-ok); font-weight: 600 }
.access-row[data-value="unreliable"] dd:not(.source), .access-row[data-value="error"] dd:not(.source) { color: var(--access-warn) }
.access-row .source { color: var(--fg-3); font-size: var(--text-sm) }
/* El estado es un punto (un <i>: la base estira todo <span> de una fila); el texto de al lado lo dice para quien no lo ve. */
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; margin-right: var(--space-1); background: var(--access-off) }
.dot[data-v="yes"], .dot[data-state="ok"] { background: var(--access-ok) }
.dot[data-v="unreliable"], .dot[data-v="error"], .dot[data-state="warn"] { background: var(--access-warn) }
.dot[data-state="fail"] { background: var(--access-fail) }
.dot[data-state="pending"] { background: transparent; box-shadow: inset 0 0 0 1px var(--access-off) }
/* La consola */
.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .dot { align-self: center; margin-right: 0 }
.log-line .name { flex: none; width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.log-line .state { min-width: 80px; color: var(--fg-3) }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2) }
.log-line[data-state="off"] .name { color: var(--fg-3) }
.log-line[data-state="fail"] .state { color: var(--access-fail) }
</style>
