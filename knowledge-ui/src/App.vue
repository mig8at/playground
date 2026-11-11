<script setup>
/* KNOWLEDGE: el conocimiento local (`knowledge/`), para LEERLO. A la izquierda los temas (con buscador, y marcados los
 * que tienen fuentes para revisar); al centro el tema como documento, con sus secciones; a la derecha sus fuentes —el
 * archivo en el commit revisado y si cambió en main— y las tareas del tablero que lo citan. No se edita: un tema se
 * cambia en el repo, con su contrato (knowledge/CLAUDE.md).
 *
 * La ruta es `#/<tema>[/<sección>]`: un enlace `knowledge:tema#ancla` de un tema o de una tarea abre lo mismo. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, readHashRoute, setRoute } from './workbench.js'
import { renderMarkdown } from './markdown.js'

const topics = ref([])
const topicsError = ref('')
const current = ref(null)        // { topic, sources, cited }
const topicError = ref('')
const route = ref({ topic: '', section: '' })
const query = ref('')
const hits = ref([])
const check = ref({ running: true, states: [] })

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ── la vigencia: el chequeo de fuentes del servidor (el de `make knowledge-check`), de fondo ──
const problemsByTopic = computed(() => {
  const out = {}
  for (const s of check.value.states || []) if (s.state !== 'unchanged') out[s.topic] = (out[s.topic] || 0) + 1
  return out
})
const stateOf = (topicId, src) => (check.value.states || []).find((s) => s.topic === topicId && s.repo === src.repo && s.path === src.path)
const totalSources = computed(() => topics.value.reduce((n, t) => n + t.sources, 0))
const totalProblems = computed(() => Object.values(problemsByTopic.value).reduce((n, c) => n + c, 0))
let checkTimer = null
async function loadCheck() {
  try { check.value = await (await fetch('/api/check')).json() } catch { /* el pie dice que no hay chequeo */ }
  clearTimeout(checkTimer)
  if (check.value.running) checkTimer = setTimeout(loadCheck, 3000)
}
async function recheck() {
  try { check.value = await (await fetch('/api/check', { method: 'POST' })).json() } catch { /* idem */ }
  loadCheck()
}

// ── los temas y el elegido ──
async function loadTopics() {
  try {
    const res = await fetch('/api/topics')
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    topics.value = body
    topicsError.value = ''
  } catch (e) {
    topicsError.value = e.message === 'Failed to fetch' ? 'No contesta la API. ¿Está arriba? (make knowledge-ui levanta las dos partes)' : e.message
  }
}
async function loadTopic(id) {
  if (!id) { current.value = null; return }
  if (current.value?.topic?.id === id) return
  try {
    const res = await fetch(`/api/topic?id=${encodeURIComponent(id)}`)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    current.value = body
    topicError.value = ''
  } catch (e) {
    current.value = null
    topicError.value = e.message
  }
}

// ── la ruta ──
function readRoute() {
  const { parts } = readHashRoute()
  route.value = { topic: parts[0] || '', section: parts[1] || '' }
}
function go(topic, section = '') {
  setRoute(`#/${[topic, section].filter(Boolean).map(encodeURIComponent).join('/')}`, { push: true })
  readRoute()
}
const onHashChange = () => readRoute()
watch(() => route.value.topic, async (id) => { await loadTopic(id); scrollToSection() })
watch(() => route.value.section, () => scrollToSection())
const editorBody = ref(null)
async function scrollToSection() {
  await nextTick()
  const id = route.value.section
  const el = id && document.getElementById(`s-${id}`)
  if (el) el.scrollIntoView({ block: 'start' })
  else if (editorBody.value) editorBody.value.scrollTop = 0
}

// ── el buscador: por título al tipear; con 3 letras o más, también dentro de las secciones (la búsqueda de la API) ──
const visibleTopics = computed(() => {
  const q = fold(query.value.trim())
  if (!q) return topics.value
  return topics.value.filter((t) => fold(`${t.id} ${t.title} ${t.summary}`).includes(q))
})
let searchTimer = null
watch(query, (q) => {
  clearTimeout(searchTimer)
  if (q.trim().length < 3) { hits.value = []; return }
  searchTimer = setTimeout(async () => {
    try { hits.value = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json() } catch { hits.value = [] }
  }, 250)
})
const titleOf = (id) => topics.value.find((t) => t.id === id)?.title || id

// ── una tarea que cita el tema: en Cockpit, el tablero al frente en esa tarea; afuera, el tablero en otra pestaña ──
function openTask(slug) {
  if (window.parent !== window) window.parent.postMessage({ cockpit: true, type: 'open', app: 'tablero', route: `#/tareas/${slug}` }, '*')
  else window.open(`http://localhost:5191/#/tareas/${encodeURIComponent(slug)}`, '_blank', 'noopener')
}

const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) }
const fmtTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) }
const short = (sha) => String(sha || '').slice(0, 7)
const STATE_LABEL = { unchanged: 'al día', changed: 'cambió en main', missing: 'ya no está', invalid: 'el hash no coincide', unavailable: 'no se pudo leer' }

// ── las regiones: temas a la izquierda y fuentes a la derecha, con el contrato de la base ──
const sidebarOpen = ref(readSize('knowledge.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('knowledge.sidebar-w', 300))
const auxOpen = ref(readSize('knowledge.aux-open', 1) !== 0)
const auxW = ref(readSize('knowledge.aux-w', 340))
const viewportW = ref(window.innerWidth)
const onWindowResize = () => { viewportW.value = window.innerWidth }
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 240)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: auxOpen.value ? auxW.value : 0, min },
    { size: sidebarOpen.value ? sidebarW.value : 0, min },
  ])
  return { sidebar, aux }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px` }))
const sidebarResize = {
  label: 'Ancho de los temas', sign: 1, defaultValue: 300,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('knowledge.sidebar-open', v ? 1 : 0); if (v) saveSize('knowledge.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho de las fuentes', sign: -1, defaultValue: 340,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('knowledge.aux-open', v ? 1 : 0); if (v) saveSize('knowledge.aux-w', auxW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('knowledge.sidebar-open', sidebarOpen.value ? 1 : 0) }
function toggleAux() { auxOpen.value = !shown.value.aux; saveSize('knowledge.aux-open', auxOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  readRoute()
  loadTopics()
  loadCheck()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearTimeout(checkTimer)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Temas">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Temas</span>
        <span class="count" :class="{ filtered: query.trim() }">{{ query.trim() ? `${visibleTopics.length} / ${topics.length}` : topics.length }}</span>
      </div>
      <div class="search">
        <input v-model="query" class="input" type="search" placeholder="Buscar en los temas…" aria-label="Buscar en los temas" />
      </div>
      <div class="region-body">
        <p v-if="topicsError" class="none">{{ topicsError }}</p>
        <template v-if="hits.length">
          <div class="region-head group"><span>Secciones</span><span class="count">{{ hits.length }}</span></div>
          <button v-for="h in hits" :key="`${h.topic}/${h.id}`" type="button" class="row stacked"
                  :class="{ on: route.topic === h.topic && route.section === h.id }" @click="go(h.topic, h.id)">
            <span>{{ h.title }}</span><small class="row-desc">{{ titleOf(h.topic) }}</small>
          </button>
          <div class="region-head group"><span>Temas</span><span class="count">{{ visibleTopics.length }}</span></div>
        </template>
        <button v-for="t in visibleTopics" :key="t.id" type="button" class="row stacked" :class="{ on: route.topic === t.id }"
                :title="t.summary" @click="go(t.id)">
          <span class="topic-line">
            <span class="topic-name">{{ t.title }}</span>
            <i v-if="problemsByTopic[t.id]" class="dot warn" :title="`${problemsByTopic[t.id]} fuente(s) para revisar`" aria-label="fuentes para revisar"></i>
          </span>
          <small class="row-desc">{{ t.id }} · {{ t.sections.length }} secciones · {{ t.sources }} fuentes</small>
        </button>
        <p v-if="!topicsError && topics.length && !visibleTopics.length && !hits.length" class="none">Nada con «{{ query }}».</p>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ current ? current.topic.title : 'Knowledge' }}</span>
        <span v-if="current" class="count">{{ current.topic.sections.length }} secciones</span>
      </div>
      <div ref="editorBody" class="region-body">
        <p v-if="topicError" class="none">{{ topicError }}</p>
        <article v-else-if="current" class="doc">
          <h1>{{ current.topic.title }}</h1>
          <p class="summary">{{ current.topic.summary }}</p>
          <p class="meta">
            <code>{{ current.topic.id }}</code> · revisado el {{ fmtDate(current.topic.reviewedAt) }} · {{ current.sources.length }} fuentes
            <template v-if="problemsByTopic[current.topic.id]"> · <span class="warn-text">{{ problemsByTopic[current.topic.id] }} para revisar</span></template>
          </p>
          <div v-if="current.topic.intro" v-html="renderMarkdown(current.topic.intro)"></div>
          <section v-for="s in current.topic.sections" :id="`s-${s.id}`" :key="s.id" :class="{ target: route.section === s.id }">
            <h2>{{ s.title }}</h2>
            <div v-html="renderMarkdown(s.text)"></div>
          </section>
        </article>
        <div v-else class="empty-state">
          <p class="empty-title">El conocimiento local</p>
          <p>{{ topics.length }} temas y {{ totalSources }} fuentes en <code>knowledge/</code>. Elegí un tema a la izquierda, o buscá
            dentro de sus secciones.</p>
          <p>Sólo se lee: un tema se cambia en el repo, con su contrato (<code>knowledge/CLAUDE.md</code>).</p>
        </div>
      </div>
    </main>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="Fuentes y citas">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>Fuentes</span>
        <span v-if="current" class="count">{{ current.sources.length }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="check.running" title="Volver a comprobar las fuentes contra main"
                  aria-label="Volver a comprobar las fuentes" @click="recheck"><span class="ui-icon" data-icon="refresh" aria-hidden="true"></span></button>
        </div>
      </div>
      <div class="region-body">
        <template v-if="current">
          <div v-for="(s, i) in current.sources" :key="i" class="source">
            <div class="source-head">
              <i class="dot" :class="stateOf(current.topic.id, s)?.state === 'unchanged' ? 'ok' : stateOf(current.topic.id, s) ? 'warn' : ''"
                 :title="stateOf(current.topic.id, s) ? `${STATE_LABEL[stateOf(current.topic.id, s).state] || stateOf(current.topic.id, s).state} · ${stateOf(current.topic.id, s).detail}` : 'comprobando…'"></i>
              <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="source-path" :title="`${s.repo}/${s.path} en ${short(s.commit)}`">{{ s.path }}</a>
              <span v-else class="source-path">{{ s.path }}</span>
            </div>
            <div class="source-meta">
              <span>{{ s.repo }} · {{ short(s.commit) }}</span>
              <button v-for="sec in s.sections" :key="sec" type="button" class="chip" @click="go(current.topic.id, sec)">#{{ sec }}</button>
            </div>
          </div>
          <div class="region-head group"><span>Citado en</span><span class="count">{{ current.cited.length }}</span></div>
          <p v-if="!current.cited.length" class="none">Ninguna tarea lo cita todavía.</p>
          <button v-for="c in current.cited" :key="c.slug" type="button" class="row stacked" @click="openTask(c.slug)">
            <span>{{ c.title }}</span><small class="row-desc">{{ c.slug }}</small>
          </button>
        </template>
        <p v-else class="none">Elegí un tema para ver sus fuentes y qué tareas lo citan.</p>
      </div>
    </aside>

    <footer class="statusbar">
      <span>{{ topics.length }} temas · {{ totalSources }} fuentes</span>
      <span v-if="check.running" class="statusbar-item">comprobando las fuentes contra main…</span>
      <span v-else-if="check.error" class="statusbar-item warn-text">{{ check.error }}</span>
      <span v-else-if="check.checkedAt" class="statusbar-item" :title="`comprobado a las ${fmtTime(check.checkedAt)}`">
        <i class="dot" :class="totalProblems ? 'warn' : 'ok'" aria-hidden="true"></i>
        {{ totalProblems ? `${totalProblems} fuente(s) para revisar` : 'todas al día con main' }}
      </span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar los temas" aria-label="Mostrar u ocultar los temas" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar las fuentes" aria-label="Mostrar u ocultar las fuentes" @click="toggleAux">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Todo lo demás —bandas, filas, grupos, conteos, pie— es de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.search { flex: none; padding: var(--space-2) var(--gutter) }
.search .input { width: 100% }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.topic-line { display: flex; align-items: center; gap: var(--space-2); min-width: 0 }
.topic-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.dot { flex: none; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.dot.ok { background: var(--knowledge-ok) }
.dot.warn { background: var(--knowledge-warn) }
.warn-text { color: var(--knowledge-warn) }
.statusbar-item { display: inline-flex; align-items: center; gap: var(--space-1) }
.source { padding: var(--space-2) var(--gutter); border-bottom: 1px solid var(--border) }
.source-head { display: flex; align-items: center; gap: var(--space-2); min-width: 0 }
.source-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--foreground) }
a.source-path { color: var(--primary-ink); text-decoration: none }
a.source-path:hover { text-decoration: underline }
.source-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); margin-top: var(--space-1); padding-left: var(--space-4); color: var(--fg-3); font-size: var(--text-xs) }
.chip { height: 18px; padding: 0 6px; border: 0; border-radius: 999px; background: var(--hover); color: var(--fg-2); font: inherit; font-size: var(--text-xs); cursor: pointer }
.chip:hover { color: var(--foreground) }
.empty-state { max-width: 60ch; padding: var(--space-6); color: var(--fg-2); font-size: var(--text-base); line-height: 1.6 }
.empty-state .empty-title { margin: 0 0 var(--space-2); font-size: var(--text-title); font-weight: 600; color: var(--foreground) }
.empty-state code { font-family: var(--font-mono); font-size: .9em }
</style>
