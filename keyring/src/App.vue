<script setup>
/* keyring · la interfaz. El editor es AWS: qué servicios lee cada perfil de ~/.aws, medido con una llamada
 * List/Describe por servicio, y cada perfil se pide por separado para que aparezca apenas contesta.
 *
 * QUÉ SE MIRA lo elige el selector del pie (como la rama en la barra de estado de VS Code): «comparar» es
 * la matriz de todos los perfiles; un perfil muestra sólo el suyo, con más detalle por fila y su identidad
 * en una subbanda. Al elegir un servicio, el sidebar secundario dice qué se probó, qué contestó cada
 * perfil y el comando que lo reproduce. Abajo, en la consola, el resto de los accesos.
 *
 * Todo sale de la API en Go —lo mismo que `make keyring`—: acá no se prueba nada, se pinta. Perfil,
 * filtro, servicio y pestaña viven en la URL. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RegionMenu from './RegionMenu.vue'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, bindMenu,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const COMPARE = 'compare'
const READ_LABEL = { yes: 'lectura', no: 'negada', error: 'no se supo', unmeasured: 'sin medir' }
const STATE_LABEL = { ok: 'ok', warn: 'vence pronto', fail: 'falla', off: 'no aplica' }
const STATE_RANK = { fail: 0, warn: 1, ok: 2, off: 3 }
const FILTERS = [
  { id: 'all', label: 'Todos los servicios' },
  { id: 'access', label: 'Con lectura' },
  { id: 'diff', label: 'Donde los perfiles difieren' },
]

// ── la ruta: #/?env=dev&filter=diff&service=ecs&tab=databases ──
const route = readHashRoute()
const env = ref(route.params.get('env') || COMPARE)
const filter = ref(FILTERS.some((f) => f.id === route.params.get('filter')) ? route.params.get('filter') : 'all')
const selectedId = ref(route.params.get('service') || '')
const tab = ref(route.params.get('tab') || '')
function writeRoute(push) {
  setRoute(hashRoute([], { env: env.value, filter: filter.value, service: selectedId.value, tab: tab.value },
    { env: COMPARE, filter: 'all', service: '', tab: '' }), { push })
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

// ── AWS: primero la lista de perfiles, después cada perfil por separado ──
const meta = ref(null) // { categories, services, profiles }
const accounts = ref({}) // perfil → cuenta medida
const measuring = ref({}) // perfil → true mientras se mide
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
    meta.value = await getJSON('/api/aws/profiles')
  } catch (e) {
    awsError.value = `No se pudo leer: ${e.message}. ¿Está la API arriba? (make keyring-ui levanta las dos partes)`
    return
  }
  await Promise.all(meta.value.profiles.map(loadAccount))
}
// Un perfil sin credenciales propias (un `default` que sólo guarda la región) no es un acceso: no ocupa
// columna; el selector lo muestra deshabilitado, para que se vea que existe y por qué no cuenta.
const profiles = computed(() => (meta.value?.profiles || []).filter((p) => !accounts.value[p]?.noCredentials))
const hidden = computed(() => (meta.value?.profiles || []).filter((p) => accounts.value[p]?.noCredentials))
const services = computed(() => (meta.value?.services || []).map((s, index) => ({ ...s, index })))
const cell = (profile, index) => accounts.value[profile]?.services?.[index] || null
const readCount = (profile) => (accounts.value[profile]?.services || []).filter((s) => s.read === 'yes').length
const measured = computed(() => profiles.value.filter((p) => accounts.value[p]?.services?.length))
const broken = computed(() => profiles.value.filter((p) => accounts.value[p]?.error))

// ── qué se mira: comparar, o un perfil. Un perfil que ya no está (se quitó de ~/.aws) vuelve a comparar ──
const single = computed(() => (env.value !== COMPARE && profiles.value.includes(env.value) ? env.value : ''))
const columns = computed(() => (single.value ? [single.value] : profiles.value))
const current = computed(() => (single.value ? accounts.value[single.value] : null))

// ── el filtro: se alterna y se toca poco, así que va al menú de la región; el contador lo delata ──
const hasAccess = (s) => columns.value.some((p) => cell(p, s.index)?.read === 'yes')
// Sólo entre perfiles medidos: uno vencido o todavía midiendo no es una diferencia de permisos.
const differs = (s) => new Set(measured.value.map((p) => cell(p, s.index)?.read)).size > 1
const filters = computed(() => (single.value ? FILTERS.filter((f) => f.id !== 'diff') : FILTERS))
const activeFilter = computed(() => (filters.value.some((f) => f.id === filter.value) ? filter.value : 'all'))
const passes = (s) => (activeFilter.value === 'access' ? hasAccess(s) : activeFilter.value === 'diff' ? differs(s) : true)
const shownServices = computed(() => services.value.filter(passes))
const filterMenu = computed(() => filters.value.map((f) => ({
  id: f.id, label: f.label, checked: activeFilter.value === f.id,
  count: f.id === 'all' ? services.value.length : services.value.filter(f.id === 'access' ? hasAccess : differs).length,
})))
const categories = computed(() => (meta.value?.categories || []).map((c) => {
  const all = services.value.filter((s) => s.category === c)
  return {
    id: c, rows: all.filter(passes), total: all.length,
    // Sólo los perfiles medidos: «dev 0/3» de un perfil vencido se leía como «sin acceso».
    perProfile: columns.value.filter((p) => accounts.value[p]?.services?.length)
      .map((p) => ({ p, n: all.filter((s) => cell(p, s.index)?.read === 'yes').length })),
  }
}).filter((c) => c.rows.length))

// ── el selector del pie ──
const envTrigger = ref(null)
let envMenu = null
const envMenuItems = computed(() => {
  const items = [{ id: COMPARE, label: 'Comparar perfiles', selected: !single.value, count: profiles.value.length }]
  items.push({ separator: true })
  for (const p of profiles.value) {
    const a = accounts.value[p]
    const why = a?.error ? 'la sesión no sirve' : a?.permissionSet || (measuring.value[p] ? 'midiendo…' : '')
    items.push({ id: p, label: `${p} · ${why}`, selected: single.value === p, count: a?.services?.length ? `${readCount(p)}/${services.value.length}` : undefined,
      title: a?.error || (a ? `${a.account} · ${a.accountLabel}` : '') })
  }
  for (const p of hidden.value) items.push({ id: p, label: `${p} · sin credenciales`, disabled: true, title: 'sólo tiene configuración en ~/.aws: no da acceso a nada' })
  return items
})
const envLabel = computed(() => (single.value ? single.value : 'comparar'))
watch(envMenuItems, () => envMenu?.refresh(), { deep: true, flush: 'post' })

// ── el servicio elegido: su detalle va al sidebar secundario ──
const selected = computed(() => services.value.find((s) => s.id === selectedId.value) || null)
function pick(id) { selectedId.value = selectedId.value === id ? '' : id; if (selectedId.value) { auxOpen.value = true } }
const copied = ref('')
async function copy(text) {
  try { await navigator.clipboard.writeText(text); copied.value = text; setTimeout(() => { if (copied.value === text) copied.value = '' }, 1500) } catch { /* sin portapapeles, el comando igual está a la vista */ }
}

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
    // La identidad de AWS ya está en el editor: la consola no la repite.
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
// «pegadas a mano el 28/09 10:56, sin vencimiento declarado» → «pegadas 28/09 10:56»; el texto entero va en el title.
const credShort = (text) => text?.replace(/^pegadas a mano el ([^,]+),.*$/, 'pegadas $1') || ''
const credentials = (a) => (a?.expires ? until(a.expires) : credShort(a?.credentials))
const fmtFull = (t) => (t ? new Date(t).toLocaleString('es-CO') : '')
const fmtTime = (t) => (t ? t.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '')

watch(tab, () => writeRoute(false))
watch(filter, () => writeRoute(false))
watch(env, () => writeRoute(true))
watch(selectedId, () => writeRoute(true))

// ── las regiones: el detalle a la derecha y la consola abajo, con el contrato de la base ──
const auxOpen = ref(readSize('keyring.aux-open', 1) !== 0)
const auxW = ref(readSize('keyring.aux-w', 340))
const panelOpen = ref(readSize('keyring.panel-open', 1) !== 0)
const panelH = ref(readSize('keyring.panel-h', 240))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const [aux] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: auxOpen.value && selected.value ? auxW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  const [panel] = fitRegions(viewportH.value - 200, [
    { size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) },
  ])
  return { aux, panel }
})
const layoutVars = computed(() => ({ '--auxiliarybar-w': `${shown.value.aux}px`, '--panel-h': `${shown.value.panel}px` }))
const auxResize = {
  label: 'Ancho del detalle', sign: -1, defaultValue: 340,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('keyring.aux-open', v ? 1 : 0); if (v) saveSize('keyring.aux-w', auxW.value) },
}
const panelResize = {
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 240,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('keyring.panel-open', v ? 1 : 0); if (v) saveSize('keyring.panel-h', panelH.value) },
}
function toggleAux() { auxOpen.value = !shown.value.aux; saveSize('keyring.aux-open', auxOpen.value ? 1 : 0) }
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
    <main class="editor">
      <div class="region-head">
        <span>AWS · {{ single || 'comparar perfiles' }}</span>
        <span v-if="meta" class="count" :class="{ filtered: activeFilter !== 'all' }">
          {{ activeFilter === 'all' ? `${services.length} servicios` : `${shownServices.length} / ${services.length}` }}
        </span>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="busy" title="Volver a probar" aria-label="Volver a probar" @click="loadAll">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
          <RegionMenu :items="filterMenu" :active="activeFilter !== 'all'" title="Qué servicios se ven" icon="filter" @select="(id) => (filter = id)" />
        </div>
      </div>
      <!-- Con un perfil elegido, la subbanda dice de quién es lo que se está viendo. -->
      <div v-if="single" class="subband" aria-label="Perfil elegido">
        <template v-if="current?.error"><span class="hot grow">{{ current.error }}</span></template>
        <template v-else-if="current">
          <strong>{{ current.account }}</strong>
          <span class="muted wide">{{ current.accountLabel }}</span>
          <code>{{ current.permissionSet || current.role }}</code>
          <span class="grow"></span>
          <span>{{ readCount(single) }} / {{ services.length }}</span>
          <span class="muted" :title="current.credentials">{{ credentials(current) }}</span>
        </template>
        <span v-else class="muted">midiendo…</span>
      </div>
      <div class="region-body">
        <div v-if="awsError" class="alert alert-destructive" role="alert">
          <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
          <div class="alert-title">{{ awsError }}</div>
        </div>
        <div v-else-if="!meta" class="empty"><div class="empty-desc">Leyendo los perfiles de ~/.aws…</div></div>
        <template v-else>
          <section v-for="c in categories" :key="c.id">
            <div class="region-head group">
              <span>{{ c.id }}</span>
              <span class="count">{{ c.rows.length === c.total ? c.total : `${c.rows.length} / ${c.total}` }}</span>
              <span class="group-meta">
                <span v-for="x in c.perProfile" :key="x.p">{{ single ? '' : `${x.p} ` }}{{ x.n }}/{{ c.total }}</span>
              </span>
            </div>
            <!-- un perfil: una fila con todo lo que contestó -->
            <table v-if="single" class="table matrix">
              <colgroup><col class="c-service"><col class="c-access"><col><col class="c-ms wide"></colgroup>
              <thead><tr><th>Servicio</th><th>Resultado</th><th>Qué contestó</th><th class="num wide">ms</th></tr></thead>
              <tbody>
                <tr v-for="s in c.rows" :key="s.id" class="clickable" tabindex="0" :aria-selected="s.id === selectedId"
                  @click="pick(s.id)" @keydown.enter.prevent="pick(s.id)" @keydown.space.prevent="pick(s.id)">
                  <td class="nowrap" :title="s.action">{{ s.label }}</td>
                  <td class="access" :data-read="cell(single, s.index)?.read || 'none'">
                    <template v-if="cell(single, s.index)"><i class="dot" :data-read="cell(single, s.index).read" aria-hidden="true"></i>{{ READ_LABEL[cell(single, s.index).read] }}</template>
                    <span v-else class="muted">{{ measuring[single] ? '…' : '—' }}</span>
                  </td>
                  <td class="answer-cell">{{ cell(single, s.index)?.detail || '' }}</td>
                  <td class="num muted wide">{{ cell(single, s.index)?.ms ?? '' }}</td>
                </tr>
              </tbody>
            </table>
            <!-- comparar: una columna por perfil -->
            <table v-else class="table matrix">
              <colgroup><col class="c-service"><col class="c-action wide"><col v-for="p in columns" :key="p" class="c-access"></colgroup>
              <thead>
                <tr>
                  <th>Servicio</th><th class="wide">Acción probada</th>
                  <th v-for="p in columns" :key="p" class="access" :class="{ hot: accounts[p]?.error }" :title="accounts[p]?.error || accounts[p]?.permissionSet || ''">
                    {{ p }}<template v-if="accounts[p]?.error"> · vencida</template>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in c.rows" :key="s.id" class="clickable" tabindex="0" :aria-selected="s.id === selectedId"
                  @click="pick(s.id)" @keydown.enter.prevent="pick(s.id)" @keydown.space.prevent="pick(s.id)">
                  <td class="nowrap">{{ s.label }}</td>
                  <td class="action wide"><code>{{ s.action }}</code></td>
                  <td v-for="p in columns" :key="p" class="access" :data-read="cell(p, s.index)?.read || 'none'">
                    <template v-if="cell(p, s.index)">
                      <i class="dot" :data-read="cell(p, s.index).read" aria-hidden="true"></i>{{ READ_LABEL[cell(p, s.index).read] }}
                    </template>
                    <span v-else-if="measuring[p]" class="muted">…</span>
                    <span v-else class="muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
          <p v-if="!categories.length" class="none">Ningún servicio pasa el filtro.</p>
        </template>
      </div>
    </main>

    <aside v-if="shown.aux" class="auxiliarybar" aria-label="Detalle del servicio">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>{{ selected.label }}</span>
        <span class="count">{{ selected.category }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Cerrar el detalle" aria-label="Cerrar el detalle" @click="selectedId = ''">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <div class="region-head group"><span>Qué se probó</span></div>
        <p class="fact"><code>{{ selected.action }}</code></p>
        <p class="none">Una llamada de lectura de a un elemento: pregunta si se puede, no qué hay.</p>
        <div class="region-head group"><span>Qué contestó</span></div>
        <div v-for="p in columns" :key="p" class="answer" :data-read="cell(p, selected.index)?.read || 'none'">
          <div class="answer-head">
            <i class="dot" :data-read="cell(p, selected.index)?.read" aria-hidden="true"></i>
            <code>{{ p }}</code>
            <span class="state">{{ cell(p, selected.index) ? READ_LABEL[cell(p, selected.index).read] : (measuring[p] ? 'midiendo…' : 'sin medir') }}</span>
            <span v-if="cell(p, selected.index)" class="muted ms">{{ cell(p, selected.index).ms }} ms</span>
          </div>
          <p v-if="cell(p, selected.index)" class="answer-detail">{{ cell(p, selected.index).detail }}</p>
          <p v-else-if="accounts[p]?.error" class="answer-detail hot">{{ accounts[p].error }}</p>
        </div>
        <div class="region-head group"><span>Reproducirlo</span></div>
        <div v-for="p in columns" :key="p" class="command">
          <code>{{ selected.command }} --profile {{ p }}</code>
          <button type="button" class="region-action" :title="copied === `${selected.command} --profile ${p}` ? 'Copiado' : 'Copiar el comando'"
            :aria-label="`Copiar el comando para ${p}`" @click="copy(`${selected.command} --profile ${p}`)">
            <span class="ui-icon" :data-icon="copied === `${selected.command} --profile ${p}` ? 'check' : 'copy'" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </aside>

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
        <span>AWS: {{ envLabel }}</span>
        <i v-if="broken.length" class="dot" data-state="fail" aria-hidden="true"></i>
        <span class="ui-icon" data-icon="down" aria-hidden="true"></span>
      </button>
      <span v-if="busy">probando…</span>
      <span v-else-if="checkedAt" :title="fmtFull(checkedAt)">probado a las {{ fmtTime(checkedAt) }}</span>
      <span v-if="failTotal" class="hot">{{ failTotal }} accesos fallan en la consola</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" :disabled="!selected" title="Mostrar u ocultar el detalle" aria-label="Mostrar u ocultar el detalle" @click="toggleAux">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Mostrar u ocultar la consola" aria-label="Mostrar u ocultar la consola" @click="togglePanel">
          <span class="ui-icon" data-icon="bottom" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Todo lo demás —bandas, subbanda, pestañas, tabla, grupos, avisos, líneas, pie— es de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.nowrap { white-space: nowrap }
.muted { color: var(--fg-3) }
.hot { color: var(--access-fail) }
.clickable { cursor: pointer }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
.env .dot { margin-right: 0 }
/* El conteo por perfil va al borde del encabezado del grupo, apagado: resume sin competirle al título. */
.group-meta { margin-left: auto; display: flex; gap: var(--space-3); font-size: var(--text-xs); font-weight: 400; color: var(--fg-3); font-variant-numeric: tabular-nums }
/* Con el detalle abierto el editor se angosta: lo que ya dice el detalle (la acción, los ms) y lo que tiene
   su title se van antes de que las columnas se pisen. Sin JS: una consulta de contenedor. */
.editor { container-type: inline-size }
@container (max-width: 620px) { .wide { display: none } }
/* Las tablas de cada categoría son tablas distintas: con anchos fijos, las columnas quedan alineadas de una a otra. */
.matrix { table-layout: fixed }
.matrix .c-service { width: 176px }
.matrix .c-access { width: 104px }
.matrix .c-ms { width: 64px }
.matrix tr[aria-selected="true"] td { background: var(--accent); color: var(--accent-foreground) }
.action { color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.answer-cell { color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.access { white-space: nowrap }
.access[data-read="yes"] { color: var(--access-ok) }
.access[data-read="no"] { color: var(--fg-3) }
.access[data-read="error"] { color: var(--access-warn) }
th.hot { color: var(--access-fail) }
/* El estado es un punto (un <i>: la base estira todo <span> de una fila); el texto de al lado lo dice para quien no lo ve. */
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; margin-right: var(--space-1); background: var(--access-off) }
.dot[data-read="yes"], .dot[data-state="ok"] { background: var(--access-ok) }
.dot[data-read="error"], .dot[data-state="warn"] { background: var(--access-warn) }
.dot[data-state="fail"] { background: var(--access-fail) }
.dot[data-state="pending"] { background: transparent; box-shadow: inset 0 0 0 1px var(--access-off) }
/* El detalle */
.fact { margin: 0; padding: var(--space-2) var(--gutter) 0 }
.answer { padding: var(--space-2) var(--gutter) }
.answer-head { display: flex; align-items: center; gap: var(--space-2) }
.answer-head .state { color: var(--fg-2) }
.answer[data-read="yes"] .state { color: var(--access-ok) }
.answer-head .ms { margin-left: auto; font-size: var(--text-xs) }
.answer-detail { margin: var(--space-1) 0 0 calc(8px + var(--space-2)); color: var(--fg-3); font-size: var(--text-sm); overflow-wrap: anywhere }
.command { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-1) var(--gutter) }
.command code { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--fg-2) }
/* La consola */
.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .dot { align-self: center; margin-right: 0 }
.log-line .name { flex: none; width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.log-line .state { min-width: 80px; color: var(--fg-3) }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2) }
.log-line[data-state="off"] .name { color: var(--fg-3) }
.log-line[data-state="fail"] .state { color: var(--access-fail) }
</style>
