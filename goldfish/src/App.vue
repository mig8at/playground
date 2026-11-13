<script setup>
/* goldfish · la interfaz: el REGISTRO de lo que se validó con Elephant-Goldfish. Las validaciones las corre la sesión
 * desde la consola (make goldfish-check, el paso previo a publicar; make goldfish-run PR=<url> para un PR abierto):
 * acá sólo se leen. Nada de botones que validen o prueben.
 *
 * A la izquierda, un bloque por repo con sus validaciones (la más nueva arriba), cada una con su resumen: qué quedó para
 * atender, qué para mirar, si se comprobó corriendo. A la derecha, la elegida: los pasos con su costo, los hallazgos con
 * su veredicto y su evidencia, y la descripción que se revisó. En el pie, la base a la que apunta (main, qa, develop,
 * staging). La validación y la base elegidas viven en la URL. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, bindMenu, readHashRoute, hashRoute, setRoute } from './workbench.js'

const VERDICTS = [
  { id: 'confirmado', label: 'Para atender', hint: 'confirmados: de este cambio, antes de publicar' },
  { id: 'plausible', label: 'Para mirar', hint: 'dependen de algo que no se ve leyendo' },
  { id: '', label: 'Sin veredicto', hint: 'el elephant no alcanzó a juzgarlos' },
  { id: 'fuera de alcance', label: 'Fuera de alcance', hint: 'no son de este cambio: no se arreglan acá' },
  { id: 'descartado', label: 'Descartados', hint: 'no aplican, con su evidencia' },
]
const FROM = { intent: 'goldfish · descripción vs cambio', risk: 'goldfish · riesgos', context: 'elephant · contexto' }
const STAGE_MARK = { pending: '·', running: '…', done: '✓', failed: '✗', skipped: '–' }
const PROOF_LABEL = { comprobado: 'comprobado corriendo', refutado: 'refutado corriendo', 'sin probar': 'sin probar' }
const BASES = ['main', 'qa', 'develop', 'staging']
const BASE_LABEL = { main: 'main · producción', qa: 'qa · lo que se prueba en qa', develop: 'develop · el dev compartido', staging: 'staging' }
const MAIN_REPOS = ['legacy-backend', 'frontend-monorepo', 'legacy-application']

async function getJSON(path) {
  const res = await fetch(path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── la ruta: #/?run=<id>&base=qa ──
const baseOf = (v) => (BASES.includes(v) ? v : 'main')
const route = readHashRoute()
const runId = ref(route.params.get('run') || '')
const base = ref(baseOf(route.params.get('base')))
function writeRoute(push) {
  setRoute(hashRoute([], { run: runId.value, base: base.value }, { run: '', base: 'main' }), { push })
}
function onHashChange() {
  const r = readHashRoute()
  runId.value = r.params.get('run') || ''
  base.value = baseOf(r.params.get('base'))
}

// ── las validaciones ──
const runs = ref([])
const loading = ref(false)
const loadError = ref('')
let listTimer = 0
async function loadRuns() {
  clearTimeout(listTimer)
  loading.value = !runs.value.length
  try {
    runs.value = (await getJSON('/api/runs')).runs || []
    loadError.value = ''
  } catch (e) { loadError.value = String(e.message || e) } finally { loading.value = false }
  // si alguna sigue corriendo (la consola la está corriendo), se vuelve a mirar seguido
  listTimer = setTimeout(loadRuns, runs.value.some((r) => r.status === 'running') ? 3000 : 30000)
}
const inBase = (r) => r.base === base.value
const blocks = computed(() => {
  const by = {}
  for (const r of runs.value.filter(inBase)) (by[r.repo] ||= []).push(r)
  const names = [...new Set([...MAIN_REPOS, ...Object.keys(by).sort()])]
  return names.map((name) => ({ name, runs: (by[name] || []).sort((a, b) => b.started.localeCompare(a.started)) }))
})
const shownCount = computed(() => runs.value.filter(inBase).length)
const collapsed = ref(new Set(JSON.parse(readStore('goldfish.collapsed') || '[]')))
function readStore(k) { try { return localStorage.getItem(k) } catch { return null } }
function toggleBlock(name) {
  const s = new Set(collapsed.value)
  if (s.has(name)) s.delete(name); else s.add(name)
  collapsed.value = s
  try { localStorage.setItem('goldfish.collapsed', JSON.stringify([...s])) } catch { /* sólo en esta pestaña */ }
}
function pick(r) { runId.value = r.id; writeRoute(true) }
// el resumen de una validación, en una línea
function summaryOf(r) {
  if (r.status === 'running') return 'corriendo en la consola…'
  if (r.status === 'failed') return 'no terminó'
  const v = r.verdicts || {}
  const parts = []
  if (v.confirmado) parts.push(`${v.confirmado} para atender`)
  if (v.plausible) parts.push(`${v.plausible} para mirar`)
  if (!parts.length) parts.push('nada para atender')
  const p = r.proofs || {}
  if (p.comprobado || p.refutado) parts.push(`corrido: ${[p.comprobado && `${p.comprobado} comprobados`, p.refutado && `${p.refutado} refutados`].filter(Boolean).join(', ')}`)
  return parts.join(' · ')
}
const stateOf = (r) => (r.status !== 'done' ? r.status : r.verdicts?.confirmado ? 'attend' : r.verdicts?.plausible ? 'look' : 'clear')

// ── la elegida ──
const run = ref(null)
const runError = ref('')
let pollTimer = 0
async function loadRun() {
  clearTimeout(pollTimer)
  if (!runId.value) { run.value = null; return }
  try {
    run.value = await getJSON(`/api/runs/${encodeURIComponent(runId.value)}`)
    runError.value = ''
  } catch (e) { run.value = null; runError.value = String(e.message || e) }
  if (run.value?.status === 'running' || run.value?.proving) pollTimer = setTimeout(loadRun, 2000)
}
watch(runId, loadRun)
const listed = computed(() => runs.value.find((r) => r.id === runId.value) || null)
const byVerdict = computed(() => {
  const fs = run.value?.findings || []
  const sev = { alta: 0, media: 1, baja: 2 }
  return VERDICTS.map((v) => ({ ...v, items: fs.filter((f) => (f.verdict || '') === v.id).sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3)) }))
    .filter((v) => v.items.length)
})
const proposalOpen = ref(false)

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const fmtSecs = (ms) => (ms ? `${Math.round(ms / 1000)} s` : '')
const usd = (n) => (n ? `US$${n.toFixed(2)}` : '')
const loc = (f) => (f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : '')

// ── la base, en el pie (como el ambiente en ecommerce) ──
const baseItems = computed(() => BASES.map((b) => ({ id: b, label: BASE_LABEL[b], selected: base.value === b })))
watch(base, () => writeRoute(false))
const baseTrigger = ref(null)
let baseMenu = null
watch(baseItems, () => baseMenu?.refresh(), { deep: true, flush: 'post' })

// ── las regiones ──
const sidebarOpen = ref(readSize('goldfish.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('goldfish.sidebar-w', 360))
const viewportW = ref(window.innerWidth)
const onWindowResize = () => { viewportW.value = window.innerWidth }
const shown = computed(() => {
  const [sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  return { sidebar }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--panel-h': '0px' }))
const sidebarResize = {
  label: 'Ancho de la lista de validaciones', sign: 1, defaultValue: 360,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('goldfish.sidebar-open', v ? 1 : 0); if (v) saveSize('goldfish.sidebar-w', sidebarW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('goldfish.sidebar-open', sidebarOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  baseMenu = bindMenu(baseTrigger.value, {
    label: 'A qué rama apuntan las validaciones que se ven', getItems: () => baseItems.value,
    onSelect: (id) => { base.value = id },
  })
  loadRuns()
  loadRun()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearTimeout(pollTimer)
  clearTimeout(listTimer)
  themeBinding?.destroy?.()
  baseMenu?.destroy()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Validaciones por repo">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Validaciones</span>
        <span class="count">{{ shownCount }}</span>
      </div>
      <div class="region-body blocks">
        <p v-if="loadError" class="none hot">{{ loadError }}</p>
        <p v-else-if="loading" class="none">Leyendo las validaciones…</p>
        <section v-for="b in blocks" :key="b.name" class="block" :aria-label="b.name">
          <button type="button" class="block-head" :aria-expanded="!collapsed.has(b.name)" @click="toggleBlock(b.name)">
            <span class="ui-icon chevron" :class="{ open: !collapsed.has(b.name) }" data-icon="chevron" aria-hidden="true"></span>
            <span class="block-name">{{ b.name }}</span>
            <span class="count">{{ b.runs.length }}</span>
          </button>
          <ul v-if="!collapsed.has(b.name)" class="runs-list">
            <li v-if="!b.runs.length" class="empty-block">Nada validado contra {{ base }}</li>
            <li v-for="r in b.runs" :key="r.id">
              <button type="button" class="item" :class="{ on: r.id === runId }" :title="r.title" @click="pick(r)">
                <span class="item-title">{{ r.title }}</span>
                <span class="item-meta">
                  <span>{{ r.local ? 'antes del PR' : `PR #${r.pr?.number}` }}</span>
                  <span v-if="r.pr && r.pr.external" class="tag external">{{ r.pr.author }}</span>
                  <span>{{ fmtTime(r.started) }}</span>
                </span>
                <span class="item-summary" :data-state="stateOf(r)"><i class="dot" aria-hidden="true"></i>{{ summaryOf(r) }}</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ run ? run.proposal?.title || run.branch : 'Goldfish' }}</span>
        <span v-if="run" class="count">{{ run.repo }}</span>
      </div>
      <div class="region-body">
        <div v-if="!run && !runError" class="empty">
          <div class="empty-head">
            <div class="empty-title">El registro de lo que se validó</div>
            <div class="empty-desc">
              Antes de publicar un PR, la sesión que trabaja en la rama lo pasa por Goldfish desde la consola: dos
              <b>goldfish</b> lo revisan en frío (la descripción, el diff y lo que pide la tarea) y el <b>elephant</b>,
              con tu contexto, le da veredicto a cada hallazgo, sin ser estricto. Acá queda lo que se hizo: elegí una
              validación a la izquierda.
              <pre class="cli">make goldfish-check REPO=legacy-backend DESC=pr.md BASE=main [PROBAR=1]
make goldfish-run PR=https://github.com/…/pull/123</pre>
            </div>
          </div>
        </div>
        <p v-if="runError" class="none hot">{{ runError }}</p>

        <template v-if="run">
          <dl class="facts">
            <div><dt>Rama</dt><dd><code>{{ run.branch }}</code> → <code>{{ run.base }}</code> <span class="muted">· commit {{ (run.head || '').slice(0, 10) }}</span></dd></div>
            <div v-if="run.pr && !run.local"><dt>PR</dt><dd><a :href="run.pr.url" target="_blank" rel="noopener">#{{ run.pr.number }} · {{ run.pr.title }}</a> <span class="muted">· de {{ run.pr.author }}</span></dd></div>
            <div v-else><dt>PR</dt><dd class="muted">todavía no: se validó antes de publicar</dd></div>
            <div><dt>Tarea</dt><dd><template v-if="run.task">{{ run.task.title }} <span class="muted">· {{ run.task.slug }}</span></template><span v-else class="muted">ninguna la declara en <code>ramas:</code></span></dd></div>
            <div><dt>Cuándo</dt><dd>{{ fmtTime(run.started) }} <span class="muted">· costo equivalente {{ usd(run.costUsd) || 'US$0.00' }}</span></dd></div>
          </dl>

          <section class="stages" aria-label="Los pasos">
            <div v-for="s in run.stages" :key="s.id" class="stage" :data-status="s.status">
              <span class="mark" aria-hidden="true">{{ STAGE_MARK[s.status] }}</span>
              <span class="stage-label">{{ s.label }}</span>
              <span class="stage-note">{{ s.note }}</span>
              <span class="stage-cost">{{ [fmtSecs(s.millis), usd(s.costUsd)].filter(Boolean).join(' · ') }}</span>
            </div>
            <p v-if="run.status === 'running' || run.proving" class="stage-total">Corriendo desde la consola…</p>
            <p v-else-if="run.status === 'failed'" class="stage-total hot">No terminó: {{ run.error }}</p>
            <p v-else-if="listed" class="stage-total" :data-state="stateOf(listed)">{{ summaryOf(listed) }}</p>
          </section>

          <section v-for="v in byVerdict" :key="v.id" class="verdict" :data-verdict="v.id || 'none'">
            <div class="region-head group"><span>{{ v.label }}</span><span class="count">{{ v.items.length }}</span><span class="hint">{{ v.hint }}</span></div>
            <article v-for="f in v.items" :key="f.n" class="finding">
              <header>
                <span class="sev" :data-sev="f.severity">{{ f.severity }}</span>
                <b>{{ f.title }}</b>
              </header>
              <p class="where"><code v-if="loc(f)">{{ loc(f) }}</code> <span class="muted">{{ FROM[f.from] }}</span></p>
              <p class="detail">{{ f.detail }}</p>
              <p v-if="f.reason" class="reason">{{ f.reason }}</p>
              <div v-if="f.proof" class="proof" :data-proof="f.proof.status">
                <b>{{ PROOF_LABEL[f.proof.status] || f.proof.status }}</b> {{ f.proof.result }}
                <pre v-if="f.proof.command">{{ f.proof.command }}</pre>
              </div>
            </article>
          </section>
          <p v-if="run.status === 'done' && !run.findings?.length" class="none">Ningún hallazgo: los goldfish no encontraron nada serio.</p>

          <section v-if="run.proposal?.title" class="proposal">
            <div class="region-head group">
              <button type="button" class="toggle" @click="proposalOpen = !proposalOpen">
                <span class="ui-icon chevron" :class="{ open: proposalOpen }" data-icon="chevron" aria-hidden="true"></span>
                <span>La descripción que se revisó</span>
              </button>
            </div>
            <div v-if="proposalOpen" class="proposal-body">
              <h3>{{ run.proposal.title }}</h3>
              <pre>{{ run.proposal.body || '(no traía descripción)' }}</pre>
            </div>
          </section>
        </template>
      </div>
    </main>

    <footer class="statusbar">
      <!-- a qué rama apuntan las validaciones que se ven, como el ambiente en el pie de ecommerce -->
      <button ref="baseTrigger" type="button" class="statusbar-item base-pick" title="A qué rama apuntan las validaciones que se ven">
        <span class="ui-icon" data-icon="server" aria-hidden="true"></span>
        <span>Base: {{ base }}</span>
        <span class="ui-icon" data-icon="down" aria-hidden="true"></span>
      </button>
      <span>{{ shownCount }} validaciones contra {{ base }}</span>
      <span v-if="runs.some((r) => r.status === 'running')" class="muted">· una corriendo en la consola</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las validaciones" aria-label="Mostrar u ocultar las validaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Bandas, estado vacío y pie son de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.hot { color: var(--verdict-confirmed) }
.muted { color: var(--fg-3) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
.chevron { transition: transform .12s }
.chevron.open { transform: rotate(90deg) }
.cli { margin: var(--space-3) 0 0; padding: var(--space-2); border-radius: 6px; border: 1px solid var(--border); text-align: left;
  font-family: var(--font-mono); font-size: var(--text-xs); white-space: pre-wrap; color: var(--fg-2) }
/* los bloques: una tarjeta por repo */
.blocks { padding: var(--space-2) }
.block { border: 1px solid var(--border); border-radius: 10px; background: var(--card); margin-bottom: var(--space-2); overflow: hidden }
.block-head { width: 100%; display: flex; align-items: center; gap: var(--space-2); padding: 8px 10px; border: 0; background: transparent;
  color: var(--foreground); font: inherit; font-weight: 600; cursor: pointer; text-align: left }
.block-head:hover { background: var(--hover) }
.block-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.runs-list { list-style: none; margin: 0; padding: 0 0 4px }
.empty-block { padding: 2px 10px 6px 30px; font-size: var(--text-sm); color: var(--fg-3) }
.item { width: 100%; display: block; padding: 6px 10px 6px 30px; border: 0; background: transparent; color: var(--foreground); font: inherit;
  text-align: left; cursor: pointer; border-radius: 6px }
.item:hover { background: var(--hover) }
.item.on { background: var(--accent); color: var(--accent-foreground) }
.item-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3 }
.item-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; font-size: var(--text-xs); color: var(--fg-3) }
.item.on .item-meta { color: inherit; opacity: .85 }
/* el resumen: un punto del color de lo que quedó y la frase */
.item-summary { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: var(--text-xs); color: var(--fg-2) }
.item.on .item-summary { color: inherit }
.dot { flex: none; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--fg-3) }
[data-state="attend"] .dot { background: var(--verdict-confirmed) }
[data-state="look"] .dot { background: var(--verdict-plausible) }
[data-state="clear"] .dot { background: var(--stage-done) }
[data-state="running"] .dot { background: var(--primary) }
[data-state="failed"] .dot { background: var(--verdict-confirmed) }
.tag { display: inline-block; padding: 0 5px; border-radius: 4px; border: 1px solid var(--border); font-size: var(--text-xs); line-height: 16px }
.tag.external { border-color: var(--verdict-plausible); color: var(--verdict-plausible) }
/* los datos */
.facts { margin: 0; padding: var(--space-2) var(--gutter); display: grid; gap: 4px }
.facts > div { display: grid; grid-template-columns: 70px 1fr; gap: var(--space-2) }
.facts dt { color: var(--fg-3) }
.facts dd { margin: 0; min-width: 0 }
.facts a { color: var(--primary) }
/* los pasos */
.stages { padding: var(--space-2) var(--gutter) }
.stage { display: grid; grid-template-columns: 18px minmax(0, 1.2fr) minmax(0, 1fr) auto; gap: var(--space-2); align-items: baseline; min-height: 24px }
.stage .mark { font-family: var(--font-mono); color: var(--fg-3); text-align: center }
.stage[data-status="done"] .mark { color: var(--stage-done) }
.stage[data-status="failed"] .mark, .stage[data-status="failed"] .stage-note { color: var(--verdict-confirmed) }
.stage[data-status="running"] .mark { color: var(--primary) }
.stage[data-status="pending"] .stage-label { color: var(--fg-3) }
.stage-note { color: var(--fg-3); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.stage-cost { color: var(--fg-3); font-size: var(--text-sm); font-variant-numeric: tabular-nums }
.stage-total { margin: var(--space-2) 0 0; color: var(--fg-2); font-size: var(--text-sm); font-weight: 600 }
.stage-total[data-state="attend"] { color: var(--verdict-confirmed) }
.stage-total[data-state="clear"] { color: var(--stage-done) }
/* los hallazgos, por veredicto */
.verdict .hint { margin-left: var(--space-2); color: var(--fg-3); font-weight: 400 }
.verdict[data-verdict="confirmado"] > .region-head { color: var(--verdict-confirmed) }
.verdict[data-verdict="plausible"] > .region-head { color: var(--verdict-plausible) }
.finding { padding: var(--space-2) var(--gutter); border-bottom: 1px solid var(--border) }
.finding header { display: flex; gap: var(--space-2); align-items: baseline }
.finding p { margin: 4px 0 0 }
.finding .where { font-size: var(--text-sm) }
.finding .detail { white-space: pre-wrap }
.finding .reason { color: var(--fg-2); font-size: var(--text-sm); border-left: 2px solid var(--border); padding-left: var(--space-2); white-space: pre-wrap }
.verdict[data-verdict="descartado"] .finding b, .verdict[data-verdict="fuera de alcance"] .finding b { color: var(--fg-2); font-weight: 500 }
.sev { flex: none; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .03em; color: var(--fg-3) }
.sev[data-sev="alta"] { color: var(--verdict-confirmed); font-weight: 700 }
.sev[data-sev="media"] { color: var(--verdict-plausible); font-weight: 600 }
.proof { margin-top: 6px; padding: 6px var(--space-2); border-radius: 6px; border: 1px solid var(--border); font-size: var(--text-sm) }
.proof[data-proof="comprobado"] b { color: var(--verdict-confirmed) }
.proof[data-proof="refutado"] b { color: var(--stage-done) }
.proof[data-proof="sin probar"] b { color: var(--fg-3) }
.proof pre { margin: 4px 0 0; white-space: pre-wrap; word-break: break-all; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--fg-2) }
/* la descripción revisada */
.proposal .toggle { background: transparent; border: 0; color: inherit; font: inherit; display: flex; gap: var(--space-2); align-items: center; cursor: pointer; padding: 0 }
.proposal-body { padding: var(--space-2) var(--gutter) }
.proposal-body h3 { margin: 0 0 var(--space-2); font-size: var(--text-base) }
.proposal-body pre { margin: 0; white-space: pre-wrap; font: inherit; font-size: var(--text-sm); color: var(--fg-2) }
.base-pick { flex: none }
</style>
