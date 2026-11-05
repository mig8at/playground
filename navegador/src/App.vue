<script setup>
/* navegador · la interfaz. Todo lo hace la API en Go (playwright-go): acá se elige el sitio, se abre la ventana
 * para loguearse a mano, se lanza el recorrido y se lee el mapa. El sitio y la página elegida viven en la URL. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'
import RegionMenu from './RegionMenu.vue'

// ── la ruta: #/<sitio>?page=<id> ──
const route = readHashRoute()
const siteSlug = ref(route.parts[0] || '')
const pageId = ref(route.params.get('page') || '')
function writeRoute(push) { setRoute(hashRoute(siteSlug.value ? [siteSlug.value] : [], { page: pageId.value }), { push }) }
function onHashChange() {
  const r = readHashRoute()
  siteSlug.value = r.parts[0] || ''
  pageId.value = r.params.get('page') || ''
}

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
function pickSite(slug) { siteSlug.value = slug; pageId.value = '' }
const site = computed(() => sites.value.find((s) => s.slug === siteSlug.value))

// ── el mapa del sitio ──
const pages = ref([])
const pagesError = ref('')
const filter = ref('')
async function loadPages() {
  if (!siteSlug.value) { pages.value = []; return }
  const slug = siteSlug.value
  try {
    const body = await api(`/api/pages?site=${encodeURIComponent(slug)}`)
    if (slug === siteSlug.value) { pages.value = body; pagesError.value = '' }
  } catch (e) {
    pagesError.value = e.message
  }
}
const shownPages = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return pages.value
  return pages.value.filter((p) => (p.url + ' ' + p.title + ' ' + (p.stack || []).join(' ')).toLowerCase().includes(q))
})
const page = computed(() => pages.value.find((p) => p.id === pageId.value))
function pickPage(id) { pageId.value = id; auxOpen.value = true; saveSize('navegador.aux-open', 1) }
async function clearPages() {
  if (!site.value || !confirm(`¿Vaciar el mapa de ${site.value.name}? La sesión se conserva.`)) return
  await api(`/api/pages?site=${encodeURIComponent(siteSlug.value)}`, { method: 'DELETE' })
  pageId.value = ''
  await Promise.all([loadPages(), loadSites()])
}

// Lo que se ve en el resumen del mapa: el stack más visto y el total de llamadas a backends.
const summary = computed(() => {
  const stack = new Map()
  let calls = 0, errors = 0, walls = 0
  for (const p of pages.value) {
    for (const s of p.stack || []) stack.set(s, (stack.get(s) || 0) + 1)
    calls += (p.requests || []).length
    errors += (p.console || []).length
    if (p.authWall) walls++
  }
  return { stack: [...stack.keys()], calls, errors, walls }
})

// ── correr: la ventana o el recorrido ──
const state = ref({ busy: false, log: [] })
const log = ref([])
const runError = ref('')
const maxPages = ref(readPref('navegador.max', 40))
const maxDepth = ref(readPref('navegador.depth', 3))
watch(maxPages, (v) => savePref('navegador.max', v))
watch(maxDepth, (v) => savePref('navegador.depth', v))
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
      if (st.site === siteSlug.value) loadPages()
    }
    if (wasBusy && !st.busy) loadSites()
  } catch { /* la API se cae al reiniciar: se reintenta */ }
  pollTimer = setTimeout(poll, state.value.busy ? 1000 : 3000)
}
async function run(kind, start = '') {
  runError.value = ''
  panelOpen.value = true
  saveSize('navegador.panel-open', 1)
  try {
    const q = `site=${encodeURIComponent(siteSlug.value)}${start ? `&start=${encodeURIComponent(start)}` : ''}`
    if (kind === 'browse') await api(`/api/browse?${q}`, { method: 'POST' })
    else await api(`/api/explore?${q}`, { method: 'POST', body: JSON.stringify({ max: Number(maxPages.value), depth: Number(maxDepth.value), start }) })
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

// ── el detalle de la página ──
const TABS = [
  { id: 'summary', label: 'Resumen' },
  { id: 'forms', label: 'Formularios', count: (p) => (p.forms || []).length },
  { id: 'links', label: 'Enlaces', count: (p) => (p.links || []).length },
  { id: 'calls', label: 'Llamadas', count: (p) => (p.requests || []).length },
  { id: 'console', label: 'Consola', count: (p) => (p.console || []).length },
]
const tab = ref(readPref('navegador.tab', 'summary'))
watch(tab, (v) => savePref('navegador.tab', v))
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

// ── formato ──
function path(u) {
  try { const x = new URL(u); return (x.pathname || '/') + x.search + (x.hash.startsWith('#/') ? x.hash : '') } catch { return u }
}
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')
const fmtFull = (t) => (t && !t.startsWith('0001') ? new Date(t).toLocaleString('es-CO') : '')
const statusClass = (s) => (s >= 400 ? 'bad' : s >= 300 ? 'warn' : '')

// ── las regiones, con el contrato de la base ──
const sidebarOpen = ref(readSize('navegador.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('navegador.sidebar-w', 280))
const auxOpen = ref(readSize('navegador.aux-open', 1) !== 0)
const auxW = ref(readSize('navegador.aux-w', 420))
const panelOpen = ref(readSize('navegador.panel-open', 1) !== 0)
const panelH = ref(readSize('navegador.panel-h', 200))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 240)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: auxOpen.value && page.value ? auxW.value : 0, min },
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
  label: 'Ancho de los sitios', sign: 1, defaultValue: 280,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('navegador.sidebar-open', v ? 1 : 0); if (v) saveSize('navegador.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho del detalle', sign: -1, defaultValue: 420,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('navegador.aux-open', v ? 1 : 0); if (v) saveSize('navegador.aux-w', auxW.value) },
}
const panelResize = {
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 200,
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

const mapMenu = computed(() => [
  { id: 'reload', label: 'Volver a leer el mapa', icon: 'refresh' },
  { id: 'clear', label: 'Vaciar el mapa', icon: 'trash', disabled: !pages.value.length || busyHere.value },
])
function onMapMenu(id) { if (id === 'reload') loadPages(); if (id === 'clear') clearPages() }

watch(siteSlug, () => { writeRoute(true); filter.value = ''; loadPages() })
watch(pageId, () => writeRoute(false))

const themeToggle = ref(null)
let themeBinding = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  await loadSites()
  writeRoute(false)
  loadPages()
  poll()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearTimeout(pollTimer)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Sitios">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head"><span>Sitios</span><span class="count">{{ sites.length }}</span></div>
      <div class="region-body">
        <form class="add" @submit.prevent="addSite">
          <input v-model="newURL" class="input input-sm" placeholder="https://sitio.com/entrada" aria-label="URL de entrada del sitio" />
          <button type="submit" class="region-action" :disabled="adding || !newURL.trim()" title="Agregar el sitio" aria-label="Agregar el sitio">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
          </button>
        </form>
        <p v-if="sitesError" class="none bad">{{ sitesError }}</p>
        <div v-for="s in sites" :key="s.slug" class="row stacked" :class="{ on: s.slug === siteSlug }"
          role="button" tabindex="0" @click="pickSite(s.slug)" @keydown.enter="pickSite(s.slug)">
          <span>{{ s.name }}</span>
          <span class="row-desc">{{ s.pages }} páginas · {{ s.hasSession ? 'con perfil guardado' : 'sin abrir todavía' }}</span>
          <div class="row-actions">
            <button type="button" class="region-action" title="Olvidar el sitio" aria-label="Olvidar el sitio" @click.stop="removeSite(s)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <p v-if="!sites.length && !sitesError" class="none">Agregá la URL de entrada de un sitio para empezar.</p>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ site ? site.name : 'Mapa' }}</span>
        <span v-if="site" class="count">{{ filter ? `${shownPages.length} / ${pages.length}` : pages.length }}</span>
        <div v-if="site" class="region-actions">
          <button type="button" class="region-action" :disabled="state.busy" title="Abrir la ventana: loguearte a mano y navegar (cada página entra al mapa)"
            aria-label="Abrir la ventana" @click="run('browse')">
            <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" :disabled="state.busy" title="Explorar solo, sin ventana, con la sesión guardada"
            aria-label="Explorar" @click="run('explore')">
            <span class="ui-icon" data-icon="play" aria-hidden="true"></span>
          </button>
          <button v-if="busyHere" type="button" class="region-action" title="Parar" aria-label="Parar" @click="stop">
            <span class="ui-icon" data-icon="stop" aria-hidden="true"></span>
          </button>
          <RegionMenu :items="mapMenu" @select="onMapMenu" />
        </div>
      </div>
      <div v-if="site" class="subband">
        <span class="input-group input-group-xs grow">
          <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          <input v-model="filter" class="input input-xs" placeholder="Filtrar por ruta, título o stack" aria-label="Filtrar páginas" />
        </span>
        <label class="knob">Páginas <input v-model="maxPages" class="input input-xs num-input" type="number" min="1" max="500" /></label>
        <label class="knob">Niveles <input v-model="maxDepth" class="input input-xs num-input" type="number" min="1" max="10" /></label>
      </div>
      <div class="region-body">
        <div v-if="runError" class="alert alert-destructive" role="alert">
          <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
          <div class="alert-title">{{ runError }}</div>
        </div>
        <div v-if="!site" class="empty">
          <div class="empty-title">Ningún sitio elegido</div>
          <div class="empty-desc">Agregá uno a la izquierda. Si pide login, abrí la ventana, entrá a mano y después explorá.</div>
        </div>
        <div v-else-if="!pages.length" class="empty">
          <div class="empty-title">El mapa está vacío</div>
          <div class="empty-desc">
            {{ site.hasSession ? 'El perfil ya tiene cookies: si te logueaste en la ventana, podés explorar directo.' : 'Si el sitio pide login, abrí la ventana primero y entrá a mano: la sesión queda guardada en su perfil.' }}
          </div>
          <div class="empty-content">
            <button type="button" class="btn btn-lg" :disabled="state.busy" @click="run('browse')">Abrir la ventana</button>
            <button type="button" class="btn btn-outline btn-lg" :disabled="state.busy" @click="run('explore')">Explorar</button>
          </div>
        </div>
        <template v-else>
          <p class="none">
            <template v-if="summary.stack.length">Hecho con {{ summary.stack.join(' · ') }} · </template>
            {{ summary.calls }} llamadas a backends · {{ summary.errors }} errores de consola
            <span v-if="summary.walls" class="bad"> · {{ summary.walls }} páginas mandaron al login</span>
          </p>
          <table class="table">
            <thead><tr><th>Ruta</th><th>Título</th><th class="num">Estado</th><th class="num">Form.</th><th class="num">Llam.</th><th class="num">Err.</th><th>Vía</th></tr></thead>
            <tbody>
              <tr v-for="p in shownPages" :key="p.id" :class="{ on: p.id === pageId }" class="clickable" tabindex="0"
                @click="pickPage(p.id)" @keydown.enter="pickPage(p.id)">
                <td class="route" :title="p.url"><code>{{ path(p.url) }}</code></td>
                <td class="title">{{ p.title || p.error || '—' }}</td>
                <td class="num" :class="statusClass(p.status)">{{ p.authWall ? 'login' : p.status || '' }}</td>
                <td class="num">{{ (p.forms || []).length || '' }}</td>
                <td class="num">{{ (p.requests || []).length || '' }}</td>
                <td class="num" :class="{ bad: (p.console || []).length }">{{ (p.console || []).length || '' }}</td>
                <td class="muted nowrap">{{ p.source === 'manual' ? 'a mano' : `nivel ${p.depth}` }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </main>

    <aside v-if="shown.aux" class="auxiliarybar" aria-label="Detalle de la página">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <nav class="tabs">
        <button v-for="t in TABS" :key="t.id" type="button" class="tab" :class="{ on: tab === t.id }" @click="tab = t.id">
          {{ t.label }} <span v-if="t.count && t.count(page)" class="count">{{ t.count(page) }}</span>
        </button>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="state.busy" title="Abrir esta página en la ventana" aria-label="Abrir esta página en la ventana"
            @click="run('browse', page.finalUrl || page.url)">
            <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" title="Cerrar el detalle" aria-label="Cerrar el detalle" @click="pageId = ''">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </nav>
      <div class="subband"><span class="grow ellipsis" :title="page.finalUrl || page.url"><code>{{ page.finalUrl || page.url }}</code></span></div>
      <div class="region-body">
        <template v-if="tab === 'summary'">
          <div class="detail">
            <img v-if="page.shot" class="shot" :src="`/api/shot?site=${siteSlug}&id=${page.id}&t=${page.at}`" :alt="`Captura de ${page.title}`" />
            <dl class="facts">
              <dt>Título</dt><dd>{{ page.title || '—' }}</dd>
              <dt>Estado</dt><dd :class="statusClass(page.status)">{{ page.status || '—' }}<template v-if="page.authWall"> · mandó al login</template></dd>
              <dt>Stack</dt><dd>{{ (page.stack || []).join(' · ') || 'sin señales conocidas' }}</dd>
              <dt>Idioma</dt><dd>{{ page.lang || '—' }}</dd>
              <dt>Visitada</dt><dd>{{ fmtFull(page.at) }} · {{ page.source === 'manual' ? 'a mano' : `explorando, nivel ${page.depth}` }}</dd>
              <dt>Estructura</dt>
              <dd>{{ Object.entries(page.landmarks || {}).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ') || '—' }}</dd>
              <template v-if="page.error"><dt>Error</dt><dd class="bad">{{ page.error }}</dd></template>
            </dl>
          </div>
          <div class="region-head group"><span>Encabezados</span><span class="count">{{ (page.headings || []).length }}</span></div>
          <div v-for="(h, i) in page.headings || []" :key="i" class="heading" :style="{ paddingLeft: `calc(var(--gutter) + ${(h.level - 1)} * var(--indent))` }">
            <small class="muted">h{{ h.level }}</small> {{ h.text }}
          </div>
          <div class="region-head group"><span>Botones</span><span class="count">{{ (page.buttons || []).length }}</span></div>
          <p class="none">{{ (page.buttons || []).join(' · ') || 'Ninguno.' }}</p>
        </template>

        <template v-else-if="tab === 'forms'">
          <p v-if="!(page.forms || []).length" class="none">Sin formularios ni campos.</p>
          <section v-for="(f, i) in page.forms || []" :key="i">
            <div class="region-head group">
              <span>{{ f.loose ? 'Campos sueltos (sin form)' : `${(f.method || 'get').toUpperCase()} ${f.action ? path(f.action) : '(misma página)'}` }}</span>
              <span class="count">{{ (f.fields || []).length }}</span>
            </div>
            <table class="table">
              <thead><tr><th>Campo</th><th>Tipo</th><th>name</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(x, j) in f.fields || []" :key="j">
                  <td>{{ x.label || x.placeholder || x.id || '—' }}<div v-if="(x.options || []).length" class="muted small">{{ x.options.join(' · ') }}</div></td>
                  <td class="muted">{{ x.tag === 'input' ? x.type || 'text' : x.tag }}</td>
                  <td><code>{{ x.name }}</code></td>
                  <td class="muted">{{ x.required ? 'requerido' : '' }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="(f.submits || []).length" class="none">Envía con: {{ f.submits.join(' · ') }}</p>
          </section>
        </template>

        <template v-else-if="tab === 'links'">
          <p v-if="!internalLinks.length" class="none">Sin enlaces.</p>
          <div v-for="l in internalLinks" :key="l.href" class="row stacked" :class="{ clickable: pageByURL(l.href) }"
            @click="pageByURL(l.href) && pickPage(pageByURL(l.href).id)">
            <span>{{ l.text || '(sin texto)' }}</span>
            <span class="row-desc">
              <template v-if="!l.internal">afuera · </template><template v-else-if="pageByURL(l.href)">en el mapa · </template>{{ l.internal ? path(l.href) : l.href }}
            </span>
          </div>
        </template>

        <template v-else-if="tab === 'calls'">
          <p v-if="!(page.requests || []).length" class="none">Sin llamadas registradas.</p>
          <div v-for="(r, i) in page.requests || []" :key="i" class="log-line call">
            <span class="method">{{ r.method }}</span>
            <span class="num" :class="statusClass(r.status)">{{ r.status }}</span>
            <span class="muted">{{ r.type }}</span>
            <span class="what" :title="r.url">{{ r.url }}</span>
          </div>
        </template>

        <template v-else-if="tab === 'console'">
          <p v-if="!(page.console || []).length" class="none">La consola no dijo nada.</p>
          <div v-for="(c, i) in page.console || []" :key="i" class="log-line"><span class="what wrap" :class="{ bad: !c.startsWith('warning') }">{{ c }}</span></div>
        </template>
      </div>
    </aside>

    <section v-if="shown.panel" class="panel" aria-label="Consola">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <div class="region-head">
        <span>Consola</span>
        <span v-if="state.busy" class="muted head-note">{{ busyLabel }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Limpiar la consola" aria-label="Limpiar la consola" @click="log = []">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <p v-if="!log.length" class="none">Acá sale lo que hace el navegador: cada página que analiza y lo que falla.</p>
        <div v-for="l in log" :key="l.seq" class="log-line" :data-kind="l.kind">
          <span class="log-time">{{ fmtTime(l.at) }}</span><span class="what wrap">{{ l.text }}</span>
        </div>
      </div>
    </section>

    <footer class="statusbar">
      <span>{{ busyLabel || 'Quieto' }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar los sitios" aria-label="Mostrar u ocultar los sitios" @click="toggleSidebar">
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
/* Lo que la base no da. Bandas, filas, tabla, pestañas, grupos, avisos, líneas y pie son de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.add { display: flex; gap: var(--space-1); align-items: center; padding: var(--space-2) var(--gutter) }
.add .input { flex: 1; min-width: 0 }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.muted { color: var(--fg-3) }
.small { font-size: var(--text-xs) }
.bad { color: var(--status-bad) }
.warn { color: var(--status-warn) }
.grow { flex: 1; min-width: 0 }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.head-note { font-size: var(--text-sm); margin-left: var(--space-2) }
.clickable { cursor: pointer }
.nowrap { white-space: nowrap }
.knob { display: flex; gap: var(--space-1); align-items: center; font-size: var(--text-sm); color: var(--fg-2); white-space: nowrap }
.num-input { width: 56px }
.alert { margin: var(--space-2) var(--gutter) }
.empty-content { display: flex; gap: var(--space-2) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
.route code { display: block; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.title { min-width: 160px }
.detail { padding: var(--space-3) var(--gutter); display: flex; flex-direction: column; gap: var(--space-3) }
.shot { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-control) }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-3); margin: 0; font-size: var(--text-sm) }
.facts dt { color: var(--fg-3) }
.facts dd { margin: 0; overflow-wrap: anywhere }
.heading { padding: 2px var(--gutter); font-size: var(--text-sm) }
.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-sm) }
.log-line .what.wrap { white-space: pre-wrap; overflow-wrap: anywhere }
.log-line[data-kind="error"] .what { color: var(--status-bad) }
.log-line[data-kind="warn"] .what { color: var(--status-warn) }
.call .method { min-width: 48px; font-family: var(--font-mono); font-size: var(--text-sm) }
.call .num { min-width: 32px; font-variant-numeric: tabular-nums }
</style>
