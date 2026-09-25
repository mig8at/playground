<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, refreshResizers, fitRegions, reopenSize, cssSize, bindThemeToggle } from './workbench.js'

// EL VISOR: un diseño de Figma leído como recorrido. A la izquierda los carriles que armó el
// diseñador, al centro la pantalla con las zonas del prototipo, a la derecha lo que la pantalla dice
// y a dónde lleva. Todo sale de `/api/map` (connectors/figma, `Structure`) y `/api/screen`.

const refInput = ref('')
const loading = ref(false)
const error = ref('')
const data = ref(null) // { key, node, structure, cached }
const currentID = ref('')
// La capa señalada de la pantalla, por su id de Figma (ver «SEÑALAR UNA CAPA»): va arriba porque la ruta la lee.
const selectedLayer = ref('')
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
// Se guarda lo que ELIGIÓ la persona (medida y si está abierta); lo que se pinta sale de `fitRegions`
// contra la ventana: mínimo o nada, y lo que se pliega por falta de lugar vuelve cuando hay.
const sidebarOpen = ref(readSize('visor.sidebar-open', 1) !== 0)
const auxOpen = ref(readSize('visor.aux-open', 1) !== 0)
const sidebarW = ref(readSize('visor.sidebar-w', 300))
const auxW = ref(readSize('visor.aux-w', 340))
const viewportW = ref(window.innerWidth)
const onWindowResize = () => { viewportW.value = window.innerWidth }
const sideMin = () => cssSize('--sidebar-min', 240)
const editorMin = () => cssSize('--editor-min', 360)
// El orden es el de sacrificio: primero se pliega el detalle, después los carriles.
const shown = computed(() => {
  const [aux, sidebar] = fitRegions(viewportW.value - editorMin(), [
    { size: auxOpen.value ? auxW.value : 0, min: sideMin() },
    { size: sidebarOpen.value ? sidebarW.value : 0, min: sideMin() },
  ])
  return { sidebar, aux }
})
function setOpen(which, open) {
  if (which === 'sidebar') { sidebarOpen.value = open; saveSize('visor.sidebar-open', open ? 1 : 0) }
  else { auxOpen.value = open; saveSize('visor.aux-open', open ? 1 : 0) }
}
function resizeOptions(which) {
  const isSidebar = which === 'sidebar'
  const other = () => (isSidebar ? shown.value.aux : shown.value.sidebar)
  return {
    label: isSidebar ? 'Ancho de los carriles' : 'Ancho del detalle',
    min: sideMin, sign: isSidebar ? 1 : -1, defaultValue: isSidebar ? 300 : 340,
    max: () => viewportW.value - other() - editorMin(),
    get: () => (isSidebar ? shown.value.sidebar : shown.value.aux),
    // 0 es plegar: la medida preferida queda como estaba, que es la última abierta.
    set: (v) => {
      if (!v) return setOpen(which, false)
      setOpen(which, true)
      if (isSidebar) sidebarW.value = v; else auxW.value = v
    },
    reopen: () => (isSidebar ? sidebarW.value : auxW.value),
    commit: () => saveSize(isSidebar ? 'visor.sidebar-w' : 'visor.aux-w', isSidebar ? sidebarW.value : auxW.value),
  }
}
const layoutVars = computed(() => ({ '--sidebar-w': shown.value.sidebar + 'px', '--auxiliarybar-w': shown.value.aux + 'px' }))
function toggle(which) {
  const isSidebar = which === 'sidebar'
  const visible = isSidebar ? shown.value.sidebar : shown.value.aux
  if (visible) setOpen(which, false)
  else {
    // Abrir lo que no entra pliega la del otro lado: el pedido es explícito y gana.
    const room = viewportW.value - editorMin()
    const otherWhich = isSidebar ? 'aux' : 'sidebar'
    if (reopenSize(isSidebar ? sidebarW.value : auxW.value, sideMin(), room - (isSidebar ? shown.value.aux : shown.value.sidebar)) === 0)
      setOpen(otherWhich, false)
    setOpen(which, true)
  }
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
  routeHold = false
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
// clave → las pantallas de su página de flujo. La ruta lleva `?nodo=` sólo si la pantalla NO está ahí:
// una sección pegada a mano casi siempre vive adentro de la página de flujo, y entonces sobra.
const flowIDs = ref({})
function rememberFlow(key, st) {
  const ids = new Set(groupsFor(st).flatMap((g) => g.lanes.flatMap((l) => l.screens.map((sc) => sc.id))))
  flowIDs.value = { ...flowIDs.value, [key]: ids }
}
// learnFlow averigua, en segundo plano y sin tocar lo que se está mirando, qué pantallas tiene la página de
// flujo de un archivo que se abrió pegando una sección.
async function learnFlow(key) {
  if (flowIDs.value[key]) return
  try {
    await loadPages(key)
    const page = flowPage(pagesOf.value[key]?.pages || [])
    if (!page) return
    flowNodes[key] = page.id
    const res = await fetch('/api/map?' + new URLSearchParams({ ref: figmaRef(key, page.id) }))
    if (res.ok) rememberFlow(key, (await res.json()).structure)
  } catch { /* sin eso la ruta lleva `nodo`, que abre igual */ }
}
const mapState = ref({}) // clave → 'loading' | { error }
const reFlowPage = /flujo|flow/i
const reSkipPage = /cover|portada|bench|bechmarck|prototipo|prototype|archivo|archive/i
function flowPage(pages) {
  return pages.find((p) => reFlowPage.test(p.name)) || pages.find((p) => !reSkipPage.test(p.name)) || pages[0] || null
}
async function openFlow(key, fresh = false) {
  // Lo que hay en memoria puede ser una sección pegada a mano: el bloque muestra la página de flujo.
  if (maps.value[key] && maps.value[key].node === flowNodes[key] && !fresh) return
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
    rememberFlow(key, body.structure)
    const { [key]: _, ...rest } = mapState.value
    mapState.value = rest
    // Si no hay nada al centro, o se volvió a leer el que se está mirando, este pasa a ser el activo. Con
    // un error a la vista (una ruta a un proyecto que no está) no: el bloque que se recordaba abierto lo
    // tapaba y la ruta quedaba reescrita a otro proyecto sin avisar. Mientras una ruta manda tampoco: la
    // pantalla la elige la ruta, y si no se pudo abrir su aviso queda a la vista hasta que se toque otra.
    // Y si al centro hay una sección de OTRA página del mismo archivo (pegada, o de una ruta con `nodo`),
    // se queda: releer el bloque no la reemplaza por la página de flujo.
    const showingFlow = data.value?.key === key && data.value.node === flowNodes[key]
    if (!routeHold && ((!data.value && !error.value) || showingFlow)) activate(key)
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
  routeHold = false
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
    learnFlow(body.key)
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
// ── la hoja de tokens de un proyecto, en el centro ──
// Cada bloque de la barra tiene arriba «Tokens del diseño»: los colores y estilos de texto con su nombre
// del sistema de diseño (connectors/figma, tokens.go). Vienen en el mismo mapa del flujo, así que no
// cuestan un pedido; la hoja para copiar (CSS o Tailwind) la escribe el server.
const sheetKey = ref('') // el proyecto cuya hoja se mira; vacío: se mira una pantalla
// Qué hoja: los tokens o los componentes. La ruta es /<proyecto>/tokens o /<proyecto>/componentes.
const sheetKind = ref('tokens')
const sheetPaths = { tokens: 'tokens', components: 'componentes' }
const tokensOf = (key) => maps.value[key]?.structure?.tokens || null
const sheet = computed(() => (sheetKey.value ? tokensOf(sheetKey.value) : null))
const inventoryOf = (key) => maps.value[key]?.structure?.inventory || null
const inventory = computed(() => (sheetKey.value ? inventoryOf(sheetKey.value) || [] : []))
const sheetFormat = ref('css')
const sheetFormats = [{ id: 'css', label: 'CSS' }, { id: 'tailwind', label: 'Tailwind' }, { id: 'json', label: 'JSON' }]
// Una entrada por variable (dos estilos con el mismo nombre y valor son el mismo token), agrupadas por
// familia: `--morado-500` es de «morado».
const sheetFamilies = computed(() => {
  const byVar = new Map()
  for (const c of sheet.value?.colors || []) {
    const prev = byVar.get(c.var)
    if (prev) { prev.uses += c.uses; if (!prev.names.includes(c.name)) prev.names.push(c.name) } else byVar.set(c.var, { ...c, names: [c.name] })
  }
  const fams = new Map()
  for (const c of byVar.values()) {
    const fam = c.var.replace(/^--/, '').replace(/-[0-9a-f]{6}$/, '').replace(/-\d+$/, '') || c.var
    if (!fams.has(fam)) fams.set(fam, [])
    fams.get(fam).push(c)
  }
  const level = (v) => Number((v.match(/-(\d+)(?:-[0-9a-f]{6})?$/) || [0, 0])[1])
  return [...fams].map(([name, colors]) => ({ name, colors: colors.sort((a, b) => level(a.var) - level(b.var)) }))
    .sort((a, b) => b.colors.reduce((n, c) => n + c.uses, 0) - a.colors.reduce((n, c) => n + c.uses, 0))
})
const sheetCount = (key) => { const t = tokensOf(key); return t ? `${new Set(t.colors.map((c) => c.var)).size} colores · ${t.texts.length} textos` : '' }
function openSheet(key, kind = 'tokens') {
  routeHold = false
  if (!data.value || data.value.key !== key) activate(key)
  sheetKind.value = kind
  sheetKey.value = key
  writeRoute()
}
const componentCount = (key) => { const inv = inventoryOf(key); return inv ? `${inv.length} en ${new Set(inv.flatMap((c) => c.screens)).size} pantallas` : '' }
const screenTitle = (id) => { const sc = screens.value.get(id); return sc ? sc.title || sc.name : id }
// Las pantallas de un componente, juntas por título: en Credifamilia nueve se llaman «Completa tu
// solicitud». Tocar el título abre la primera; el conteo dice cuántas son.
const screensByTitle = (ids) => {
  const out = new Map()
  for (const id of ids) {
    const t = screenTitle(id)
    if (!out.has(t)) out.set(t, { title: t, first: id, n: 0 })
    out.get(t).n++
  }
  return [...out.values()]
}
const propLine = (p) => (p.type === 'TEXT' ? `${p.name} (texto)` : `${p.name}: ${(p.values || []).map((v) => `${v.value} ×${v.uses}`).join(' · ')}`)
// El inventario como texto, para pegarlo en la conversación con el modelo o en la tarea.
const inventoryText = computed(() => {
  const name = maps.value[sheetKey.value]?.structure?.file_name || ''
  const lines = [`Componentes de «${name}» (de Figma: instancias de primer nivel, con sus variantes y dónde aparecen)`, '']
  for (const c of inventory.value) {
    lines.push(`- ${c.name} — ${c.uses} usos en ${c.screens.length} pantallas`)
    for (const p of c.props || []) lines.push(`  - ${propLine(p)}`)
    lines.push(`  - pantallas: ${c.screens.map(screenTitle).filter((t, i, a) => a.indexOf(t) === i).join(' · ')}`)
  }
  return lines.join('\n')
})
const sheetCopied = ref(false)
async function copySheet() {
  if (!sheetKey.value) return
  try {
    const q = new URLSearchParams({ key: sheetKey.value })
    if (sheetFormat.value !== 'json') q.set('format', sheetFormat.value)
    const res = await fetch('/api/tokens?' + q)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await navigator.clipboard.writeText(await res.text())
    sheetCopied.value = true
    setTimeout(() => { sheetCopied.value = false }, 1500)
  } catch { /* sin la hoja o sin portapapeles: el enlace de al lado la abre */ }
}
const sheetURL = computed(() => (sheetKey.value ? `/api/tokens?key=${sheetKey.value}${sheetFormat.value === 'json' ? '' : '&format=' + sheetFormat.value}` : ''))
const copiedVar = ref('')
async function copyVar(text) {
  try { await navigator.clipboard.writeText(text); copiedVar.value = text; setTimeout(() => { if (copiedVar.value === text) copiedVar.value = '' }, 1200) } catch { /* sin portapapeles */ }
}
// La muestra de un estilo de texto se escribe en SU letra: se pide a Fontshare (Satoshi) o a Google.
const loadedFonts = new Set()
watch(sheet, (t) => {
  for (const x of t?.texts || []) {
    const fam = (x.family || '').replace(/ Variable$/, '')
    if (!fam || loadedFonts.has(fam)) continue
    loadedFonts.add(fam)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = fam === 'Satoshi' ? 'https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap'
      : `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam)}:wght@100..900&display=swap`
    document.head.appendChild(link)
  }
})
const textSample = (x) => ({ fontFamily: `'${(x.family || '').replace(/ Variable$/, '')}', sans-serif`, fontWeight: x.weight, fontSize: x.size + 'px',
  lineHeight: x.line_height ? x.line_height + 'px' : 'normal', letterSpacing: x.letter_spacing ? x.letter_spacing + 'px' : 'normal' })

function go(id, remember = true) {
  if (id && sheetKey.value) { sheetKey.value = ''; if (id === currentID.value) { writeRoute(); return } }
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

// ── la ruta: /<clave del archivo>/<pantalla> ──
// Para poder enlazar una pantalla desde afuera (el tablero, una tarea) la ruta va por IDS de Figma: la
// clave del archivo y el nodo con guion, como lo escribe Figma en `node-id`:
// `/7M01d0CZPzzJs0iZeKhwvf/381-1052`. Los nombres son para la barra; un id no depende de cómo se llame
// nada. Una ruta vieja con el nombre del proyecto (`/credifamilia/1-4063`) sigue abriendo. Opcionales: `?modo=html|comparar` y `?nodo=<id>` cuando el mapa no es la
// página de flujo del archivo sino una sección pegada a mano. Vite sirve `index.html` en cualquier ruta
// sin extensión, así que no hace falta un router.
const slugOf = (name) => (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
// Un nombre que el archivo tuvo antes también abre el proyecto: el diseñador lo puede renombrar y los
// enlaces pegados en las tareas no se enteran (la biblioteca guarda los nombres de antes).
const keyOfProject = (project) => {
  const slug = project.toLowerCase()
  const byName = flows.value.find((x) => slugOf(x.name) === slug)?.key
  const byAlias = (library.value.opened || []).find((o) => (o.aliases || []).some((a) => slugOf(a) === slug))?.key
  return byName || byAlias || (/^[A-Za-z0-9]{15,}$/.test(project) ? project : '')
}
const toID = (s) => (s || '').replace(/-/g, ':')
const fromID = (id) => (id || '').replace(/:/g, '-')
// La capa en la ruta: guiones por «:» y guion bajo por «;» (las capas de adentro de un componente se
// llaman `I1:6711;1265:1238`). Así el enlace se lee y se pega sin codificar nada.
const toLayer = (s) => (s || '').replace(/-/g, ':').replace(/_/g, ';')
const fromLayer = (id) => (id || '').replace(/:/g, '-').replace(/;/g, '_')
// La comprobación del enlace con que se llegó (ver checkLink, más abajo).
const linkCheck = ref(null) // { id, linked, status: 'checking' | 'same' | 'changed' | 'deleted', print }
const routePath = computed(() => {
  if (sheetKey.value) return `/${sheetKey.value}/${sheetPaths[sheetKind.value]}`
  if (!data.value || !currentID.value) return ''
  const q = new URLSearchParams()
  const inFlow = flowIDs.value[data.value.key]?.has(currentID.value)
  if (data.value.node !== flowNodes[data.value.key] && !inFlow) q.set('nodo', fromID(data.value.node))
  if (mode.value !== 'image') q.set('modo', modeSlugs[mode.value])
  // La huella del enlace con que se llegó se queda en la barra mientras se mira ESA pantalla.
  if (linkCheck.value?.linked && linkCheck.value.id === currentID.value) q.set('huella', linkCheck.value.linked)
  if (selectedLayer.value) q.set('capa', fromLayer(selectedLayer.value))
  const qs = q.toString()
  return `/${data.value.key}/${fromID(currentID.value)}${qs ? '?' + qs : ''}`
})
function writeRoute() {
  const p = routePath.value
  if (p && location.pathname + location.search + location.hash !== p) history.replaceState(null, '', p)
}
// El proyecto se resuelve cuando la biblioteca ya llegó, y el `nodo` sobra cuando se sabe qué hay en la
// página de flujo: la ruta se reescribe cuando cambia cualquiera de los dos.
watch(routePath, () => writeRoute())
function readRoute() {
  const m = location.pathname.match(/^\/([^/]+)(?:\/([0-9]+-[0-9]+|tokens|componentes))?\/?$/)
  if (!m) return null
  const q = new URLSearchParams(location.search)
  const modeID = Object.keys(modeSlugs).find((k) => modeSlugs[k] === q.get('modo')) || ''
  const sheetOf = { tokens: 'tokens', componentes: 'components' }
  if (sheetOf[m[2]]) return { project: decodeURIComponent(m[1]), sheet: sheetOf[m[2]], screen: '', node: '', mode: modeID, print: '' }
  return { project: decodeURIComponent(m[1]), screen: toID(m[2]), node: toID(q.get('nodo')), mode: modeID, print: q.get('huella') || '',
    layer: toLayer(q.get('capa')) }
}
const figmaRef = (key, node) => `https://www.figma.com/design/${key}/?node-id=${fromID(node)}`
// routeHold: una ruta está mandando en el centro. Ningún bloque que termine de cargar después —el que
// quedó abierto de la visita anterior— se lo queda; lo suelta un clic en la barra.
let routeHold = false
async function openRoute(r) {
  routeHold = true
  const fail = (msg) => { error.value = msg; data.value = null; currentID.value = '' }
  const key = keyOfProject(r.project)
  if (!key) { fail(`No hay un proyecto «${r.project}» en la barra.`); return }
  if (r.mode) mode.value = r.mode
  if (r.node) {
    routeLayer = r.layer && r.screen ? { screen: r.screen, layer: r.layer } : null
    await load(figmaRef(key, r.node), r.screen); routeHold = false; return
  }
  const set = new Set([key]); openFiles.value = set; saveSet('visor.open-files', set)
  await openFlow(key)
  if (mapState.value[key]?.error) { fail(mapState.value[key].error); return }
  // La ruta nombra la pantalla por su id de Figma, que vive lo que vive la pantalla: sobrevive a que el
  // diseñador la edite, la mueva o la renombre, y muere si la borra. Una pantalla que ya no está en el
  // flujo NO abre otra en su lugar —antes abría la primera y reescribía la ruta, así que el enlace roto
  // de una tarea parecía sano—: se dice qué pasó.
  const ids = new Set(groupsFor(maps.value[key]?.structure).flatMap((g) => g.lanes.flatMap((l) => l.screens.map((sc) => sc.id))))
  if (r.screen && !ids.has(r.screen)) { fail(await whyMissing(key, r.screen)); return }
  routeHold = false
  if (r.print && r.screen) checkLink(key, r.screen, r.print)
  routeLayer = r.layer && r.screen ? { screen: r.screen, layer: r.layer } : null
  activate(key, r.screen)
  if (r.sheet) openSheet(key, r.sheet)
}
// whyMissing distingue una pantalla BORRADA (Figma ya no la tiene) de una que sigue en el archivo pero
// fuera de la página de flujo (la movieron a otra página, o a una sección de archivo).
async function whyMissing(key, screen) {
  const name = fromID(screen)
  try {
    const res = await fetch('/api/map?' + new URLSearchParams({ ref: figmaRef(key, screen) }))
    if (res.status === 404) return `La pantalla ${name} ya no existe: el diseñador la borró.`
    if (res.ok) return `La pantalla ${name} sigue en el archivo, pero ya no está en la página de flujo. Abrila en Figma: figma.com/design/${key}/?node-id=${name}`
  } catch { /* sin red: no se sabe */ }
  return `La pantalla ${name} no está en el flujo.`
}
// Los enlaces de antes —#/<clave>/<nodo>/<pantalla>— siguen abriendo, y quedan reescritos a la ruta.
function readHash() {
  const m = location.hash.match(/^#\/([A-Za-z0-9]+)\/([0-9]+:[0-9]+)(?:\/([0-9]+:[0-9]+))?/)
  return m ? { ref: figmaRef(m[1], m[2]), screen: m[3] || '' } : null
}
const copied = ref(false)
// ── la huella: rastrear si la pantalla de un enlace cambió ──
// El enlace que se copia lleva la huella del contenido de la pantalla en ese momento (server:
// `/api/track`, connectors/figma.Fingerprint). Abrirlo después compara contra la de hoy: la pantalla puede
// cambiar entera sin cambiar de id. `make visor-enlaces` hace lo mismo con todos los enlaces de las tareas.
async function checkLink(key, id, linked) {
  linkCheck.value = { id, linked, status: 'checking' }
  try {
    const res = await fetch('/api/track?' + new URLSearchParams({ key, id, huella: linked }))
    const body = await res.json()
    if (linkCheck.value?.id === id) linkCheck.value = res.ok ? { id, linked, status: body.status, print: body.print } : { id, linked, status: 'error', error: body.error }
  } catch (e) { if (linkCheck.value?.id === id) linkCheck.value = { id, linked, status: 'error', error: String(e.message || e) } }
}
// El enlace para una TAREA del tablero: `[Título](visor:<proyecto>/<pantalla>@<huella>)`. El tablero lo
// pinta como enlace a esta pantalla y `make visor-enlaces` lo rastrea. La huella se pide al cambiar de
// pantalla (sale de lo guardado: no cuesta un pedido a Figma).
const screenPrint = ref({ id: '', print: '' })
watch(() => [data.value?.key, current.value?.id], async ([key, id]) => {
  screenPrint.value = { id: id || '', print: '' }
  if (!key || !id) return
  try {
    const res = await fetch('/api/track?' + new URLSearchParams({ key, id }))
    if (res.ok && current.value?.id === id) screenPrint.value = { id, print: (await res.json()).print || '' }
  } catch { /* sin huella el enlace se escribe igual, sin rastreo */ }
})
const taskRef = computed(() => {
  if (!data.value || !current.value) return ''
  const print = screenPrint.value.id === current.value.id && screenPrint.value.print ? '@' + screenPrint.value.print : ''
  const title = (current.value.title || current.value.name || 'pantalla').replace(/[\[\]()\n]/g, ' ').trim()
  return `[${title}](visor:${data.value.key}/${fromID(current.value.id)}${print})`
})
const refCopied = ref(false)
async function copyTaskRef() {
  try {
    await navigator.clipboard.writeText(taskRef.value)
    refCopied.value = true
    setTimeout(() => { refCopied.value = false }, 1500)
  } catch { /* sin permiso del portapapeles: el texto queda a la vista para copiarlo a mano */ }
}
// El PAQUETE PARA EL MODELO de la pantalla (server: `/api/brief`): el enlace con huella, dónde está, sus
// textos en orden, a dónde lleva, los componentes y tokens que usa y el HTML traducido, en un solo texto
// para pegar en la conversación con el modelo que la va a pasar a código.
const briefURL = computed(() => (data.value && current.value ? `/api/brief?key=${data.value.key}&id=${encodeURIComponent(current.value.id)}` : ''))
const briefState = ref('') // '' | 'copying' | 'copied' | 'error'
async function copyBrief() {
  if (!briefURL.value) return
  briefState.value = 'copying'
  try {
    const res = await fetch(briefURL.value)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await navigator.clipboard.writeText(await res.text())
    briefState.value = 'copied'
  } catch { briefState.value = 'error' }
  setTimeout(() => { briefState.value = '' }, 1800)
}
async function copyLink() {
  if (!data.value || !current.value) return
  const path = routePath.value.replace(/[?&]huella=[0-9a-f]+/, '').replace(/\?$/, '')
  let print = ''
  try {
    const res = await fetch('/api/track?' + new URLSearchParams({ key: data.value.key, id: current.value.id }))
    if (res.ok) print = (await res.json()).print || ''
  } catch { /* sin huella el enlace sirve igual: sólo no se podrá rastrear */ }
  try {
    await navigator.clipboard.writeText(location.origin + path + (print ? (path.includes('?') ? '&' : '?') + 'huella=' + print : ''))
    copied.value = print ? 'huella' : 'plain'
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* sin permiso del portapapeles: la ruta sigue en la barra del navegador */ }
}

const htmlURL = computed(() => (data.value && current.value ? `/api/html?key=${data.value.key}&id=${encodeURIComponent(current.value.id)}` : ''))
// El reporte de la traducción: qué se tradujo y qué no. Se pide al cambiar de pantalla sólo si se está
// mirando el HTML, para no traducir pantallas que nadie abre.
// El reporte se pide en los tres modos: además de la traducción dice qué estilos del sistema de diseño usa
// la pantalla, y eso sirve también mirando la imagen.
watch([htmlURL, mode], async ([u]) => {
  report.value = null
  if (!u) return
  try {
    const res = await fetch(u + '&report=1')
    if (res.ok && u === htmlURL.value) report.value = await res.json()
  } catch { /* el reporte es un extra: sin él, la pantalla se ve igual */ }
}, { immediate: true })
const missingList = computed(() => Object.entries(report.value?.missing || {}).map(([why, n]) => `${why} ×${n}`))
const tokensURL = (format) => (data.value ? `/api/tokens?key=${data.value.key}${format ? '&format=' + format : ''}` : '')
// Los controles que el HTML deja usar: campos para escribir, casillas para marcar, botones.
const controlList = computed(() => Object.entries(report.value?.controls || {}).map(([kind, n]) => `${n} ${kind}`))

// LA FIDELIDAD DE LA PANTALLA: cuánto se parece el HTML a Figma, en un número (`server/fidelity.go`). Medir
// cuesta unos segundos —un Chromium dibuja el HTML y lo compara con la imagen—, así que al abrir una
// pantalla sólo se pide la medida GUARDADA (`cached=1`); se mide al tocar «Medir». La medida vale para la
// versión del archivo y la traducción con que se tomó.
// ⚠ Hubo un mapa de calor y una lista de capas que difieren: se sacaron porque daban falsos positivos en
// el suavizado de letras e íconos (Miguel, 2026-09-25).
const fidelity = ref(null)
const fidelityState = ref('') // '' · 'measuring' · 'none' (sin medir) · 'error'
const fidelityError = ref('')
const fidelityURL = computed(() => (data.value && current.value ? `/api/fidelity?key=${data.value.key}&id=${encodeURIComponent(current.value.id)}` : ''))
async function loadFidelity(u, { measure = false, fresh = false } = {}) {
  if (measure) fidelityState.value = 'measuring'
  try {
    const res = await fetch(u + (measure ? (fresh ? '&fresh=1' : '') : '&cached=1'))
    if (u !== fidelityURL.value) return
    if (!measure && res.status === 404) { fidelityState.value = 'none'; return }
    const body = await res.json()
    if (u !== fidelityURL.value) return
    if (!res.ok) { fidelityState.value = 'error'; fidelityError.value = body.error || `HTTP ${res.status}`; return }
    fidelity.value = body
    fidelityState.value = ''
  } catch (e) {
    if (u === fidelityURL.value) { fidelityState.value = 'error'; fidelityError.value = String(e?.message || e) }
  }
}
watch(fidelityURL, (u) => {
  fidelity.value = null; fidelityState.value = ''
  if (u) loadFidelity(u)
}, { immediate: true })
const measureNow = () => { if (fidelityURL.value) loadFidelity(fidelityURL.value, { measure: true, fresh: Boolean(fidelity.value) }) }
// En palabras y no en color: el tema no trae un «bien / regular / mal», y un número solo no dice si 99 es
// mucho. Sobre la medida REAL (sin el suavizado): una pantalla bien traducida da 99,9 y pico; unos chulos
// que faltan la bajan poco, así que el número dice cuánto confiar en el HTML, no qué le falta.
const fidelityWord = computed(() => {
  const x = fidelity.value?.same_real
  if (x === undefined) return ''
  return x >= 0.995 ? 'alta' : x >= 0.97 ? 'media: hay capas corridas o de otro tamaño' : 'baja: el HTML no sirve de guía sin revisar'
})
const pct = (x, digits = 1) => (x * 100).toFixed(digits).replace('.', ',') + ' %'

// SEÑALAR UNA CAPA: para decirle al modelo «acá hay algo que no cuadra» con un enlace. En el modo
// «Señalar» (S) se marca la capa de abajo del mouse —la visible más chica que contiene el punto, en la
// imagen o en el HTML, con las cajas que da el server— y un clic la fija: va a la ruta como `?capa=` y la
// barra derecha dice qué es, qué dice Figma y cómo se ve esa zona de cada lado. `make visor-capa` con el
// mismo enlace le da al modelo lo mismo, con los recortes en archivo.
const picking = ref(false)
const layers = ref([])       // las cajas de la pantalla actual
const hoverLayer = ref(null)
const layerDetail = ref(null)
const layerState = ref('')   // '' · 'loading' · 'gone' · 'error'
const layerError = ref('')
let routeLayer = null        // la capa que trae la ruta, para cuando la pantalla termine de abrir
const selectedBox = computed(() => layers.value.find((l) => l.id === selectedLayer.value) || layerDetail.value || null)
async function loadLayers() {
  const want = data.value && current.value ? `/api/layers?key=${data.value.key}&id=${encodeURIComponent(current.value.id)}` : ''
  if (!want) return
  try {
    const res = await fetch(want)
    const body = await res.json()
    if (res.ok && current.value && want.endsWith(encodeURIComponent(current.value.id))) layers.value = body.layers || []
  } catch { /* sin cajas no se puede señalar, pero la pantalla se ve igual */ }
}
watch(currentID, (id) => {
  layers.value = []; hoverLayer.value = null; layerDetail.value = null; layerState.value = ''
  if (routeLayer && routeLayer.screen === id) { selectedLayer.value = routeLayer.layer; routeLayer = null } else selectedLayer.value = ''
  if (id && (picking.value || selectedLayer.value)) loadLayers()
})
watch(picking, (on) => { if (on && !layers.value.length) loadLayers(); if (!on) hoverLayer.value = null })
watch(selectedLayer, async (layer) => {
  layerDetail.value = null; layerError.value = ''
  if (!layer || !data.value || !current.value) { layerState.value = ''; return }
  if (!layers.value.length) loadLayers()
  layerState.value = 'loading'
  const screenID = current.value.id
  try {
    const res = await fetch(`/api/layer?key=${data.value.key}&id=${encodeURIComponent(screenID)}&layer=${encodeURIComponent(layer)}`)
    const body = await res.json()
    if (selectedLayer.value !== layer) return
    if (res.status === 404) { layerState.value = 'gone'; layerError.value = body.error; return }
    if (!res.ok) { layerState.value = 'error'; layerError.value = body.error || `HTTP ${res.status}`; return }
    layerDetail.value = body
    layerState.value = ''
  } catch (e) {
    if (selectedLayer.value === layer) { layerState.value = 'error'; layerError.value = String(e?.message || e) }
  }
})
// La capa de abajo del punto: la visible MÁS CHICA que lo contiene. Un texto adentro de un botón gana al
// botón; para el botón, se señala su borde.
function layerAt(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const x = (e.clientX - r.left) / scale.value, y = (e.clientY - r.top) / scale.value
  let best = null
  for (const l of layers.value) {
    if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h && (!best || l.w * l.h < best.w * best.h)) best = l
  }
  return best
}
const onPickMove = (e) => { hoverLayer.value = layerAt(e) }
function onPick(e) {
  const l = layerAt(e)
  if (l) selectedLayer.value = selectedLayer.value === l.id ? '' : l.id
}
const layerStyle = (l) => {
  const c = current.value
  return { left: (l.x / c.w) * 100 + '%', top: (l.y / c.h) * 100 + '%', width: (l.w / c.w) * 100 + '%', height: (l.h / c.h) * 100 + '%' }
}
// Los recortes de la barra derecha se arman acá, sin Chromium: la imagen de Figma y el HTML de la
// pantalla, corridos y escalados para que se vea sólo la caja de la capa.
// Del ancho de la barra: menos los dos márgenes y lo que ocupa la barra de desplazamiento.
const CROP_H = 180
const cropScale = computed(() => {
  const b = selectedBox.value
  if (!b || !b.w || !b.h) return 1
  return Math.min(Math.max(80, shown.value.aux - 48) / b.w, CROP_H / b.h, 3)
})
const cropFrame = computed(() => {
  const b = selectedBox.value, k = cropScale.value
  return b ? { width: b.w * k + 'px', height: b.h * k + 'px' } : {}
})
const cropImage = computed(() => {
  const b = selectedBox.value, k = cropScale.value, c = current.value
  return b && c ? { width: c.w * k + 'px', height: c.h * k + 'px', transform: `translate(${-b.x * k}px, ${-b.y * k}px)` } : {}
})
const cropFrameHTML = computed(() => {
  const b = selectedBox.value, k = cropScale.value, c = current.value
  return b && c ? { width: c.w + 'px', height: c.h + 'px', transform: `scale(${k}) translate(${-b.x}px, ${-b.y}px)` } : {}
})
const layerCopied = ref(false)
async function copyLayerLink() {
  const url = location.origin + routePath.value
  const d = layerDetail.value
  const text = `${url}\n(capa «${d?.name || selectedLayer.value}» de «${current.value?.title || current.value?.name}»; por consola: make visor-capa R='${url}')`
  try {
    await navigator.clipboard.writeText(text)
    layerCopied.value = true
    setTimeout(() => { layerCopied.value = false }, 1500)
  } catch { /* sin portapapeles: el enlace está en la barra del navegador */ }
}

// LA PALETA Y LA TIPOGRAFÍA de la pantalla, como las escribe el HTML (`render.Report`): cada color con su
// token si lo tiene, cada combinación de letra con su clase.
const palette = computed(() => report.value?.colors || [])
const typeList = computed(() => report.value?.type || [])
const hexOf = (value) => {
  const m = /rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/.exec(value || '')
  if (!m) return value
  const hex = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  const alpha = m[4] === undefined ? 1 : Number(m[4])
  return alpha < 1 ? `${hex} al ${Math.round(alpha * 100)} %` : hex
}
const tokenLeaf = (name) => name.split('/').pop()
const round1 = (x) => Math.round(x * 10) / 10
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
    // Un arrastre que empezó adentro del HTML ya lo captura su documento (bindFrame).
    try { stage.value?.setPointerCapture(e.pointerId) } catch { /* el puntero es del iframe */ }
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
// ── el HTML responde: sus campos, casillas y botones se usan, y el resto sigue moviendo el lienzo ──
// El iframe es del mismo origen (lo sirve este server por el proxy de Vite), así que la página escucha
// sus eventos directo; el documento de adentro no corre scripts. Un clic en un control es del control;
// un arrastre desde cualquier otra parte mueve el lienzo, la rueda hace lo mismo que afuera, y un botón
// del HTML sigue la zona del prototipo que tiene encima — también con las zonas ocultas (H).
const CONTROLS = 'input, select, textarea, label, button'
function bindFrame(ev) {
  const frame = ev.target
  let doc = null
  try { doc = frame.contentDocument } catch { return }
  if (!doc || frame.dataset.bound === doc.URL) return
  frame.dataset.bound = doc.URL
  // De coordenadas del documento (px de Figma, sin escalar) a las de la página.
  const toPage = (e) => {
    const r = frame.getBoundingClientRect()
    const k = r.width / (frame.offsetWidth || 1)
    return { clientX: r.left + e.clientX * k, clientY: r.top + e.clientY * k, pointerId: e.pointerId, button: e.button }
  }
  doc.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.(CONTROLS)) return
    onPointerDown(toPage(e))
    try { doc.documentElement.setPointerCapture(e.pointerId) } catch { /* sin captura, el arrastre corta al salir */ }
  })
  doc.addEventListener('pointermove', (e) => onPointerMove(toPage(e)))
  doc.addEventListener('pointerup', (e) => onPointerUp(toPage(e)))
  doc.addEventListener('pointercancel', (e) => onPointerUp(toPage(e)))
  doc.addEventListener('wheel', (e) => onWheel({ ...toPage(e), deltaX: e.deltaX, deltaY: e.deltaY, ctrlKey: e.ctrlKey,
    metaKey: e.metaKey, preventDefault: () => e.preventDefault() }), { passive: false })
  // Con el foco adentro del HTML las flechas y la H siguen andando, salvo mientras se escribe.
  doc.addEventListener('keydown', (e) => { if (!e.target.closest?.('input, textarea, select')) onKey(e) })
  doc.addEventListener('click', (e) => {
    if (swallowClick) { e.preventDefault(); e.stopPropagation(); swallowClick = false; return }
    if (!e.target.closest?.('button')) return
    const h = clickable.value.find((z) => e.clientX >= z.X && e.clientX <= z.X + z.W && e.clientY >= z.Y && e.clientY <= z.Y + z.H)
    if (h) follow(h)
  }, true)
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
  if (e.target.closest('input, textarea') || sheetKey.value) return
  if (e.key === 'ArrowRight') { step(1); e.preventDefault() }
  else if (e.key === 'ArrowLeft' && !e.altKey) { step(-1); e.preventDefault() }
  else if (e.key === 'Backspace' || (e.key === 'ArrowLeft' && e.altKey)) { back(); e.preventDefault() }
  else if (e.key === 'h' || e.key === 'H') showHotspots.value = !showHotspots.value
  else if (e.key === 's' || e.key === 'S') picking.value = !picking.value
  else if (e.key === 'Escape' && (picking.value || selectedLayer.value)) { if (picking.value) picking.value = false; else selectedLayer.value = '' }
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

// El tema lo elige la persona con el botón del pie (la base: `bindThemeToggle`). El renglón que lo aplica
// antes de pintar lo inyecta Vite en el <head> desde `THEME_BOOT` (vite.config.js). El HTML traducido y
// la imagen de Figma no lo siguen a propósito: son el diseño, y el diseño tiene sus propios colores.
const themeToggle = ref(null)
let themeBinding = null
onMounted(async () => {
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  window.addEventListener('resize', onWindowResize)
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
  themeBinding?.destroy()
  window.removeEventListener('resize', onWindowResize)
  observer?.disconnect()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('hashchange', onHash)
  window.removeEventListener('popstate', onPopState)
})

const kindName = { mobile: 'móvil', web: 'web', panel: 'panel', textless: 'sin texto' }
const laneName = (lane) => (lane.label ? lane.label : 'Fila sin rótulo')
// El dato de la derecha de una fila son dos iconos; su `title` dice los dos en palabras.
const rowMetaTitle = (sc) => [sc.hotspots?.length ? 'Tiene zonas del prototipo' : '',
  sc.open_comments ? sc.open_comments + ' comentario(s) abierto(s)' : ''].filter(Boolean).join(' · ')
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Proyectos">
      <div class="rsz rsz-edge-right" v-resize="resizeOptions('sidebar')"></div>
      <!-- La banda superior de la columna, de 40 como la del editor y la del detalle: sin ella la primera
           vista (32) dejaba la costura de arriba escalonada contra las otras dos columnas. -->
      <div class="region-head"><span>Proyectos</span><span v-if="flows.length" class="count">{{ flows.length }}</span></div>

      <!-- Cada PROYECTO (un flujo, un archivo de Figma) es un bloque del acordeón en la raíz de la barra, y
           adentro están sus pantallas en los carriles del diseñador, sin pasar por las páginas del
           archivo. Los bloques abiertos se reparten el alto y uno cerrado cuesta una fila. -->
      <section v-for="f in flows" :key="f.key" class="view" :class="{ open: isOpenFile(f.key) }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="isOpenFile(f.key)" :aria-controls="'flow-' + f.key" @click="toggleFile(f.key)">
            <span class="ui-icon" data-icon="chevron" aria-hidden="true"></span><span>{{ f.name }}</span>
          </button>
          <span v-if="countOf(f.key)" class="count" :title="countOf(f.key) + ' pantallas en el flujo'">{{ countOf(f.key) }}</span>
          <div v-if="maps[f.key]" class="region-actions">
            <button class="region-action" title="Volver a leer el flujo desde Figma" aria-label="Volver a leer" @click="openFlow(f.key, true)">
              <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div v-if="isOpenFile(f.key)" :id="'flow-' + f.key" class="region-body">
          <p v-if="mapState[f.key] === 'loading'" class="hint">Leyendo el flujo…</p>
          <div v-else-if="mapState[f.key]?.error" class="alert alert-destructive" role="alert"><div class="alert-desc">{{ mapState[f.key].error }}</div></div>
          <!-- Arriba de los carriles, la hoja de tokens del proyecto: se abre en el centro. -->
          <button v-if="tokensOf(f.key)" type="button" class="row" :class="{ on: sheetKey === f.key && sheetKind === 'tokens' }"
            :aria-current="sheetKey === f.key && sheetKind === 'tokens' ? 'true' : undefined" @click="openSheet(f.key, 'tokens')">
            <span>Tokens del diseño</span><span class="row-meta">{{ sheetCount(f.key) }}</span>
          </button>
          <button v-if="inventoryOf(f.key)?.length" type="button" class="row" :class="{ on: sheetKey === f.key && sheetKind === 'components' }"
            :aria-current="sheetKey === f.key && sheetKind === 'components' ? 'true' : undefined" @click="openSheet(f.key, 'components')">
            <span>Componentes</span><span class="row-meta">{{ componentCount(f.key) }}</span>
          </button>
          <template v-for="g in groupsFor(maps[f.key]?.structure)" :key="g.id">
            <div v-if="groupsFor(maps[f.key]?.structure).length > 1" class="section-name">{{ g.name }}</div>
            <template v-for="(lane, li) in g.lanes" :key="g.id + '-' + li">
              <div class="region-head group" :class="{ unlabeled: !lane.label }">
                <span>{{ laneName(lane) }}</span><span class="count">{{ lane.screens.length }}</span>
              </div>
              <!-- Una pantalla es una fila de la base (`.row`, 28): su número de orden adelante y, a la
                   derecha, si lleva a otra (zonas del prototipo) y si tiene comentarios abiertos. -->
              <button v-for="(sc, i) in lane.screens" :key="sc.id" type="button" class="row" :data-screen="sc.id"
                :class="{ on: data && data.key === f.key && sc.id === currentID }"
                :aria-current="data && data.key === f.key && sc.id === currentID ? 'true' : undefined" @click="pick(f.key, sc.id)">
                <small class="row-index">{{ i + 1 }}</small>
                <span>{{ sc.title || sc.name }}</span>
                <span v-if="sc.hotspots?.length || sc.open_comments" class="row-meta" :title="rowMetaTitle(sc)">
                  <span v-if="sc.hotspots?.length" class="ui-icon" data-icon="play" role="img" aria-label="Tiene zonas del prototipo"></span>
                  <span v-if="sc.open_comments" class="ui-icon" data-icon="comment" role="img" :aria-label="sc.open_comments + ' comentario(s) abierto(s)'"></span>
                </span>
              </button>
            </template>
          </template>
        </div>
      </section>

      <!-- Al final, sumar otro: como «Traer de Jira» en el tablero. -->
      <section class="view" :class="{ open: adding }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="adding" aria-controls="view-add" @click="adding = !adding">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span><span>Sumar un flujo</span>
          </button>
          <div class="region-actions">
            <button class="region-action" title="Volver a pedir los proyectos a Figma" aria-label="Actualizar los proyectos" @click="loadLibrary(true)">
              <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div v-if="adding || libraryError || libraryErrors.length || !flows.length" id="view-add" class="region-body">
          <form v-if="adding || !flows.length" class="add-form" @submit.prevent="addToLibrary()">
            <input v-model="addURL" class="input" type="url" placeholder="Enlace de un archivo, proyecto o equipo" aria-label="Enlace de Figma" />
            <button class="btn" :disabled="libraryBusy || !addURL.trim()">{{ libraryBusy ? 'Sumando…' : 'Sumar' }}</button>
          </form>
          <p v-if="adding || !flows.length" class="hint">Pegá el enlace de un archivo de Figma, o la página de un proyecto (<span class="mono">figma.com/files/project/…</span>) o de un equipo (<span class="mono">figma.com/files/team/…</span>) para sumar todos sus flujos. La API de Figma no lista lo visto recientemente.</p>
          <div v-if="libraryError" class="alert alert-destructive" role="alert"><div class="alert-desc">{{ libraryError }}</div></div>
          <div v-for="e in libraryErrors" :key="e" class="alert alert-destructive"><div class="alert-desc">{{ e }}</div></div>
        </div>
      </section>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ sheetKey ? (sheetKind === 'tokens' ? 'Tokens del diseño · ' : 'Componentes · ') + (maps[sheetKey]?.structure?.file_name || '') : current ? (current.title || current.name) : 'Visor' }}</span>
        <template v-if="sheetKey && sheetKind === 'components'">
          <div class="region-actions">
            <button class="region-action" :title="copiedVar === inventoryText ? 'Copiado' : 'Copiar el inventario como texto, para el modelo o la tarea'" aria-label="Copiar el inventario" @click="copyVar(inventoryText)">
              <span class="ui-icon" :data-icon="copiedVar === inventoryText ? 'check' : 'copy'" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <template v-else-if="sheetKey">
          <div class="toggle-group toggle-sm mode-toggle" role="group" aria-label="Formato de la hoja">
            <button v-for="f in sheetFormats" :key="f.id" type="button" class="toggle" :class="{ on: sheetFormat === f.id }"
              :aria-pressed="sheetFormat === f.id" @click="sheetFormat = f.id">{{ f.label }}</button>
          </div>
          <div class="region-actions">
            <button class="region-action" :title="sheetCopied ? 'Copiada' : 'Copiar la hoja en ' + sheetFormat.toUpperCase() + ' para pegarla en el proyecto'" aria-label="Copiar la hoja" @click="copySheet">
              <span class="ui-icon" :data-icon="sheetCopied ? 'check' : 'copy'" aria-hidden="true"></span>
            </button>
            <a class="region-action" :href="sheetURL" target="_blank" rel="noopener" title="Abrir la hoja como texto" aria-label="Abrir la hoja">
              <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
            </a>
          </div>
        </template>
        <template v-else-if="current">
          <div class="region-actions">
            <button class="region-action" title="Volver (Retroceso)" aria-label="Volver" :disabled="!trail.length" @click="back">
              <span class="ui-icon icon-flip" data-icon="move" aria-hidden="true"></span>
            </button>
            <button class="region-action" title="Anterior del carril (←)" aria-label="Anterior" :disabled="current.index === 0" @click="step(-1)">
              <span class="ui-icon icon-flip" data-icon="chevron" aria-hidden="true"></span>
            </button>
            <button class="region-action" title="Siguiente del carril (→)" aria-label="Siguiente" :disabled="current.index === current.lane.screens.length - 1" @click="step(1)">
              <span class="ui-icon" data-icon="chevron" aria-hidden="true"></span>
            </button>
          </div>
          <!-- Los tres modos son el alternador de la base, de 28 (el tamaño de un control en una banda): se
               elige UNO y se ven los tres. Sin contorno ni unidos: sería una caja alrededor de un grupo. -->
          <div class="toggle-group toggle-sm mode-toggle" role="group" aria-label="Cómo ver la pantalla">
            <button v-for="m in modes" :key="m.id" type="button" class="toggle" :class="{ on: mode === m.id }"
              :aria-pressed="mode === m.id" @click="mode = m.id">{{ m.label }}</button>
          </div>
          <div class="region-actions">
            <!-- Sin zonas el ojo no tiene nada que mostrar: deshabilitado y diciéndolo, porque encendido o
                 apagado se veía igual y parecía roto. -->
            <button class="region-action" :aria-pressed="showHotspots" :disabled="!clickable.length"
              :title="clickable.length ? `${showHotspots ? 'Ocultar' : 'Mostrar'} ${clickable.length === 1 ? 'la zona' : 'las ' + clickable.length + ' zonas'} del prototipo: tocar una lleva a la pantalla a la que conecta en Figma (H)` : 'Esta pantalla no tiene zonas del prototipo: en Figma no se conectó a ninguna otra'"
              aria-label="Zonas del prototipo" @click="showHotspots = !showHotspots">
              <span class="ui-icon" data-icon="eye" aria-hidden="true"></span>
            </button>
            <button class="region-action" :aria-pressed="picking" title="Señalar una capa: tocala para marcarla y copiar el enlace (S)" aria-label="Señalar una capa" @click="picking = !picking">
              <span class="ui-icon" data-icon="pick" aria-hidden="true"></span>
            </button>
            <button class="region-action" title="Centrar la pantalla (0)" aria-label="Centrar la pantalla" @click="center">
              <span class="ui-icon" data-icon="collapse" aria-hidden="true"></span>
            </button>
            <button class="region-action" :title="copied === 'huella' ? 'Copiado, con la huella de la pantalla' : copied ? 'Copiado, sin huella: no se pudo leer' : 'Copiar el enlace a esta pantalla, con su huella para saber después si cambió'" aria-label="Copiar el enlace" @click="copyLink">
              <span class="ui-icon" :data-icon="copied ? 'check' : 'copy'" aria-hidden="true"></span>
            </button>
            <a class="region-action" :href="figmaURL" target="_blank" rel="noopener" title="Abrir esta pantalla en Figma" aria-label="Abrir en Figma">
              <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
            </a>
          </div>
        </template>
      </div>
      <div v-show="!sheetKey" ref="stage" class="stage" :class="{ dragging }" @pointerdown="onPointerDown" @pointermove="onPointerMove"
        @pointerup="onPointerUp" @pointercancel="onPointerUp" @click.capture="onClickCapture" @wheel="onWheel" @dblclick.self="center">
        <div v-if="!current" class="empty">
          <div class="empty-head">
            <div class="empty-title">{{ loading ? 'Leyendo el diseño…' : error ? 'No se abrió la pantalla' : 'Sin pantalla elegida' }}</div>
            <div class="empty-desc">{{ loading ? 'El primer mapa de una sección grande tarda: baja el árbol entero de Figma.' : (error || 'Elegí una pantalla de un carril en la barra de la izquierda.') }}</div>
          </div>
        </div>
        <div v-else ref="canvas" class="canvas" :style="{ transform: `translate(${pan.x}px, ${pan.y}px)` }">
        <figure v-for="p in panes" :key="p" class="screen-pane">
        <div class="device" :data-kind="current.kind" :style="{ width: current.w * scale + 'px', height: current.h * scale + 'px' }">
          <img v-if="p === 'image'" :key="imageURL" :src="imageURL" :alt="current.title || current.name" draggable="false" @error="imageFailed = true" />
          <iframe v-else :key="htmlURL" :src="htmlURL" :title="'HTML de ' + (current.title || current.name)" class="html" @load="bindFrame"
            :style="{ width: current.w + 'px', height: current.h + 'px', transform: `scale(${scale})` }"></iframe>
          <div v-if="p === 'image' && imageFailed" class="alert alert-destructive"><div class="alert-desc">Figma no devolvió la imagen de esta pantalla.</div></div>
          <div v-if="selectedBox && selectedLayer" class="layer-box on" :style="layerStyle(selectedBox)" aria-hidden="true"></div>
          <div v-if="picking && hoverLayer && hoverLayer.id !== selectedLayer" class="layer-box" :style="layerStyle(hoverLayer)" aria-hidden="true"></div>
          <!-- Señalando, una superficie transparente se queda con el mouse: el iframe del HTML se lo llevaría, y
               las zonas del prototipo navegarían en vez de marcar. -->
          <div v-if="picking" class="pick-surface" :title="hoverLayer ? hoverLayer.name : ''" @pointermove="onPickMove" @pointerleave="hoverLayer = null" @click="onPick"></div>
          <template v-if="showHotspots && !picking">
            <button v-for="(h, i) in clickable" :key="i" class="hotspot" :class="{ outside: !h.to }" :style="hotspotStyle(h)"
              :title="h.via + ' → ' + h.to_name" :aria-label="h.via + ' → ' + h.to_name" :disabled="!h.to" @click="follow(h)"></button>
          </template>
          <button v-if="autoNext" type="button" class="btn auto-next" @click="follow(autoNext)">
            <span class="ui-icon" data-icon="play" aria-hidden="true"></span><span>Avanza sola a {{ autoNext.to_name }}</span>
          </button>
        </div>
        <figcaption v-if="panes.length > 1">{{ p === 'image' ? 'Figma (imagen)' : 'HTML traducido' }}</figcaption>
        </figure>
        </div>
      </div>
      <!-- La hoja de tokens: una muestra por color (tocarla copia su variable), cada estilo de texto escrito
           en su letra, los colores que se salen del sistema y los radios. -->
      <!-- El inventario: un componente por fila, dibujado con una instancia real (el SVG de Figma), con sus
           variantes y las pantallas donde aparece —tocar una la abre—. -->
      <div v-if="sheetKey && sheetKind === 'components'" class="region-body sheet">
        <div v-for="c in inventory" :key="c.name" class="component">
          <div class="component-thumb"><img :src="'/api/asset?key=' + sheetKey + '&svg=' + encodeURIComponent(c.sample)" :alt="c.name" loading="lazy" /></div>
          <div class="component-body">
            <div class="component-name"><strong>{{ c.name }}</strong><small>{{ c.uses }} usos · {{ c.screens.length }} pantallas</small></div>
            <div v-for="p in c.props" :key="p.name" class="component-prop">
              <small class="prop-name">{{ p.name }}{{ p.type === 'TEXT' ? ' · texto' : p.type === 'BOOLEAN' ? ' · sí/no' : '' }}</small>
              <span v-for="v in p.values" :key="v.value" class="badge badge-outline badge-xs">{{ v.value }} <small>×{{ v.uses }}</small></span>
            </div>
            <div class="component-screens">
              <button v-for="g in screensByTitle(c.screens).slice(0, 8)" :key="g.first" type="button" class="link-inline" @click="pick(sheetKey, g.first)">{{ g.title }}<small v-if="g.n > 1"> ×{{ g.n }}</small></button>
              <small v-if="screensByTitle(c.screens).length > 8">y {{ screensByTitle(c.screens).length - 8 }} más</small>
            </div>
          </div>
        </div>
      </div>
      <div v-if="sheetKey && sheetKind === 'tokens' && sheet" class="region-body sheet">
        <section class="sheet-part">
          <div class="region-head group"><span>Colores</span><span class="count">{{ sheetFamilies.reduce((n, f) => n + f.colors.length, 0) }}</span></div>
          <div v-for="fam in sheetFamilies" :key="fam.name" class="swatch-row">
            <span class="swatch-family">{{ fam.name }}</span>
            <button v-for="c in fam.colors" :key="c.var" type="button" class="swatch" :title="c.names.join(' = ') + ' · ' + c.uses + ' usos en ' + c.screens + ' pantallas · tocá para copiar var(' + c.var + ')'"
              @click="copyVar('var(' + c.var + ')')">
              <span class="swatch-chip" :style="{ background: c.value }"></span>
              <span class="swatch-var">{{ copiedVar === 'var(' + c.var + ')' ? 'copiado' : c.var }}</span>
              <small>{{ c.value }} · {{ c.uses }}</small>
            </button>
          </div>
        </section>
        <section class="sheet-part">
          <div class="region-head group"><span>Textos</span><span class="count">{{ sheet.texts.length }}</span></div>
          <button v-for="x in sheet.texts" :key="x.id" type="button" class="text-style" :title="'tocá para copiar la clase ' + x.class" @click="copyVar(x.class)">
            <span class="text-sample" :style="textSample(x)">Completa tu solicitud</span>
            <span class="text-meta"><code>{{ copiedVar === x.class ? 'copiado' : '.' + x.class }}</code>
              <small>{{ x.name }} · {{ (x.family || '').replace(/ Variable$/, '') }} {{ x.weight }} · {{ x.size }}/{{ x.line_height || '—' }} · {{ x.uses }} usos</small></span>
          </button>
        </section>
        <section v-if="sheet.loose?.length" class="sheet-part">
          <div class="region-head group"><span>Sin estilo</span><span class="count">{{ sheet.loose.length }}</span></div>
          <p class="hint">Colores escritos a mano en Figma: se salen del sistema de diseño. Si coinciden con un token, conviene usar el token.</p>
          <div class="swatch-row">
            <button v-for="l in sheet.loose" :key="l.value" type="button" class="swatch" :title="l.uses + ' usos en ' + l.screens + ' pantallas'" @click="copyVar(l.matches ? 'var(' + l.matches + ')' : l.value)">
              <span class="swatch-chip" :style="{ background: l.value }"></span>
              <span class="swatch-var">{{ l.matches ? '= ' + l.matches : l.value }}</span>
              <small>{{ l.uses }} usos</small>
            </button>
          </div>
        </section>
        <section v-if="sheet.radii?.length" class="sheet-part">
          <div class="region-head group"><span>Radios</span><span class="count">{{ sheet.radii.length }}</span></div>
          <div class="swatch-row">
            <div v-for="r in sheet.radii" :key="r.value" class="radius" :title="r.uses + ' usos'">
              <span class="radius-box" :style="{ borderRadius: Math.min(r.value, 24) + 'px' }"></span><small>{{ r.value }} · {{ r.uses }}</small>
            </div>
          </div>
        </section>
      </div>
    </main>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="Detalle de la pantalla">
      <div class="rsz rsz-edge-left" v-resize="resizeOptions('aux')"></div>
      <div class="region-head"><span>{{ sheetKey ? (sheetKind === 'tokens' ? 'Cómo usar la hoja' : 'Cómo usar el inventario') : 'Pantalla' }}</span></div>
      <div class="region-body detail">
        <div v-if="sheetKey && sheetKind === 'components'" class="sheet-help">
          <p>Las piezas del sistema de diseño que usa el flujo: cada una con las variantes con que aparece y dónde.</p>
          <p><strong>Para pasar el flujo a código</strong>, estos son los componentes de Vue o React que hay que tener antes
            de armar pantallas: si ya existen en el front, se reusan; si no, se arman primero, con esas variantes.</p>
          <p>Cuenta las piezas de primer nivel: el ícono de adentro de un botón es parte del botón. Tocar una pantalla la abre.</p>
          <p class="hint">Los nombres son los de Figma, con sus erratas: «Bontones» y «Botones» son dos componentes distintos en el archivo.</p>
        </div>
        <div v-else-if="sheetKey" class="sheet-help">
          <p>Estos son los estilos del sistema de diseño que usa el flujo, con el nombre que tienen en Figma.</p>
          <p><strong>Para pasar una pantalla a código</strong>, pegá la hoja en el proyecto —CSS: las variables y las
            clases de texto; Tailwind: el <code>@theme</code>, que da <code>bg-morado-500</code> o <code>text-small-medium</code>— y el
            HTML traducido de cada pantalla ya la usa.</p>
          <p>Tocar un color copia su variable; tocar un texto, su clase.</p>
          <p class="hint">Radios y espaciados van por valor: Figma no le da a este token los nombres de sus variables.</p>
        </div>
        <div v-else-if="!current" class="empty">
          <div class="empty-head"><div class="empty-desc">Elegí una pantalla de un carril.</div></div>
        </div>
        <template v-else>
          <template v-if="linkCheck && linkCheck.id === current.id">
            <p v-if="linkCheck.status === 'checking'" class="hint">Comprobando si la pantalla cambió desde que se copió el enlace…</p>
            <p v-else-if="linkCheck.status === 'same'" class="hint">Sin cambios desde que se copió el enlace (huella {{ linkCheck.linked }}).</p>
            <div v-else-if="linkCheck.status === 'changed'" class="alert" role="status"><div class="alert-desc">El diseño cambió desde que se copió el enlace: huella {{ linkCheck.linked }} → {{ linkCheck.print }}. Lo que diga la tarea sobre esta pantalla puede estar viejo.</div></div>
            <div v-else-if="linkCheck.status === 'deleted'" class="alert alert-destructive" role="status"><div class="alert-desc">Figma ya no tiene esta pantalla: el diseñador la borró.</div></div>
            <p v-else-if="linkCheck.status === 'error'" class="hint">No se pudo comprobar la huella: {{ linkCheck.error }}</p>
          </template>
          <div v-if="selectedLayer" class="block layer-block">
            <div class="region-head group">
              <span>Capa señalada</span>
              <div class="region-actions">
                <button class="region-action" :title="layerCopied ? 'Copiado' : 'Copiar el enlace a esta capa, para decírselo a la IA'" aria-label="Copiar el enlace a la capa" @click="copyLayerLink">
                  <span class="ui-icon" :data-icon="layerCopied ? 'check' : 'copy'" aria-hidden="true"></span>
                </button>
                <a v-if="layerDetail" class="region-action" :href="layerDetail.figma" target="_blank" rel="noopener" title="Abrir la capa en Figma" aria-label="Abrir la capa en Figma">
                  <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
                </a>
                <button class="region-action" title="Soltar la capa (Esc)" aria-label="Soltar la capa" @click="selectedLayer = ''">
                  <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
                </button>
              </div>
            </div>
            <p v-if="layerState === 'loading'" class="hint">Leyendo la capa…</p>
            <div v-else-if="layerState === 'gone'" class="alert" role="status"><div class="alert-desc">{{ layerError }}</div></div>
            <p v-else-if="layerState === 'error'" class="hint">No se pudo leer la capa: {{ layerError }}</p>
            <template v-else-if="layerDetail">
              <dl>
                <dt>Capa</dt><dd>{{ layerDetail.name }} <small>· {{ layerDetail.type.toLowerCase() }}</small></dd>
                <template v-if="layerDetail.path?.length"><dt>Adentro de</dt><dd>{{ layerDetail.path.slice(1).join(' › ') || layerDetail.path[0] }}</dd></template>
                <dt>Caja</dt><dd>{{ Math.round(layerDetail.x) }},{{ Math.round(layerDetail.y) }} · {{ Math.round(layerDetail.w) }}×{{ Math.round(layerDetail.h) }}</dd>
                <template v-if="layerDetail.text"><dt>Dice</dt><dd>«{{ layerDetail.text }}»</dd></template>
                <template v-for="(f, i) in layerDetail.facts" :key="i"><dt>{{ f.label }}</dt><dd>{{ f.value }}</dd></template>
              </dl>
              <div class="crops">
                <figure>
                  <div class="crop" :style="cropFrame"><img :src="imageURL" alt="" :style="cropImage" draggable="false" /></div>
                  <figcaption>Figma</figcaption>
                </figure>
                <figure>
                  <div class="crop" :style="cropFrame"><iframe :src="htmlURL" title="El HTML en esa zona" tabindex="-1" :style="cropFrameHTML"></iframe></div>
                  <figcaption>HTML</figcaption>
                </figure>
              </div>
              <p class="hint">El enlace lleva la capa: pegalo en el chat o en la tarea. Por consola, <code>make visor-capa R='…'</code> con ese enlace da lo mismo, con los recortes en archivo y cuánto se parecen en esa zona.</p>
            </template>
          </div>
          <dl>
            <dt>Título</dt><dd>{{ current.title || '—' }}<small v-if="current.title_from === 'capa'"> · del nombre de la capa</small></dd>
            <dt>Capa</dt><dd>{{ current.name }}</dd>
            <dt>Carril</dt><dd>{{ laneName(current.lane) }} · {{ current.index + 1 }} de {{ current.lane.screens.length }}</dd>
            <dt>Tipo</dt><dd>{{ kindName[current.kind] || current.kind }} · {{ Math.round(current.w) }}×{{ Math.round(current.h) }}</dd>
            <template v-if="current.open_comments"><dt>Comentarios</dt><dd>{{ current.open_comments }} abierto(s) en Figma</dd></template>
            <dt>Para la tarea</dt>
            <dd class="task-ref">
              <code :title="screenPrint.print ? 'Pegalo en un bloque de la tarea: el tablero lo abre acá y make visor-enlaces avisa si la pantalla cambia' : 'Sin huella todavía: el tablero lo abre igual, pero no se podrá saber si cambió'">{{ taskRef }}</code>
              <button class="region-action" :title="refCopied ? 'Copiado' : 'Copiar para pegar en la tarea'" aria-label="Copiar el enlace para la tarea" @click="copyTaskRef">
                <span class="ui-icon" :data-icon="refCopied ? 'check' : 'copy'" aria-hidden="true"></span>
              </button>
            </dd>
            <dt>Para el modelo</dt>
            <dd class="task-ref">
              <button type="button" class="btn btn-sm btn-secondary" :disabled="briefState === 'copying'" @click="copyBrief"
                title="Todo lo que un modelo necesita para pasar esta pantalla a Vue o React: textos, a dónde lleva, componentes, tokens y el HTML">
                {{ briefState === 'copying' ? 'Armando…' : briefState === 'copied' ? 'Copiado' : briefState === 'error' ? 'No se pudo' : 'Copiar el paquete' }}
              </button>
              <a class="region-action" :href="briefURL" target="_blank" rel="noopener" title="Ver el paquete" aria-label="Ver el paquete">
                <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
              </a>
            </dd>
          </dl>
          <div class="block">
            <div class="region-head group">
              <span>Fidelidad del HTML</span>
              <div class="region-actions">
                <button class="region-action" :disabled="fidelityState === 'measuring'" :title="fidelity ? 'Volver a medir' : 'Medir contra Figma'"
                  :aria-label="fidelity ? 'Volver a medir' : 'Medir'" @click="measureNow">
                  <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
                </button>
              </div>
            </div>
            <p v-if="fidelityState === 'measuring'" class="hint">Midiendo: Chromium dibuja el HTML y lo compara píxel a píxel con la imagen de Figma. Tarda unos segundos.</p>
            <p v-else-if="fidelityState === 'error'" class="hint">No se pudo medir: {{ fidelityError }}</p>
            <template v-else-if="fidelity">
              <div class="fidelity">
                <strong>{{ pct(fidelity.same_real, 2) }}</strong>
                <span>igual a Figma · fidelidad {{ fidelityWord }}</span>
              </div>
              <div class="progress progress-xs fidelity-bar"><i :style="{ width: fidelity.same_real * 100 + '%' }"></i></div>
              <p class="hint">Medida el {{ new Date(fidelity.measured_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) }} · no cuenta el suavizado de las letras ni medio píxel de corrimiento: un píxel es distinto si en la otra imagen no hay uno parecido a menos de 1 px. Píxel a píxel da {{ pct(fidelity.same) }}.</p>
            </template>
            <p v-else class="hint">Sin medir en esta versión. <button type="button" class="link-inline" @click="measureNow">Medir</button> dibuja el HTML y lo compara con la imagen de Figma (unos segundos).</p>
          </div>
          <div v-if="report && mode !== 'image'" class="block">
            <div class="region-head group"><span>La traducción a HTML</span></div>
            <dl>
              <dt>Cajas</dt><dd>{{ report.elements }} · {{ report.flex }} con auto-layout → flex · {{ report.absolute }} en posición absoluta</dd>
              <dt>Textos</dt><dd>{{ report.texts }}</dd>
              <dt>Dibujos</dt><dd>{{ report.drawings?.length || 0 }} como SVG de Figma</dd>
              <template v-if="report.images?.length"><dt>Imágenes</dt><dd>{{ report.images.length }}</dd></template>
              <dt>Controles</dt><dd>{{ controlList.join(' · ') || 'ninguno' }}</dd>
              <dt>Fuentes</dt><dd>{{ (report.fonts || []).join(' · ') || '—' }}</dd>
              <dt>Sin traducir</dt><dd>{{ missingList.join(' · ') || 'nada' }}</dd>
            </dl>
          </div>
          <div v-if="report" class="block">
            <div class="region-head group"><span>Paleta</span><span class="count">{{ palette.length }}</span></div>
            <div v-if="palette.length" class="palette">
              <div v-for="c in palette" :key="c.value + '|' + (c.token || '')" class="palette-row" :title="(c.token || 'sin estilo en Figma') + ' · ' + c.value">
                <span class="palette-chip" :style="{ background: c.value }"></span>
                <span class="palette-name">{{ c.token ? tokenLeaf(c.token) : 'sin estilo' }}<small>{{ hexOf(c.value) }}{{ c.var ? ' · var(' + c.var + ')' : '' }}</small></span>
                <small class="palette-uses">×{{ c.uses }}</small>
              </div>
            </div>
            <p v-else class="hint">La pantalla no pinta colores propios.</p>
            <p v-if="report.loose" class="hint">{{ report.loose }} uso(s) de color sin estilo: se salen del sistema de diseño.</p>
          </div>
          <div v-if="report" class="block">
            <div class="region-head group"><span>Tipografía</span><span class="count">{{ typeList.length }}</span></div>
            <div v-if="typeList.length" class="palette">
              <div v-for="t in typeList" :key="[t.family, t.weight, t.size, t.line_height, t.token].join('|')" class="palette-row" :title="t.token || 'sin estilo de texto en Figma'">
                <span class="type-size">{{ round1(t.size) }}</span>
                <span class="palette-name">{{ t.family.replace(/ Variable$/, '') }} {{ t.weight }}{{ t.line_height ? ' · interlineado ' + round1(t.line_height) : '' }}<small>{{ t.class ? '.' + t.class : 'sin estilo de texto' }}</small></span>
                <small class="palette-uses">×{{ t.uses }}</small>
              </div>
            </div>
            <p v-else class="hint">La pantalla no tiene textos.</p>
            <p class="hint">La hoja del archivo, para pasar el diseño a código:
              <a :href="tokensURL('css')" target="_blank" rel="noopener">CSS</a> ·
              <a :href="tokensURL('tailwind')" target="_blank" rel="noopener">Tailwind</a> ·
              <a :href="tokensURL('')" target="_blank" rel="noopener">JSON</a></p>
          </div>
          <div v-if="current.actions?.length" class="block">
            <div class="region-head group"><span>Botones</span><span class="count">{{ current.actions.length }}</span></div>
            <ul class="plain-list"><li v-for="a in current.actions" :key="a">{{ a }}</li></ul>
          </div>
          <!-- Las pantallas a las que se va y de las que se llega son filas de la base, con un segundo
               renglón: por dónde (el clic, el temporizador), que es largo y no entra como dato a la derecha. -->
          <div v-if="current.hotspots?.length" class="block">
            <div class="region-head group"><span>Lleva a</span><span class="count">{{ current.hotspots.length }}</span></div>
            <button v-for="(h, i) in current.hotspots" :key="i" type="button" class="row stacked" :disabled="!h.to" @click="follow(h)">
              <span>{{ h.to_name }}</span><small class="row-desc">{{ h.via }}</small>
            </button>
          </div>
          <div v-if="incoming.length" class="block">
            <div class="region-head group"><span>Llega desde</span><span class="count">{{ incoming.length }}</span></div>
            <button v-for="(x, i) in incoming" :key="i" type="button" class="row stacked" @click="go(x.from.id)">
              <span>{{ x.from.title || x.from.name }}</span><small class="row-desc">{{ x.via }} · {{ laneName(x.from.lane) }}</small>
            </button>
          </div>
          <div v-if="variantsOfCurrent.length" class="block">
            <div class="region-head group"><span>La misma pantalla en otro lugar</span><span class="count">{{ variantsOfCurrent.length }}</span></div>
            <button v-for="v in variantsOfCurrent" :key="v.id" type="button" class="row stacked" @click="go(v.id)">
              <span>{{ laneName(v.lane) }}</span><small class="row-desc">{{ v.index + 1 }} de {{ v.lane.screens.length }} · {{ v.name }}</small>
            </button>
          </div>
          <p class="hint">El carril y el título se deducen de cómo está dibujado el lienzo. <kbd class="kbd">←</kbd> <kbd class="kbd">→</kbd> recorren el carril, <kbd class="kbd">Retroceso</kbd> vuelve y <kbd class="kbd">H</kbd> muestra u oculta las zonas del prototipo.</p>
        </template>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="structure">{{ structure.file_name }} · {{ structure.name }}</span>
      <span v-if="structure?.last_modified">guardado {{ new Date(structure.last_modified).toLocaleString('es-CO') }}</span>
      <span v-if="screenCount">{{ screenCount }} pantallas</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <!-- El tema, antes de los botones de disposición y separado 8: los de disposición van al final
             porque su orden copia la pantalla (izquierda, derecha). -->
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar los carriles" aria-label="Mostrar u ocultar los carriles" @click="toggle('sidebar')">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar el detalle" aria-label="Mostrar u ocultar el detalle" @click="toggle('aux')">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que queda acá es lo que la base NO da: la fila de pantalla con su meta, el
   lienzo que se arrastra, el marco del dispositivo y las zonas del prototipo. Todo lo demás —bandas,
   vistas, filas, contadores, alternador, avisos, estado vacío, pie— es de `workbench.css`. */

/* El tema va antes de los de disposición y separado 8: el `gap` de 4 de la base más estos 4. */
.theme-toggle { margin-right: var(--space-1) }

.add-form { display: flex; gap: var(--space-2); padding: var(--space-3) var(--gutter) 0 }
.add-form .input { flex: 1 }
.hint { margin: 0; padding: var(--space-3) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.hint .mono { font-family: var(--font-mono); font-size: var(--text-xs) }
/* El nombre de una sección cuando la página trae varias: por encima de los grupos de carriles, así que
   no es otro encabezado de grupo (serían dos pegajosos compitiendo) sino un rótulo que scrollea. */
.section-name { padding: var(--space-3) var(--gutter) var(--space-1); font-size: var(--text-xs); color: var(--fg-3) }
.region-head.group.unlabeled > span:first-child { font-style: italic }

.row-meta { display: inline-flex; align-items: center; gap: var(--space-1) }
/* El lienzo: la región no scrollea, la pantalla se arrastra. */
.stage { position: relative; flex: 1; min-height: 0; overflow: hidden; cursor: grab; touch-action: none; user-select: none }
.stage.dragging { cursor: grabbing }
.stage > .empty { position: absolute; inset: 0; cursor: default }
/* El lienzo mide lo que miden sus pantallas (no la región) y se mueve con `transform`: arrastrarlo no
   reacomoda nada, y `offsetWidth` sigue dando su tamaño sin el desplazamiento. */
.canvas { position: absolute; left: 0; top: 0; display: flex; align-items: flex-start; gap: var(--space-6);
  padding-bottom: var(--space-6); will-change: transform }
/* Una pantalla del lienzo con su rótulo. No es el `.pane` de la base (los dos paneles del editor): con
   ese nombre, en Comparar la segunda pantalla se llevaba su línea a la izquierda. */
.screen-pane { margin: 0; display: flex; flex-direction: column; align-items: center; gap: var(--space-2) }
.screen-pane figcaption { font-size: var(--text-xs); color: var(--fg-3) }
/* La cabecera del editor junta título, navegación, modos y acciones: con los dos sidebars abiertos no
   entra en un renglón, y la regla del taller es ENVOLVER, no desbordar. */
.editor > .region-head { flex-wrap: wrap; row-gap: var(--space-1) }
/* Al envolver, el título no cede todo el ancho: sin una base, `flex: 1` con `min-width: 0` lo dejaba en 0. */
.editor > .region-head > span:first-child { flex: 1 1 140px }
/* La base no trae una flecha hacia la izquierda: se da vuelta la de la derecha. */
.icon-flip { transform: scaleX(-1) }

/* El HTML se dibuja a su tamaño de Figma y se escala entero, a la misma escala que la imagen: el texto
   conserva sus medidas y la comparación es de igual a igual. Recibe el puntero porque sus controles se
   usan; el arrastre y la rueda que caen fuera de un control los reenvía bindFrame al lienzo. */
.device iframe.html { display: block; border: 0; transform-origin: 0 0 }
/* Sin radio: la esquina redondeada imitaba un teléfono y le cortaba al diseño lo que tiene en las
   esquinas. La pantalla se muestra con el borde que dibujó el diseñador. */
.device { position: relative; flex: none; border: 1px solid var(--device-edge); overflow: hidden; background: var(--card) }
.device img { display: block; width: 100%; height: 100%; user-select: none }
.device > .alert { position: absolute; left: 0; right: 0; top: 0 }
/* 2 px y no 1: con 1 px sobre un botón del mismo color la zona no se notaba, y el ojo parecía no hacer nada. */
.hotspot { position: absolute; padding: 0; border: 2px solid var(--hotspot); border-radius: var(--radius-control);
  background: var(--hotspot-fill); cursor: pointer }
.hotspot:hover { background: var(--hotspot-fill-hover) }
.hotspot.outside { border-style: dashed; cursor: not-allowed }
/* «Avanza sola a …»: el botón primario de la base, flotando al pie de la pantalla. */
.auto-next { position: absolute; left: 50%; bottom: var(--space-4); translate: -50% 0; max-width: 90% }
.auto-next > span:last-child { overflow: hidden; text-overflow: ellipsis }

/* El detalle: una lista de propiedades, rótulo y valor. */
/* La hoja de tokens. Una muestra de color y la caja de un radio son OBJETOS —se ven como lo que son—, así
   que llevan su borde; el resto va sin cajas, separado por su encabezado y por línea. */
.sheet { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--space-4) }
.sheet-part { padding-bottom: var(--space-3) }
.swatch-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2) var(--space-3); padding: var(--space-2) var(--space-3) }
.swatch-family { flex: 0 0 100%; font-size: var(--text-xs); color: var(--fg-3) }
.swatch { display: flex; flex-direction: column; gap: 2px; width: 104px; padding: 0; border: 0; background: none; color: inherit;
  font: inherit; text-align: left; cursor: pointer }
.swatch-chip { display: block; width: 100%; height: 40px; border: 1px solid var(--border); border-radius: var(--radius-sm) }
.swatch-var { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-xs); overflow-wrap: anywhere }
.swatch:hover .swatch-var { text-decoration: underline }
.swatch small, .radius small { font-size: var(--text-xs); color: var(--fg-3) }
.text-style { display: flex; flex-direction: column; gap: var(--space-1); width: 100%; padding: var(--space-2) var(--space-3); border: 0;
  border-bottom: 1px solid var(--border); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer }
.text-style:hover { background: color-mix(in oklab, var(--foreground) 6%, transparent) }
.text-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) }
.text-meta code { font-size: var(--text-xs); color: var(--fg-2) }
.text-meta small { font-size: var(--text-xs); color: var(--fg-3) }
.radius { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 64px }
.radius-box { width: 48px; height: 48px; border: 2px solid var(--fg-3) }
.component { display: flex; gap: var(--space-3); padding: var(--space-3); border-bottom: 1px solid var(--border) }
.component-thumb { flex: none; display: grid; place-items: center; width: 132px; height: 72px }
.component-thumb img { max-width: 100%; max-height: 100%; object-fit: contain }
.component-body { flex: 1; min-width: 0; display: grid; gap: var(--space-1) }
.component-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) }
.component-name small, .prop-name, .component-screens small { font-size: var(--text-xs); color: var(--fg-3) }
.component-prop { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) }
.component-prop .badge small { color: var(--fg-3) }
.component-screens { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); font-size: var(--text-xs) }
.link-inline { padding: 0; border: 0; background: none; color: var(--foreground); font: inherit; text-decoration: underline; text-decoration-color: var(--border); cursor: pointer }
.link-inline:hover { text-decoration-color: currentColor }
.sheet-help { display: grid; gap: var(--space-2); padding: var(--space-3); font-size: var(--text-sm) }
.sheet-help p { margin: 0 }
.detail dl { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: var(--space-1) var(--space-3); margin: 0;
  padding: var(--space-3) var(--gutter); font-size: var(--text-base) }
.detail dt { font-size: var(--text-sm); color: var(--fg-3) }
.detail dd { margin: 0; overflow-wrap: anywhere }
.detail dd small { font-size: var(--text-xs); color: var(--fg-3) }
.tokens { list-style: none; margin: 0; padding: var(--space-2) var(--space-3); font-size: var(--text-sm) }
.tokens li { display: flex; justify-content: space-between; gap: var(--space-2) }
.tokens small { color: var(--fg-3); font-variant-numeric: tabular-nums }
.task-ref { display: flex; align-items: flex-start; gap: var(--space-1) }
.task-ref code { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--text-sm); color: var(--fg-2);
  overflow-wrap: anywhere }
.plain-list { margin: 0; padding: 0 0 var(--space-2); list-style: none; font-size: var(--text-base) }
.plain-list li { display: flex; align-items: center; min-height: var(--row-h); padding: 0 var(--gutter) }

/* SEÑALAR: el recuadro de la capa (el que sigue al mouse, punteado; el fijado, entero) y la superficie que
   se queda con el mouse mientras se señala. */
.layer-box { position: absolute; pointer-events: none; outline: 1px dashed var(--primary); outline-offset: 0 }
.layer-box.on { outline: 2px solid var(--primary); box-shadow: 0 0 0 100vmax color-mix(in oklab, var(--background) 45%, transparent) }
.pick-surface { position: absolute; inset: 0; cursor: crosshair; z-index: 1 }
.crops { display: flex; flex-direction: column; gap: var(--space-3); padding: 0 var(--gutter) var(--space-2) }
.crops figure { margin: 0; display: flex; flex-direction: column; gap: var(--space-1) }
.crops figcaption { font-size: var(--text-xs); color: var(--fg-3) }
/* Un recorte es un objeto (una miniatura de la pantalla): lleva su marco. */
.crop { position: relative; overflow: hidden; border: 1px solid var(--device-edge); background: var(--card) }
.crop img { position: absolute; left: 0; top: 0; max-width: none; transform-origin: 0 0; user-select: none }
.crop iframe { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; pointer-events: none }
.fidelity { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); padding: var(--space-3) var(--gutter) var(--space-2) }
.fidelity strong { font-size: var(--text-title); font-variant-numeric: tabular-nums }
.fidelity span { font-size: var(--text-sm); color: var(--fg-2) }
.fidelity-bar { width: auto; margin: 0 var(--gutter) var(--space-2) }
/* La paleta y la tipografía: una fila por color o por letra, la muestra a la izquierda, los usos a la
   derecha. La muestra de color es un objeto, así que lleva su borde (sobre un fondo del mismo tono no
   se vería). */
.palette { display: grid; padding: var(--space-1) 0 var(--space-2) }
.palette-row { display: flex; align-items: center; gap: var(--space-2); min-height: var(--row-h); padding: var(--space-1) var(--gutter) }
.palette-chip { flex: none; width: 20px; height: 20px; border: 1px solid var(--border); border-radius: var(--radius-sm) }
.palette-name { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: var(--text-sm); overflow-wrap: anywhere }
.palette-name small { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--fg-3) }
.palette-uses { flex: none; font-size: var(--text-xs); color: var(--fg-3); font-variant-numeric: tabular-nums }
.type-size { flex: none; width: 28px; font-size: var(--text-sm); font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; color: var(--fg-2) }
</style>
