<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { vResize, readSize, saveSize } from './workbench.js'
import tree from '../tree.json'
import RegionMenu from './RegionMenu.vue'
import JevConsole from './JevConsole.vue'

let jevTimer = null
let jevAbort = null
let jevSequence = 0

// Disposición local: cerrar el árbol no descarta el ancho que la persona eligió. El botón del pie y
// el tirador lo devuelven exactamente donde estaba, sin necesitar una acción de «restablecer».
const savedTreeWidth = readSize('context.sidebar', 300)
const treeWidth = ref(savedTreeWidth)
const lastTreeWidth = ref(readSize('context.sidebar.last-open', savedTreeWidth || 300))
const explorerToggle = ref(null)
const viewportWidth = ref(window.innerWidth)
const viewportHeight = ref(window.innerHeight)
const maxTreeWidth = computed(() => Math.max(160, Math.min(560, viewportWidth.value - 280)))
const visibleTreeWidth = computed(() => treeWidth.value ? Math.min(treeWidth.value, maxTreeWidth.value) : 0)
const treeResize = computed(() => ({
  label: 'Ancho del explorador', min: 200, max: maxTreeWidth.value,
  defaultValue: 300, collapsible: true,
  get: () => visibleTreeWidth.value,
  set: (v) => {
    treeWidth.value = v
    if (v > 0) lastTreeWidth.value = v
  },
  commit: (v) => {
    saveSize('context.sidebar', v)
    if (v > 0) saveSize('context.sidebar.last-open', v)
  },
}))
function toggleTree() {
  if (treeWidth.value) {
    lastTreeWidth.value = treeWidth.value
    saveSize('context.sidebar.last-open', treeWidth.value)
    treeWidth.value = 0
  } else {
    treeWidth.value = Math.min(lastTreeWidth.value || 300, maxTreeWidth.value)
  }
  saveSize('context.sidebar', treeWidth.value)
}

// Las fuentes declaradas son evidencia del nodo abierto, no prosa del documento. Van en una región
// aparte para que leer y ubicar archivos no compitan por la misma columna. Si no hay presupuesto para
// 240px, se pliega sola: el documento conserva una medida útil y el tirador la recupera al ganar ancho.
const REFERENCES_BASE = 300
const MIN_EDITOR = 340
const savedReferencesWidth = readSize('context.referencias', REFERENCES_BASE)
const referencesWidth = ref(savedReferencesWidth)
const lastReferencesWidth = ref(readSize('context.referencias.last-open', savedReferencesWidth || REFERENCES_BASE))
const referencesToggle = ref(null)
const maxReferencesWidth = computed(() => Math.max(0, Math.min(480,
  viewportWidth.value - visibleTreeWidth.value - MIN_EDITOR)))
const visibleReferencesWidth = computed(() => maxReferencesWidth.value < 240 ? 0
  : Math.min(referencesWidth.value, maxReferencesWidth.value))
const referencesResize = computed(() => ({
  label: 'Ancho de referencias', sign: -1, min: 240, max: maxReferencesWidth.value,
  defaultValue: REFERENCES_BASE, collapsible: true,
  get: () => visibleReferencesWidth.value,
  set: (v) => {
    referencesWidth.value = v
    if (v > 0) lastReferencesWidth.value = v
  },
  commit: (v) => {
    saveSize('context.referencias', v)
    if (v > 0) saveSize('context.referencias.last-open', v)
  },
}))
function hideReferences() {
  if (referencesWidth.value) {
    lastReferencesWidth.value = referencesWidth.value
    saveSize('context.referencias.last-open', referencesWidth.value)
  }
  referencesWidth.value = 0
  saveSize('context.referencias', 0)
  referencesToggle.value?.focus()
}
function toggleReferences() {
  if (visibleReferencesWidth.value) hideReferences()
  else {
    referencesWidth.value = Math.min(lastReferencesWidth.value || REFERENCES_BASE, maxReferencesWidth.value)
    saveSize('context.referencias', referencesWidth.value)
  }
}

// JEV no reemplaza el documento: es una consola de navegación donde se prepara evidencia por capas.
// Su alto recuerda la preferencia y se puede plegar al borde como las otras regiones de trabajo.
const JEV_CONSOLE_BASE = 250
const savedJevConsoleHeight = readSize('context.jev-console.height', JEV_CONSOLE_BASE)
const jevConsoleHeight = ref(savedJevConsoleHeight)
const lastJevConsoleHeight = ref(readSize('context.jev-console.last-open', savedJevConsoleHeight || JEV_CONSOLE_BASE))
const jevConsoleToggle = ref(null)
const maxJevConsoleHeight = computed(() => Math.max(140, Math.min(440, viewportHeight.value - 260)))
const visibleJevConsoleHeight = computed(() => jevConsoleHeight.value
  ? Math.min(jevConsoleHeight.value, maxJevConsoleHeight.value) : 0)
const jevConsoleResize = computed(() => ({
  label: 'Alto de la consola JEV', axis: 'y', sign: -1, min: 160, max: maxJevConsoleHeight.value,
  defaultValue: JEV_CONSOLE_BASE, collapsible: true,
  get: () => visibleJevConsoleHeight.value,
  set: (value) => {
    jevConsoleHeight.value = value
    if (value > 0) lastJevConsoleHeight.value = value
  },
  commit: (value) => {
    saveSize('context.jev-console.height', value)
    if (value > 0) saveSize('context.jev-console.last-open', value)
  },
}))
function hideJevConsole() {
  if (jevConsoleHeight.value) {
    lastJevConsoleHeight.value = jevConsoleHeight.value
    saveSize('context.jev-console.last-open', jevConsoleHeight.value)
  }
  jevConsoleHeight.value = 0
  saveSize('context.jev-console.height', 0)
  jevConsoleToggle.value?.focus()
}
function toggleJevConsole() {
  if (visibleJevConsoleHeight.value) hideJevConsole()
  else {
    jevConsoleHeight.value = Math.min(lastJevConsoleHeight.value || JEV_CONSOLE_BASE, maxJevConsoleHeight.value)
    saveSize('context.jev-console.height', jevConsoleHeight.value)
  }
}
const resizeWindow = () => {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}
onMounted(() => window.addEventListener('resize', resizeWindow))
onUnmounted(() => {
  window.removeEventListener('resize', resizeWindow)
  clearTimeout(jevTimer)
  jevAbort?.abort()
})


// ── Data: estructura del árbol (tree.json) + contenido por nodo (map.json/doc.md) ──
// Sin backend: todo se importa del repo. Editar tree.json (o agregar un flows/<id>/)
// y la viz se actualiza sola (HMR de Vite).
const mapMods = import.meta.glob('../server/data/flows/*/map.json', { eager: true })
const docMods = import.meta.glob('../server/data/flows/*/doc.md', { eager: true, query: '?raw', import: 'default' })
const idOf = (p) => p.split('/').slice(-2)[0]
const maps = {}; for (const p in mapMods) maps[idOf(p)] = mapMods[p].default || mapMods[p]
const docs = {}; for (const p in docMods) docs[idOf(p)] = docMods[p]

// ── ALINEACIÓN: ¿qué nodos quedaron viejos? ──
// Lo calcula `tools/alinear.py` (git en consola) y deja `alineacion.json`. Acá SOLO se pinta: el
// browser no puede correr git, y levantar un server para eso sería reconstruir lo que se borró.
// Se importa por glob y no con `import` directo a propósito: si el JSON no existe todavía (nadie
// corrió el comando, o clonaste fresco) la viz sigue andando sin alineación en vez de romperse.
const alinMods = import.meta.glob('../alineacion.json', { eager: true })
const alinRaw = Object.values(alinMods)[0]
const alin = (alinRaw && (alinRaw.default || alinRaw)) || { nodos: [], resumen: {}, generado: null }
const alinById = Object.fromEntries((alin.nodos || []).map(n => [n.id, n]))
const alinOf = (id) => alinById[id] || null
// EL CÍRCULO ES UN INDICADOR DE SALUD, no de tipo. Antes el relleno decía el `kind` y la alineación
// iba en un anillo, pero el kind no informaba nada en este árbol: son 1 `root` y 30 `reference`, o sea
// un canal casi constante. Y había un choque de color: el root es amarillo, igual que la deriva.
// Ahora el relleno es el estado (verde → amarillo → naranja → rojo, violeta para rama sin mergear) y
// el kind se sigue viendo en el badge del panel de detalle y en la posición dentro del árbol.
const estadoOf = (id) => (alinById[id] ? alinById[id].estado : null)
const ETIQ = {
  'rutas-muertas': '⛔ rutas muertas — el mapa cita archivos que no existen en main',
  'marca-ya-mergeada': '🔁 marca ya mergeada — sus pendientes YA están en main: devolvelos a files[] y borrá la marca',
  'deriva-alta': '🔴 deriva alta — muchos de sus archivos cambiaron desde que se verificó',
  'rama-sin-mergear': '⏳ describe una rama sin mergear, no lo que corre en main',
  'deriva': '🟡 deriva — algunos archivos cambiaron desde que se verificó',
  'solo-hubs': '⚪ solo hubs — lo único que se movió son archivos que comparte con medio árbol (api.php, routes.ts): nada propio que releer',
  'al-dia': '🟢 al día',
}

const combos = tree.combinations || []
const byId = computed(() => Object.fromEntries(combos.map(c => [c.id, c])))

// kind: del map.json si existe; si no, se infiere (sin padre = raíz, con contexts = task)
function kindOf(id) {
  const m = maps[id]
  if (m && m.kind) return m.kind
  const c = byId.value[id]
  if (!c) return 'reference'
  if (!c.parent) return 'root'
  if (c.contexts && c.contexts.length) return 'task'
  return 'reference'
}
const nameOf = (id) => (maps[id] && maps[id].name) || (byId.value[id] && byId.value[id].name) || id
const nodeNames = computed(() => Object.fromEntries(combos.map((entry) => [entry.id, nameOf(entry.id)])))
const filesOf = (id) => (maps[id] && maps[id].files ? maps[id].files.length : 0)
const whenOf = (id) => (maps[id] && maps[id].when) || ''

/* ── EL GRAFO DERIVADO: quién habla de lo mismo que quién ────────────────────────────────────────
 *
 * El árbol dice de qué CUELGA cada nodo, que es una decisión de quien lo escribió. Lo que no dice es
 * cuáles se pisan, y eso no hace falta escribirlo: si dos nodos declaran el MISMO archivo, hablan del
 * mismo código. Se deriva de los `map.json`, así que no se puede quedar viejo ni hay que mantenerlo.
 *
 * ⚠ Y HAY QUE DESCARTAR LOS HUBS, o no queda grafo sino una malla. Medido acá el 2026-09-09 sobre los
 * 39 nodos: sin descartar nada el grado medio es 18,9 de 38 posibles —o sea «medio árbol es vecino»,
 * que no informa—, porque `Modules/Onboarding/routes/api.php` lo declaran 13 nodos y
 * `loan-request-wizard/app/routes.ts` 10. Contando sólo los archivos que declaran DOS nodos el grado
 * medio baja a 5,5 (máx 14) y las vecinas se vuelven ciertas: `rotativo` → `db-routines` y `servicing`;
 * `kyc` → `credifamilia` por cuatro archivos de validación de identidad. Es la misma idea que la
 * etiqueta `solo-hubs` de la alineación, que ya existía por el mismo motivo. */
const TOPE_HUB = 2
const grafo = (() => {
  const cuenta = {}
  for (const id in maps) for (const f of new Set(maps[id].files || [])) cuenta[f] = (cuenta[f] || 0) + 1
  const duenos = {}
  for (const id in maps) for (const f of new Set(maps[id].files || [])) {
    if (cuenta[f] > TOPE_HUB) continue
    ;(duenos[f] = duenos[f] || []).push(id)
  }
  const ady = {}
  for (const f in duenos) for (const a of duenos[f]) for (const b of duenos[f]) {
    if (a === b) continue
    const m = (ady[a] = ady[a] || {})
    ;(m[b] = m[b] || []).push(f)
  }
  return ady
})()

/* Las CONEXIONES MÁS CERCANAS de un nodo, con el motivo de cada una. El motivo importa tanto como la
 * lista: «4 archivos» y «padre» se siguen por razones distintas. */
function conexionesDe(id) {
  const out = new Map()
  const add = (otro, motivo) => {
    if (!otro || otro === id || !byId.value[otro]) return
    const a = out.get(otro) || []
    if (!a.includes(motivo)) a.push(motivo)
    out.set(otro, a)
  }
  const c = byId.value[id]
  if (c && c.parent) add(c.parent, 'padre')
  for (const k of combos) if (k.parent === id) add(k.id, 'hijo')
  const comp = grafo[id] || {}
  for (const otro in comp) add(otro, comp[otro].length + ' archivo' + (comp[otro].length > 1 ? 's' : ''))
  if (c && c.contexts) for (const cx of c.contexts) add(cx, 'la task lo usa')
  for (const t of combos) if ((t.contexts || []).includes(id)) add(t.id, 'task que lo usa')
  return out
}
// ── Árbol de CONTEXTOS (las tasks van aparte, aunque cuelguen de la raíz) ──
const childrenOf = (id) => combos.filter(c => c.parent === id && kindOf(c.id) !== 'task').map(c => c.id).sort()
const roots = combos.filter(c => !c.parent).map(c => c.id).sort()
// Plegar TODO o desplegar todo según cómo esté: un botón que sólo pliega deja de servir apenas lo
// usaste una vez. ⚠ Va DESPUÉS de `childrenOf`, que es un `const` y no se hoistea — la primera
// versión lo llamaba desde arriba con nombres que no existen en este archivo y el botón no hacía
// nada, sin un solo error en consola.
const conHijos = computed(() => combos.filter((c) => childrenOf(c.id).length).map((c) => c.id))
const todoPlegado = computed(() => conHijos.value.length > 0 && conHijos.value.every((id) => collapsed.value.has(id)))
function plegarTodo() { collapsed.value = todoPlegado.value ? new Set() : new Set(conHijos.value) }
const collapsed = ref(new Set())

const toggle = (id) => { const s = new Set(collapsed.value); s.has(id) ? s.delete(id) : s.add(id); collapsed.value = s }

// Qué nodo está abierto. Se declara acá arriba porque el buscador lo mueve (un solo resultado se abre).
const initialParams = new URLSearchParams(window.location.search)
const requestedNode = initialParams.get('node') || ''
const sel = ref(byId.value[requestedNode] ? requestedNode : 'creditop')
const select = (id) => { sel.value = id }

const referenciaQ = ref('')
const archivosSel = computed(() => [...new Set(maps[sel.value]?.files || [])].sort())
const archivosFiltrados = computed(() => {
  const query = referenciaQ.value.trim().toLocaleLowerCase()
  return query ? archivosSel.value.filter((archivo) => archivo.toLocaleLowerCase().includes(query)) : archivosSel.value
})
const referenciasPorRepo = computed(() => {
  const grupos = new Map()
  for (const archivo of archivosFiltrados.value) {
    const repo = archivo.split('/')[0] || 'otros'
    grupos.set(repo, [...(grupos.get(repo) || []), archivo])
  }
  return [...grupos].sort(([a], [b]) => a.localeCompare(b)).map(([repo, archivos]) => ({ repo, archivos }))
})
const rutaEnRepo = (archivo, repo) => archivo.startsWith(`${repo}/`) ? archivo.slice(repo.length + 1) : archivo
watch(sel, () => { referenciaQ.value = '' })

/* ── EL BUSCADOR ─────────────────────────────────────────────────────────────────────────────────
 *
 * Antes no había: para encontrar algo había que acordarse en qué nodo estaba y abrirlo. Y lo que hace
 * falta no es un filtro que deje el nodo solo —eso ya lo da abrirlo— sino ver **el nodo y con qué se
 * une**, que es lo que uno va a leer después.
 *
 * Busca en cuatro lados y DICE en cuál pegó, que es la mitad del valor: `403` pega en el cuerpo de un
 * doc y `LenderRetrievalService.php` en los archivos declarados, y son dos preguntas distintas. */
// Un enlace de tarea selecciona el nodo exacto, aunque su nombre coincida también con otros.
// Si el id dejó de existir, la búsqueda permite encontrar su reemplazo.
const q = ref(requestedNode || initialParams.get('q') || '')
const JEV_DEBOUNCE_MS = 550
const JEV_SENSITIVE_LIKE = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b\d[\d\s-]{4,}\d\b|\b(?:sk|ts|api|key)_[A-Za-z0-9_-]{12,}\b|\b(?:api[-_ ]?key|token|secret|password|contraseña)\s*[:=]\s*\S{6,}|\bbearer\s+[A-Za-z0-9._-]{12,}/i
const jev = ref({ phase: 'idle', data: null })
const jevSugerido = computed(() => jev.value.phase === 'suggest' ? jev.value.data?.decision?.node : null)
const jevAlternativas = computed(() => {
  const data = jev.value.data || {}
  const candidates = data.jev?.top4 || data.baseline || []
  return candidates.map((candidate) => Array.isArray(candidate)
    ? { node: candidate[0], probability: candidate[1] }
    : candidate)
    .filter((candidate) => candidate.node && candidate.node !== jevSugerido.value && byId.value[candidate.node])
    .slice(0, 3)
})
const jevNecesitaCaso = computed(() => Number(jev.value.data?.jev?.needs_case_data) >= .5)
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`

function abrirSugerenciaJev(node) {
  if (!byId.value[node]) return
  q.value = ''
  select(node)
}

async function consultarJev(query, request) {
  jevAbort?.abort()
  jevAbort = new AbortController()
  jev.value = { phase: 'loading', data: null }
  try {
    const response = await fetch('/api/jev/route', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }), signal: jevAbort.signal,
    })
    const data = await response.json()
    if (request !== jevSequence) return
    if (!response.ok || data.error) {
      jev.value = { phase: data.error === 'sensitive-query' ? 'blocked' : 'unavailable', data }
    } else {
      jev.value = { phase: data.decision?.action === 'suggest' ? 'suggest' : 'fallback', data }
    }
  } catch (error) {
    if (error.name === 'AbortError' || request !== jevSequence) return
    jev.value = { phase: 'unavailable', data: null }
  }
}

watch(q, (value) => {
  clearTimeout(jevTimer)
  jevAbort?.abort()
  const request = ++jevSequence
  const query = value.trim()
  if (!query || query.length < 3) {
    jev.value = { phase: 'idle', data: null }
    return
  }
  if (JEV_SENSITIVE_LIKE.test(query)) {
    jev.value = { phase: 'blocked', data: null }
    return
  }
  jev.value = { phase: 'waiting', data: null }
  jevTimer = setTimeout(() => consultarJev(query, request), JEV_DEBOUNCE_MS)
})
/* ⚠ LOS CUATRO LUGARES NO PESAN IGUAL, y esto se midió acá. Buscando «rotativo» con el texto del doc
 * al mismo nivel salen 17 resultados de 39: los docs se nombran entre sí todo el tiempo, así que
 * «lo menciona» es casi todo el árbol y el buscador vuelve a contestar «está en todas partes». Hay una
 * jerarquía real: si el NOMBRE, un SÍNTOMA o un ARCHIVO DECLARADO coinciden, ese nodo es la respuesta;
 * el que sólo lo nombra en la prosa es contexto. Así, «rotativo» da 1 y «RevolvingLoanConfigService»
 * da los 2 que lo declaran, en vez de 4.
 *
 * Las menciones NO se tiran —una búsqueda libre como «403» sólo vive ahí—: si no hay nada fuerte pasan
 * a ser el resultado solas, y si hay, quedan a un clic con la cuenta a la vista. */
const verMenciones = ref(false)
const VECINAS_KEY = 'context-viz-vecinas-v1'
const conVecinas = ref(localStorage.getItem(VECINAS_KEY) !== '0')
const alternarMenciones = () => { verMenciones.value = !verMenciones.value }
const alternarVecinas = () => {
  conVecinas.value = !conVecinas.value
  localStorage.setItem(VECINAS_KEY, conVecinas.value ? '1' : '0')
}

/* ⚠ En texto largo el match tiene que caer en BORDE DE PALABRA, no en cualquier subcadena. Medido:
 * buscar «403» daba como resultado `ecommerce` porque su migración se llama
 * `2024_04_16_214033_create_ecommerce_requests_log_table.php` —el «403» está dentro del timestamp—, y
 * al contar como coincidencia FUERTE tapaba los 4 nodos que sí hablan de un 403. La joroba de camelCase
 * cuenta como borde, así que `LoanConfig` sigue encontrando `RevolvingLoanConfigService.php`.
 *
 * El nombre y el id quedan con subcadena pelada a propósito: son cortos, y ahí uno teclea pedazos. */
function pegaEnTexto(texto, s) {
  const t = String(texto), bajo = t.toLowerCase()
  for (let i = bajo.indexOf(s); i !== -1; i = bajo.indexOf(s, i + 1)) {
    if (i === 0) return true
    const prev = t[i - 1]
    if (!/[a-z0-9]/i.test(prev)) return true
    if (/[A-Z]/.test(t[i]) && /[a-z0-9]/.test(prev)) return true // joroba camelCase
  }
  return false
}

function dondePega(id, s) {
  const m = maps[id] || {}, c = byId.value[id] || {}
  const en = []
  if (id.toLowerCase().includes(s) || String(m.name || c.name || '').toLowerCase().includes(s)) en.push('nombre')
  if ((m.sintomas || []).some(x => pegaEnTexto(x, s))) en.push('síntoma')
  if ((m.files || []).some(f => pegaEnTexto(f, s))) en.push('archivo')
  if (pegaEnTexto(docs[id] || '', s)) en.push('doc')
  return en
}

/* Los RESULTADOS. No dependen de qué nodo esté abierto —si dependieran, abrir uno cambiaría la lista—
 * y vienen ordenados por qué tan fuerte pegaron, que es lo que decide cuál se abre solo. */
const FUERZA = { nombre: 0, 'síntoma': 1, archivo: 2, doc: 3 }
const busqueda = computed(() => {
  const s = q.value.trim().toLowerCase()
  if (!s) return null
  const donde = {}
  const fuerte = new Set(), menciones = new Set()
  for (const c of combos) {
    const en = dondePega(c.id, s)
    if (!en.length) continue
    donde[c.id] = en
    if (en.some(x => x !== 'doc')) fuerte.add(c.id)
    else menciones.add(c.id)
  }
  // Sin nada fuerte, las menciones SON el resultado: si no, «403» no encontraría nada.
  const soloMenciones = fuerte.size === 0
  const pega = soloMenciones || verMenciones.value ? new Set([...fuerte, ...menciones]) : fuerte
  const orden = [...pega].sort((a, b) => {
    const fa = Math.min(...donde[a].map(x => FUERZA[x] === undefined ? 9 : FUERZA[x]))
    const fb = Math.min(...donde[b].map(x => FUERZA[x] === undefined ? 9 : FUERZA[x]))
    return fa - fb || a.localeCompare(b)
  })
  return {
    pega, donde, orden,
    // cuántos lo nombran sin declararlo, para poder ofrecerlos sin meterlos
    menciones: soloMenciones || verMenciones.value ? 0 : menciones.size,
    porMencion: soloMenciones,
  }
})

/* ⚠ LA VECINDAD ES DEL NODO ABIERTO, no de la unión de los resultados. Medido acá: `deceval` pega en 5
 * nodos y la unión de sus vecindades da 20 de 39, o sea otra vez «está en todo el árbol». La vecindad
 * es una propiedad de UN nodo —«con qué se une esto»— así que se pinta la del que estás mirando, y
 * seguirla es hacer clic en otro resultado. Con un solo resultado, que es el caso común, da lo mismo
 * que mostrar la unión. */
const vista = computed(() => {
  const b = busqueda.value
  if (!b) return null
  const vec = new Map()
  if (conVecinas.value && b.pega.has(sel.value)) {
    for (const [otro, motivos] of conexionesDe(sel.value)) {
      if (!b.pega.has(otro)) vec.set(otro, motivos)
    }
  }
  /* La RUTA: los ancestros que hacen falta para que el árbol siga siendo un árbol. No son resultados
   * ni vecinas —no se cuentan ni se resaltan—, son el camino para llegar. */
  const ruta = new Set()
  const subir = (id) => {
    let p = byId.value[id] && byId.value[id].parent
    while (p) { if (!b.pega.has(p) && !vec.has(p)) ruta.add(p); p = byId.value[p] && byId.value[p].parent }
  }
  for (const id of b.pega) subir(id)
  for (const id of vec.keys()) subir(id)
  return { vec, ruta, visible: new Set([...b.pega, ...vec.keys(), ...ruta]) }
})

const rows = computed(() => {
  const v = vista.value
  const out = []
  const walk = (id, depth) => {
    // Con búsqueda, `ruta` ya trae los ancestros: lo que no está visible no se dibuja.
    if (v && !v.visible.has(id)) return
    const kids = childrenOf(id)
    out.push({ id, depth, hasKids: kids.length > 0 })
    // Buscando se ignora lo colapsado: esconder el resultado detrás de un ▸ sería contestar y tapar.
    if (v || !collapsed.value.has(id)) for (const k of kids) walk(k, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return out
})
// Cómo se pinta cada fila: resultado · vecina · ruta (sólo estructura).
const claseDe = (id) => {
  const b = busqueda.value
  if (!b) return null
  return b.pega.has(id) ? 'res' : (vista.value.vec.has(id) ? 'vec' : 'ruta')
}
const motivoDe = (id) => {
  const b = busqueda.value
  if (!b) return ''
  if (b.pega.has(id)) return 'pega en: ' + (b.donde[id] || []).join(', ')
  const v = vista.value.vec.get(id)
  if (v) return 'vecina de ' + nameOf(sel.value) + ' — ' + v.join(' · ')
  return 'sólo el camino en el árbol'
}

const tasks = computed(() => {
  const todas = combos.filter(c => kindOf(c.id) === 'task').map(c => c.id).sort()
  const b = busqueda.value
  return b ? todas.filter(t => vista.value.visible.has(t)) : todas
})

/* Se abre el resultado MÁS FUERTE si el que está abierto no es ninguno de ellos. Buscar «pullman» y
 * quedar mirando otro nodo obligaría a un clic que no decide nada — y como la vecindad que se pinta es
 * la del abierto, sin esto se pintaría la de un nodo que no tiene nada que ver con lo buscado. */
watch(busqueda, (b) => {
  if (b && b.orden.length && !b.pega.has(sel.value)) sel.value = b.orden[0]
}, { immediate: true })

// stats
const nContext = computed(() => combos.filter(c => kindOf(c.id) !== 'task').length)
const nTask = computed(() => tasks.value.length)
const nFiles = computed(() => combos.reduce((a, c) => a + filesOf(c.id), 0))

// ── Selección + panel de detalle ──
// Las conexiones del nodo abierto, la más pisada primero.
const conexionesSel = computed(() => [...conexionesDe(sel.value)].sort((a, b) => b[1].length - a[1].length))
// al seleccionar una task, resaltar sus contextos en el árbol
const highlighted = computed(() => {
  const c = byId.value[sel.value]
  return new Set(c && c.contexts ? c.contexts : [])
})

// ── mini-render de markdown (sin deps): headings/bold/code/hr/listas/quote/tablas ──
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inl = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[\[([^\]]+)\]\]/g, '<em>$1</em>')
function md(src) {
  if (!src) return ''
  const L = src.split('\n'); const o = []; let list = null, tbl = false
  const closeList = () => { if (list) { o.push(`</${list}>`); list = null } }
  const closeTbl = () => { if (tbl) { o.push('</tbody></table>'); tbl = false } }
  for (let i = 0; i < L.length; i++) {
    const ln = L[i]
    if (/^\s*\|.*\|\s*$/.test(ln)) {
      const cells = ln.trim().replace(/^\||\|$/g, '').split('|')
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(ln)) continue // separador
      if (!tbl) { closeList(); o.push('<table><tbody>'); tbl = true }
      o.push('<tr>' + cells.map(c => `<td>${inl(c.trim())}</td>`).join('') + '</tr>'); continue
    } else closeTbl()
    let m
    if ((m = ln.match(/^(#{1,4})\s+(.*)$/))) { closeList(); o.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`) }
    else if (/^\s*[-*]\s+/.test(ln)) { if (list !== 'ul') { closeList(); o.push('<ul>'); list = 'ul' } o.push(`<li>${inl(ln.replace(/^\s*[-*]\s+/, ''))}</li>`) }
    else if (/^\s*\d+\.\s+/.test(ln)) { if (list !== 'ol') { closeList(); o.push('<ol>'); list = 'ol' } o.push(`<li>${inl(ln.replace(/^\s*\d+\.\s+/, ''))}</li>`) }
    else if (/^>\s?/.test(ln)) { closeList(); o.push(`<blockquote>${inl(ln.replace(/^>\s?/, ''))}</blockquote>`) }
    else if (/^---+$/.test(ln.trim())) { closeList(); o.push('<hr>') }
    else if (ln.trim() === '') { closeList() }
    else { closeList(); o.push(`<p>${inl(ln)}</p>`) }
  }
  closeList(); closeTbl(); return o.join('\n')
}
const selDoc = computed(() => md(docs[sel.value] || '_(sin doc.md)_'))

const explorerMenu = computed(() => [
  { id: 'vecinas', label: 'Incluir nodos vecinos', checked: conVecinas.value, disabled: !busqueda.value },
  { id: 'menciones', label: 'Incluir menciones en el documento', checked: verMenciones.value,
    disabled: !busqueda.value || (!busqueda.value.menciones && !verMenciones.value) },
  { id: 'limpiar', label: 'Limpiar búsqueda', icon: 'close', disabled: !q.value },
  { separador: true },
  { id: 'ocultar', label: 'Ocultar explorador', icon: 'sidebar' },
])
function explorerAction(id) {
  if (id === 'vecinas') alternarVecinas()
  if (id === 'menciones') alternarMenciones()
  if (id === 'limpiar') q.value = ''
  if (id === 'ocultar') { toggleTree(); explorerToggle.value?.focus() }
}

</script>

<template>
  <div class="wrap">
    <div class="context-workspace">
    <div class="cols">
      <aside id="context-sidebar" class="tree sidebar" v-show="visibleTreeWidth" :style="{ flexBasis: visibleTreeWidth + 'px' }" aria-label="Explorador de contexto">
        <!-- ⚠ El encabezado sale del scroll. Medido: el árbol tiene 1215px de contenido en 675 de
             alto, y «Contextos» se iba a −291px — recorrías la mitad del árbol sin saber si seguías
             en contextos o ya estabas en tasks. -->
        <div class="region-head">
          <span>Explorador</span>
          <span class="badge badge-secondary badge-xs cnt">{{ rows.length }}</span>
          <div class="region-actions toolbar" role="group" aria-label="Acciones del explorador">
            <button type="button" class="region-action" :title="todoPlegado ? 'Desplegar todo' : 'Plegar todo'"
                    :aria-label="todoPlegado ? 'Desplegar todo' : 'Plegar todo'"
                    @click="plegarTodo"><span class="ui-icon" data-icon="collapse" aria-hidden="true"></span></button>
            <RegionMenu title="Opciones del explorador" :items="explorerMenu"
                        :active="!!busqueda && (!conVecinas || verMenciones)" @select="explorerAction" />
          </div>
        </div>

        <!-- EL BUSCADOR, dentro del árbol y fuera de su scroll. Estaba en un titlebar a lo ancho de
             la ventana, encima de las DOS columnas: el detalle pagaba 47px de alto por una caja que
             sólo filtra el árbol. Acá arriba de lo que filtra, y el detalle se los queda. -->
        <div class="buscar">
          <label class="input-group search-field">
          <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          <input v-model="q" aria-label="Buscar en el contexto" aria-describedby="jev-privacy" class="input input-sm" type="search" placeholder="Buscar o describir el problema…"
                 title="Busca en el nombre, los síntomas, los archivos declarados y el cuerpo del doc.md; Jev propone una ruta semántica tras una pausa." />
          </label>
          <p id="jev-privacy" v-if="q" class="jev-privacy">No escribas cédulas, teléfonos, solicitudes ni secretos.</p>
          <!-- Los filtros viven en el menú; el conteo y las menciones activas siguen visibles. -->
          <div v-if="busqueda" class="buscar-sub">
            <span class="cuenta">
              {{ busqueda.pega.size }} resultado(s)<template v-if="verMenciones"> · menciones incluidas</template><template v-if="vista.vec.size"> · {{ vista.vec.size }} vecina(s) de «{{ nameOf(sel) }}»</template>
              <!-- la nota del modo mención sólo tiene sentido si HAY algo; con cero decía las dos cosas -->
              <template v-if="busqueda.porMencion && busqueda.pega.size"> · sólo lo mencionan: nadie lo declara</template>
            </span>
          </div>
          <div v-if="jev.phase !== 'idle'" class="jev-route" :data-phase="jev.phase" role="status" aria-live="polite">
            <template v-if="jev.phase === 'waiting' || jev.phase === 'loading'">
              <span class="spinner" aria-hidden="true"></span><span>JEV busca una ruta de lectura…</span>
            </template>
            <template v-else-if="jev.phase === 'suggest'">
              <span class="jev-label">JEV sugiere</span>
              <button type="button" class="jev-open" @click="abrirSugerenciaJev(jevSugerido)">
                {{ nameOf(jevSugerido) }}
              </button>
              <span class="jev-score">{{ pct(jev.data.jev.probability) }} · {{ pct(jev.data.jev.confidence) }} confianza</span>
              <span v-if="jevNecesitaCaso" class="jev-case">puede requerir datos del caso</span>
              <div v-if="jevAlternativas.length" class="jev-alts">
                <span>Alternativas</span>
                <button v-for="alternative in jevAlternativas" :key="alternative.node" type="button" @click="abrirSugerenciaJev(alternative.node)">
                  {{ nameOf(alternative.node) }}
                </button>
              </div>
            </template>
            <template v-else-if="jev.phase === 'fallback'">
              <span class="jev-label">JEV no propone una ruta segura</span>
              <span class="jev-score">Usá los resultados locales.</span>
              <div v-if="jevAlternativas.length" class="jev-alts">
                <button v-for="alternative in jevAlternativas" :key="alternative.node" type="button" @click="abrirSugerenciaJev(alternative.node)">
                  {{ nameOf(alternative.node) }}
                </button>
              </div>
            </template>
            <template v-else-if="jev.phase === 'blocked'">
              <span class="jev-label">La consulta parece incluir datos sensibles.</span>
            </template>
            <template v-else>
              <span class="jev-label">JEV no está disponible en este entorno.</span>
              <span class="jev-score">La búsqueda local sigue funcionando.</span>
            </template>
          </div>
        </div>
        <div class="region-body">
        <div class="region-head grupo">
          <span>Contextos</span><span class="badge badge-secondary badge-xs cnt">{{ nContext }}</span>
        </div>
        <div v-for="r in rows" :key="r.id"
             class="row" :class="[claseDe(r.id), { sel: sel === r.id, hl: highlighted.has(r.id) }]"
             :title="motivoDe(r.id)"
             :style="{ paddingLeft: (12 + r.depth * 18) + 'px' }" @click="select(r.id)">
          <button v-if="r.hasKids" type="button" class="tog tree-toggle" :aria-expanded="!collapsed.has(r.id)"
                :aria-label="(collapsed.has(r.id) ? 'Desplegar ' : 'Plegar ') + nameOf(r.id)"
                @keydown.stop @click.stop="toggle(r.id)"><span class="ui-icon" data-icon="chevron" aria-hidden="true"></span></button>
          <span v-else class="tog" aria-hidden="true"></span>
          <!-- el relleno ES el estado de salud (ver estadoOf) -->
          <span class="dot" :class="kindOf(r.id)" :data-alin="estadoOf(r.id)"
                :title="ETIQ[estadoOf(r.id)] || ''"></span>
          <button class="nm tree-select" type="button" :aria-pressed="sel === r.id" @click.stop="select(r.id)">{{ nameOf(r.id) }}</button>
          <!-- El badge dice por qué algo ES resultado. En una vecina engaña: una vecina que además
               menciona la palabra se leía como resultado (pasó con `doc` en tres filas). -->
          <span class="badge badge-xs pega" v-if="busqueda && busqueda.pega.has(r.id)">{{ busqueda.donde[r.id].join('·') }}</span>
          <span class="badge badge-secondary badge-xs deriva" v-if="alinOf(r.id) && alinOf(r.id).deriva.cambiados"
                :data-alin="estadoOf(r.id)"
                :title="alinOf(r.id).deriva.cambiados + ' de ' + alinOf(r.id).archivos + ' archivos cambiaron en main desde ' + (alinOf(r.id).verificado.date || '?')">
            {{ alinOf(r.id).deriva.pct }}%
          </span>
          <span class="badge badge-secondary badge-xs cnt" v-if="filesOf(r.id)">{{ filesOf(r.id) }}</span>
        </div>

        <p class="vacio" v-if="busqueda && !rows.length">
          nada con «{{ q }}». Se busca en el nombre, los síntomas, los archivos declarados y el cuerpo
          del <code>doc.md</code>.
        </p>

        <div class="region-head grupo">
          <span>Tasks</span><span class="badge badge-secondary badge-xs cnt">{{ nTask }}</span>
        </div>
        <div v-for="t in tasks" :key="t" class="taskcard" :class="{ sel: sel === t }" @click="select(t)">
          <div class="tc-name"><span class="dot task"></span>{{ nameOf(t) }}</div>
          <div class="chips">
            <span v-for="cx in (byId[t].contexts || [])" :key="cx" class="badge chip" @click.stop="select(cx)">{{ cx }}</span>
          </div>
        </div>
        </div>
      </aside>
      <div class="rsz context-resizer" v-resize="treeResize"></div>

      <main class="detail editor" v-if="byId[sel]">
        <!-- LA BARRA DEL DETALLE · era un encabezado de 18px DENTRO del scroll, o sea que a las tres
             pantallas de doc ya no sabías en qué nodo estabas — el mismo problema que el árbol tenía
             resuelto desde antes y esta columna no. Ahora es la barra de la región: misma forma que
             la del árbol, fuera del scroll, y lo que scrollea es el cuerpo.

             ⚠ El punto va DENTRO del nombre y no al lado: `.region-head > :first-child` se lleva el
             `flex: 1`, así que suelto se estiraba él y el nombre quedaba pegado a las pastillas. -->
        <div class="region-head">
          <span class="nodo"><span class="dot" :class="kindOf(sel)"></span>{{ nameOf(sel) }}</span>
          <span class="badge badge-outline kind" :class="kindOf(sel)">{{ kindOf(sel) }}</span>
        </div>
        <div class="region-body">
        <p class="when" v-if="whenOf(sel)"><b>Cuándo:</b> {{ whenOf(sel) }}</p>

        <!-- ALINEACIÓN del nodo seleccionado: el estado, contra qué se verificó y QUÉ archivos cambiaron -->
        <div class="alin" v-if="alinOf(sel)" :data-alin="estadoOf(sel)">
          <div class="alin-head">
            <span class="alin-badge" :data-alin="estadoOf(sel)">{{ ETIQ[estadoOf(sel)] }}</span>
            <span class="alin-meta" v-if="alinOf(sel).verificado.date">
              verificado contra <code>{{ alinOf(sel).verificado.ref }}</code> el
              {{ alinOf(sel).verificado.date }}
              <em v-if="alinOf(sel).verificado.source === 'git-doc'">(fecha estimada del último commit del doc, no una verificación)</em>
            </span>
          </div>

          <div v-if="alinOf(sel).rutas_muertas.length" class="alin-lista">
            <b>No existen en {{ alin.ref }}:</b>
            <div v-for="f in alinOf(sel).rutas_muertas" :key="f"><code>{{ f }}</code></div>
          </div>

          <div v-if="alinOf(sel).pendiente_merge" class="alin-lista">
            <b>Pendiente de merge en <code>{{ alinOf(sel).pendiente_merge.ref }}</code>:</b>
            {{ alinOf(sel).pendiente_merge.archivos }} archivo(s) fuera de <code>files[]</code>.
            <span v-if="alinOf(sel).pendiente_merge.ya_en_main.length">
              ⚠ {{ alinOf(sel).pendiente_merge.ya_en_main.length }} ya están en {{ alin.ref }}.
            </span>
          </div>

          <!-- QUÉ pasó y QUIÉN lo hizo. El asunto del commit no verifica nada —dice la intención,
               no el resultado— pero TRIA: con leer «feat/customer-revolving-credit-detail» se sabe
               que ese cambio no toca este nodo, sin abrir código. Y el autor es a quién preguntarle.
               Para concluir hay que leer el diff: `make context-diff NODE=<nodo>`. -->
          <div v-if="alinOf(sel).commits && alinOf(sel).commits.total" class="alin-lista">
            <b>{{ alinOf(sel).commits.total }} commit(s) atrasado(s)</b>
            <span class="alin-meta">
              · {{ Object.entries(alinOf(sel).commits.autores).map(([a, n]) => a + ' (' + n + ')').join(' · ') }}
            </span>
            <div v-for="c in alinOf(sel).commits.lista" :key="c.sha" class="alin-commit">
              <span class="alin-fecha">{{ c.fecha }}</span>
              <code>{{ c.sha }}</code>
              <span class="alin-autor">{{ c.autor }}</span>
              {{ c.asunto }}
            </div>
            <div v-if="alinOf(sel).commits.total > alinOf(sel).commits.lista.length" class="alin-meta">
              … y {{ alinOf(sel).commits.total - alinOf(sel).commits.lista.length }} más
            </div>
            <div class="alin-meta alin-cmd">
              el asunto tría, el diff decide → <code>make context-diff NODE={{ sel }}</code>
            </div>
          </div>

          <div v-if="alinOf(sel).deriva.cambiados" class="alin-lista">
            <b>Cambiaron desde la verificación ({{ alinOf(sel).deriva.cambiados }} de {{ alinOf(sel).archivos }}):</b>
            <div v-for="a in alinOf(sel).deriva.archivos" :key="a.ruta">
              <span class="alin-fecha">{{ a.ultimo_cambio }}</span> <code>{{ a.ruta }}</code>
            </div>
          </div>
        </div>

        <!-- CON QUÉ SE UNE. No está escrito en ningún lado: sale de los archivos que dos nodos declaran
             (ver `grafo`), más el árbol y las tasks. Es lo que se lee DESPUÉS de este nodo. -->
        <div class="conex" v-if="conexionesSel.length">
          <div class="conex-lbl">Se une con</div>
          <span v-for="[otro, motivos] in conexionesSel" :key="otro" class="badge conex-n" @click="select(otro)"
                :title="'motivo: ' + motivos.join(' · ')">
            <span class="conex-name">{{ nameOf(otro) }}</span><em>{{ motivos.join('·') }}</em>
          </span>
        </div>

        <!-- La ruta del nodo son MIGAS (`breadcrumb` de `taller.css`): el camino apagado y el nodo
             actual en el color del texto, en vez de una línea entera en gris donde hay que leer las
             barras para saber dónde termina. -->
        <nav class="path breadcrumb" aria-label="ruta del nodo">
          <span class="breadcrumb-item">server</span><span class="breadcrumb-sep" aria-hidden="true">/</span>
          <span class="breadcrumb-item">data</span><span class="breadcrumb-sep" aria-hidden="true">/</span>
          <span class="breadcrumb-item">flows</span><span class="breadcrumb-sep" aria-hidden="true">/</span>
          <span class="breadcrumb-item breadcrumb-page" aria-current="page"><code>{{ sel }}</code></span>
          <span class="breadcrumb-sep" aria-hidden="true">·</span>
          <span class="breadcrumb-item">doc.md + map.json</span>
        </nav>
        <div class="chips" v-if="byId[sel].contexts">
          <span class="badge chip" v-for="cx in byId[sel].contexts" :key="cx" @click="select(cx)">{{ cx }}</span>
        </div>
        <div class="doc" v-html="selDoc"></div>
        </div>
      </main>

      <div class="rsz references-resizer" v-resize="referencesResize"></div>
      <aside id="context-references" class="references auxiliarybar" v-show="visibleReferencesWidth"
             :style="{ flexBasis: `${Math.round(visibleReferencesWidth)}px` }" aria-label="Referencias de archivos">
        <div class="region-head">
          <span>Archivos</span>
          <span class="badge badge-secondary badge-xs cnt">{{ archivosFiltrados.length }}</span>
          <div class="region-actions toolbar" role="group" aria-label="Acciones de referencias">
            <button type="button" class="region-action" aria-label="Ocultar referencias" title="Ocultar referencias" @click="hideReferences">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="reference-filter">
          <label class="input-group reference-search">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
            <input v-model="referenciaQ" aria-label="Filtrar archivos de referencia" class="input input-sm" type="search"
                   placeholder="Filtrar archivos…" />
          </label>
        </div>
        <div class="region-body">
          <p class="reference-note">Fuentes declaradas para <code>{{ sel }}</code></p>
          <template v-for="grupo in referenciasPorRepo" :key="grupo.repo">
            <div class="reference-group-head">
              <span>{{ grupo.repo }}</span><span>{{ grupo.archivos.length }}</span>
            </div>
            <div v-for="archivo in grupo.archivos" :key="archivo" class="reference-file" :title="archivo">
              <code>{{ rutaEnRepo(archivo, grupo.repo) }}</code>
            </div>
          </template>
          <p v-if="!archivosFiltrados.length" class="reference-empty">
            No hay archivos que coincidan con «{{ referenciaQ }}».
          </p>
        </div>
      </aside>
    </div>

    <div class="rsz jev-console-resizer" v-show="visibleJevConsoleHeight" v-resize="jevConsoleResize"></div>
    <JevConsole id="context-jev-console" v-show="visibleJevConsoleHeight"
                :style="{ flexBasis: `${Math.round(visibleJevConsoleHeight)}px` }"
                :node="sel" :node-name="nameOf(sel)" :files="archivosSel" :names="nodeNames"
                @select-node="select" @close="hideJevConsole" />
    </div>

    <!-- STATUSBAR · el estado del ÁRBOL, que es lo que vale para toda la pantalla: cuántos nodos
         hay, cuántos archivos cubren y cuántos quedaron viejos. Eran pastillas en una fila propia
         del encabezado, y son estado, no navegación.

         ⚠ El «read-only» era un párrafo permanente de 19px. Un aviso que está siempre se deja de
           leer; acá es una palabra con el detalle en el `title`, que es donde se busca cuando hace
           falta y no antes. -->
    <footer class="statusbar">
      <strong>{{ nContext }} contextos</strong>
      <span v-if="nTask">{{ nTask }} tasks</span>
      <span>{{ nFiles }} archivos</span>
      <span v-if="alin.generado" class="sb-alin" :data-alin="alin.resumen['rutas-muertas'] ? 'rutas-muertas' : 'al-dia'"
            :title="'Calculado por tools/alinear.py el ' + alin.generado + ' contra ' + alin.ref">
        {{ alin.resumen['al-dia'] || 0 }} al día
        <template v-if="alin.resumen['deriva'] || alin.resumen['deriva-alta']">
          · {{ (alin.resumen['deriva'] || 0) + (alin.resumen['deriva-alta'] || 0) }} con deriva
        </template>
      </span>
      <span class="sb-ro"
            title="La estructura vive en tree.json; para agregar una task, un LLM edita ese JSON (+ flows/&lt;id&gt;/) y esto se actualiza.">sólo lectura</span>
      <div class="layout-controls" role="group" aria-label="Regiones visibles">
        <button ref="explorerToggle" type="button" class="region-action" :aria-pressed="!!visibleTreeWidth" aria-controls="context-sidebar"
                aria-label="Mostrar u ocultar el explorador" title="Mostrar u ocultar el explorador" @click="toggleTree">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button ref="referencesToggle" type="button" class="region-action" :aria-pressed="!!visibleReferencesWidth" aria-controls="context-references"
                aria-label="Mostrar u ocultar referencias" title="Mostrar u ocultar referencias" @click="toggleReferences">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
        <button ref="jevConsoleToggle" type="button" class="region-action" :aria-pressed="!!visibleJevConsoleHeight" aria-controls="context-jev-console"
                aria-label="Mostrar u ocultar consola JEV" title="Mostrar u ocultar consola JEV" @click="toggleJevConsole">
          <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
