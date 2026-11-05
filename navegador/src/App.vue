<script setup>
/* navegador · la interfaz. Todo lo hace la API en Go (playwright-go): acá se elige el sitio, se abre la ventana
 * para loguearse a mano, se lanza el recorrido y se lee el mapa. El sitio y la página elegida viven en la URL.
 *
 * Las regiones son las de la base: el sidebar con UN árbol (cada sitio es una raíz y sus páginas cuelgan
 * adentro, como las carpetas del Explorer de VS Code), el editor con la página como documento (o el resumen del sitio), el sidebar
 * secundario con el detalle de la página y la consola abajo. */
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
function pickSite(slug) { siteSlug.value = slug; pageId.value = ''; expandSite(slug, true) }
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
const page = computed(() => pages.value.find((p) => p.id === pageId.value))
function pickPage(id) { pageId.value = id; auxOpen.value = true; saveSize('navegador.aux-open', 1) }
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

// ── el detalle de la página (sidebar secundario) ──
const TABS = [
  { id: 'forms', label: 'Formularios', count: (p) => (p.forms || []).length },
  { id: 'links', label: 'Enlaces', count: (p) => (p.links || []).length },
  { id: 'calls', label: 'Llamadas', count: (p) => (p.requests || []).length },
  { id: 'console', label: 'Consola', count: (p) => (p.console || []).length },
]
const tab = ref(TABS.some((t) => t.id === readPref('navegador.tab', 'forms')) ? readPref('navegador.tab', 'forms') : 'forms')
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
const parentPage = computed(() => page.value && pages.value.find((p) => p.id === page.value.parent))
async function copyURL() { try { await navigator.clipboard.writeText(page.value.finalUrl || page.value.url) } catch { /* sin permiso */ } }

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
const panelH = ref(readSize('navegador.panel-h', 180))
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
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 180,
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
    <!-- SIDEBAR · el explorador: un solo árbol, cada sitio es una raíz y sus páginas cuelgan adentro -->
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Explorador">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Explorador</span>
        <span class="count" :class="{ filtered: filter }">{{ sites.length }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" :aria-pressed="filtering" title="Filtrar páginas" aria-label="Filtrar páginas" @click="toggleFilter">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" title="Plegar las carpetas" aria-label="Plegar las carpetas" @click="collapseAll">
            <span class="ui-icon" data-icon="collapse" aria-hidden="true"></span>
          </button>
          <RegionMenu :items="treeMenu" :active="grouping !== 'folders' || !showPending" @select="onTreeMenu" />
        </div>
      </div>
      <div class="region-body">
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

    <!-- EDITOR · la página elegida como documento, o el resumen del sitio -->
    <main class="editor">
      <div class="region-head">
        <span class="ellipsis">{{ page ? pathOf(page.url) : site ? site.name : 'navegador' }}</span>
        <div class="region-actions">
          <template v-if="page">
            <button type="button" class="region-action" :disabled="state.busy" title="Abrir esta página en la ventana" aria-label="Abrir esta página en la ventana"
              @click="run('browse', page.finalUrl || page.url)">
              <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" title="Copiar la URL" aria-label="Copiar la URL" @click="copyURL">
              <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" title="Volver al resumen del sitio" aria-label="Volver al resumen del sitio" @click="pageId = ''">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </template>
        </div>
      </div>
      <div class="region-body">
        <div v-if="runError" class="alert alert-destructive" role="alert">
          <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
          <div class="alert-title">{{ runError }}</div>
        </div>

        <div v-if="!site" class="empty">
          <div class="empty-title">Ningún sitio elegido</div>
          <div class="empty-desc">Pegá una URL en Sitios: se agrega y se explora sola. Si pide login, abrí la ventana, entrá a mano y volvé a explorar.</div>
        </div>

        <article v-else-if="page" class="doc">
          <h1 class="doc-title">{{ page.title || pathOf(page.url) }}</h1>
          <a class="doc-url" :href="page.finalUrl || page.url" target="_blank" rel="noopener noreferrer"><code>{{ page.finalUrl || page.url }}</code></a>
          <dl class="facts">
            <dt>Estado</dt><dd :class="statusClass(page.status)">{{ page.status || '—' }}<template v-if="page.authWall"> · mandó al login</template></dd>
            <dt>Stack</dt><dd>{{ (page.stack || []).join(' · ') || 'sin señales conocidas' }}</dd>
            <dt>Llegó desde</dt>
            <dd>
              <button v-if="parentPage" type="button" class="btn btn-link btn-xs" @click="pickPage(parentPage.id)">{{ pathOf(parentPage.url) }}</button>
              <template v-else>{{ page.depth === 0 ? 'es la entrada' : '—' }}</template>
            </dd>
            <dt>Visitada</dt><dd>{{ fmtFull(page.at) }} · {{ page.source === 'manual' ? 'a mano' : `explorando, nivel ${page.depth}` }}</dd>
            <dt>Estructura</dt>
            <dd>{{ Object.entries(page.landmarks || {}).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ') || '—' }}</dd>
            <template v-if="page.error"><dt>Error</dt><dd class="bad">{{ page.error }}</dd></template>
          </dl>
          <img v-if="page.shot" class="shot" :src="`/api/shot?site=${siteSlug}&id=${page.id}&t=${page.at}`" :alt="`Captura de ${page.title}`" />
          <h2 class="doc-h">Encabezados</h2>
          <p v-if="!(page.headings || []).length" class="muted">Ninguno.</p>
          <div v-for="(h, i) in page.headings || []" :key="i" class="heading" :style="{ paddingLeft: `calc(${(h.level - 1)} * var(--indent))` }">
            <small class="muted">h{{ h.level }}</small> {{ h.text }}
          </div>
          <h2 class="doc-h">Botones</h2>
          <p class="muted">{{ (page.buttons || []).join(' · ') || 'Ninguno.' }}</p>
        </article>

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

    <!-- SIDEBAR SECUNDARIO · el detalle de la página -->
    <aside v-if="shown.aux" class="auxiliarybar" aria-label="Detalle de la página">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <nav class="tabs">
        <button v-for="t in TABS" :key="t.id" type="button" class="tab" :class="{ on: tab === t.id }" @click="tab = t.id">
          {{ t.label }} <span v-if="t.count(page)" class="count">{{ t.count(page) }}</span>
        </button>
      </nav>
      <div class="region-body">
        <template v-if="tab === 'forms'">
          <p v-if="!(page.forms || []).length" class="none">Sin formularios ni campos.</p>
          <section v-for="(f, i) in page.forms || []" :key="i">
            <div class="region-head group">
              <span>{{ f.loose ? 'Campos sueltos (sin form)' : `${(f.method || 'get').toUpperCase()} ${f.action ? pathOf(f.action) : '(misma página)'}` }}</span>
              <span class="count">{{ (f.fields || []).length }}</span>
            </div>
            <div v-for="(x, j) in f.fields || []" :key="j" class="row stacked">
              <span>{{ x.label || x.placeholder || x.name || x.id || '—' }}<template v-if="x.required"> *</template></span>
              <span class="row-desc">{{ x.tag === 'input' ? x.type || 'text' : x.tag }}<template v-if="x.name"> · name={{ x.name }}</template><template v-if="(x.options || []).length"> · {{ x.options.join(' / ') }}</template></span>
            </div>
            <p v-if="(f.submits || []).length" class="none">Envía con: {{ f.submits.join(' · ') }}</p>
          </section>
        </template>

        <template v-else-if="tab === 'links'">
          <p v-if="!internalLinks.length" class="none">Sin enlaces.</p>
          <div v-for="l in internalLinks" :key="l.href" class="row stacked" :class="{ clickable: pageByURL(l.href) }"
            @click="pageByURL(l.href) && pickPage(pageByURL(l.href).id)">
            <span>{{ l.text || '(sin texto)' }}</span>
            <span class="row-desc">
              <template v-if="!l.internal">afuera · </template><template v-else-if="pageByURL(l.href)">en el mapa · </template>{{ l.internal ? pathOf(l.href) : l.href }}
            </span>
          </div>
        </template>

        <template v-else-if="tab === 'calls'">
          <p v-if="!(page.requests || []).length" class="none">Sin llamadas registradas.</p>
          <div v-for="(r, i) in page.requests || []" :key="i" class="row stacked" :title="r.url">
            <span><code>{{ r.method }}</code> <span :class="statusClass(r.status)">{{ r.status }}</span> <small class="muted">{{ r.type }}</small></span>
            <span class="row-desc">{{ r.url }}</span>
          </div>
        </template>

        <template v-else-if="tab === 'console'">
          <p v-if="!(page.console || []).length" class="none">La consola no dijo nada.</p>
          <div v-for="(c, i) in page.console || []" :key="i" class="log-line"><span class="what wrap" :class="{ bad: !c.startsWith('warning') }">{{ c }}</span></div>
        </template>
      </div>
    </aside>

    <!-- PANEL · lo que hace el navegador, en vivo -->
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
.shot { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-control) }
.heading { font-size: var(--text-sm) }
.stats { display: flex; flex-wrap: wrap; gap: var(--space-6) }
.stat { display: flex; flex-direction: column }
.stat strong { font-size: var(--text-title); font-variant-numeric: tabular-nums }
.stat span { font-size: var(--text-xs); color: var(--fg-3) }
.controls { display: flex; gap: var(--space-3) }
.controls .field { width: 160px }
.actions { display: flex; gap: var(--space-2) }

.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-sm) }
.log-line .what.wrap { white-space: pre-wrap; overflow-wrap: anywhere }
.log-line[data-kind="error"] .what { color: var(--status-bad) }
.log-line[data-kind="warn"] .what { color: var(--status-warn) }
</style>
