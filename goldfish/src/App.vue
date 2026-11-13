<script setup>
/* goldfish · la interfaz. Las ramas de los repos reales que están por subir y, de la elegida, sus validaciones
 * Elephant-Goldfish (el método está en goldfish/review/branches.go): quién propone no valida su propio trabajo.
 *
 * A la izquierda, las ramas con commits que main no tiene: primero las que todavía no tienen PR, después las de PR
 * abierto y, plegadas, las ya mergeadas o cerradas. A la derecha, la rama elegida: su PR y su tarea, el botón
 * «Validar» y la validación (los pasos con su costo, los hallazgos con su veredicto y la propuesta revisada).
 *
 * Todo sale de la API en Go (goldfish/server): acá no se valida nada, se pinta. La rama y la validación elegidas
 * viven en la URL. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, readHashRoute, hashRoute, setRoute } from './workbench.js'

const GROUPS = [
  { id: 'pending', label: 'Por subir', open: true },
  { id: 'open', label: 'Con PR abierto', open: true },
  { id: 'closed', label: 'Ya mergeadas o cerradas', open: false },
]
const VERDICTS = [
  { id: 'confirmado', label: 'Confirmados', hint: 'ciertos: atenderlos antes del PR' },
  { id: 'plausible', label: 'Plausibles', hint: 'dependen de algo que no se comprueba leyendo' },
  { id: '', label: 'Sin veredicto', hint: 'el elephant no alcanzó a juzgarlos' },
  { id: 'descartado', label: 'Descartados', hint: 'no aplican, con su evidencia' },
]
const FROM = { intent: 'goldfish · propuesta vs cambio', risk: 'goldfish · riesgos', context: 'elephant · contexto' }
const STAGE_MARK = { pending: '·', running: '…', done: '✓', failed: '✗', skipped: '–' }

async function getJSON(path, init) {
  const res = await fetch(path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── la ruta: #/?repo=legacy-backend&branch=fix/x&run=<id> ──
const route = readHashRoute()
const repo = ref(route.params.get('repo') || '')
const branchName = ref(route.params.get('branch') || '')
const runId = ref(route.params.get('run') || '')
function writeRoute(push) {
  setRoute(hashRoute([], { repo: repo.value, branch: branchName.value, run: runId.value }, { repo: '', branch: '', run: '' }), { push })
}
function onHashChange() {
  const r = readHashRoute()
  repo.value = r.params.get('repo') || ''
  branchName.value = r.params.get('branch') || ''
  runId.value = r.params.get('run') || ''
}

// ── las ramas ──
const branches = ref([])
const loading = ref(false)
const loadError = ref('')
const checkedAt = ref('')
async function loadBranches(refresh = false) {
  loading.value = true
  loadError.value = ''
  try {
    const d = await getJSON(`/api/branches${refresh ? '?refresh=1' : ''}`)
    branches.value = d.branches || []
    checkedAt.value = new Date().toISOString()
  } catch (e) { loadError.value = String(e.message || e) } finally { loading.value = false }
}
const groupOf = (b) => (!b.pr ? 'pending' : b.pr.state === 'OPEN' ? 'open' : 'closed')
const openGroups = ref(new Set(GROUPS.filter((g) => g.open).map((g) => g.id)))
function toggleGroup(id) {
  const s = new Set(openGroups.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  openGroups.value = s
}
const grouped = computed(() => GROUPS.map((g) => ({ ...g, items: branches.value.filter((b) => groupOf(b) === g.id) })))
const keyOf = (b) => `${b.repo}\u0000${b.name}`
const selected = computed(() => branches.value.find((b) => b.repo === repo.value && b.name === branchName.value) || null)
function pick(b) {
  repo.value = b.repo; branchName.value = b.name; runId.value = b.lastRunId || ''
  writeRoute(true)
}

// ── las validaciones de la rama elegida ──
const runs = ref([])
const run = ref(null)
const runError = ref('')
async function loadRuns() {
  try { runs.value = (await getJSON('/api/runs')).runs || [] } catch { /* la lista no es crítica */ }
}
const branchRuns = computed(() => runs.value.filter((r) => r.Repo === repo.value && r.Branch === branchName.value))
let pollTimer = 0
async function loadRun() {
  clearTimeout(pollTimer)
  if (!runId.value) { run.value = null; return }
  try {
    run.value = await getJSON(`/api/runs/${encodeURIComponent(runId.value)}`)
    runError.value = ''
  } catch (e) { run.value = null; runError.value = String(e.message || e) }
  // mientras corre, se pregunta cada 2 s
  if (run.value?.status === 'running') pollTimer = setTimeout(loadRun, 2000)
  else { loadRuns(); loadBranches() }
}
watch(runId, loadRun)
watch([repo, branchName], () => { if (!runId.value) run.value = null })
const starting = ref(false)
async function validate() {
  if (!selected.value) return
  starting.value = true
  runError.value = ''
  try {
    const d = await getJSON('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: selected.value.repo, branch: selected.value.name }) })
    runId.value = d.id
    writeRoute(false)
    await loadRuns()
  } catch (e) { runError.value = String(e.message || e) } finally { starting.value = false }
}
async function stop() {
  if (run.value?.status !== 'running') return
  await fetch(`/api/runs/${encodeURIComponent(run.value.id)}/stop`, { method: 'POST' }).catch(() => {})
}
const byVerdict = computed(() => {
  const fs = run.value?.findings || []
  const sev = { alta: 0, media: 1, baja: 2 }
  return VERDICTS.map((v) => ({ ...v, items: fs.filter((f) => (f.verdict || '') === v.id).sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3)) }))
    .filter((v) => v.items.length)
})
const proposalOpen = ref(false)
const copied = ref(false)
async function copyProposal() {
  const p = run.value?.proposal
  if (!p) return
  try { await navigator.clipboard.writeText(`${p.title}\n\n${p.body}`); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const fmtSecs = (ms) => (ms ? `${Math.round(ms / 1000)} s` : '')
const usd = (n) => (n ? `US$${n.toFixed(2)}` : '')
const loc = (f) => (f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : '')

// ── las regiones ──
const sidebarOpen = ref(readSize('goldfish.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('goldfish.sidebar-w', 340))
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
  label: 'Ancho de la lista de ramas', sign: 1, defaultValue: 340,
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
  loadBranches()
  loadRuns()
  loadRun()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearTimeout(pollTimer)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Ramas por subir">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Ramas</span>
        <span class="count">{{ branches.length }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="loading" title="Volver a mirar los repos y GitHub" aria-label="Volver a mirar los repos y GitHub" @click="loadBranches(true)">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <p v-if="loadError" class="none hot">{{ loadError }}</p>
        <p v-else-if="loading && !branches.length" class="none">Mirando las ramas de los repos y sus PRs…</p>
        <p v-else-if="!branches.length" class="none">No hay ramas con commits por delante de main en los últimos días.</p>
        <ul v-else class="tree" role="tree" aria-label="Ramas por estado">
          <li v-for="g in grouped" v-show="g.items.length" :key="g.id" role="treeitem" :aria-expanded="openGroups.has(g.id)" class="folder">
            <button type="button" class="row" @click="toggleGroup(g.id)">
              <span class="ui-icon chevron" :class="{ open: openGroups.has(g.id) }" data-icon="chevron" aria-hidden="true"></span>
              <span class="label">{{ g.label }}</span>
              <span class="row-meta">{{ g.items.length }}</span>
            </button>
            <ul v-if="openGroups.has(g.id)" role="group">
              <li v-for="b in g.items" :key="keyOf(b)" role="treeitem" :aria-selected="selected && keyOf(selected) === keyOf(b)">
                <button type="button" class="row file branch" :class="{ on: selected && keyOf(selected) === keyOf(b) }" :title="b.subject" @click="pick(b)">
                  <span class="label">
                    <span class="branch-name">{{ b.name }}</span>
                    <span class="branch-repo">{{ b.repo }}<template v-if="b.task"> · {{ b.task.slug }}</template></span>
                  </span>
                  <span class="row-meta">
                    <i v-if="b.lastRunId" class="dot done" title="Ya se validó" aria-label="Ya se validó"></i>
                    +{{ b.ahead }}
                  </span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ selected ? selected.name : 'Goldfish' }}</span>
        <span v-if="selected" class="count">{{ selected.repo }}</span>
        <div v-if="selected" class="region-actions">
          <button v-if="run?.status === 'running'" type="button" class="action" @click="stop">Frenar</button>
          <button v-else type="button" class="action primary" :disabled="starting" @click="validate">{{ branchRuns.length ? 'Validar de nuevo' : 'Validar' }}</button>
        </div>
      </div>
      <div class="region-body">
        <div v-if="!selected" class="empty">
          <div class="empty-head">
            <div class="empty-title">Elegí una rama para validarla antes de abrir su PR</div>
            <div class="empty-desc">
              Quien propone no valida su propio trabajo. El <b>elephant</b>, con todo tu contexto local (la tarea,
              <code>knowledge/</code>, las trampas), arma la propuesta: el diff y la descripción del PR. Dos
              <b>goldfish</b> la revisan en frío, sin nada más: si la propuesta y el cambio dicen lo mismo, y qué puede
              salir mal. El elephant vuelve a mirar cada hallazgo contra el código y suma lo que sólo se ve con contexto.
              Vos decidís qué corregir. No abre PRs ni pushea.
            </div>
          </div>
        </div>
        <template v-else>
          <dl class="facts">
            <div><dt>Contra</dt><dd><code>{{ selected.base }}</code> · {{ selected.ahead }} commits por delante<template v-if="selected.behind">, {{ selected.behind }} por detrás</template></dd></div>
            <div><dt>Último commit</dt><dd>{{ selected.subject }} <span class="muted">· {{ fmtTime(selected.updated) }}</span></dd></div>
            <div><dt>PR</dt><dd><a v-if="selected.pr" :href="selected.pr.url" target="_blank" rel="noopener">#{{ selected.pr.number }} · {{ selected.pr.state.toLowerCase() }}</a><span v-else class="muted">todavía no tiene: el elephant redacta la descripción</span></dd></div>
            <div><dt>Tarea</dt><dd><template v-if="selected.task">{{ selected.task.title }} <span class="muted">· {{ selected.task.slug }}</span></template><span v-else class="muted">ninguna la declara en <code>ramas:</code></span></dd></div>
          </dl>

          <nav v-if="branchRuns.length" class="tabs runs" aria-label="Validaciones de esta rama">
            <button v-for="r in branchRuns" :key="r.ID" type="button" class="tab" :class="{ on: r.ID === runId }" @click="runId = r.ID; writeRoute(false)">
              {{ fmtTime(r.Started) }}
              <span class="count">{{ r.Status === 'running' ? 'corriendo' : r.Status === 'failed' ? 'falló' : `${r.Findings} hallazgos` }}</span>
            </button>
          </nav>
          <p v-if="runError" class="none hot">{{ runError }}</p>

          <template v-if="run">
            <section class="stages" aria-label="Los pasos">
              <div v-for="s in run.stages" :key="s.id" class="stage" :data-status="s.status">
                <span class="mark" aria-hidden="true">{{ STAGE_MARK[s.status] }}</span>
                <span class="stage-label">{{ s.label }}</span>
                <span class="stage-note">{{ s.note }}</span>
                <span class="stage-cost">{{ [fmtSecs(s.millis), usd(s.costUsd)].filter(Boolean).join(' · ') }}</span>
              </div>
              <p class="stage-total">
                <template v-if="run.status === 'running'">Corriendo… </template>
                <template v-else-if="run.status === 'failed'"><span class="hot">Falló: {{ run.error }}</span> · </template>
                costo equivalente {{ usd(run.costUsd) || 'US$0.00' }} (gasta del límite del plan de equipo)
                <template v-if="run.artifact"> · quedó en la tarea</template>
              </p>
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
              </article>
            </section>
            <p v-if="run.status === 'done' && !run.findings?.length" class="none">Ningún hallazgo: los goldfish no encontraron nada serio.</p>

            <section v-if="run.proposal?.body" class="proposal">
              <div class="region-head group">
                <button type="button" class="row" @click="proposalOpen = !proposalOpen">
                  <span class="ui-icon chevron" :class="{ open: proposalOpen }" data-icon="chevron" aria-hidden="true"></span>
                  <span>La propuesta que se revisó</span>
                  <span class="count">{{ run.proposal.source === 'pr' ? 'la del PR' : 'redactada por el elephant' }}</span>
                </button>
                <div class="region-actions">
                  <button type="button" class="action" @click="copyProposal">{{ copied ? 'Copiada' : 'Copiar' }}</button>
                </div>
              </div>
              <div v-if="proposalOpen" class="proposal-body">
                <h3>{{ run.proposal.title }}</h3>
                <pre>{{ run.proposal.body }}</pre>
              </div>
            </section>
          </template>
          <p v-else-if="!branchRuns.length" class="none">Todavía no se validó. «Validar» corre cuatro agentes (unos minutos).</p>
        </template>
      </div>
    </main>

    <footer class="statusbar">
      <span v-if="loading">mirando las ramas…</span>
      <span v-else-if="checkedAt">{{ branches.filter((b) => !b.pr).length }} por subir · mirado a las {{ new Date(checkedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las ramas" aria-label="Mostrar u ocultar las ramas" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Bandas, filas, pestañas, grupos, estado vacío y pie son de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.hot { color: var(--verdict-confirmed) }
.muted { color: var(--fg-3) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
.tree, .tree ul { list-style: none; margin: 0; padding: 0 }
.tree .label { flex: 1; min-width: 0; overflow: hidden }
.tree .folder > .row { font-weight: 600 }
.tree .file { padding-left: calc(var(--space-2) + 16px) }
.chevron { transition: transform .12s }
.chevron.open { transform: rotate(90deg) }
/* una rama: su nombre y, debajo, el repo y la tarea */
.branch { height: auto; min-height: var(--row-h); padding-top: 4px; padding-bottom: 4px }
.branch-name, .branch-repo { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.branch-repo { font-size: var(--text-xs); color: var(--fg-3) }
.row.on .branch-repo { color: inherit; opacity: .8 }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: var(--space-1); vertical-align: middle }
.dot.done { background: var(--stage-done) }
/* los datos de la rama */
.facts { margin: 0; padding: var(--space-2) var(--gutter); display: grid; gap: 4px }
.facts > div { display: grid; grid-template-columns: 110px 1fr; gap: var(--space-2) }
.facts dt { color: var(--fg-3) }
.facts dd { margin: 0; min-width: 0 }
.facts a { color: var(--primary) }
.runs { padding: 0 var(--gutter) }
/* las acciones del encabezado */
.action { border: 1px solid var(--border); background: transparent; color: var(--foreground); border-radius: 6px; padding: 3px 10px; font: inherit; font-size: var(--text-sm); cursor: pointer }
.action:hover { background: var(--hover) }
.action.primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary) }
.action:disabled { opacity: .5; cursor: default }
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
.stage-total { margin: var(--space-2) 0 0; color: var(--fg-2); font-size: var(--text-sm) }
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
.verdict[data-verdict="descartado"] .finding b { color: var(--fg-2); font-weight: 500 }
.sev { flex: none; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .03em; color: var(--fg-3) }
.sev[data-sev="alta"] { color: var(--verdict-confirmed); font-weight: 700 }
.sev[data-sev="media"] { color: var(--verdict-plausible); font-weight: 600 }
/* la propuesta */
.proposal .row { background: transparent; border: 0; color: inherit; font: inherit; display: flex; gap: var(--space-2); align-items: center; cursor: pointer; padding: 0 }
.proposal-body { padding: var(--space-2) var(--gutter) }
.proposal-body h3 { margin: 0 0 var(--space-2); font-size: var(--text-base) }
.proposal-body pre { margin: 0; white-space: pre-wrap; font: inherit; font-size: var(--text-sm); color: var(--fg-2) }
</style>
