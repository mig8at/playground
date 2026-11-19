<script setup>
/* NEWS: lo que pasó en Hugging Face cada semana. A la izquierda las semanas y los temas; al centro la portada (lo más
 * innovador, los modelos nuevos, los que siguen subiendo y los papers más votados); a la derecha la ficha del modelo
 * elegido, documentada.
 *
 * Todo lo arma el servidor (news/server): junta la semana de la API pública de Hugging Face y le pide al modelo de
 * fondo los textos. La ruta es `#/<semana>` (p. ej. `#/2026-W47`); sin ella, la última.
 *
 * Los favoritos (`#/favorites`) son modelos curiosos que se guardan para no perderlos de vista, con qué hacen, por qué
 * son interesantes, si corren en la Mac y lo que dieron al probarlos: los escribe Claude en news/favorites.json. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const weeks = ref([])
const data = ref(null)
const refreshing = ref(false)
const apiError = ref('')
async function api(path, opts) {
  const res = await fetch(path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}
const routeKey = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''))
const favorites = ref([])
// Los modelos instalados en la Mac (caché de Hugging Face, GGUF de llama-server y entornos), con su tamaño.
const installed = ref([])
const installedBytes = ref(0)
const loadInstalled = () => api('/api/installed').then((r) => { installed.value = r.installed; installedBytes.value = r.bytes }).catch(() => {})
const KIND_ICON = { hub: 'download', gguf: 'server', env: 'code', whisper: 'mic' }
// Borrar se confirma en la misma fila (el primer toque pregunta, el segundo borra): los diálogos del navegador no
// siempre aparecen dentro de la ventana de Cockpit.
const removing = ref('')
const confirming = ref('')
const removeError = ref('')
async function removeInstalled(it) {
  if (confirming.value !== it.key) { confirming.value = it.key; removeError.value = ''; return }
  confirming.value = ''
  removing.value = it.key
  try {
    await api(`/api/installed?key=${encodeURIComponent(it.key)}`, { method: 'DELETE', headers: { 'X-News': '1' } })
  } catch (e) { removeError.value = `No se pudo borrar ${it.name}: ${e.message}` }
  removing.value = ''
  loadInstalled()
}
async function load() {
  try {
    api('/api/favorites').then((r) => { favorites.value = r.favorites }).catch(() => {})
    loadInstalled()
    if (routeKey() === 'favorites') view.value = 'favorites'
    const list = await api('/api/weeks')
    weeks.value = list.weeks
    refreshing.value = list.refreshing
    apiError.value = list.error || ''
    const key = weeks.value.some((w) => w.key === routeKey()) ? routeKey() : weeks.value[0]?.key
    if (!key) return
    const wk = await api(`/api/weeks/${key}`)
    if (data.value?.key !== wk.key || data.value?.fetched !== wk.fetched) {
      data.value = wk
      if (!models.value.some((m) => m.id === selectedId.value)) selectedId.value = wk.lead || models.value.find((m) => m.new)?.id
    }
  } catch { apiError.value = 'No contesta la API de News.' }
}
async function refreshNow() {
  try { await api('/api/refresh', { method: 'POST' }); refreshing.value = true } catch { /* lo dice el pie */ }
}

const TOPICS = [
  { id: 'all', name: 'Todo', tasks: null },
  { id: 'text', name: 'Texto', tasks: ['text-generation', 'text2text-generation', 'fill-mask', 'sentence-similarity', 'feature-extraction', 'text-classification'] },
  { id: 'multimodal', name: 'Multimodal', tasks: ['image-text-to-text', 'any-to-any', 'visual-question-answering', 'video-text-to-text'] },
  { id: 'image', name: 'Imagen y video', tasks: ['text-to-image', 'image-to-image', 'image-to-video', 'text-to-video', 'unconditional-image-generation', 'image-to-3d', 'text-to-3d'] },
  { id: 'audio', name: 'Audio y voz', tasks: ['text-to-speech', 'audio-to-audio', 'automatic-speech-recognition', 'text-to-audio', 'audio-classification'] },
]
const topicOf = (task) => TOPICS.find((t) => t.tasks?.includes(task))?.id || 'other'
// El ícono y el color de cada tema, para reconocer el tipo de modelo a simple vista.
const TOPIC_ICON = { all: 'apps', text: 'text', multimodal: 'multimodal', image: 'image', audio: 'audio', other: 'box' }
// Dentro de «Imagen y video», el video lleva su propio ícono.
const VIDEO_TASKS = ['image-to-video', 'text-to-video', 'video']
const taskIcon = (task) => (VIDEO_TASKS.includes(task) ? 'video' : TOPIC_ICON[topicOf(task)])
const topic = ref('all')
const search = ref('')
const view = ref('cover') // cover · papers · favorites

// ── los favoritos ──
const FAV_GROUPS = [
  { id: 'tried', name: 'Probados', icon: 'check' },
  { id: 'voice', name: 'Voz que conversa', icon: 'mic' },
  { id: 'music', name: 'Música y sonido', icon: 'play' },
  { id: 'odd', name: 'Rarezas', icon: 'emoji' },
  { id: 'tiny', name: 'Diminutos', icon: 'box' },
  { id: 'detect', name: 'Detectores raros', icon: 'eye' },
  { id: 'create', name: 'Para crear', icon: 'image' },
  { id: 'specialist', name: 'Especialistas', icon: 'multimodal' },
  { id: 'gpu', name: 'Piden GPU NVIDIA', icon: 'server' },
]
const MAC = { yes: 'corre en la Mac', no: 'no corre en la Mac', unknown: 'en la Mac: sin confirmar' }
const favGroup = ref('all')
const favMatches = (f) => (favGroup.value === 'all' || f.group === favGroup.value)
  && (!q.value || `${f.id} ${f.task} ${f.what}`.toLowerCase().includes(q.value))
// «Probados» no va en tarjetas: es el historial, una tabla con fecha, veredicto, quién lo usa y cuánto ocupa.
const favSections = computed(() => FAV_GROUPS.filter((g) => g.id !== 'tried').map((g) => ({ ...g, items: favorites.value.filter((f) => f.group === g.id && favMatches(f)) })).filter((g) => g.items.length))
const triedHistory = computed(() => favorites.value.filter((f) => f.verdict && (favGroup.value === 'all' || favGroup.value === 'tried')
  && (!q.value || `${f.id} ${f.task} ${f.what}`.toLowerCase().includes(q.value))).sort((a, b) => (b.triedOn || '').localeCompare(a.triedOn || '')))
const VERDICT = { keep: 'Vale la pena', dropped: 'Descartado' }
const installedByKey = computed(() => Object.fromEntries(installed.value.map((i) => [i.key, i])))
const favInstalled = (f) => (f.installed || []).map((k) => installedByKey.value[k]).filter(Boolean)
const favBytes = (f) => favInstalled(f).reduce((n, i) => n + i.bytes, 0)
const favOfInstalled = (it) => favorites.value.find((f) => (f.installed || []).includes(it.key))
const favStats = computed(() => {
  const tried = favorites.value.filter((f) => f.verdict)
  return { saved: favorites.value.length, tried: tried.length, keep: tried.filter((f) => f.verdict === 'keep').length,
    dropped: tried.filter((f) => f.verdict === 'dropped').length, inUse: favorites.value.filter((f) => f.usedBy).length }
})
const favCount = (id) => favorites.value.filter((f) => id === 'all' || f.group === id).length
const favName = (f) => f.id.split('/')[1]
const favOrg = (f) => f.id.split('/')[0]
const openFavorites = (g) => { favGroup.value = g; view.value = 'favorites'; if (location.hash !== '#/favorites') history.replaceState(null, '', '#/favorites') }
const selectedFavId = ref('')
const selectedFav = computed(() => (view.value === 'favorites' ? favorites.value.find((f) => f.id === selectedFavId.value) : null))

const models = computed(() => (data.value?.models || []).map((m) => ({ ...m, topic: topicOf(m.task) })))
const q = computed(() => search.value.trim().toLowerCase())
const matches = (m) => (topic.value === 'all' || m.topic === topic.value || (topic.value === 'other' && m.topic === 'other'))
  && (!q.value || `${m.id} ${m.task}`.toLowerCase().includes(q.value))
const fresh = computed(() => models.value.filter((m) => m.new && matches(m)))
const rising = computed(() => models.value.filter((m) => !m.new && matches(m)).slice(0, 8))
// Lo más innovador lo elige el modelo de fondo; sin su texto todavía, el primero en tendencia de los nuevos.
const lead = computed(() => fresh.value.find((m) => m.id === data.value?.lead) || fresh.value[0] || null)
// Lo más popular: el nuevo de la semana que va más alto en tendencia (la lista ya viene en ese orden). Puede ser el
// mismo que el más innovador: entonces queda una sola nota con las dos etiquetas.
const popular = computed(() => fresh.value[0] || null)
const both = computed(() => !!lead.value && lead.value === popular.value)
const popularWhy = computed(() => popular.value ? [`Es el nuevo de la semana que va más alto en tendencia: #${popular.value.rank} de todo Hugging Face.`, popular.value.what].filter(Boolean).join(' ') : '')
const countFor = (id) => models.value.filter((m) => m.new && (id === 'all' || m.topic === id)).length
const otherCount = computed(() => models.value.filter((m) => m.new && m.topic === 'other').length)

const selectedId = ref('')
const selected = computed(() => models.value.find((m) => m.id === selectedId.value))
const openPaper = ref('')

// ── formatos ──
const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const day = (iso) => { if (!iso) return '—'; const [, m, d] = iso.split('-').map(Number); return `${d} ${months[m - 1]}` }
const num = (n) => (n ?? 0).toLocaleString('es-CO')
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${(n / 1e3).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil` : num(n))
const bytes = (n) => (n >= 1e9 ? `${(n / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 })} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)
const params = (n) => (!n ? 'no lo declara' : n >= 1e9 ? `${(n / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 })} B parámetros` : `${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 0 })} M parámetros`)
const weekLabel = computed(() => (data.value ? `${day(data.value.from)} al ${day(data.value.to)}` : ''))
const papers = computed(() => data.value?.papers || [])
const clock = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const hf = (id) => `https://huggingface.co/${id}`

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const sidebarOpen = ref(readSize('news.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('news.sidebar-w', 240))
const auxOpen = ref(readSize('news.aux-open', 1) !== 0)
const auxW = ref(readSize('news.aux-w', 320))
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 220)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 420), [
    { size: auxOpen.value ? auxW.value : 0, min },
    { size: sidebarOpen.value ? sidebarW.value : 0, min },
  ])
  return { sidebar, aux }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px` }))
const resizeOf = (key, w, open, sign, other) => ({
  label: key === 'sidebar' ? 'Ancho de las semanas' : 'Ancho de la ficha', sign, defaultValue: key === 'sidebar' ? 240 : 320,
  min: () => cssSize('--sidebar-min', 220), max: () => viewportW.value - shown.value[other] - cssSize('--editor-min', 420),
  get: () => shown.value[key],
  set: (v) => { if (!v) open.value = false; else { open.value = true; w.value = v } },
  reopen: () => w.value,
  commit: (v) => { saveSize(`news.${key}-open`, v ? 1 : 0); if (v) saveSize(`news.${key}-w`, w.value) },
})
const sidebarResize = resizeOf('sidebar', sidebarW, sidebarOpen, 1, 'aux')
const auxResize = resizeOf('aux', auxW, auxOpen, -1, 'sidebar')
const toggle = (key, open) => { open.value = !shown.value[key]; saveSize(`news.${key}-open`, open.value ? 1 : 0) }
const pick = (m) => { selectedId.value = m.id; if (!shown.value.aux) toggle('aux', auxOpen) }
const pickFav = (f) => { selectedFavId.value = f.id; if (!shown.value.aux) toggle('aux', auxOpen) }
// Tocar un instalado abre la ficha del favorito al que pertenece (si lo hay).
const pickInstalled = (it) => { const f = favOfInstalled(it); if (f) { openFavorites('all'); pickFav(f) } }
const onWindowResize = () => { viewportW.value = window.innerWidth }
const themeToggle = ref(null)
let themeBinding = null
// Mientras se actualiza, cada 5 s; si no, cada minuto (por si cambió de fondo).
let timer = null
function schedule() { clearTimeout(timer); timer = setTimeout(async () => { if (!document.hidden) await load(); schedule() }, refreshing.value ? 5000 : 60000) }
const onHash = () => {
  if (routeKey() === 'favorites') { view.value = 'favorites'; return }
  if (view.value === 'favorites') view.value = 'cover'
  data.value = null; load()
}
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHash)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  load().then(schedule)
})
onBeforeUnmount(() => { window.removeEventListener('resize', onWindowResize); window.removeEventListener('hashchange', onHash); clearTimeout(timer); themeBinding?.destroy?.() })
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Semanas y temas">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head"><span>News</span></div>
      <div class="region-body">
        <div class="group-label">Favoritos</div>
        <button type="button" class="nav-row" :class="{ on: view === 'favorites' && favGroup === 'all' }" @click="openFavorites('all')">
          <span class="ui-icon" data-icon="star" aria-hidden="true"></span><span class="nav-name">Todos</span><span class="count">{{ favCount('all') }}</span>
        </button>
        <button v-for="g in FAV_GROUPS.filter((x) => favCount(x.id))" :key="g.id" type="button" class="nav-row sub" :class="{ on: view === 'favorites' && favGroup === g.id }" @click="openFavorites(g.id)">
          <span class="ui-icon" :data-icon="g.icon" aria-hidden="true"></span><span class="nav-name">{{ g.name }}</span><span class="count">{{ favCount(g.id) }}</span>
        </button>
        <div class="group-label">Instalados<span v-if="installed.length" class="group-count">{{ bytes(installedBytes) }}</span></div>
        <template v-for="it in installed" :key="it.key">
          <div class="nav-row installed" :class="{ muted: removing === it.key, asking: confirming === it.key }" :title="`${it.name} · ${it.where}${it.usedBy ? ` · lo usa ${it.usedBy}` : ''}`">
            <span class="ui-icon" :data-icon="KIND_ICON[it.kind]" aria-hidden="true"></span><button type="button" class="nav-name installed-name" :disabled="!favOfInstalled(it)" @click="pickInstalled(it)">{{ it.name.split('/').pop() }}</button><span v-if="it.usedBy" class="in-use" :title="`Lo usa ${it.usedBy}`">en uso</span><span class="count">{{ removing === it.key ? 'borrando…' : bytes(it.bytes) }}</span>
            <button type="button" class="region-action trash" :disabled="removing === it.key" :title="`Borrar ${it.name}`" :aria-label="`Borrar ${it.name}`" @click="removeInstalled(it)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
          </div>
          <div v-if="confirming === it.key" class="confirm-row">
            <span>¿Borrar {{ it.name }}? Libera {{ bytes(it.bytes) }}. {{ it.usedBy ? `Lo usa ${it.usedBy}: deja de andar hasta volver a bajarlo.` : 'Se puede volver a bajar.' }}</span>
            <span class="confirm-actions"><button type="button" class="danger" @click="removeInstalled(it)">Borrar</button><button type="button" @click="confirming = ''">Cancelar</button></span>
          </div>
        </template>
        <div v-if="removeError" class="confirm-row error">{{ removeError }}</div>
        <div v-if="!installed.length" class="nav-row muted"><span class="ui-icon" data-icon="box" aria-hidden="true"></span><span class="nav-name">Ningún modelo en la Mac</span></div>
        <div class="group-label">Semanas</div>
        <a v-for="w in weeks" :key="w.key" class="nav-row" :class="{ on: data?.key === w.key && view !== 'favorites' }" :href="`#/${w.key}`" @click="view === 'favorites' && (view = 'cover')">
          <span class="ui-icon" data-icon="clock" aria-hidden="true"></span><span class="nav-name">Semana {{ w.number }}</span><span class="count">{{ day(w.from) }} al {{ day(w.to) }}</span>
        </a>
        <div v-if="!weeks.length" class="nav-row muted"><span class="ui-icon" data-icon="clock" aria-hidden="true"></span><span class="nav-name">{{ refreshing ? 'Juntando la primera semana…' : 'Todavía no hay semanas' }}</span></div>
        <div class="group-label">Temas</div>
        <button v-for="t in TOPICS" :key="t.id" type="button" class="nav-row" :class="{ on: topic === t.id && view === 'cover' }" @click="topic = t.id; view = 'cover'">
          <span class="ui-icon topic-icon" :class="`t-${t.id}`" :data-icon="TOPIC_ICON[t.id]" aria-hidden="true"></span><span class="nav-name">{{ t.name }}</span><span class="count">{{ countFor(t.id) }}</span>
        </button>
        <button v-if="otherCount" type="button" class="nav-row" :class="{ on: topic === 'other' && view === 'cover' }" @click="topic = 'other'; view = 'cover'">
          <span class="ui-icon topic-icon t-other" data-icon="box" aria-hidden="true"></span><span class="nav-name">Otros</span><span class="count">{{ otherCount }}</span>
        </button>
        <div class="group-label">Investigación</div>
        <button type="button" class="nav-row" :class="{ on: view === 'papers' }" @click="view = 'papers'">
          <span class="ui-icon" data-icon="paper" aria-hidden="true"></span><span class="nav-name">Papers</span><span class="count">{{ data?.papersTotal ?? '' }}</span>
        </button>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ view === 'favorites' ? 'Favoritos' : view === 'papers' ? 'Papers de la semana' : data ? `Semana ${data.number} · ${weekLabel}` : 'News' }}</span>
        <input v-model="search" class="search" type="search" placeholder="Buscar un modelo o una tarea" aria-label="Buscar">
      </div>
      <div class="region-body">
        <!-- los favoritos -->
        <div v-if="view === 'favorites'" class="cover">
          <div class="fav-stats">
            <span><b>{{ favStats.saved }}</b> guardados</span><span><b>{{ favStats.tried }}</b> probados</span>
            <span class="keep"><b>{{ favStats.keep }}</b> valen la pena</span><span class="dropped"><b>{{ favStats.dropped }}</b> {{ favStats.dropped === 1 ? 'descartado' : 'descartados' }}</span>
            <span class="use"><b>{{ favStats.inUse }}</b> en uso</span><span><b>{{ bytes(installedBytes) }}</b> en la Mac</span>
          </div>
          <section v-if="triedHistory.length">
            <h2 class="section-title">Probados <span>el historial: lo que dio cada uno y si se quedó</span></h2>
            <div class="rows history">
              <button v-for="f in triedHistory" :key="f.id" type="button" class="row" :class="{ on: selectedFavId === f.id, dropped: f.verdict === 'dropped' }" @click="pickFav(f)">
                <span class="row-num">{{ day(f.triedOn) }}</span>
                <span class="hist-name"><span class="model-icon small" :class="`t-${topicOf(f.task)}`"><span class="ui-icon" :data-icon="taskIcon(f.task)" aria-hidden="true"></span></span><b>{{ favName(f) }}</b><span class="hist-why">{{ f.verdictWhy }}</span></span>
                <span class="verdict" :class="f.verdict">{{ VERDICT[f.verdict] }}</span>
                <span class="hist-use">{{ f.usedBy ? `en uso · ${f.usedBy}` : '' }}</span>
                <span class="row-num">{{ favBytes(f) ? bytes(favBytes(f)) : f.verdict === 'dropped' ? 'borrado' : '—' }}</span>
              </button>
            </div>
          </section>
          <section v-for="g in favSections" :key="g.id">
            <h2 class="section-title">{{ g.name }} <span>{{ g.items.length }}</span></h2>
            <div class="favs">
              <button v-for="f in g.items" :key="f.id" type="button" class="fav" :class="{ on: selectedFavId === f.id }" @click="pickFav(f)">
                <span class="model-top"><span class="model-icon" :class="`t-${topicOf(f.task)}`"><span class="ui-icon" :data-icon="taskIcon(f.task)" aria-hidden="true"></span></span><span class="model-name">{{ favName(f) }}</span><span class="mac" :class="f.mac">{{ f.mac === 'yes' ? 'Mac' : f.mac === 'no' ? 'GPU' : '¿Mac?' }}</span></span>
                <span class="model-org">{{ favOrg(f) }} · {{ params(f.params) }}</span>
                <span class="fav-what">{{ f.what }}</span>
                <span v-if="f.usedBy || favBytes(f)" class="fav-tags"><span v-if="f.usedBy" class="in-use">en uso · {{ f.usedBy }}</span><span v-if="favBytes(f)" class="tag">instalado · {{ bytes(favBytes(f)) }}</span></span>
              </button>
            </div>
          </section>
          <p v-if="!favSections.length" class="empty-line">Ningún favorito coincide.</p>
        </div>

        <!-- la portada -->
        <div v-else-if="!data" class="empty"><div class="empty-head">
          <div class="empty-title">{{ apiError ? 'Sin API' : refreshing ? 'Juntando la semana…' : 'Todavía no hay semanas' }}</div>
          <div class="empty-desc">{{ apiError || 'Junta los modelos y los papers de Hugging Face y le pide al modelo de fondo los textos: tarda un minuto.' }}</div>
        </div></div>
        <div v-else-if="view === 'cover'" class="cover">
          <div class="leads" :class="{ single: both }">
          <article v-if="lead" class="lead" :class="{ on: selectedId === lead.id }" @click="pick(lead)">
            <div class="kickers"><span class="kicker"><span class="ui-icon" data-icon="claude" aria-hidden="true"></span> Lo más innovador</span><span v-if="both" class="kicker hot"><span class="ui-icon" data-icon="popular" aria-hidden="true"></span> y lo más popular</span></div>
            <h1><span class="model-icon big" :class="`t-${lead.topic}`"><span class="ui-icon" :data-icon="taskIcon(lead.task)" aria-hidden="true"></span></span>{{ lead.name }}</h1>
            <div class="byline">{{ lead.org }} · <span class="task" :class="`t-${lead.topic}`"><span class="ui-icon" :data-icon="taskIcon(lead.task)" aria-hidden="true"></span>{{ lead.task }}</span> · {{ params(lead.params) }} · salió el {{ day(lead.created) }}</div>
            <p v-if="lead.id === data.lead && data.why" class="why">{{ data.why }}</p>
            <p v-else class="why muted">{{ refreshing ? 'El modelo de fondo está escribiendo por qué importa…' : 'Todavía sin el texto de por qué importa.' }}</p>
            <div class="stats"><span>♥ {{ num(lead.likes) }}</span><span>↓ {{ num(lead.downloads) }}</span><span>tendencia {{ lead.trending }} · #{{ lead.rank }}</span></div>
          </article>
          <article v-if="popular && !both" class="lead hot" :class="{ on: selectedId === popular.id }" @click="pick(popular)">
            <div class="kickers"><span class="kicker hot"><span class="ui-icon" data-icon="popular" aria-hidden="true"></span> Lo más popular</span></div>
            <h1><span class="model-icon big" :class="`t-${popular.topic}`"><span class="ui-icon" :data-icon="taskIcon(popular.task)" aria-hidden="true"></span></span>{{ popular.name }}</h1>
            <div class="byline">{{ popular.org }} · <span class="task" :class="`t-${popular.topic}`"><span class="ui-icon" :data-icon="taskIcon(popular.task)" aria-hidden="true"></span>{{ popular.task }}</span> · salió el {{ day(popular.created) }}</div>
            <p class="why">{{ popularWhy }}</p>
            <div class="stats"><span>♥ {{ num(popular.likes) }}</span><span>↓ {{ num(popular.downloads) }}</span><span>tendencia {{ popular.trending }} · #{{ popular.rank }}</span></div>
          </article>
          </div>

          <section>
            <h2 class="section-title">Nuevos esta semana <span>{{ fresh.length }} modelos creados del {{ weekLabel }} que entraron en tendencia</span></h2>
            <div class="cards">
              <button v-for="m in fresh.filter((x) => x !== lead && x !== popular)" :key="m.id" type="button" class="model" :class="{ on: selectedId === m.id }" @click="pick(m)">
                <span class="model-top"><span class="model-icon" :class="`t-${m.topic}`"><span class="ui-icon" :data-icon="taskIcon(m.task)" aria-hidden="true"></span></span><span class="model-name">{{ m.name }}</span></span>
                <span class="model-org">{{ m.org }} · {{ day(m.created) }}</span>
                <span class="model-foot"><span class="task" :class="`t-${m.topic}`"><span class="ui-icon" :data-icon="taskIcon(m.task)" aria-hidden="true"></span>{{ m.task }}</span><span class="model-num">♥ {{ short(m.likes) }}</span></span>
              </button>
            </div>
            <p v-if="!fresh.length" class="empty-line">Ningún modelo nuevo coincide.</p>
          </section>

          <section>
            <h2 class="section-title">Siguen subiendo <span>no son de esta semana</span></h2>
            <div class="rows">
              <button v-for="m in rising" :key="m.id" type="button" class="row" :class="{ on: selectedId === m.id }" @click="pick(m)">
                <span class="row-rank">#{{ m.rank }}</span>
                <span class="row-name">{{ m.id }}</span>
                <span class="task" :class="`t-${m.topic}`"><span class="ui-icon" :data-icon="taskIcon(m.task)" aria-hidden="true"></span>{{ m.task }}</span>
                <span class="row-num">♥ {{ short(m.likes) }} · ↓ {{ short(m.downloads) }}</span>
                <span class="row-num">{{ day(m.created) }}</span>
              </button>
            </div>
          </section>

          <section>
            <h2 class="section-title">Papers más votados <span>{{ data.papersTotal }} en la semana</span><button type="button" class="link" @click="view = 'papers'">ver todos</button></h2>
            <div class="rows">
              <div v-for="p in papers.slice(0, 5)" :key="p.id" class="row paper"><span class="votes">▲ {{ p.upvotes }}</span><span class="row-name">{{ p.title }}</span><span class="row-num">{{ day(p.day) }}</span></div>
            </div>
          </section>
        </div>

        <!-- los papers -->
        <div v-else class="cover">
          <div v-for="p in papers" :key="p.id" class="paper-card" :class="{ open: openPaper === p.id }" @click="openPaper = openPaper === p.id ? '' : p.id">
            <div class="paper-head"><span class="votes">▲ {{ p.upvotes }}</span><span class="paper-title">{{ p.title }}</span><span class="row-num">{{ day(p.day) }}</span></div>
            <p class="paper-summary">{{ p.summarySpanish || p.summary }}</p>
            <div class="paper-links"><a :href="`https://huggingface.co/papers/${p.id}`" target="_blank" rel="noopener" @click.stop>Hugging Face</a><a v-if="p.github" :href="p.github" target="_blank" rel="noopener" @click.stop>Código</a><span>{{ p.comments }} comentarios</span></div>
          </div>
        </div>
      </div>
    </main>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="La ficha del modelo">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head"><span>Ficha</span><a v-if="selectedFav || (selected && view !== 'favorites')" class="region-action" :href="hf(selectedFav?.id || selected.id)" target="_blank" rel="noopener" title="Abrir en Hugging Face" aria-label="Abrir en Hugging Face"><span class="ui-icon" data-icon="external" aria-hidden="true"></span></a></div>
      <div v-if="selectedFav" class="region-body doc">
        <div class="doc-name">{{ favName(selectedFav) }}</div>
        <div class="doc-org">{{ favOrg(selectedFav) }}</div>
        <div v-if="selectedFav.verdict" class="verdict-box" :class="selectedFav.verdict">
          <span class="verdict" :class="selectedFav.verdict">{{ VERDICT[selectedFav.verdict] }}</span> <span class="row-num">probado el {{ day(selectedFav.triedOn) }}</span>
          <p>{{ selectedFav.verdictWhy }}</p>
          <p v-if="selectedFav.usedBy" class="in-use-line">Lo usa {{ selectedFav.usedBy }}.</p>
        </div>
        <dl>
          <dt>Tarea</dt><dd><span class="task" :class="`t-${topicOf(selectedFav.task)}`"><span class="ui-icon" :data-icon="taskIcon(selectedFav.task)" aria-hidden="true"></span>{{ selectedFav.task }}</span></dd>
          <dt>Tamaño</dt><dd>{{ params(selectedFav.params) }}</dd>
          <dt>Licencia</dt><dd>{{ selectedFav.license || 'no la declara' }}</dd>
          <dt>En la Mac</dt><dd><span class="mac" :class="selectedFav.mac">{{ MAC[selectedFav.mac] }}</span></dd>
          <dt>Guardado</dt><dd>{{ day(selectedFav.added) }}</dd>
        </dl>
        <div class="doc-section">Qué hace</div>
        <p class="doc-text">{{ selectedFav.what }}</p>
        <div class="doc-section">Por qué es interesante</div>
        <p class="doc-text">{{ selectedFav.why }}</p>
        <template v-if="selectedFav.ideas?.length">
          <div class="doc-section">Ideas</div>
          <ul class="doc-list"><li v-for="i in selectedFav.ideas" :key="i">{{ i }}</li></ul>
        </template>
        <template v-if="selectedFav.tried">
          <div class="doc-section">Lo que dio al probarlo</div>
          <p class="doc-text">{{ selectedFav.tried }}</p>
        </template>
        <template v-if="favInstalled(selectedFav).length">
          <div class="doc-section">Instalado en la Mac · {{ bytes(favBytes(selectedFav)) }}</div>
          <template v-for="it in favInstalled(selectedFav)" :key="it.key">
            <div class="nav-row installed doc-installed" :class="{ asking: confirming === it.key }">
              <span class="ui-icon" :data-icon="KIND_ICON[it.kind]" aria-hidden="true"></span><span class="nav-name">{{ it.where }}</span><span class="count">{{ bytes(it.bytes) }}</span>
              <button type="button" class="region-action trash" :disabled="removing === it.key" :aria-label="`Borrar ${it.name}`" @click="removeInstalled(it)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
            </div>
            <div v-if="confirming === it.key" class="confirm-row">
              <span>¿Borrar {{ it.name }}? Libera {{ bytes(it.bytes) }}. {{ it.usedBy ? `Lo usa ${it.usedBy}: deja de andar hasta volver a bajarlo.` : 'Se puede volver a bajar.' }}</span>
              <span class="confirm-actions"><button type="button" class="danger" @click="removeInstalled(it)">Borrar</button><button type="button" @click="confirming = ''">Cancelar</button></span>
            </div>
          </template>
        </template>
      </div>
      <div v-else-if="view === 'favorites'" class="region-body"><p class="empty-line pad">Elegí un favorito para ver su ficha.</p></div>
      <div v-else-if="selected" class="region-body doc">
        <div class="doc-name">{{ selected.name }}</div>
        <div class="doc-org">{{ selected.org }}</div>
        <dl>
          <dt>Tarea</dt><dd><span class="task" :class="`t-${selected.topic}`"><span class="ui-icon" :data-icon="taskIcon(selected.task)" aria-hidden="true"></span>{{ selected.task }}</span></dd>
          <dt>Salió</dt><dd>{{ day(selected.created) }}</dd>
          <dt>Tamaño</dt><dd>{{ params(selected.params) }}</dd>
          <dt>Licencia</dt><dd>{{ selected.license || 'no la declara' }}</dd>
          <dt>Formatos</dt><dd>{{ selected.formats?.length ? selected.formats.join(' · ') : '—' }}</dd>
          <dt>Librería</dt><dd>{{ selected.library || '—' }}</dd>
          <dt>Idiomas</dt><dd>{{ selected.languages?.length ? selected.languages.slice(0, 6).join(', ') : '—' }}</dd>
          <dt v-if="selected.base">Basado en</dt><dd v-if="selected.base">{{ Array.isArray(selected.base) ? selected.base.join(', ') : selected.base }}</dd>
          <dt>Tendencia</dt><dd>#{{ selected.rank }} · {{ selected.trending }}</dd>
          <dt>Popularidad</dt><dd>♥ {{ num(selected.likes) }} · ↓ {{ num(selected.downloads) }}</dd>
        </dl>
        <div class="doc-section">Qué hace</div>
        <p class="doc-text">{{ selected.what || (selected.new ? 'Todavía sin escribir.' : 'Sólo se documentan los modelos nuevos de la semana.') }}</p>
        <div class="doc-section">Lo nuevo</div>
        <p class="doc-text">{{ selected.novelty || '—' }}</p>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="apiError">{{ apiError }}</span>
      <span v-else-if="refreshing">actualizando la semana…</span>
      <span v-else-if="data">Hugging Face al {{ clock(data.fetched) }} · se actualiza cada 6 h{{ data.writtenBy ? ` · textos de ${data.writtenBy === 'claude' ? 'Claude' : 'Gemini'}` : '' }}{{ data.writeError ? ` · ⚠ ${data.writeError}` : '' }}</span>
      <button type="button" class="statusbar-item" :disabled="refreshing" title="Actualizar la semana ahora (lo hace solo cada 6 horas)" @click="refreshNow">Actualizar</button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las semanas" aria-label="Mostrar u ocultar las semanas" @click="toggle('sidebar', sidebarOpen)"><span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar la ficha" aria-label="Mostrar u ocultar la ficha" @click="toggle('aux', auxOpen)"><span class="ui-icon" data-icon="detail" aria-hidden="true"></span></button>
      </div>
    </footer>
  </div>
</template>
