<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, refreshResizers } from './workbench.js'

// EL VISOR: un diseño de Figma leído como recorrido. A la izquierda los carriles que armó el
// diseñador, al centro la pantalla con las zonas del prototipo, a la derecha lo que la pantalla dice
// y a dónde lleva. Todo sale de `/api/map` (connectors/figma, `Structure`) y `/api/screen`.

const refInput = ref('')
const loading = ref(false)
const error = ref('')
const data = ref(null) // { key, node, structure, cached }
const currentID = ref('')
const trail = ref([]) // las pantallas por las que se vino, para volver
const showHotspots = ref(true)
const imageFailed = ref(false)
// Cómo se ve la pantalla: la imagen que exporta Figma, el HTML que traduce el server, o las dos lado a
// lado —la imagen es la vara del HTML—.
const modes = [{ id: 'image', label: 'Imagen' }, { id: 'html', label: 'HTML' }, { id: 'compare', label: 'Comparar' }]
const mode = ref((() => { try { return localStorage.getItem('visor.mode') || 'image' } catch { return 'image' } })())
watch(mode, (m) => { try { localStorage.setItem('visor.mode', m) } catch { /* preferencia opcional */ } writeRoute(); nextTick(center) })
// En la ruta el modo va en castellano, como lo lee la cabecera.
const modeSlugs = { image: 'imagen', html: 'html', compare: 'comparar' }
const panes = computed(() => (mode.value === 'compare' ? ['image', 'html'] : [mode.value]))
const report = ref(null)

// ── las regiones, con el mismo contrato que el resto de las herramientas ──
const MIN_EDITOR = 360
const sidebarOpen = ref(readSize('visor.sidebar-open', 1) !== 0)
const auxOpen = ref(readSize('visor.aux-open', 1) !== 0)
const sidebarW = ref(readSize('visor.sidebar-w', 300))
const auxW = ref(readSize('visor.aux-w', 340))
function resizeOptions(which) {
  const isSidebar = which === 'sidebar'
  return {
    label: isSidebar ? 'Ancho de los carriles' : 'Ancho del detalle',
    min: 220, sign: isSidebar ? 1 : -1, defaultValue: isSidebar ? 300 : 340,
    max: () => Math.max(220, window.innerWidth - (isSidebar ? auxShownW() : sidebarShownW()) - MIN_EDITOR),
    get: () => (isSidebar ? sidebarW.value : auxW.value),
    set: (v) => { if (isSidebar) sidebarW.value = v; else auxW.value = v },
    commit: (v) => saveSize(isSidebar ? 'visor.sidebar-w' : 'visor.aux-w', v),
  }
}
const sidebarShownW = () => (sidebarOpen.value ? sidebarW.value : 0)
const auxShownW = () => (auxOpen.value ? auxW.value : 0)
const layoutVars = computed(() => ({ '--sidebar-w': sidebarW.value + 'px', '--auxiliarybar-w': auxW.value + 'px' }))
function toggle(which) {
  if (which === 'sidebar') { sidebarOpen.value = !sidebarOpen.value; saveSize('visor.sidebar-open', sidebarOpen.value ? 1 : 0) }
  else { auxOpen.value = !auxOpen.value; saveSize('visor.aux-open', auxOpen.value ? 1 : 0) }
  nextTick(() => refreshResizers(document.querySelector('.workbench')))
}

// ── el mapa ──
const structure = computed(() => data.value?.structure || null)
// Una página trae secciones adentro: cada una es un grupo de carriles. Se aplana a una lista de
// grupos para la barra, sin perder de qué sección viene cada carril.
function groupsFor(st) {
  const out = []
  const walk = (x, depth) => {
    if (x.lanes?.length) out.push({ id: x.id, name: x.name, type: x.type, depth, lanes: x.lanes, choices: x.choices || [] })
    for (const sub of x.sections || []) walk(sub, depth + 1)
  }
  if (st) walk(st, 0)
  return out
}
const groups = computed(() => groupsFor(structure.value))
const screens = computed(() => {
  const all = new Map()
  for (const g of groups.value) {
    g.lanes.forEach((lane, li) => lane.screens.forEach((sc, i) => {
      all.set(sc.id, { ...sc, group: g, lane, laneIndex: li, index: i })
    }))
  }
  return all
})
const current = computed(() => screens.value.get(currentID.value) || null)
const screenCount = computed(() => screens.value.size)

// Lo que llega a la pantalla actual desde otras (el prototipo al revés): sirve para entender de dónde
// se viene cuando se entra por la mitad de un carril.
const incoming = computed(() => {
  const out = []
  if (!current.value) return out
  for (const sc of screens.value.values()) {
    for (const h of sc.hotspots || []) if (h.to === current.value.id) out.push({ from: sc, via: h.via })
  }
  return out
})
const variantsOfCurrent = computed(() => {
  if (!current.value?.title) return []
  const t = current.value.title.toLowerCase()
  return [...screens.value.values()].filter((sc) => sc.id !== current.value.id && sc.title?.toLowerCase() === t)
})

// ── la biblioteca: equipos y archivos, en acordeón ──
const library = ref({ teams: [], opened: [] })
const libraryBusy = ref(false)
const libraryError = ref('')
const adding = ref(false)
const addURL = ref('')
const pagesOf = ref({}) // clave del archivo → 'loading' | { pages } | { error }
const readSet = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')) } catch { return new Set() } }
const saveSet = (k, set) => { try { localStorage.setItem(k, JSON.stringify([...set])) } catch { /* preferencia opcional */ } }
const openFiles = ref(new Set([...readSet('visor.open-files')].slice(-1)))
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : '')
// Un grupo por proyecto de cada equipo, y al final los abiertos en el visor que no estén ya en uno.
const projectGroups = computed(() => {
  const out = []
  const inProjects = new Set()
  for (const t of library.value.teams || []) {
    if (t.error) { out.push({ id: 'team-' + t.id, name: `Equipo ${t.id}`, files: [], error: t.error }); continue }
    for (const p of t.projects || []) {
      for (const f of p.files || []) inProjects.add(f.key)
      out.push({ id: 'project-' + p.id, name: (t.projects.length > 1 || (library.value.teams || []).length > 1) ? `${p.name} · ${t.name}` : p.name,
        error: p.error, files: (p.files || []).map((f) => ({ key: f.key, name: f.name, when: fmtDay(f.last_modified) })) })
    }
  }
  for (const p of library.value.projects || []) {
    for (const f of p.files || []) inProjects.add(f.key)
    out.push({ id: 'project-' + p.id, name: p.name || `Proyecto ${p.id}`, error: p.error,
      files: (p.files || []).map((f) => ({ key: f.key, name: f.name, when: fmtDay(f.last_modified) })) })
  }
  // Los archivos sueltos se agrupan por su carpeta de Figma, como en Figma; sin carpeta conocida van a
  // «Abiertos en el visor». Adentro, en orden alfabético: es una lista para encontrar un flujo.
  const byFolder = new Map()
  for (const o of (library.value.opened || []).filter((x) => !inProjects.has(x.key))) {
    const folder = o.folder || 'Abiertos en el visor'
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder).push({ key: o.key, name: o.name || o.key, when: fmtDay(o.opened_at) })
  }
  for (const [folder, files] of [...byFolder].sort(([a], [b]) => (a === 'Abiertos en el visor') - (b === 'Abiertos en el visor') || a.localeCompare(b))) {
    out.push({ id: 'folder-' + folder, name: folder, files: files.sort((x, y) => x.name.localeCompare(y.name, 'es')) })
  }
  return out
})
// Los flujos en la raíz: todos los archivos conocidos (de los equipos, de los proyectos y los sumados
// sueltos) en una sola lista alfabética, sin repetir.
const flows = computed(() => {
  const seen = new Map()
  for (const g of projectGroups.value) for (const f of g.files) if (!seen.has(f.key)) seen.set(f.key, f)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
})
const libraryErrors = computed(() => projectGroups.value.filter((g) => g.error).map((g) => `${g.name}: ${g.error}`))
const isOpenFile = (key) => openFiles.value.has(key)
// De a UN proyecto abierto: con varios, cada bloque quedaba de dos renglones y no se leía ninguno. Abrir
// uno cierra el anterior; el mapa del cerrado queda en memoria, así que volver es instantáneo.
async function toggleFile(key) {
  const s = openFiles.value.has(key) ? new Set() : new Set([key])
  openFiles.value = s; saveSet('visor.open-files', s)
  if (s.has(key)) { await openFlow(key); activate(key) }
}
async function loadPages(key) {
  if (pagesOf.value[key] && pagesOf.value[key] !== 'loading' && !pagesOf.value[key].error) return
  if (pagesOf.value[key] === 'loading') {
    // Ya se está pidiendo: se espera a ese pedido en vez de hacer otro.
    while (pagesOf.value[key] === 'loading') await new Promise((r) => setTimeout(r, 100))
    return
  }
  pagesOf.value = { ...pagesOf.value, [key]: 'loading' }
  try {
    const res = await fetch('/api/pages?key=' + encodeURIComponent(key))
    const body = await res.json()
    pagesOf.value = { ...pagesOf.value, [key]: res.ok ? { pages: body.pages || [] } : { error: body.error || `HTTP ${res.status}` } }
  } catch (e) { pagesOf.value = { ...pagesOf.value, [key]: { error: String(e.message || e) } } }
}
async function loadLibrary(fresh = false, init = {}) {
  libraryBusy.value = true
  libraryError.value = ''
  try {
    const res = await fetch('/api/library' + (fresh ? '?fresh=1' : ''), init)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    library.value = body
    return true
  } catch (e) { libraryError.value = String(e.message || e); return false } finally { libraryBusy.value = false }
}
async function addToLibrary() {
  const ok = await loadLibrary(false, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: addURL.value.trim() }) })
  if (ok) { addURL.value = ''; adding.value = false }
}
// ── el mapa de cada bloque ──
// Un bloque abierto muestra directamente las PANTALLAS de su flujo, no las páginas del archivo: Miguel
// no quiere ver «Cover · Benchmark · Flujo», quiere el recorrido. La página se elige sola: la que se
// llama «Flujo» o «Flow» (así las nombran los siete archivos de producto); si no hay, la primera que no
// sea portada, benchmark ni prototipo.
const maps = ref({}) // clave → la respuesta de /api/map de su página de flujo
const flowNodes = {} // clave → el id de su página de flujo: una ruta sin `nodo` se refiere a ella
const mapState = ref({}) // clave → 'loading' | { error }
const reFlowPage = /flujo|flow/i
const reSkipPage = /cover|portada|bench|bechmarck|prototipo|prototype|archivo|archive/i
function flowPage(pages) {
  return pages.find((p) => reFlowPage.test(p.name)) || pages.find((p) => !reSkipPage.test(p.name)) || pages[0] || null
}
async function openFlow(key, fresh = false) {
  if (maps.value[key] && !fresh) return
  mapState.value = { ...mapState.value, [key]: 'loading' }
  try {
    await loadPages(key)
    const pages = pagesOf.value[key]?.pages || []
    const page = flowPage(pages)
    if (!page) throw new Error(pagesOf.value[key]?.error || 'el archivo no tiene páginas')
    flowNodes[key] = page.id
    const q = new URLSearchParams({ ref: `https://www.figma.com/design/${key}/?node-id=${page.id.replace(':', '-')}` })
    if (fresh) q.set('fresh', '1')
    const res = await fetch('/api/map?' + q)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    maps.value = { ...maps.value, [key]: body }
    const { [key]: _, ...rest } = mapState.value
    mapState.value = rest
    // Si no hay nada al centro, o se volvió a leer el que se está mirando, este pasa a ser el activo. Con
    // un error a la vista (una ruta a un proyecto que no está) no: el bloque que se recordaba abierto lo
    // tapaba y la ruta quedaba reescrita a otro proyecto sin avisar.
    if ((!data.value && !error.value) || data.value?.key === key) activate(key)
  } catch (e) {
    mapState.value = { ...mapState.value, [key]: { error: String(e.message || e) } }
  }
}
function activate(key, screen = '') {
  const m = maps.value[key]
  if (!m) return
  error.value = ''
  if (!data.value || data.value.key !== key) { data.value = m; trail.value = [] } else data.value = m
  const first = groups.value[0]?.lanes[0]?.screens[0]?.id || ''
  go(screen && screens.value.has(screen) ? screen : (screens.value.has(currentID.value) ? currentID.value : first), false)
  writeRoute()
}
// Tocar una pantalla de un bloque que no es el que está al centro lo trae al centro.
function pick(key, id) {
  if (!data.value || data.value.key !== key) activate(key, id)
  else go(id)
}
const countOf = (key) => groupsFor(maps.value[key]?.structure).reduce((n, g) => n + g.lanes.reduce((m, l) => m + l.screens.length, 0), 0)
// Los bloques que arrancan abiertos (se recuerdan entre visitas) cargan su flujo.
watch(flows, (list) => { for (const f of list) if (openFiles.value.has(f.key)) openFlow(f.key) })

// ── cargar ──
async function load(ref_ = refInput.value, screen = '', fresh = false) {
  const value = (ref_ || '').trim()
  if (!value) return
  loading.value = true
  error.value = ''
  try {
    const q = new URLSearchParams({ ref: value })
    if (fresh) q.set('fresh', '1')
    const res = await fetch('/api/map?' + q)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    maps.value = { ...maps.value, [body.key]: body }
    data.value = body
    refInput.value = value
    loadLibrary()
    if (!openFiles.value.has(body.key)) {
      const set = new Set([body.key]); openFiles.value = set; saveSet('visor.open-files', set)
    }
    try { localStorage.setItem('visor.last', value) } catch { /* preferencia opcional */ }
    const first = groups.value[0]?.lanes[0]?.screens[0]?.id || ''
    go(screen && screens.value.has(screen) ? screen : first, false)
    writeRoute()
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    loading.value = false
  }
}

// ── navegar ──
function go(id, remember = true) {
  if (!id || id === currentID.value) return
  if (remember && currentID.value) trail.value.push(currentID.value)
  currentID.value = id
  imageFailed.value = false
  writeRoute()
  nextTick(() => document.querySelector(`[data-screen="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }))
}
function back() {
  const id = trail.value.pop()
  if (id) { currentID.value = id; writeRoute() }
}
function step(delta) {
  const c = current.value
  if (!c) return
  const next = c.lane.screens[c.index + delta]
  if (next) go(next.id)
}
function follow(h) {
  if (h.to && screens.value.has(h.to)) go(h.to)
}
const autoNext = computed(() => (current.value?.hotspots || []).find((h) => h.auto && h.to && screens.value.has(h.to)) || null)
const clickable = computed(() => (current.value?.hotspots || []).filter((h) => !h.auto))

// ── la ruta: /<proyecto>/<pantalla> ──
// Para poder enlazar una pantalla desde afuera (el tablero, una tarea) la ruta dice el PROYECTO por su
// nombre y la pantalla por su id de Figma con guion, como lo escribe Figma en `node-id`:
// `/credifamilia/1-4063`. Opcionales: `?modo=html|comparar` y `?nodo=<id>` cuando el mapa no es la
// página de flujo del archivo sino una sección pegada a mano. Vite sirve `index.html` en cualquier ruta
// sin extensión, así que no hace falta un router.
const slugOf = (name) => (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
// Un nombre que se repite no sirve de ruta: esos proyectos van por su clave, que no se repite.
function projectSlug(key) {
  const f = flows.value.find((x) => x.key === key)
  const slug = f && slugOf(f.name)
  if (!slug || flows.value.some((x) => x.key !== key && slugOf(x.name) === slug)) return key
  return slug
}
const keyOfProject = (project) => {
  const slug = project.toLowerCase()
  return flows.value.find((x) => slugOf(x.name) === slug)?.key || (/^[A-Za-z0-9]{15,}$/.test(project) ? project : '')
}
const toID = (s) => (s || '').replace(/-/g, ':')
const fromID = (id) => (id || '').replace(/:/g, '-')
const routePath = computed(() => {
  if (!data.value || !currentID.value) return ''
  const q = new URLSearchParams()
  if (data.value.node !== flowNodes[data.value.key]) q.set('nodo', fromID(data.value.node))
  if (mode.value !== 'image') q.set('modo', modeSlugs[mode.value])
  const qs = q.toString()
  return `/${projectSlug(data.value.key)}/${fromID(currentID.value)}${qs ? '?' + qs : ''}`
})
function writeRoute() {
  const p = routePath.value
  if (p && location.pathname + location.search + location.hash !== p) history.replaceState(null, '', p)
}
// El proyecto se resuelve cuando la biblioteca ya llegó: el nombre sale de ahí.
watch(flows, () => writeRoute())
function readRoute() {
  const m = location.pathname.match(/^\/([^/]+)(?:\/([0-9]+-[0-9]+))?\/?$/)
  if (!m) return null
  const q = new URLSearchParams(location.search)
  const modeID = Object.keys(modeSlugs).find((k) => modeSlugs[k] === q.get('modo')) || ''
  return { project: decodeURIComponent(m[1]), screen: toID(m[2]), node: toID(q.get('nodo')), mode: modeID }
}
const figmaRef = (key, node) => `https://www.figma.com/design/${key}/?node-id=${fromID(node)}`
async function openRoute(r) {
  const key = keyOfProject(r.project)
  if (!key) { error.value = `No hay un proyecto «${r.project}» en la barra.`; return }
  if (r.mode) mode.value = r.mode
  if (r.node) { await load(figmaRef(key, r.node), r.screen); return }
  const set = new Set([key]); openFiles.value = set; saveSet('visor.open-files', set)
  await openFlow(key)
  activate(key, r.screen)
  if (mapState.value[key]?.error) error.value = mapState.value[key].error
}
// Los enlaces de antes —#/<clave>/<nodo>/<pantalla>— siguen abriendo, y quedan reescritos a la ruta.
function readHash() {
  const m = location.hash.match(/^#\/([A-Za-z0-9]+)\/([0-9]+:[0-9]+)(?:\/([0-9]+:[0-9]+))?/)
  return m ? { ref: figmaRef(m[1], m[2]), screen: m[3] || '' } : null
}
const copied = ref(false)
async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.origin + routePath.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* sin permiso del portapapeles: la ruta sigue en la barra del navegador */ }
}

const htmlURL = computed(() => (data.value && current.value ? `/api/html?key=${data.value.key}&id=${encodeURIComponent(current.value.id)}` : ''))
// El reporte de la traducción: qué se tradujo y qué no. Se pide al cambiar de pantalla sólo si se está
// mirando el HTML, para no traducir pantallas que nadie abre.
watch([htmlURL, mode], async ([u, m]) => {
  report.value = null
  if (!u || m === 'image') return
  try {
    const res = await fetch(u + '&report=1')
    if (res.ok && u === htmlURL.value) report.value = await res.json()
  } catch { /* el reporte es un extra: sin él, la pantalla se ve igual */ }
}, { immediate: true })
const missingList = computed(() => Object.entries(report.value?.missing || {}).map(([why, n]) => `${why} ×${n}`))
const imageURL = computed(() => (data.value && current.value ? `/api/screen?key=${data.value.key}&id=${encodeURIComponent(current.value.id)}` : ''))
const figmaURL = computed(() => (data.value && current.value
  ? `https://www.figma.com/design/${data.value.key}/?node-id=${current.value.id.replace(':', '-')}`
  : ''))

// ── la pantalla: a lo sumo la altura de la región, con zoom, y se mueve con el mouse ──
// El TOPE es la altura de la región: al 100 % la pantalla la llena de arriba abajo, y el zoom la achica
// hasta ZOOM_MIN, sólo con gestos —Ctrl + rueda o el pellizco del trackpad, y + / − en el teclado—:
// Miguel no quiere un control en la cabecera. Depende sólo del ALTO, así que arrastrar un separador —que cambia el ancho— no la
// cambia de tamaño, y en Comparar las dos van a la misma escala. Lo que no entra a lo ancho se trae
// ARRASTRANDO (o con la rueda), como un lienzo.
// Arrastrar no dispara las zonas del prototipo: un clic sólo cuenta si el puntero no se movió.
const stage = ref(null)
const canvas = ref(null)
const pan = ref({ x: 0, y: 0 })
const dragging = ref(false)
const STAGE_PAD = 24
const CAPTION_H = 24 // el rótulo «Figma (imagen)» / «HTML traducido» de Comparar
const ZOOM_MIN = 0.25
const ZOOM_MAX = 1
const ZOOM_STEP = 0.1
const stageH = ref(0)
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
const zoom = ref(clampZoom(readSize('visor.zoom', 100) / 100))
watch(zoom, (z) => { saveSize('visor.zoom', Math.round(z * 100)); nextTick(onStageResize) })
// La escala de Figma a pantalla: la que hace que el alto entre en la región, por el zoom.
const scale = computed(() => {
  const c = current.value
  if (!c || !stageH.value) return 1
  const room = stageH.value - 2 * STAGE_PAD - (panes.value.length > 1 ? CAPTION_H : 0)
  return Math.max(0.05, (room / c.h) * zoom.value)
})
function setZoom(z, at = null) {
  const next = clampZoom(z)
  if (next === zoom.value) return
  // Con el puntero como ancla, lo que está debajo del puntero se queda debajo del puntero.
  if (at && stage.value) {
    const r = stage.value.getBoundingClientRect()
    const px = at.x - r.left
    const py = at.y - r.top
    const k = next / zoom.value
    pan.value = { x: px - (px - pan.value.x) * k, y: py - (py - pan.value.y) * k }
    panTouched = true
  }
  zoom.value = next
}
const KEEP_VISIBLE = 120 // lo que queda a la vista como mínimo: la pantalla no se pierde fuera de la región
let panTouched = false // si se movió a mano, un cambio de ancho de la región no la recentra
let drag = null
let swallowClick = false
function contentSize() {
  const el = canvas.value
  return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 }
}
function clampPan(x, y) {
  const st = stage.value
  if (!st) return { x, y }
  const { w, h } = contentSize()
  return {
    x: Math.min(Math.max(x, KEEP_VISIBLE - w), st.clientWidth - KEEP_VISIBLE),
    y: Math.min(Math.max(y, KEEP_VISIBLE - h), st.clientHeight - KEEP_VISIBLE),
  }
}
// Centrada en lo que entre; lo que no entra a lo ancho arranca por la izquierda.
function center() {
  const st = stage.value
  if (!st || !canvas.value) return
  const { w, h } = contentSize()
  pan.value = {
    x: w < st.clientWidth ? Math.round((st.clientWidth - w) / 2) : STAGE_PAD,
    y: h < st.clientHeight ? Math.round((st.clientHeight - h) / 2) : STAGE_PAD,
  }
  panTouched = false
}
function onStageResize() {
  if (stage.value) stageH.value = stage.value.clientHeight
  nextTick(() => {
    if (panTouched) pan.value = clampPan(pan.value.x, pan.value.y)
    else center()
  })
}
function onPointerDown(e) {
  if (e.button !== 0 || !current.value) return
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: { ...pan.value }, moved: false }
}
function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.id) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 4) return
    drag.moved = true
    dragging.value = true
    stage.value?.setPointerCapture(e.pointerId)
  }
  pan.value = clampPan(drag.from.x + dx, drag.from.y + dy)
  panTouched = true
}
function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.id) return
  if (drag.moved) {
    swallowClick = true
    // Si el navegador no manda el clic (soltó fuera de un botón), no queda tragándose el siguiente.
    setTimeout(() => { swallowClick = false }, 0)
  }
  drag = null
  dragging.value = false
}
function onClickCapture(e) {
  if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false }
}
function onWheel(e) {
  if (!current.value) return
  e.preventDefault()
  // El pellizco del trackpad llega como rueda con Ctrl: es el zoom de la pantalla, no el de la página.
  if (e.ctrlKey || e.metaKey) { setZoom(zoom.value * Math.exp(-e.deltaY / 200), { x: e.clientX, y: e.clientY }); return }
  pan.value = clampPan(pan.value.x - e.deltaX, pan.value.y - e.deltaY)
  panTouched = true
}
let observer
// Otra pantalla del mismo ancho conserva dónde se estaba mirando (comparar dos pasos seguidos en el
// mismo lugar); una de otro ancho se recentra.
watch(() => [current.value?.id, current.value?.w, current.value?.h], (now, before) => nextTick(() => {
  if (stage.value) stageH.value = stage.value.clientHeight
  nextTick(() => {
    if (!before || now[1] !== before[1] || now[2] !== before[2]) center()
    else pan.value = clampPan(pan.value.x, pan.value.y)
  })
}))
const hotspotStyle = (h) => {
  const c = current.value
  return { left: (h.X / c.w) * 100 + '%', top: (h.Y / c.h) * 100 + '%', width: (h.W / c.w) * 100 + '%', height: (h.H / c.h) * 100 + '%' }
}

function onKey(e) {
  if (e.target.closest('input, textarea')) return
  if (e.key === 'ArrowRight') { step(1); e.preventDefault() }
  else if (e.key === 'ArrowLeft' && !e.altKey) { step(-1); e.preventDefault() }
  else if (e.key === 'Backspace' || (e.key === 'ArrowLeft' && e.altKey)) { back(); e.preventDefault() }
  else if (e.key === 'h' || e.key === 'H') showHotspots.value = !showHotspots.value
  else if (e.key === '0') center()
  else if (e.key === '+' || e.key === '=') setZoom(zoom.value + ZOOM_STEP)
  else if (e.key === '-') setZoom(zoom.value - ZOOM_STEP)
}

// Pegar un enlace viejo (#/…) en la misma pestaña cambia sólo el hash, y eso no recarga la página: sin
// este aviso el diseño nuevo no se leía nunca.
function onHash() {
  const h = readHash()
  if (h) load(h.ref, h.screen)
}
function onPopState() {
  const r = readRoute()
  if (r) openRoute(r)
}

onMounted(async () => {
  window.addEventListener('hashchange', onHash)
  window.addEventListener('popstate', onPopState)
  observer = new ResizeObserver(onStageResize)
  if (stage.value) observer.observe(stage.value)
  window.addEventListener('keydown', onKey)
  // La ruta nombra el proyecto, y el nombre sale de la biblioteca: se espera a que llegue.
  await loadLibrary()
  const fromHash = readHash()
  const fromRoute = readRoute()
  let last = ''
  try { last = localStorage.getItem('visor.last') || '' } catch { /* preferencia opcional */ }
  if (fromHash) load(fromHash.ref, fromHash.screen)
  else if (fromRoute) openRoute(fromRoute)
  else if (last) { refInput.value = last; load(last) }
})
onUnmounted(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('hashchange', onHash)
  window.removeEventListener('popstate', onPopState)
})

const kindName = { mobile: 'móvil', web: 'web', panel: 'panel', textless: 'sin texto' }
const laneName = (lane) => (lane.label ? lane.label : 'Fila sin rótulo')
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="sidebarOpen" class="sidebar" aria-label="Proyectos">
      <div class="rsz rsz-sb" v-resize="resizeOptions('sidebar')"></div>

      <!-- Cada PROYECTO (un flujo, un archivo de Figma) es un bloque del acordeón en la raíz de la barra, y
           adentro están sus pantallas en los carriles del diseñador, sin pasar por las páginas del
           archivo. Los bloques abiertos se reparten el alto y uno cerrado cuesta una fila. -->
      <section v-for="f in flows" :key="f.key" class="view" :class="{ abierta: isOpenFile(f.key) }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="isOpenFile(f.key)" :aria-controls="'flow-' + f.key" @click="toggleFile(f.key)">
            <span class="ui-icon" data-icon="chevron" aria-hidden="true"></span><span>{{ f.name }}</span>
          </button>
          <span v-if="countOf(f.key)" class="count" :title="countOf(f.key) + ' pantallas en el flujo'">{{ countOf(f.key) }}</span>
          <button v-if="maps[f.key]" class="region-action" title="Volver a leer el flujo desde Figma" aria-label="Volver a leer" @click="openFlow(f.key, true)">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
        <div v-if="isOpenFile(f.key)" :id="'flow-' + f.key" class="region-body">
          <p v-if="mapState[f.key] === 'loading'" class="hint">Leyendo el flujo…</p>
          <p v-else-if="mapState[f.key]?.error" class="notice">{{ mapState[f.key].error }}</p>
          <template v-for="g in groupsFor(maps[f.key]?.structure)" :key="g.id">
            <div v-if="groupsFor(maps[f.key]?.structure).length > 1" class="section-name">{{ g.name }}</div>
            <template v-for="(lane, li) in g.lanes" :key="g.id + '-' + li">
              <div class="region-head grupo" :class="{ unlabeled: !lane.label }">
                <span>{{ laneName(lane) }}</span><span class="count">{{ lane.screens.length }}</span>
              </div>
              <button v-for="(sc, i) in lane.screens" :key="sc.id" class="screen-row" :data-screen="sc.id"
                :aria-current="data && data.key === f.key && sc.id === currentID ? 'true' : undefined" @click="pick(f.key, sc.id)">
                <span class="n">{{ i + 1 }}</span>
                <span class="t">{{ sc.title || sc.name }}</span>
                <span v-if="sc.hotspots?.length" class="tag" title="Tiene zonas del prototipo">↗</span>
                <span v-if="sc.open_comments" class="tag" :title="sc.open_comments + ' comentario(s) abierto(s)'">💬</span>
              </button>
            </template>
          </template>
        </div>
      </section>

      <!-- Al final, sumar otro: como «Traer de Jira» en el tablero. -->
      <section class="view" :class="{ abierta: adding }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="adding" aria-controls="view-add" @click="adding = !adding">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span><span>Sumar un flujo</span>
          </button>
          <button class="region-action" title="Volver a pedir los proyectos a Figma" aria-label="Actualizar los proyectos" @click="loadLibrary(true)">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
        <div v-if="adding || libraryError || libraryErrors.length || !flows.length" id="view-add" class="region-body">
          <form v-if="adding || !flows.length" class="loader" @submit.prevent="addToLibrary()">
            <input v-model="addURL" class="input input-sm" type="url" placeholder="Enlace de un archivo, proyecto o equipo" aria-label="Enlace de Figma" />
            <button class="btn btn-sm" :disabled="libraryBusy || !addURL.trim()">{{ libraryBusy ? 'Sumando…' : 'Sumar' }}</button>
          </form>
          <p v-if="adding || !flows.length" class="hint">Pegá el enlace de un archivo de Figma, o la página de un proyecto (<span class="mono">figma.com/files/project/…</span>) o de un equipo (<span class="mono">figma.com/files/team/…</span>) para sumar todos sus flujos. La API de Figma no lista lo visto recientemente.</p>
          <p v-if="libraryError" class="notice" role="alert">{{ libraryError }}</p>
          <p v-for="e in libraryErrors" :key="e" class="notice">{{ e }}</p>
        </div>
      </section>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ current ? (current.title || current.name) : 'Visor' }}</span>
        <template v-if="current">
          <button class="region-action" title="Volver (Retroceso)" aria-label="Volver" :disabled="!trail.length" @click="back">
            <span class="ui-icon" data-icon="move" aria-hidden="true" style="transform: scaleX(-1)"></span>
          </button>
          <button class="region-action" title="Anterior del carril (←)" aria-label="Anterior" :disabled="current.index === 0" @click="step(-1)">
            <span class="ui-icon" data-icon="chevron" aria-hidden="true" style="transform: scaleX(-1)"></span>
          </button>
          <button class="region-action" title="Siguiente del carril (→)" aria-label="Siguiente" :disabled="current.index === current.lane.screens.length - 1" @click="step(1)">
            <span class="ui-icon" data-icon="chevron" aria-hidden="true"></span>
          </button>
          <div class="modes" role="group" aria-label="Cómo ver la pantalla">
            <button v-for="m in modes" :key="m.id" class="btn btn-xs" :class="mode === m.id ? 'btn-secondary' : 'btn-ghost'"
              :aria-pressed="mode === m.id" @click="mode = m.id">{{ m.label }}</button>
          </div>
          <button class="region-action" :aria-pressed="showHotspots" title="Mostrar las zonas del prototipo (H)" aria-label="Zonas del prototipo" @click="showHotspots = !showHotspots">
            <span class="ui-icon" data-icon="filter" aria-hidden="true"></span>
          </button>
          <button class="region-action" title="Centrar la pantalla (0)" aria-label="Centrar la pantalla" @click="center">
            <span class="ui-icon" data-icon="collapse" aria-hidden="true"></span>
          </button>
          <button class="region-action" :title="copied ? 'Copiado' : 'Copiar el enlace a esta pantalla: ' + routePath" aria-label="Copiar el enlace" @click="copyLink">
            <span class="ui-icon" :data-icon="copied ? 'check' : 'copy'" aria-hidden="true"></span>
          </button>
          <a class="region-action" :href="figmaURL" target="_blank" rel="noopener" title="Abrir esta pantalla en Figma" aria-label="Abrir en Figma">
            <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
          </a>
        </template>
      </div>
      <div ref="stage" class="stage" :class="{ dragging }" @pointerdown="onPointerDown" @pointermove="onPointerMove"
        @pointerup="onPointerUp" @pointercancel="onPointerUp" @click.capture="onClickCapture" @wheel="onWheel" @dblclick.self="center">
        <p v-if="!current" class="empty">{{ loading ? 'Leyendo el diseño…' : (error || 'Sin pantalla elegida.') }}</p>
        <div v-else ref="canvas" class="canvas" :style="{ transform: `translate(${pan.x}px, ${pan.y}px)` }">
        <figure v-for="p in panes" :key="p" class="pane">
        <div class="device" :data-kind="current.kind" :style="{ width: current.w * scale + 'px', height: current.h * scale + 'px' }">
          <img v-if="p === 'image'" :key="imageURL" :src="imageURL" :alt="current.title || current.name" draggable="false" @error="imageFailed = true" />
          <iframe v-else :key="htmlURL" :src="htmlURL" :title="'HTML de ' + (current.title || current.name)" class="html"
            :style="{ width: current.w + 'px', height: current.h + 'px', transform: `scale(${scale})` }"></iframe>
          <p v-if="p === 'image' && imageFailed" class="notice over">Figma no devolvió la imagen de esta pantalla.</p>
          <template v-if="showHotspots">
            <button v-for="(h, i) in clickable" :key="i" class="hotspot" :class="{ outside: !h.to }" :style="hotspotStyle(h)"
              :title="h.via + ' → ' + h.to_name" :aria-label="h.via + ' → ' + h.to_name" :disabled="!h.to" @click="follow(h)"></button>
          </template>
          <button v-if="autoNext" class="auto" @click="follow(autoNext)">▶ Avanza sola a {{ autoNext.to_name }}</button>
        </div>
        <figcaption v-if="panes.length > 1">{{ p === 'image' ? 'Figma (imagen)' : 'HTML traducido' }}</figcaption>
        </figure>
        </div>
      </div>
    </main>

    <aside v-show="auxOpen" class="auxiliarybar" aria-label="Detalle de la pantalla">
      <div class="rsz rsz-aux" v-resize="resizeOptions('aux')"></div>
      <div class="region-head"><span>Pantalla</span></div>
      <div class="region-body detail">
        <p v-if="!current" class="empty">Elegí una pantalla de un carril.</p>
        <template v-else>
          <dl>
            <dt>Título</dt><dd>{{ current.title || '—' }}<small v-if="current.title_from === 'capa'"> · del nombre de la capa</small></dd>
            <dt>Capa</dt><dd>{{ current.name }}</dd>
            <dt>Carril</dt><dd>{{ laneName(current.lane) }} · {{ current.index + 1 }} de {{ current.lane.screens.length }}</dd>
            <dt>Tipo</dt><dd>{{ kindName[current.kind] || current.kind }} · {{ Math.round(current.w) }}×{{ Math.round(current.h) }}</dd>
            <template v-if="current.open_comments"><dt>Comentarios</dt><dd>{{ current.open_comments }} abierto(s) en Figma</dd></template>
          </dl>
          <div v-if="report && mode !== 'image'" class="block">
            <div class="region-head grupo"><span>La traducción a HTML</span></div>
            <dl>
              <dt>Cajas</dt><dd>{{ report.elements }} · {{ report.flex }} con auto-layout → flex · {{ report.absolute }} en posición absoluta</dd>
              <dt>Textos</dt><dd>{{ report.texts }}</dd>
              <dt>Dibujos</dt><dd>{{ report.drawings?.length || 0 }} como SVG de Figma</dd>
              <template v-if="report.images?.length"><dt>Imágenes</dt><dd>{{ report.images.length }}</dd></template>
              <dt>Fuentes</dt><dd>{{ (report.fonts || []).join(' · ') || '—' }}</dd>
              <dt>Sin traducir</dt><dd>{{ missingList.join(' · ') || 'nada' }}</dd>
            </dl>
          </div>
          <div v-if="current.actions?.length" class="block">
            <div class="region-head grupo"><span>Botones</span></div>
            <ul><li v-for="a in current.actions" :key="a">{{ a }}</li></ul>
          </div>
          <div v-if="current.hotspots?.length" class="block">
            <div class="region-head grupo"><span>Lleva a</span></div>
            <button v-for="(h, i) in current.hotspots" :key="i" class="link" :disabled="!h.to" @click="follow(h)">
              <span>{{ h.to_name }}</span><small>{{ h.via }}</small>
            </button>
          </div>
          <div v-if="incoming.length" class="block">
            <div class="region-head grupo"><span>Llega desde</span></div>
            <button v-for="(x, i) in incoming" :key="i" class="link" @click="go(x.from.id)">
              <span>{{ x.from.title || x.from.name }}</span><small>{{ x.via }} · {{ laneName(x.from.lane) }}</small>
            </button>
          </div>
          <div v-if="variantsOfCurrent.length" class="block">
            <div class="region-head grupo"><span>La misma pantalla en otro lugar</span></div>
            <button v-for="v in variantsOfCurrent" :key="v.id" class="link" @click="go(v.id)">
              <span>{{ laneName(v.lane) }}</span><small>{{ v.index + 1 }} de {{ v.lane.screens.length }} · {{ v.name }}</small>
            </button>
          </div>
          <p class="hint">El carril y el título se deducen de cómo está dibujado el lienzo. ← → recorren el carril, Retroceso vuelve y H muestra u oculta las zonas del prototipo.</p>
        </template>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="structure">{{ structure.file_name }} · {{ structure.name }}</span>
      <span v-if="structure?.last_modified">guardado {{ new Date(structure.last_modified).toLocaleString('es-CO') }}</span>
      <span v-if="screenCount">{{ screenCount }} pantallas</span>
      <span class="grow"></span>
      <button class="region-action" :aria-pressed="sidebarOpen" title="Carriles" aria-label="Mostrar u ocultar los carriles" @click="toggle('sidebar')">
        <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
      </button>
      <button class="region-action" :aria-pressed="auxOpen" title="Detalle" aria-label="Mostrar u ocultar el detalle" @click="toggle('aux')">
        <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
      </button>
    </footer>
  </div>
</template>

<style scoped>
.sidebar, .auxiliarybar { position: relative }
.rsz-sb, .rsz-aux { position: absolute; top: 0; bottom: 0; width: calc(var(--rsz) + 6px) }
.rsz-sb { right: -3px }
.rsz-aux { left: -3px }
.rsz-sb::before { left: 3px; right: auto; width: 1px }
.rsz-aux::before { left: auto; right: 3px; width: 1px }

.count { flex: none; color: var(--texto-3); font-weight: 500 }
.loader { display: flex; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--sidebar-border) }
.loader .input { flex: 1; min-width: 0 }
.notice { margin: var(--space-2) var(--space-3); padding: var(--space-2) var(--space-3); font-size: var(--text-sm);
  border-left: 3px solid var(--destructive); background: color-mix(in oklab, var(--destructive) 12%, transparent) }
.notice.over { position: absolute; left: var(--space-3); right: var(--space-3); top: var(--space-3) }
.mono { font-family: var(--font-mono, ui-monospace, monospace) }
.empty, .hint { padding: var(--space-3); color: var(--texto-3); font-size: var(--text-sm) }
.section-name { padding: var(--space-3) var(--space-3) var(--space-1); font-size: var(--text-xs); color: var(--texto-3) }
.region-head.grupo.unlabeled > span:first-child { font-style: italic }

.screen-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 30px;
  padding: 0 var(--space-3); border: 0; background: none; color: inherit; font: inherit; font-size: var(--text-sm);
  text-align: left; cursor: pointer }
.screen-row:hover { background: color-mix(in oklab, var(--foreground) 6%, transparent) }
.screen-row[aria-current="true"] { background: var(--sidebar-accent); color: var(--sidebar-accent-foreground) }
.screen-row .n { flex: none; width: 1.6em; text-align: right; color: var(--texto-3); font-variant-numeric: tabular-nums }
.screen-row .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.screen-row .tag { flex: none; font-size: var(--text-xs); color: var(--texto-3) }

.stage { position: relative; flex: 1; min-height: 0; overflow: hidden; cursor: grab; touch-action: none; user-select: none }
.stage.dragging { cursor: grabbing }
/* El lienzo mide lo que miden sus pantallas (no la región) y se mueve con `transform`: arrastrarlo no
   reacomoda nada, y `offsetWidth` sigue dando su tamaño sin el desplazamiento. */
.canvas { position: absolute; left: 0; top: 0; display: flex; align-items: flex-start; gap: 24px; padding-bottom: 24px;
  will-change: transform }
.stage .empty { position: absolute; inset: 0; display: grid; place-items: center; cursor: default }
.pane { margin: 0; display: flex; flex-direction: column; align-items: center; gap: var(--space-2) }
.pane figcaption { font-size: var(--text-xs); color: var(--texto-3) }
.modes { display: flex; gap: 2px }
/* La cabecera del editor junta título, navegación, modos y acciones: con los dos sidebars abiertos no
   entra en un renglón, y la regla del taller es ENVOLVER, no desbordar (con height:auto, o la caja fija
   de .region-head deja el segundo renglón afuera). */
.editor > .region-head { flex-wrap: wrap; height: auto; row-gap: var(--space-1) }
/* Al envolver, el título no cede todo el ancho: sin una base, `flex: 1` con `min-width: 0` lo dejaba en 0. */
.editor > .region-head > span:first-child { flex: 1 1 140px }
/* El HTML se dibuja a su tamaño de Figma y se escala entero, a la misma escala que la imagen: el texto
   conserva sus medidas y la comparación es de igual a igual. No recibe el puntero —es un dibujo, las
   zonas del prototipo van encima—, así que arrastrar sobre él mueve el lienzo en vez de perderse
   adentro del iframe. */
.device iframe.html { display: block; border: 0; pointer-events: none; transform-origin: 0 0 }
.device { position: relative; flex: none; border: 1px solid var(--device-edge); border-radius: 18px; overflow: hidden;
  background: var(--card) }
/* El tipo va en un atributo y no en una clase: `panel` como clase es la región compartida y le ponía
   su fondo y su borde al dispositivo (lo frenó `make estilo-check`). */
.device:not([data-kind="mobile"]) { border-radius: var(--radius-md) }
.device img { display: block; width: 100%; height: 100%; user-select: none }
.hotspot { position: absolute; padding: 0; border: 1px solid var(--hotspot); border-radius: 4px; background: var(--hotspot-fill);
  cursor: pointer }
.hotspot:hover { background: color-mix(in oklab, var(--primary) 32%, transparent) }
.hotspot.outside { border-style: dashed; cursor: not-allowed }
.auto { position: absolute; left: 50%; bottom: var(--space-4); transform: translateX(-50%); max-width: 90%;
  padding: var(--space-2) var(--space-3); border: 0; border-radius: 999px; background: var(--primary);
  color: var(--primary-foreground); font: inherit; font-size: var(--text-sm); cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis }

.detail dl { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3); margin: 0; padding: var(--space-3);
  font-size: var(--text-sm) }
.detail dt { color: var(--texto-3) }
.detail dd { margin: 0; overflow-wrap: anywhere }
.detail small { color: var(--texto-3) }
.block ul { margin: 0; padding: var(--space-2) var(--space-3) var(--space-2) calc(var(--space-3) + 14px); font-size: var(--text-sm) }
.link { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: var(--space-2) var(--space-3);
  border: 0; background: none; color: inherit; font: inherit; font-size: var(--text-sm); text-align: left; cursor: pointer }
.link:hover:not(:disabled) { background: color-mix(in oklab, var(--foreground) 6%, transparent) }
.link:disabled { cursor: default }
.link small { color: var(--texto-3) }
.grow { flex: 1 }
</style>
