<script setup>
/* goldfish · la interfaz. Validar un PR con Elephant-Goldfish (el método está en goldfish/review/prs.go): quien
 * propone no valida su propio trabajo.
 *
 * A la izquierda, un bloque por repo (primero los principales) con TUS PRs abiertos, con el título que les pusiste;
 * lo mergeado o cerrado se va solo. Un PR de otra persona que pegaste para validar queda en su repo, marcado
 * «externo», mientras siga abierto. A la derecha, sin nada elegido, un buscador: pegás la URL de un PR y se valida.
 * Con un PR elegido, sus datos, «Validar» y la validación: los pasos con su costo, los hallazgos con su veredicto y
 * la descripción que se revisó.
 *
 * Todo sale de la API en Go (goldfish/server): acá no se valida nada, se pinta. El PR y la validación elegidos viven
 * en la URL. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, bindMenu, readHashRoute, hashRoute, setRoute } from './workbench.js'

const VERDICTS = [
  { id: 'confirmado', label: 'Confirmados', hint: 'ciertos: atenderlos' },
  { id: 'plausible', label: 'Plausibles', hint: 'dependen de algo que no se comprueba leyendo' },
  { id: '', label: 'Sin veredicto', hint: 'el elephant no alcanzó a juzgarlos' },
  { id: 'descartado', label: 'Descartados', hint: 'no aplican, con su evidencia' },
]
const FROM = { intent: 'goldfish · descripción vs cambio', risk: 'goldfish · riesgos', context: 'elephant · contexto' }
const STAGE_MARK = { pending: '·', running: '…', done: '✓', failed: '✗', skipped: '–' }

async function getJSON(path, init) {
  const res = await fetch(path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}
const postJSON = (path, body) => getJSON(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ── la ruta: #/?pr=<url del PR>&run=<id>&base=qa ──
const route = readHashRoute()
const prUrl = ref(route.params.get('pr') || '')
const runId = ref(route.params.get('run') || '')
const base = ref(route.params.get('base') || 'all') // contra qué rama apuntan los PRs que se ven: all, main, qa…
function writeRoute(push) {
  setRoute(hashRoute([], { pr: prUrl.value, run: runId.value, base: base.value }, { pr: '', run: '', base: 'all' }), { push })
}
function onHashChange() {
  const r = readHashRoute()
  prUrl.value = r.params.get('pr') || ''
  runId.value = r.params.get('run') || ''
  base.value = r.params.get('base') || 'all'
}

// ── los bloques ──
const repos = ref([])
const loading = ref(false)
const loadError = ref('')
const checkedAt = ref('')
async function loadRepos(refresh = false) {
  loading.value = true
  loadError.value = ''
  try {
    repos.value = (await getJSON(`/api/prs${refresh ? '?refresh=1' : ''}`)).repos || []
    checkedAt.value = new Date().toISOString()
  } catch (e) { loadError.value = String(e.message || e) } finally { loading.value = false }
}
const allPRs = computed(() => repos.value.flatMap((b) => b.prs || []))
// LA BASE, en el pie (como el ambiente en ecommerce y el harness): a qué rama apuntan los PRs que se ven. Las opciones
// salen de los PRs que hay; primero main y qa. Un PR sin base conocida (su repo no tiene clon) sólo sale en «todas».
const BASE_ORDER = ['main', 'qa', 'develop', 'staging']
const bases = computed(() => {
  const count = {}
  for (const p of allPRs.value) if (p.base) count[p.base] = (count[p.base] || 0) + 1
  const names = Object.keys(count).sort((a, b) => ((BASE_ORDER.indexOf(a) + 1 || 99) - (BASE_ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b))
  return names.map((n) => ({ id: n, count: count[n] }))
})
const baseItems = computed(() => [{ id: 'all', label: `Todas las bases · ${allPRs.value.length}`, selected: base.value === 'all' },
  ...bases.value.map((b) => ({ id: b.id, label: `→ ${b.id} · ${b.count}`, selected: base.value === b.id }))])
const inBase = (p) => base.value === 'all' || p.base === base.value
const shownRepos = computed(() => repos.value.map((b) => ({ ...b, prs: (b.prs || []).filter(inBase) }))
  .filter((b) => b.prs.length || base.value === 'all' || ['legacy-backend', 'frontend-monorepo', 'legacy-application'].includes(b.name)))
const shownCount = computed(() => allPRs.value.filter(inBase).length)
watch(base, () => writeRoute(false))
const baseTrigger = ref(null)
let baseMenu = null
watch(baseItems, () => baseMenu?.refresh(), { deep: true, flush: 'post' })
const selected = computed(() => allPRs.value.find((p) => p.url === prUrl.value) || null)
const blockOf = (p) => repos.value.find((b) => b.slug === p?.slug)
const keyOf = (p) => `${p.slug}#${p.number}`
const collapsed = ref(new Set(JSON.parse(readStore('goldfish.collapsed') || '[]')))
function readStore(k) { try { return localStorage.getItem(k) } catch { return null } }
function toggleBlock(slug) {
  const s = new Set(collapsed.value)
  if (s.has(slug)) s.delete(slug); else s.add(slug)
  collapsed.value = s
  try { localStorage.setItem('goldfish.collapsed', JSON.stringify([...s])) } catch { /* sólo en esta pestaña */ }
}
function pick(p) {
  prUrl.value = p.url; runId.value = p.lastRunId || ''
  writeRoute(true)
}
function home() { prUrl.value = ''; runId.value = ''; writeRoute(true); nextTick(() => search.value?.focus()) }
async function removeExternal(p) {
  await fetch(`/api/prs?url=${encodeURIComponent(p.url)}`, { method: 'DELETE' }).catch(() => {})
  if (prUrl.value === p.url) home()
  loadRepos(true)
}

// ── pegar un PR: se valida enseguida (si es de otro, queda como externo en su repo) ──
const search = ref(null)
const pasted = ref('')
const pasteError = ref('')
const starting = ref(false)
async function validateUrl(url) {
  url = String(url || '').trim()
  if (!url) return
  starting.value = true
  pasteError.value = ''
  try {
    const d = await postJSON('/api/runs', { url })
    const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    await loadRepos(true)
    const p = m && allPRs.value.find((x) => x.slug === m[1] && String(x.number) === m[2])
    prUrl.value = p?.url || url
    runId.value = d.id
    writeRoute(true)
    pasted.value = ''
    await loadRuns()
  } catch (e) { pasteError.value = String(e.message || e) } finally { starting.value = false }
}

// ── las validaciones ──
const runs = ref([])
const run = ref(null)
const runError = ref('')
async function loadRuns() {
  try { runs.value = (await getJSON('/api/runs')).runs || [] } catch { /* la lista no es crítica */ }
}
const prRuns = computed(() => (selected.value ? runs.value.filter((r) => r.key === keyOf(selected.value)) : []))
let pollTimer = 0
async function loadRun() {
  clearTimeout(pollTimer)
  if (!runId.value) { run.value = null; return }
  try {
    run.value = await getJSON(`/api/runs/${encodeURIComponent(runId.value)}`)
    runError.value = ''
  } catch (e) { run.value = null; runError.value = String(e.message || e) }
  if (run.value?.status === 'running' || run.value?.proving) pollTimer = setTimeout(loadRun, 2000)
  else loadRuns()
}
watch(runId, loadRun)
watch(prUrl, () => { if (!runId.value) run.value = null })
async function stop() {
  if (run.value?.status !== 'running' && !run.value?.proving) return
  await fetch(`/api/runs/${encodeURIComponent(run.value.id)}/stop`, { method: 'POST' }).catch(() => {})
}
const byVerdict = computed(() => {
  const fs = run.value?.findings || []
  const sev = { alta: 0, media: 1, baja: 2 }
  return VERDICTS.map((v) => ({ ...v, items: fs.filter((f) => (f.verdict || '') === v.id).sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3)) }))
    .filter((v) => v.items.length)
})
const proposalOpen = ref(false)
// COMPROBAR CORRIENDO (goldfish/review/prove.go): el clon del repo se pone en el PR, un agente prueba con el harness en
// local los hallazgos confirmados y plausibles, y el clon vuelve a su rama
const testable = computed(() => (run.value?.findings || []).filter((f) => f.verdict === 'confirmado' || f.verdict === 'plausible').length)
const proveError = ref('')
async function prove() {
  proveError.value = ''
  try {
    await postJSON(`/api/runs/${encodeURIComponent(run.value.id)}/prove`, {})
    await loadRun()
  } catch (e) { proveError.value = String(e.message || e) }
}
const PROOF_LABEL = { comprobado: 'comprobado corriendo', refutado: 'refutado corriendo', 'sin probar': 'sin probar' }

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const fmtSecs = (ms) => (ms ? `${Math.round(ms / 1000)} s` : '')
const usd = (n) => (n ? `US$${n.toFixed(2)}` : '')
const loc = (f) => (f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : '')

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
  label: 'Ancho de la lista de PRs', sign: 1, defaultValue: 360,
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
    label: 'A qué rama apuntan los PRs que se ven', getItems: () => baseItems.value,
    onSelect: (id) => { base.value = id },
  })
  loadRepos()
  loadRuns()
  loadRun()
  if (!prUrl.value) nextTick(() => search.value?.focus())
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearTimeout(pollTimer)
  themeBinding?.destroy?.()
  baseMenu?.destroy()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="PRs por repo">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>PRs abiertos</span>
        <span class="count" :class="{ filtered: base !== 'all' }">{{ base === 'all' ? allPRs.length : `${shownCount} / ${allPRs.length}` }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Validar otro PR (pegar su URL)" aria-label="Validar otro PR" @click="home">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" :disabled="loading" title="Volver a preguntarle a GitHub" aria-label="Volver a preguntarle a GitHub" @click="loadRepos(true)">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body blocks">
        <p v-if="loadError" class="none hot">{{ loadError }}</p>
        <p v-else-if="loading && !repos.length" class="none">Preguntándole a GitHub por tus PRs abiertos…</p>
        <section v-for="b in shownRepos" :key="b.slug" class="block" :aria-label="b.name">
          <button type="button" class="block-head" :aria-expanded="!collapsed.has(b.slug)" @click="toggleBlock(b.slug)">
            <span class="ui-icon chevron" :class="{ open: !collapsed.has(b.slug) }" data-icon="chevron" aria-hidden="true"></span>
            <span class="block-name">{{ b.name }}</span>
            <span v-if="!b.clone" class="block-warn" title="No hay un clon de este repo: sus PRs no se pueden validar">sin clon</span>
            <span class="count">{{ b.prs.length }}</span>
          </button>
          <ul v-if="!collapsed.has(b.slug)" class="prs">
            <li v-if="!b.prs.length" class="empty-block">{{ base === 'all' ? 'Sin PRs abiertos' : `Sin PRs abiertos contra ${base}` }}</li>
            <li v-for="p in b.prs" :key="keyOf(p)">
              <button type="button" class="pr" :class="{ on: selected && keyOf(selected) === keyOf(p) }" :title="p.title" @click="pick(p)">
                <span class="pr-title">{{ p.title }}</span>
                <span class="pr-meta">
                  <span>#{{ p.number }}</span>
                  <span v-if="base === 'all' && p.base" class="pr-base" :data-base="p.base">→ {{ p.base }}</span>
                  <span v-if="p.external" class="tag external" :title="`De ${p.author}: lo pegaste para validarlo`">externo · {{ p.author }}</span>
                  <span v-if="p.draft" class="tag">borrador</span>
                  <span v-if="p.task" class="pr-task">{{ p.task.slug }}</span>
                  <i v-if="p.lastRunId" class="dot done" title="Ya se validó" aria-label="Ya se validó"></i>
                </span>
              </button>
              <button v-if="p.external" type="button" class="pr-remove" :title="`Sacar #${p.number} de la lista`" :aria-label="`Sacar #${p.number} de la lista`" @click="removeExternal(p)">×</button>
            </li>
          </ul>
        </section>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ selected ? `#${selected.number} · ${blockOf(selected)?.name || selected.slug}` : 'Goldfish' }}</span>
        <div v-if="selected" class="region-actions">
          <button v-if="run?.status === 'running' || run?.proving" type="button" class="action" @click="stop">Frenar</button>
          <button v-else type="button" class="action primary" :disabled="starting || !blockOf(selected)?.clone" @click="validateUrl(selected.url)">{{ prRuns.length ? 'Validar de nuevo' : 'Validar' }}</button>
        </div>
      </div>
      <div class="region-body">
        <!-- sin nada elegido: el buscador, como el de Google -->
        <div v-if="!selected && !run" class="search-home">
          <div class="brand" aria-hidden="true">Goldfish</div>
          <form class="search" @submit.prevent="validateUrl(pasted)">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
            <input ref="search" v-model="pasted" type="url" inputmode="url" autocomplete="off" spellcheck="false"
                   placeholder="Pegá la URL de un PR de GitHub" aria-label="URL del PR a validar" @paste="(e) => nextTick(() => validateUrl(pasted))" />
          </form>
          <div class="search-actions">
            <button type="button" class="action primary" :disabled="starting || !pasted.trim()" @click="validateUrl(pasted)">{{ starting ? 'Arrancando…' : 'Validar PR' }}</button>
          </div>
          <p v-if="pasteError" class="hot search-error">{{ pasteError }}</p>
          <p class="search-desc">
            Quien propone no valida su propio trabajo. Dos <b>goldfish</b> revisan el PR en frío (sólo su descripción,
            su diff y lo que pide su tarea): si la descripción y el cambio dicen lo mismo, y qué puede salir mal. Después
            el <b>elephant</b>, con todo tu contexto local, le da veredicto a cada hallazgo contra el código y suma lo
            que sólo se ve con ese contexto. Un PR de otra persona queda en su repo como <b>externo</b>. No comenta en
            GitHub ni aprueba.
          </p>
        </div>
        <template v-else>
          <dl v-if="selected" class="facts">
            <div><dt>PR</dt><dd><a :href="selected.url" target="_blank" rel="noopener">{{ selected.title }}</a></dd></div>
            <div><dt>De</dt><dd>{{ selected.author }}<span v-if="selected.external" class="tag external">externo</span><span v-if="selected.draft" class="tag">borrador</span></dd></div>
            <div v-if="selected.head"><dt>Rama</dt><dd><code>{{ selected.head }}</code> → <code>{{ selected.base }}</code></dd></div>
            <div><dt>Tarea</dt><dd><template v-if="selected.task">{{ selected.task.title }} <span class="muted">· {{ selected.task.slug }}</span></template><span v-else class="muted">ninguna la declara en <code>ramas:</code></span></dd></div>
            <div v-if="!blockOf(selected)?.clone"><dt></dt><dd class="hot">No hay un clon de {{ selected.slug }} en ~/Desktop/CREDITOP/github: sin él no se puede validar.</dd></div>
          </dl>

          <nav v-if="prRuns.length" class="tabs runs" aria-label="Validaciones de este PR">
            <button v-for="r in prRuns" :key="r.id" type="button" class="tab" :class="{ on: r.id === runId }" @click="runId = r.id; writeRoute(false)">
              {{ fmtTime(r.started) }}
              <span class="count">{{ r.status === 'running' ? 'corriendo' : r.status === 'failed' ? 'falló' : `${r.findings} hallazgos` }}</span>
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
              <div v-if="run.status === 'done' && testable && !run.proving" class="prove">
                <button type="button" class="action primary" @click="prove">Comprobar corriendo</button>
                <span class="muted">Pone el clon de {{ blockOf(selected)?.name || run.slug }} en el PR, prueba con el harness en
                  local los {{ testable }} hallazgos confirmados y plausibles, y lo devuelve a tu rama. Si el clon tiene
                  cambios sin commit, no lo toca.</span>
              </div>
              <p v-if="run.proving" class="muted prove-note">Comprobando: el clon de {{ blockOf(selected)?.name || run.slug }} está en el PR hasta que termine.</p>
              <p v-if="proveError" class="hot">{{ proveError }}</p>
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
                <pre>{{ run.proposal.body || '(el PR no trae descripción)' }}</pre>
              </div>
            </section>
          </template>
          <p v-else-if="selected && !prRuns.length" class="none">Todavía no se validó. «Validar» corre tres agentes (unos minutos).</p>
        </template>
      </div>
    </main>

    <footer class="statusbar">
      <!-- a qué rama apuntan los PRs que se ven, como el ambiente en el pie de ecommerce -->
      <button ref="baseTrigger" type="button" class="statusbar-item base-pick" title="A qué rama apuntan los PRs que se ven">
        <span class="ui-icon" data-icon="compare" aria-hidden="true"></span>
        <span>Base: {{ base === 'all' ? 'todas' : base }}</span>
        <span class="ui-icon" data-icon="down" aria-hidden="true"></span>
      </button>
      <span v-if="loading">preguntándole a GitHub…</span>
      <span v-else-if="checkedAt">{{ allPRs.filter((p) => !p.external).length }} tuyos · {{ allPRs.filter((p) => p.external).length }} externos · mirado a las {{ new Date(checkedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar los PRs" aria-label="Mostrar u ocultar los PRs" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Bandas, pestañas, estado vacío y pie son de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.hot { color: var(--verdict-confirmed) }
.muted { color: var(--fg-3) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
.chevron { transition: transform .12s }
.chevron.open { transform: rotate(90deg) }
/* los bloques: una tarjeta por repo */
.blocks { padding: var(--space-2) }
.block { border: 1px solid var(--border); border-radius: 10px; background: var(--card); margin-bottom: var(--space-2); overflow: hidden }
.block-head { width: 100%; display: flex; align-items: center; gap: var(--space-2); padding: 8px 10px; border: 0; background: transparent;
  color: var(--foreground); font: inherit; font-weight: 600; cursor: pointer; text-align: left }
.block-head:hover { background: var(--hover) }
.block-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.block-warn { font-size: var(--text-xs); font-weight: 500; color: var(--verdict-plausible) }
.prs { list-style: none; margin: 0; padding: 0 0 4px }
.prs li { position: relative }
.empty-block { padding: 2px 10px 6px 30px; font-size: var(--text-sm); color: var(--fg-3) }
.pr { width: 100%; display: block; padding: 6px 28px 6px 30px; border: 0; background: transparent; color: var(--foreground); font: inherit;
  text-align: left; cursor: pointer; border-radius: 6px }
.pr:hover { background: var(--hover) }
.pr.on { background: var(--accent); color: var(--accent-foreground) }
.pr-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3 }
.pr-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; font-size: var(--text-xs); color: var(--fg-3) }
.pr.on .pr-meta { color: inherit; opacity: .85 }
.pr-task { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px }
.pr-remove { position: absolute; right: 6px; top: 6px; width: 20px; height: 20px; border: 0; border-radius: 4px; background: transparent;
  color: var(--fg-3); cursor: pointer; font-size: 15px; line-height: 1; opacity: 0 }
.prs li:hover .pr-remove, .pr-remove:focus-visible { opacity: 1 }
.pr-remove:hover { background: var(--hover); color: var(--foreground) }
.tag { display: inline-block; padding: 0 5px; border-radius: 4px; border: 1px solid var(--border); font-size: var(--text-xs); line-height: 16px; margin-left: 4px }
.pr-meta .tag { margin-left: 0 }
.tag.external { border-color: var(--verdict-plausible); color: var(--verdict-plausible) }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50% }
.dot.done { background: var(--stage-done) }
/* la base de cada PR, y el selector del pie */
.pr-base { font-family: var(--font-mono) }
.pr-base[data-base="main"] { color: var(--verdict-confirmed) }
.pr-base[data-base="qa"] { color: var(--verdict-plausible) }
.pr.on .pr-base { color: inherit }
.base-pick { flex: none }
/* el buscador, como el de Google */
.search-home { max-width: 640px; margin: 12vh auto 0; padding: 0 var(--gutter); display: flex; flex-direction: column; align-items: center; gap: var(--space-3) }
.brand { font-size: 34px; font-weight: 700; letter-spacing: -.02em; color: var(--primary) }
.search { width: 100%; display: flex; align-items: center; gap: var(--space-2); padding: 0 16px; height: 46px; border: 1px solid var(--border);
  border-radius: 23px; background: var(--card) }
.search:focus-within { box-shadow: 0 1px 8px rgba(0, 0, 0, .25); border-color: var(--ring) }
.search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--foreground); font: inherit; font-size: 15px }
.search-actions { display: flex; gap: var(--space-2) }
.search-error { margin: 0; font-size: var(--text-sm); text-align: center }
.search-desc { margin: var(--space-2) 0 0; color: var(--fg-3); font-size: var(--text-sm); line-height: 1.5; text-align: center }
/* los datos del PR */
.facts { margin: 0; padding: var(--space-2) var(--gutter); display: grid; gap: 4px }
.facts > div { display: grid; grid-template-columns: 70px 1fr; gap: var(--space-2) }
.facts dt { color: var(--fg-3) }
.facts dd { margin: 0; min-width: 0 }
.facts a { color: var(--primary) }
.runs { padding: 0 var(--gutter) }
/* las acciones */
.action { border: 1px solid var(--border); background: transparent; color: var(--foreground); border-radius: 6px; padding: 4px 12px; font: inherit; font-size: var(--text-sm); cursor: pointer }
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
/* comprobar corriendo, y su evidencia en cada hallazgo */
.prove { display: flex; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-2); font-size: var(--text-sm) }
.prove .action { flex: none }
.prove-note { margin: var(--space-2) 0 0; font-size: var(--text-sm) }
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
</style>
