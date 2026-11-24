<script setup>
/* MINUTES: grabar una reunión sin tomar notas. A la izquierda, el botón de grabar y las grabaciones; al centro, la que
 * está abierta: en vivo (la última captura y lo que se va diciendo) o, ya frenada, el recordatorio, los momentos en
 * pantalla y la transcripción, con cada frase enlazada a la pantalla que estaba a la vista.
 *
 * Todo pasa por la API (`bin/minutes serve`, minutes/server.go), que usa las mismas funciones que el CLI. Lo grabado
 * no sale de la Mac. Rutas: `#/r/<id>`. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const list = ref([])
const state = ref({ current: '', phase: '', working: '', error: '' })
const detail = ref(null)
const loaded = ref(false)
const apiError = ref('')
const error = ref('')
const selected = ref('')
const title = ref('')
const confirmDelete = ref(false)
const now = ref(Date.now())

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Minutes': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`)
  return out
}

async function load() {
  try {
    const [l, s] = await Promise.all([api('/api/recordings'), api('/api/state')])
    list.value = l.recordings
    const before = state.value
    state.value = s
    apiError.value = ''
    if (s.error && s.error !== before.error) error.value = s.error
    if (!selected.value && list.value.length) selected.value = s.current || list.value[0].id
    if (selected.value) await loadDetail()
  } catch { apiError.value = 'No contesta la API de Minutes (bin/minutes serve).' }
  loaded.value = true
}
async function loadDetail() {
  if (!selected.value) { detail.value = null; return }
  try { detail.value = await api(`/api/recordings/${selected.value}`) } catch (err) { detail.value = null; error.value = err.message }
}

const recording = computed(() => !!state.value.current)
const busy = computed(() => !!state.value.phase)
const phaseText = computed(() => ({
  starting: 'Arrancando la grabadora…',
  finishing: 'Terminando de transcribir y armando el resumen (alrededor de un minuto)…',
  summarizing: 'Armando el resumen con Qwen3-VL en esta Mac…',
}[state.value.phase] || ''))

async function startRecording() {
  error.value = ''
  state.value = { ...state.value, phase: 'starting' }
  try {
    const r = await api('/api/start', { method: 'POST', body: { title: title.value } })
    title.value = ''
    go(`#/r/${r.id}`)
  } catch (err) { error.value = err.message }
  await load()
}
async function stopRecording() {
  error.value = ''
  try { await api('/api/stop', { method: 'POST' }) } catch (err) { error.value = err.message }
  await load()
}
async function resummarize() {
  error.value = ''
  try { await api(`/api/recordings/${selected.value}/summarize`, { method: 'POST' }) } catch (err) { error.value = err.message }
  await load()
}
async function remove() {
  if (!confirmDelete.value) { confirmDelete.value = true; return }
  confirmDelete.value = false
  error.value = ''
  try {
    await api(`/api/recordings/${selected.value}`, { method: 'DELETE' })
    selected.value = ''
    go('#/')
  } catch (err) { error.value = err.message }
  await load()
}

// ── lo abierto ──
const rec = computed(() => detail.value?.recording || null)
const timeline = computed(() => detail.value?.timeline || null)
const isLive = computed(() => rec.value?.recording)
const working = computed(() => busy.value && state.value.working === selected.value)
const segments = computed(() => timeline.value?.segments || detail.value?.segments || [])
const screens = computed(() => timeline.value?.screens || [])
const lastFrame = computed(() => { const f = detail.value?.frames || []; return f.length ? f[f.length - 1] : null })
const frameURL = (file) => `/api/recordings/${selected.value}/frames/${String(file).replace(/^frames\//, '')}`
const refers = computed(() => Object.fromEntries(screens.value.map((s) => [s.id, s.refers])))

function clock(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0'), ss = String(s % 60).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`
}
const who = (src) => (src === 'mic' ? 'yo' : 'reunión')
const liveSeconds = computed(() => {
  const r = list.value.find((x) => x.recording)
  if (!r) return 0
  return (now.value - Date.parse(r.started)) / 1000
})
function label(r) {
  if (r.title) return r.title
  const d = new Date(Date.parse(r.started) || 0)
  return isNaN(d) ? r.id : d.toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const when = (r) => { const d = new Date(Date.parse(r.started)); return isNaN(d) ? r.id : d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }

// El recordatorio que escribe el modelo: títulos, viñetas, negrita y las pantallas [P3] como enlaces.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
function md(text) {
  let html = '', list = false
  for (const raw of String(text || '').split('\n')) {
    const t = raw.trim()
    const item = /^[-*] /.test(t)
    if (list && !item) { html += '</ul>'; list = false }
    let e = esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/\[(P\d+)\]/g, '<a class="ref" href="#" data-screen="$1">$1</a>')
    if (!t) continue
    if (t.startsWith('#')) html += `<h3>${e.replace(/^#+\s*/, '')}</h3>`
    else if (item) { if (!list) { html += '<ul>'; list = true } html += `<li>${e.slice(2)}</li>` }
    else html += `<p>${e}</p>`
  }
  return list ? html + '</ul>' : html
}
function jump(id) {
  const el = document.getElementById(`screen-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('flash')
  setTimeout(() => el.classList.remove('flash'), 1200)
}
function onSummaryClick(e) {
  const a = e.target.closest('[data-screen]')
  if (a) { e.preventDefault(); jump(a.dataset.screen) }
}

// En vivo, la transcripción baja sola al final.
const liveBox = ref(null)
watch(() => segments.value.length, async () => {
  if (!isLive.value) return
  await nextTick()
  if (liveBox.value) liveBox.value.scrollTop = liveBox.value.scrollHeight
})

// ── rutas ──
function readRoute() {
  const m = location.hash.match(/^#\/r\/(.+)$/)
  selected.value = m ? decodeURIComponent(m[1]) : (state.value.current || list.value[0]?.id || '')
  confirmDelete.value = false
  error.value = ''
  loadDetail()
}
const go = (hash) => { if (location.hash === hash) readRoute(); else location.hash = hash }

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const sidebarOpen = ref(readSize('minutes.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('minutes.sidebar-w', 260))
const shownSidebar = computed(() => {
  const [w] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [{ size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 200) }])
  return w
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shownSidebar.value}px`, '--auxiliarybar-w': '0px' }))
const sidebarResize = {
  label: 'Ancho de las grabaciones', sign: 1, defaultValue: 260,
  min: () => cssSize('--sidebar-min', 200), max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shownSidebar.value,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('minutes.sidebar-open', v ? 1 : 0); if (v) saveSize('minutes.sidebar-w', sidebarW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shownSidebar.value; saveSize('minutes.sidebar-open', sidebarOpen.value ? 1 : 0) }

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const onWindowResize = () => { viewportW.value = window.innerWidth }
const themeToggle = ref(null)
let themeBinding = null
let poll = null
let tick = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  await load()
  readRoute()
  // Mientras se graba o se trabaja, cada 2 s; si no, cada 10 s (otra terminal pudo arrancar una).
  let n = 0
  poll = setInterval(() => { n++; if (recording.value || busy.value || n % 5 === 0) load() }, 2000)
  tick = setInterval(() => { now.value = Date.now() }, 1000)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  clearInterval(poll)
  clearInterval(tick)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars" @click="(e) => { if (confirmDelete && !e.target.closest('[data-confirm]')) confirmDelete = false }">
    <aside v-show="shownSidebar" class="sidebar" aria-label="Grabaciones">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head"><span>Minutes</span><span class="count">{{ list.length }}</span></div>
      <div class="region-body">
        <div class="recorder">
          <template v-if="recording">
            <div class="rec-live"><span class="rec-dot" aria-hidden="true"></span><span>Grabando</span><span class="rec-time">{{ clock(liveSeconds) }}</span></div>
            <button type="button" class="btn btn-sm rec-stop" :disabled="busy" @click="stopRecording">
              <span class="ui-icon" data-icon="stop" aria-hidden="true"></span>Frenar y resumir
            </button>
          </template>
          <form v-else @submit.prevent="startRecording">
            <input v-model="title" class="rec-title" placeholder="Nombre de la reunión (opcional)" aria-label="Nombre de la reunión" :disabled="busy">
            <button type="submit" class="btn btn-sm rec-start" :disabled="busy">
              <span class="ui-icon" data-icon="mic" aria-hidden="true"></span>{{ state.phase === 'starting' ? 'Arrancando…' : 'Grabar' }}
            </button>
          </form>
          <p class="rec-note">Pantalla, micrófono y audio de la reunión, sin quitarle el micrófono a Meet o Zoom. Todo queda en esta Mac.</p>
        </div>
        <a v-for="r in list" :key="r.id" class="rec-row" :class="{ on: r.id === selected }" :href="`#/r/${r.id}`">
          <span class="ui-icon" :data-icon="r.recording ? 'mic' : r.has_summary ? 'paper' : 'audio'" :class="{ 'is-live': r.recording }" aria-hidden="true"></span>
          <span class="rec-name"><span class="rec-label">{{ label(r) }}</span><span class="rec-sub">{{ r.title ? when(r) + ' · ' : '' }}{{ clock(r.seconds) }} · {{ plural(r.frames, 'captura', 'capturas') }}</span></span>
        </a>
        <div v-if="loaded && !list.length && !apiError" class="rec-empty">Todavía no hay grabaciones.</div>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ rec ? label(rec) : 'Minutes' }}</span>
        <span v-if="rec && !isLive" class="head-sub">{{ when(rec) }} · {{ clock(rec.seconds) }}</span>
        <span class="spacer"></span>
        <template v-if="rec && !isLive">
          <button type="button" class="region-action" :disabled="busy" title="Volver a armar el resumen" aria-label="Volver a armar el resumen" @click="resummarize"><span class="ui-icon" data-icon="refresh" aria-hidden="true"></span></button>
          <button v-if="confirmDelete" type="button" class="confirm" data-confirm @click="remove">Borrar la grabación</button>
          <button v-else type="button" class="region-action" data-confirm title="Borrar la grabación (capturas, audio y texto)" aria-label="Borrar la grabación" :disabled="busy" @click="remove"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
        </template>
      </div>
      <div class="region-body">
        <p v-if="error" class="alert alert-bad" role="alert">{{ error }}</p>
        <p v-if="working" class="alert working">{{ phaseText }}</p>

        <div v-if="loaded && !rec" class="empty"><div class="empty-head">
          <div class="empty-title">{{ apiError || 'Grabá una reunión' }}</div>
          <div v-if="!apiError" class="empty-desc">Tocá «Grabar» antes de que empiece. Al frenar queda un recordatorio con lo dicho, las pantallas que se mostraron y qué frase habla de cuál.</div>
        </div></div>

        <!-- en vivo -->
        <div v-else-if="isLive" class="live">
          <figure class="live-frame">
            <img v-if="lastFrame" :src="frameURL(lastFrame.file)" alt="La última captura">
            <figcaption>{{ lastFrame ? `Última captura distinta, a los ${clock(lastFrame.t)} · ${plural(detail.frames.length, 'captura', 'capturas')}` : 'Esperando la primera captura…' }}</figcaption>
          </figure>
          <div ref="liveBox" class="live-text">
            <div v-for="(g, i) in segments" :key="i" class="line"><span class="t">{{ clock(g.start) }}</span><span class="who">{{ who(g.source) }}</span><span>{{ g.text }}</span></div>
            <div class="line pending">{{ segments.length ? 'El texto llega unos 15 s detrás de lo dicho.' : 'La transcripción aparece acá unos 15 s después de que alguien hable.' }}</div>
          </div>
        </div>

        <!-- frenada -->
        <div v-else-if="rec" class="doc">
          <section v-if="timeline" class="summary" @click="onSummaryClick">
            <div class="doc-meta">{{ plural(timeline.frames, 'captura distinta', 'capturas distintas') }} · {{ plural(screens.length, 'momento', 'momentos') }} en pantalla · resumen: {{ timeline.model }}</div>
            <div class="md" v-html="md(timeline.summary)"></div>
          </section>
          <section v-else-if="!working" class="summary">
            <p class="doc-meta">Todavía no tiene resumen.</p>
            <button type="button" class="btn btn-sm" :disabled="busy" @click="resummarize">Armar el resumen</button>
          </section>

          <template v-if="screens.length">
            <h2>Momentos en pantalla</h2>
            <div class="screens">
              <article v-for="s in screens" :id="`screen-${s.id}`" :key="s.id" class="screen">
                <a :href="frameURL(s.file)" target="_blank"><img :src="frameURL(s.file)" :alt="s.id" loading="lazy"></a>
                <div class="screen-body">
                  <div class="screen-when"><strong>{{ s.id }}</strong> · {{ clock(s.start) }}–{{ clock(s.end) }} <span class="stars">{{ '★'.repeat(s.key || 0) }}</span></div>
                  <div>{{ s.seen || '(sin descripción)' }}</div>
                  <div v-if="s.refers" class="said">Se habló de esto: «{{ String(s.evidence || '').replace(/^[«»"“”\s]+|[«»"“”\s]+$/g, '') }}»</div>
                </div>
              </article>
            </div>
          </template>

          <h2>Transcripción</h2>
          <div v-if="!segments.length" class="doc-meta">No se transcribió nada{{ detail?.pending ? ` (faltan ${detail.pending} tramos)` : '' }}.</div>
          <table v-else class="transcript">
            <tr v-for="(g, i) in segments" :key="i" :class="{ on: g.screen && refers[g.screen] }">
              <td class="t">{{ clock(g.start) }}</td>
              <td class="who">{{ who(g.source) }}</td>
              <td>{{ g.text }}
                <a v-if="g.screen" class="ref" href="#" @click.prevent="jump(g.screen)">{{ g.screen }}</a>
                <a v-else-if="g.frame" class="ref muted" :href="frameURL(g.frame)" target="_blank" title="Lo que estaba en pantalla">▣</a>
              </td>
            </tr>
          </table>
        </div>
      </div>
    </main>

    <footer class="statusbar">
      <span>{{ apiError || (recording ? `● grabando · ${clock(liveSeconds)}` : phaseText || `${plural(list.length, 'grabación', 'grabaciones')} · Whisper y Qwen3-VL en esta Mac`) }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shownSidebar" title="Mostrar u ocultar las grabaciones" aria-label="Mostrar u ocultar las grabaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
