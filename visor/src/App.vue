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
watch(mode, (m) => { try { localStorage.setItem('visor.mode', m) } catch { /* preferencia opcional */ } nextTick(fit) })
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
  nextTick(() => { refreshResizers(document.querySelector('.workbench')); fit() })
}

// ── el mapa ──
const structure = computed(() => data.value?.structure || null)
// Una página trae secciones adentro: cada una es un grupo de carriles. Se aplana a una lista de
// grupos para la barra, sin perder de qué sección viene cada carril.
const groups = computed(() => {
  const out = []
  const walk = (st, depth) => {
    if (st.lanes?.length) out.push({ id: st.id, name: st.name, type: st.type, depth, lanes: st.lanes, choices: st.choices || [] })
    for (const sub of st.sections || []) walk(sub, depth + 1)
  }
  if (structure.value) walk(structure.value, 0)
  return out
})
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
    data.value = body
    refInput.value = value
    try { localStorage.setItem('visor.last', value) } catch { /* preferencia opcional */ }
    const first = groups.value[0]?.lanes[0]?.screens[0]?.id || ''
    go(screen && screens.value.has(screen) ? screen : first, false)
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
  writeHash()
  nextTick(() => document.querySelector(`[data-screen="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }))
}
function back() {
  const id = trail.value.pop()
  if (id) { currentID.value = id; writeHash() }
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

// La ruta queda en el hash —#/<clave>/<nodo>/<pantalla>— para poder copiarla y volver a la misma
// pantalla; no se usa history del servidor porque es un Vite de desarrollo.
function writeHash() {
  if (!data.value) return
  const h = `#/${data.value.key}/${data.value.node}/${currentID.value}`
  if (location.hash !== h) history.replaceState(null, '', h)
}
function readHash() {
  const m = location.hash.match(/^#\/([A-Za-z0-9]+)\/([0-9]+:[0-9]+)(?:\/([0-9]+:[0-9]+))?/)
  return m ? { ref: `https://www.figma.com/design/${m[1]}/?node-id=${m[2].replace(':', '-')}`, screen: m[3] || '' } : null
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

// ── el dispositivo se ajusta a la región, sin escalar el texto de la UI ──
const stage = ref(null)
const deviceSize = ref({ w: 0, h: 0 })
function fit() {
  const el = stage.value
  const c = current.value
  if (!el || !c) return
  const pad = 32
  const gap = 24
  const n = panes.value.length
  const scale = Math.min((el.clientWidth - pad - gap * (n - 1)) / n / c.w, (el.clientHeight - pad) / c.h, 1.5)
  deviceSize.value = { w: Math.max(0, Math.floor(c.w * scale)), h: Math.max(0, Math.floor(c.h * scale)) }
}
let observer
watch(current, () => nextTick(fit))
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
}

// Pegar un enlace del visor en la misma pestaña cambia sólo el hash, y eso no recarga la página: sin
// este aviso el diseño nuevo no se leía nunca.
function onHash() {
  const h = readHash()
  if (!h) return
  const m = location.hash.match(/^#\/([A-Za-z0-9]+)\/([0-9]+:[0-9]+)/)
  if (data.value && m && data.value.key === m[1] && data.value.node === m[2]) {
    if (h.screen) go(h.screen, false)
    return
  }
  load(h.ref, h.screen)
}

onMounted(() => {
  window.addEventListener('hashchange', onHash)
  observer = new ResizeObserver(fit)
  if (stage.value) observer.observe(stage.value)
  window.addEventListener('keydown', onKey)
  const fromHash = readHash()
  let last = ''
  try { last = localStorage.getItem('visor.last') || '' } catch { /* preferencia opcional */ }
  if (fromHash) load(fromHash.ref, fromHash.screen)
  else if (last) { refInput.value = last; load(last) }
})
onUnmounted(() => { observer?.disconnect(); window.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', onHash) })

const kindName = { mobile: 'móvil', web: 'web', panel: 'panel', textless: 'sin texto' }
const laneName = (lane) => (lane.label ? lane.label : 'Fila sin rótulo')
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="sidebarOpen" class="sidebar" aria-label="Carriles del diseño">
      <div class="rsz rsz-sb" v-resize="resizeOptions('sidebar')"></div>
      <div class="region-head">
        <span>Carriles</span>
        <span v-if="screenCount" class="count">{{ screenCount }}</span>
        <button v-if="data" class="region-action" title="Volver a leer el diseño desde Figma" aria-label="Volver a leer" @click="load(refInput, currentID, true)">
          <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
        </button>
      </div>
      <form class="loader" @submit.prevent="load()">
        <input v-model="refInput" class="input input-sm" type="url" placeholder="URL de Figma (sección o página)" aria-label="URL de Figma" />
        <button class="btn btn-sm" :disabled="loading || !refInput.trim()">{{ loading ? 'Leyendo…' : 'Abrir' }}</button>
      </form>
      <p v-if="error" class="notice" role="alert">{{ error }}</p>
      <div class="region-body">
        <p v-if="!data && !loading && !error" class="empty">Pegá la URL de una sección o página de Figma: la que se copia del navegador, con su <span class="mono">node-id</span>.</p>
        <template v-for="g in groups" :key="g.id">
          <div v-if="groups.length > 1" class="section-name">{{ g.name }}</div>
          <template v-for="(lane, li) in g.lanes" :key="g.id + '-' + li">
            <div class="region-head grupo" :class="{ unlabeled: !lane.label }">
              <span>{{ laneName(lane) }}</span><span class="count">{{ lane.screens.length }}</span>
            </div>
            <button v-for="(sc, i) in lane.screens" :key="sc.id" class="screen-row" :data-screen="sc.id"
              :aria-current="sc.id === currentID ? 'true' : undefined" @click="go(sc.id)">
              <span class="n">{{ i + 1 }}</span>
              <span class="t">{{ sc.title || sc.name }}</span>
              <span v-if="sc.hotspots?.length" class="tag" title="Tiene zonas del prototipo">↗</span>
              <span v-if="sc.open_comments" class="tag" :title="sc.open_comments + ' comentario(s) abierto(s)'">💬</span>
            </button>
          </template>
        </template>
      </div>
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
          <a class="region-action" :href="figmaURL" target="_blank" rel="noopener" title="Abrir esta pantalla en Figma" aria-label="Abrir en Figma">
            <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
          </a>
        </template>
      </div>
      <div ref="stage" class="stage">
        <p v-if="!current" class="empty">{{ loading ? 'Leyendo el diseño…' : 'Sin pantalla elegida.' }}</p>
        <figure v-else v-for="p in panes" :key="p" class="pane">
        <div class="device" :data-kind="current.kind" :style="{ width: deviceSize.w + 'px', height: deviceSize.h + 'px' }">
          <img v-if="p === 'image'" :key="imageURL" :src="imageURL" :alt="current.title || current.name" draggable="false" @error="imageFailed = true" />
          <iframe v-else :key="htmlURL" :src="htmlURL" :title="'HTML de ' + (current.title || current.name)" class="html"
            :style="{ width: current.w + 'px', height: current.h + 'px', transform: `scale(${deviceSize.w / current.w})` }"></iframe>
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

.stage { flex: 1; min-height: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 24px }
.pane { margin: 0; display: flex; flex-direction: column; align-items: center; gap: var(--space-2) }
.pane figcaption { font-size: var(--text-xs); color: var(--texto-3) }
.modes { display: flex; gap: 2px }
/* La cabecera del editor junta título, navegación, modos y acciones: con los dos sidebars abiertos no
   entra en un renglón, y la regla del taller es ENVOLVER, no desbordar (con height:auto, o la caja fija
   de .region-head deja el segundo renglón afuera). */
.editor > .region-head { flex-wrap: wrap; height: auto; row-gap: var(--space-1) }
/* Al envolver, el título no cede todo el ancho: sin una base, `flex: 1` con `min-width: 0` lo dejaba en 0. */
.editor > .region-head > span:first-child { flex: 1 1 140px }
/* El HTML se dibuja a su tamaño de Figma y se escala entero: así el texto conserva sus medidas reales
   y la comparación con la imagen es de igual a igual. */
.device iframe.html { display: block; border: 0; transform-origin: 0 0 }
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
