<script setup>
/* KNOWLEDGE: el vigía de la biblioteca. No muestra el contenido de knowledge: dice si está al día con main y, cuando
 * queda vieja, cómo se pone al día, paso a paso, como un workflow de GitHub. A la izquierda las corridas (en curso,
 * en cola, las anteriores); al centro la elegida, con sus diez pasos; a la derecha la biblioteca y el vigía.
 *
 * Lo corre el servidor (knowledge-flow/server), aunque esto esté cerrado. La ruta es `#/run/<n>`; sin ella, la última. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const state = ref(null)
const run = ref(null)
const apiError = ref('')
const routeId = ref(0)
const tick = ref(Date.now())

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}
async function load() {
  try {
    state.value = await api('/api/state')
    apiError.value = ''
    const id = routeId.value || state.value.runs?.[0]?.id
    run.value = id ? await api(`/api/runs/${id}`) : null
  } catch { apiError.value = 'No contesta la API. ¿Está arriba? (make knowledge-flow, o make knowledge-flow-install para que corra de fondo)' }
}
// Borrar: el primer toque pregunta en la misma línea y el segundo borra (los diálogos del navegador no siempre salen
// dentro de Cockpit). Sólo las frenadas y las falladas: las que pasaron están atadas a un commit.
const confirming = ref('')
const deleteError = ref('')
const canDelete = (r) => r && (r.state === 'failed' || r.state === 'stopped')
async function deleteRun(id) {
  if (confirming.value !== `run-${id}`) { confirming.value = `run-${id}`; deleteError.value = ''; return }
  confirming.value = ''
  try {
    await api(`/api/runs/${id}`, { method: 'DELETE', headers: { 'X-Knowledge': '1' } })
    if (routeId.value === id) location.hash = ''
    await load()
  } catch (e) { deleteError.value = e.message }
}
async function cleanSuperseded() {
  if (confirming.value !== 'clean') { confirming.value = 'clean'; deleteError.value = ''; return }
  confirming.value = ''
  try {
    await api('/api/runs/clean', { method: 'POST', headers: { 'X-Knowledge': '1' } })
    if (runs.value.find((r) => r.id === routeId.value)?.superseded) location.hash = ''
    await load()
  } catch (e) { deleteError.value = e.message }
}
// Retomar una frenada: corre otra vez desde el paso donde frenó, con lo que se decidió a mano.
const resumeError = ref('')
const resuming = ref(false)
async function resumeRun(id) {
  resumeError.value = ''
  resuming.value = true
  try {
    await api(`/api/runs/${id}/resume`, { method: 'POST', headers: { 'X-Knowledge': '1' } })
    setTimeout(load, 800)
  } catch (e) { resumeError.value = e.message } finally { setTimeout(() => { resuming.value = false }, 1500) }
}
// El aviso de una corrida frenada o fallada: el paso, el motivo y qué hacer, en vez del resultado pelado.
const halt = computed(() => {
  const r = run.value
  if (!r || (r.state !== 'stopped' && r.state !== 'failed')) return null
  const st = r.steps.find((s) => s.state === 'stopped' || s.state === 'failed')
  const reason = (r.result || '').replace(/^(frenó|falló) en «[^»]*»:\s*/, '')
  const dir = `knowledge-flow/.data/runs/${r.id}/drift`
  const HELP = {
    final: `Decidí esas secciones a mano en ${dir}/overrides.json (veredicto «sigue» o «cambia» con su texto nuevo) y, si main borró un archivo y lo reemplazó, anotalo en reemplazos.json. Después, Retomar.`,
    verify: `Corregí el texto en ${dir}/overrides.json y Retomar: vuelve a juntar y a verificar.`,
    apply: 'Otra sesión tiene cambios sin commitear en esos temas. Commitealos o descartalos y Retomar.',
  }
  const isLast = runs.value[0]?.id === r.id
  return {
    stopped: r.state === 'stopped',
    title: `${r.state === 'stopped' ? 'Frenó' : 'Falló'} en «${st?.label || '?'}»`,
    reason,
    help: r.state === 'stopped' ? HELP[st?.id] || 'Resolvé lo que la frenó y Retomar.' : '',
    canResume: r.state === 'stopped' && isLast && !state.value?.running,
    pending: state.value?.resumePending === r.id,
  }
})
async function lookNow() { try { await api('/api/look', { method: 'POST' }); setTimeout(load, 800) } catch { /* lo dice el pie */ } }

function readRoute() {
  const m = location.hash.match(/^#\/run\/(\d+)/)
  routeId.value = m ? Number(m[1]) : 0
  load()
}
function pick(id) { location.hash = `#/run/${id}` }

// ── lo que se ve ──
const runs = computed(() => state.value?.runs || [])
const look = computed(() => state.value?.look || {})
const runningRun = computed(() => runs.value.find((r) => r.state === 'running'))
// Las frenadas o falladas que ya no piden nada (pasó otra después y sus temas están al día) se esconden: son ruido.
// «Ver todas» las muestra; la elegida por la ruta se ve igual.
const showAll = ref(false)
const hiddenCount = computed(() => runs.value.filter((r) => r.superseded).length)
const pastByDay = computed(() => {
  const groups = []
  for (const r of runs.value.filter((x) => x.state !== 'running' && (showAll.value || !x.superseded || x.id === run.value?.id))) {
    const label = dayLabel(r.startedAt)
    let g = groups.find((x) => x.label === label)
    if (!g) groups.push((g = { label, runs: [] }))
    g.runs.push(r)
  }
  return groups
})
const STATE_TEXT = { running: 'en curso', passed: 'al día', stopped: 'frenó', failed: 'falló' }
const stepCount = computed(() => (run.value?.steps || []).filter((s) => s.state === 'done' || s.state === 'skipped').length)

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 864e5)
  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' })
}
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
function dur(from, to) {
  if (!from) return ''
  const s = Math.max(0, Math.round(((to ? new Date(to) : new Date(tick.value)) - new Date(from)) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)} h ${m % 60} min`
}
const runDur = (r) => dur(r.startedAt, r.finishedAt)
// Cuánto lleva la mirada a main en curso (el servidor dice desde cuándo).
const lookingFor = computed(() => (look.value.lookingSince ? dur(look.value.lookingSince) : '…'))
const topicsOf = (changes) => {
  const by = new Map()
  for (const c of changes || []) by.set(c.topic, (by.get(c.topic) || 0) + 1)
  return [...by.entries()].map(([topic, n]) => ({ topic, n }))
}
const staleTopics = computed(() => topicsOf(look.value.changes))
const queuedTopics = computed(() => topicsOf(look.value.queued))
const libState = computed(() => {
  if (look.value.error) return { cls: 'is-bad-bg', text: 'No pudo mirar main' }
  if (state.value?.running) return { cls: 'is-warn-bg', text: 'Poniéndose al día', spin: true }
  if (look.value.looking) return { cls: 'is-idle-bg', text: `Mirando main · ${lookingFor.value}`, spin: true }
  // «esperando al modelo» se arregla solo (arranca apenas conteste); «frenada» espera que la mires.
  if (look.value.waiting?.startsWith('esperando al modelo')) return { cls: 'is-warn-bg', text: 'Esperando al modelo' }
  if (look.value.waiting) return { cls: 'is-bad-bg', text: 'Esperando que mires una corrida' }
  if (staleTopics.value.length) return { cls: 'is-warn-bg', text: 'Vieja' }
  return look.value.at ? { cls: 'is-ok-bg', text: 'Al día con main' } : { cls: 'is-idle-bg', text: 'Todavía no miró' }
})
const fresh = computed(() => Math.max(0, (look.value.sources || 0) - (look.value.changes || []).length))
const MODEL = { claude: 'Claude (el de Cockpit)', gemini: 'Gemini (el de Cockpit)' }

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const sidebarOpen = ref(readSize('knowledge.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('knowledge.sidebar-w', 280))
const auxOpen = ref(readSize('knowledge.aux-open', 1) !== 0)
const auxW = ref(readSize('knowledge.aux-w', 300))
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
  label: 'Ancho de las corridas', sign: 1, defaultValue: 280,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('knowledge.sidebar-open', v ? 1 : 0); if (v) saveSize('knowledge.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho de la biblioteca', sign: -1, defaultValue: 300,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('knowledge.aux-open', v ? 1 : 0); if (v) saveSize('knowledge.aux-w', auxW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('knowledge.sidebar-open', sidebarOpen.value ? 1 : 0) }
function toggleAux() { auxOpen.value = !shown.value.aux; saveSize('knowledge.aux-open', auxOpen.value ? 1 : 0) }
const onWindowResize = () => { viewportW.value = window.innerWidth }

// El sondeo: cada 2 s mientras corre algo (para ver los pasos en vivo), cada 15 s si no.
let timer = null
let clockTimer = null
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(async () => { if (!document.hidden) await load(); schedule() }, state.value?.running ? 2000 : 15000)
}
const onVisibility = () => { if (!document.hidden) load() }
const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  document.addEventListener('visibilitychange', onVisibility)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  clockTimer = setInterval(() => { tick.value = Date.now() }, 1000)
  readRoute()
  schedule()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  document.removeEventListener('visibilitychange', onVisibility)
  clearTimeout(timer)
  clearInterval(clockTimer)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Corridas">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Corridas</span>
        <span class="count">{{ runs.length }}</span>
      </div>
      <div class="region-body">
        <!-- La mirada a main tarda (traer ~36 clones y comprobar ~1.300 fuentes, unos minutos): se ve que está trabajando,
             no que se colgó. -->
        <template v-if="look.looking && !runningRun">
          <div class="group-label">En curso</div>
          <div class="run-row" style="cursor: default">
            <svg class="st st-spin" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--primary)" stroke-width="2" stroke-dasharray="26 12"/></svg>
            <span class="run-title">Mirando main</span><span class="run-time">{{ lookingFor }}</span>
            <span class="run-desc">trae los clones sólo-main y comprueba qué fuentes cambiaron; si hay alguna, arranca una corrida</span>
          </div>
        </template>
        <template v-if="runningRun">
          <div class="group-label">En curso</div>
          <button type="button" class="run-row" :class="{ on: run?.id === runningRun.id }" @click="pick(runningRun.id)">
            <svg class="st st-spin" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--primary)" stroke-width="2" stroke-dasharray="26 12"/></svg>
            <span class="run-title">#{{ runningRun.id }} · {{ runningRun.title }}</span><span class="run-time">{{ runDur(runningRun) }}</span>
          </button>
        </template>
        <template v-if="queuedTopics.length">
          <div class="group-label">En cola</div>
          <div class="run-row" style="cursor: default">
            <svg class="st" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--fg-3)" stroke-width="2"/></svg>
            <span class="run-title">{{ queuedTopics.length }} {{ queuedTopics.length === 1 ? 'tema' : 'temas' }} esperando</span><span class="run-time">espera</span>
            <span class="run-desc">entraron mientras corría la #{{ runningRun?.id }}: arranca cuando termine</span>
          </div>
        </template>
        <template v-for="g in pastByDay" :key="g.label">
          <div class="group-label">{{ g.label }}</div>
          <button v-for="r in g.runs" :key="r.id" type="button" class="run-row" :class="{ on: run?.id === r.id }" @click="pick(r.id)">
            <svg v-if="r.state === 'passed'" class="st" viewBox="0 0 16 16" aria-label="al día"><circle cx="8" cy="8" r="7" fill="var(--status-ok)"/><path d="M4.5 8.2l2.2 2.2 4.8-4.8" stroke="#123" stroke-width="1.8" fill="none"/></svg>
            <svg v-else class="st" viewBox="0 0 16 16" :aria-label="STATE_TEXT[r.state]"><circle cx="8" cy="8" r="7" :fill="r.state === 'stopped' ? 'var(--status-warn)' : 'var(--status-bad)'"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#123" stroke-width="1.8"/></svg>
            <span class="run-title">#{{ r.id }} · {{ r.title }}<span v-if="r.resumed" class="tag" title="Se retomó desde el paso donde cayó o frenó"> retomada</span><span v-if="r.superseded" class="tag"> superada</span></span><span class="run-time">{{ runDur(r) }}</span>
            <span class="run-desc">{{ r.result }}</span>
          </button>
        </template>
        <button v-if="hiddenCount" type="button" class="run-row more" @click="showAll = !showAll">
          <span class="run-title">{{ showAll ? 'Ocultar las superadas' : `Ver todas (${hiddenCount} ${hiddenCount === 1 ? 'superada oculta' : 'superadas ocultas'})` }}</span>
        </button>
        <button v-if="hiddenCount" type="button" class="run-row more" :class="{ asking: confirming === 'clean' }" @click="cleanSuperseded">
          <span class="run-title">{{ confirming === 'clean' ? `¿Borrar las ${hiddenCount}? Tocá de nuevo para confirmar` : `Borrar las superadas (${hiddenCount})` }}</span>
        </button>
        <div v-if="deleteError" class="alert alert-bad" style="margin: var(--space-2)"><div class="alert-desc"><p>{{ deleteError }}</p></div></div>
        <div v-if="state && !runs.length" class="empty">
          <div class="empty-head">
            <div class="empty-title">Sin corridas</div>
            <div class="empty-desc">Arranca una sola cuando una fuente de knowledge cambia en main.</div>
          </div>
        </div>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ run ? `Corrida #${run.id}` : 'Knowledge' }}</span>
        <span v-if="run" class="count">{{ stepCount }} de {{ run.steps.length }} pasos</span>
        <template v-if="canDelete(run)">
          <button v-if="confirming === `run-${run.id}`" type="button" class="btn btn-sm btn-destructive" @click="deleteRun(run.id)">Borrar la #{{ run.id }}</button>
          <button v-if="confirming === `run-${run.id}`" type="button" class="btn btn-sm btn-outline" @click="confirming = ''">Cancelar</button>
          <button v-else type="button" class="region-action" title="Borrar esta corrida (no pasó: no hay nada que perder)" :aria-label="`Borrar la corrida #${run.id}`" @click="deleteRun(run.id)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
        </template>
      </div>
      <div class="region-body">
        <template v-if="run">
          <div class="run-head">
            <svg v-if="run.state === 'running'" class="st st-spin" viewBox="0 0 16 16" style="width: 20px; height: 20px" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--primary)" stroke-width="2" stroke-dasharray="26 12"/></svg>
            <span v-else class="dotc" :class="run.state === 'passed' ? 'is-ok-bg' : run.state === 'stopped' ? 'is-warn-bg' : 'is-bad-bg'"></span>
            <h1>#{{ run.id }} · {{ run.topics.length }} {{ run.topics.length === 1 ? 'tema quedó viejo' : 'temas quedaron viejos' }}</h1>
          </div>
          <div class="run-meta">
            Arrancó el {{ dayLabel(run.startedAt).toLowerCase() }} a las <b>{{ clock(run.startedAt) }}</b> porque cambiaron <b>{{ run.changes.length }} {{ run.changes.length === 1 ? 'fuente' : 'fuentes' }}</b> en main:
            <b>{{ run.topics.join(', ') }}</b><template v-if="run.model"> · modelo <b>{{ ({ claude: 'Claude', gemini: 'Gemini' })[run.model] || run.model }}</b></template><template v-if="run.commit"> · commit <b>{{ run.commit }}</b></template>
          </div>
          <div v-if="run.state === 'running' && queuedTopics.length" class="alert alert-warn">
            <div class="alert-desc"><p>Mientras corre entraron {{ look.queued.length }} {{ look.queued.length === 1 ? 'cambio' : 'cambios' }} más. No se mezclan con esta corrida: arrancan en otra cuando termine.</p></div>
          </div>
          <div v-if="halt" class="alert halt" :class="halt.stopped ? 'alert-warn' : 'alert-bad'" role="status">
            <span class="alert-icon" aria-hidden="true">{{ halt.stopped ? '⏸' : '✕' }}</span>
            <div class="alert-title">{{ halt.title }}</div>
            <div class="alert-desc">
              <p>{{ halt.reason }}</p>
              <p v-if="halt.help" class="halt-help">{{ halt.help }}</p>
              <div v-if="halt.pending" class="halt-actions">
                <svg class="st st-spin" viewBox="0 0 16 16" style="width: 14px; height: 14px" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--primary)" stroke-width="2" stroke-dasharray="26 12"/></svg>
                <span>{{ look.looking ? `En cola para retomar: arranca apenas termine la mirada a main (lleva ${lookingFor})` : 'Retomando…' }}</span>
              </div>
              <div v-else-if="halt.canResume" class="halt-actions">
                <button type="button" class="btn btn-sm" :disabled="resuming" @click="resumeRun(run.id)">{{ resuming ? 'Retomando…' : `Retomar la #${run.id}` }}</button>
                <span v-if="resumeError" class="halt-error">{{ resumeError }}</span>
              </div>
            </div>
          </div>
          <div class="steps">
            <div v-for="(s, i) in run.steps" :key="s.id" class="step" :class="`is-${s.state}`">
              <div class="step-row">
                <span class="step-n">{{ i + 1 }}</span>
                <svg v-if="s.state === 'running'" class="st st-spin" viewBox="0 0 16 16" aria-label="corriendo"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--primary)" stroke-width="2" stroke-dasharray="26 12"/></svg>
                <svg v-else-if="s.state === 'done'" class="st" viewBox="0 0 16 16" aria-label="listo"><circle cx="8" cy="8" r="7" fill="var(--status-ok)"/><path d="M4.5 8.2l2.2 2.2 4.8-4.8" stroke="#123" stroke-width="1.8" fill="none"/></svg>
                <svg v-else-if="s.state === 'stopped' || s.state === 'failed'" class="st" viewBox="0 0 16 16" :aria-label="s.state"><circle cx="8" cy="8" r="7" :fill="s.state === 'stopped' ? 'var(--status-warn)' : 'var(--status-bad)'"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#123" stroke-width="1.8"/></svg>
                <svg v-else-if="s.state === 'skipped'" class="st" viewBox="0 0 16 16" aria-label="no hizo falta"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--fg-3)" stroke-width="2"/><path d="M5 8h6" stroke="var(--fg-3)" stroke-width="2"/></svg>
                <svg v-else class="st" viewBox="0 0 16 16" aria-label="en espera"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--fg-3)" stroke-width="2"/></svg>
                <span>{{ s.label }}</span>
                <span class="step-who">{{ s.who }}</span>
                <span class="step-dur">{{ s.startedAt ? dur(s.startedAt, s.finishedAt) : '' }}</span>
              </div>
              <div v-if="s.summary || s.now || s.detail?.length" class="step-log">
                <span v-if="s.now">ahora: <code>{{ s.now }}</code></span>
                <span v-if="s.summary">{{ s.summary }}</span>
                <ul v-if="s.detail?.length" class="step-detail"><li v-for="(d, k) in s.detail" :key="k">{{ d }}</li></ul>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="empty">
          <div class="empty-head">
            <div class="empty-title">{{ apiError ? 'Sin API' : 'La biblioteca está al día' }}</div>
            <div class="empty-desc">{{ apiError || 'Knowledge mira main cada 30 minutos. Cuando una fuente cambie, arranca una corrida y se ve acá paso a paso.' }}</div>
          </div>
        </div>
      </div>
    </main>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="La biblioteca">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>La biblioteca</span>
        <button type="button" class="region-action" :disabled="look.looking" title="Mirar main ya" aria-label="Mirar main ya" @click="lookNow">
          <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
        </button>
      </div>
      <div class="region-body">
        <div class="lib">
          <div class="run-time"><svg v-if="libState.spin" class="st st-spin" viewBox="0 0 16 16" style="width: 12px; height: 12px; vertical-align: -1px" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--primary)" stroke-width="2" stroke-dasharray="26 12"/></svg><span v-else class="dotc" :class="libState.cls"></span> {{ libState.text }}</div>
          <div class="lib-big">{{ !look.at && look.looking ? 'Mirando main…' : staleTopics.length ? `${staleTopics.length} de ${look.topics || '…'} temas viejos` : `${look.topics || '…'} temas al día` }}</div>
          <div class="run-time">{{ fresh.toLocaleString('es-CO') }} de {{ (look.sources || 0).toLocaleString('es-CO') }} fuentes al día con main</div>
        </div>
        <div v-if="look.waiting" class="alert alert-bad" style="margin: 0 var(--space-2) var(--space-2)"><div class="alert-desc"><p>{{ look.waiting }}</p></div></div>
        <div v-if="look.error" class="alert alert-bad" style="margin: 0 var(--space-2) var(--space-2)"><div class="alert-desc"><p>{{ look.error }}</p></div></div>
        <div class="group-label">El vigía</div>
        <div class="kv"><span>Mira main</span><span>cada {{ state?.every || 30 }} min</span></div>
        <div class="kv"><span>Última mirada</span><span>{{ look.looking ? 'mirando…' : clock(look.at) || '—' }}</span></div>
        <div class="kv"><span>Próxima</span><span>{{ state?.running ? 'al terminar la corrida' : clock(look.next) || '—' }}</span></div>
        <div class="kv"><span>Modelo</span><span>{{ MODEL[state?.model] || state?.model || '—' }}</span></div>
        <div class="kv"><span>Aplica</span><span>solo, si la verificación sale limpia</span></div>
        <template v-if="staleTopics.length">
          <div class="group-label">Viejos ahora</div>
          <div v-for="t in staleTopics" :key="t.topic" class="topic"><span class="dotc is-warn-bg"></span><span>{{ t.topic }}</span><span class="tag">{{ t.n }} {{ t.n === 1 ? 'fuente' : 'fuentes' }}</span></div>
        </template>
        <template v-if="queuedTopics.length">
          <div class="group-label">En la cola</div>
          <div v-for="t in queuedTopics" :key="t.topic" class="topic"><span class="dotc is-idle-bg"></span><span>{{ t.topic }}</span><span class="tag">{{ t.n }} {{ t.n === 1 ? 'fuente' : 'fuentes' }}</span></div>
        </template>
      </div>
    </aside>

    <footer class="statusbar">
      <span>{{ apiError || (look.looking ? `mirando main · ${lookingFor}` : look.at ? `miró main a las ${clock(look.at)} · ${look.fetchSec?.toFixed(0)} s de fetch y ${look.checkSec?.toFixed(0)} s de comprobación` : 'todavía no miró main') }}</span>
      <button type="button" class="statusbar-item" :disabled="look.looking" title="Que mire main ya (mira solo cada 30 min)" @click="lookNow">Mirar ahora</button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las corridas" aria-label="Mostrar u ocultar las corridas" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar la biblioteca" aria-label="Mostrar u ocultar la biblioteca" @click="toggleAux">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
