<script setup>
import { ref, computed, watch } from 'vue'
import tree from '../tree.json'

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
</script>

<template>
  <div class="wrap">

    <div class="cols">
      <aside class="tree sidebar">
        <!-- ⚠ El encabezado sale del scroll. Medido: el árbol tiene 1215px de contenido en 675 de
             alto, y «Contextos» se iba a −291px — recorrías la mitad del árbol sin saber si seguías
             en contextos o ya estabas en tasks. -->
        <div class="region-head">
          <span>context</span>
          <span class="cnt">{{ rows.length }}</span>
          <div class="region-actions">
            <button type="button" class="region-action" :title="todoPlegado ? 'Desplegar todo' : 'Plegar todo'"
                    @click="plegarTodo">⊟</button>
          </div>
        </div>

        <!-- EL BUSCADOR, dentro del árbol y fuera de su scroll. Estaba en un titlebar a lo ancho de
             la ventana, encima de las DOS columnas: el detalle pagaba 47px de alto por una caja que
             sólo filtra el árbol. Acá arriba de lo que filtra, y el detalle se los queda. -->
        <div class="buscar">
          <input v-model="q" type="search" placeholder="Buscar nodo, síntoma, archivo o texto del doc…"
                 title="Busca en el nombre, los síntomas, los archivos declarados y el cuerpo del doc.md" />
          <!-- Las perillas aparecen cuando hay algo escrito, que es cuando significan algo. Y van a la
               VISTA y no a un menú ⋯: cambian QUÉ filas se listan, y un filtro escondido se olvida
               encendido — después lo que falta se lee como «no existe». -->
          <div v-if="busqueda" class="buscar-sub">
            <button class="vec-chip" :class="{ off: !conVecinas }" @click="alternarVecinas"
                    :title="conVecinas
                      ? 'Se muestran también los nodos con los que se une (padre, hijo, task y archivo compartido). Clic para ver sólo lo encontrado.'
                      : 'Sólo lo encontrado. Clic para traer los nodos vecinos.'">+ vecinas</button>
            <button v-if="busqueda.menciones" class="vec-chip off" @click="alternarMenciones"
                    title="Nodos que lo nombran en la prosa sin declararlo. No son la respuesta, pero a veces es lo que buscás.">
              + {{ busqueda.menciones }} que lo mencionan
            </button>
            <button v-if="verMenciones" class="vec-chip" @click="alternarMenciones"
                    title="Volver a los nodos que lo declaran (nombre, síntoma o archivo).">menciones incluidas</button>
            <span class="cuenta">
              {{ busqueda.pega.size }} resultado(s)<template v-if="vista.vec.size"> · {{ vista.vec.size }} vecina(s) de «{{ nameOf(sel) }}»</template>
              <!-- la nota del modo mención sólo tiene sentido si HAY algo; con cero decía las dos cosas -->
              <template v-if="busqueda.porMencion && busqueda.pega.size"> · sólo lo mencionan: nadie lo declara</template>
            </span>
          </div>
        </div>
        <div class="region-body">
        <div class="region-head grupo">
          <span>Contextos</span><span class="cnt">{{ nContext }}</span>
        </div>
        <div v-for="r in rows" :key="r.id"
             class="row" :class="[claseDe(r.id), { sel: sel === r.id, hl: highlighted.has(r.id) }]"
             :title="motivoDe(r.id)"
             :style="{ paddingLeft: (8 + r.depth * 18) + 'px' }" @click="select(r.id)">
          <span class="tog" @click.stop="r.hasKids && toggle(r.id)">{{ r.hasKids ? (collapsed.has(r.id) ? '▸' : '▾') : '·' }}</span>
          <!-- el relleno ES el estado de salud (ver estadoOf) -->
          <span class="dot" :class="kindOf(r.id)" :data-alin="estadoOf(r.id)"
                :title="ETIQ[estadoOf(r.id)] || ''"></span>
          <span class="nm">{{ nameOf(r.id) }}</span>
          <!-- El badge dice por qué algo ES resultado. En una vecina engaña: una vecina que además
               menciona la palabra se leía como resultado (pasó con `doc` en tres filas). -->
          <span class="pega" v-if="busqueda && busqueda.pega.has(r.id)">{{ busqueda.donde[r.id].join('·') }}</span>
          <span class="deriva" v-if="alinOf(r.id) && alinOf(r.id).deriva.cambiados"
                :data-alin="estadoOf(r.id)"
                :title="alinOf(r.id).deriva.cambiados + ' de ' + alinOf(r.id).archivos + ' archivos cambiaron en main desde ' + (alinOf(r.id).verificado.date || '?')">
            {{ alinOf(r.id).deriva.pct }}%
          </span>
          <span class="cnt" v-if="filesOf(r.id)">{{ filesOf(r.id) }}</span>
        </div>

        <p class="vacio" v-if="busqueda && !rows.length">
          nada con «{{ q }}». Se busca en el nombre, los síntomas, los archivos declarados y el cuerpo
          del <code>doc.md</code>.
        </p>

        <div class="region-head grupo">
          <span>Tasks</span><span class="cnt">{{ nTask }}</span>
        </div>
        <div v-for="t in tasks" :key="t" class="taskcard" :class="{ sel: sel === t }" @click="select(t)">
          <div class="tc-name"><span class="dot task"></span>{{ nameOf(t) }}</div>
          <div class="chips">
            <span v-for="cx in (byId[t].contexts || [])" :key="cx" class="chip" @click.stop="select(cx)">{{ cx }}</span>
          </div>
        </div>
        </div>
      </aside>

      <main class="detail editor" v-if="byId[sel]">
        <div class="d-head">
          <span class="dot" :class="kindOf(sel)"></span>
          <h2>{{ nameOf(sel) }}</h2>
          <span class="kind" :class="kindOf(sel)">{{ kindOf(sel) }}</span>
          <span class="cnt big" v-if="filesOf(sel)">{{ filesOf(sel) }} archivos</span>
        </div>
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
          <span v-for="[otro, motivos] in conexionesSel" :key="otro" class="conex-n" @click="select(otro)"
                :title="'motivo: ' + motivos.join(' · ')">
            {{ nameOf(otro) }}<em>{{ motivos.join('·') }}</em>
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
          <span class="chip" v-for="cx in byId[sel].contexts" :key="cx" @click="select(cx)">{{ cx }}</span>
        </div>
        <div class="doc" v-html="selDoc"></div>
      </main>
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
    </footer>
  </div>
</template>
