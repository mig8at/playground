<script setup>
// Context — árbol de WORKSPACES: cada nodo es una combinación de ramas (resumen +
// copy del flujo) del que se pueden DERIVAR hijos que ramifican sobre el padre.
import { ref, computed } from 'vue'
import WorkspaceGraph from './WorkspaceGraph.vue'
import { Waypoints, FileText, Copy, Check, X, Database, GitFork } from 'lucide-vue-next'

const WS_URL = 'ws://localhost:8788/ws'

const status = ref('conectando…')
const repos = ref([])
const combinations = ref([]) // [{id,name,parent,targets,status,flow}]
const selectedCombo = ref('')
const graphsByCombo = ref({}) // comboId → graphs (caché de árboles para copiar por nodo)
const copiedKey = ref('') // `${combo}::${group}::${key}` recién copiado
const aligning = ref('') // comboId que está alineando
const alignResults = ref([]) // reporte por repo del último align
const summary = ref({ repos: [], links: [] })
const repoBranches = ref({}) // alias → [ramas locales] (para elegir la base al derivar una tarea)
const nodeCount = ref(0)
const toast = ref('')

let pendingCopy = null // {combo,group,key,label} esperando su árbol

const comboGraphs = computed(() => graphsByCombo.value[selectedCombo.value] || [])

const ALIAS_SHORT = { application: 'app', 'frontend-monorepo': 'front', 'legacy-backend': 'legacy' }
const shortA = (a) => ALIAS_SHORT[a] || a.split('-')[0]

// linaje del workspace seleccionado (raíz → … → seleccionado) para el breadcrumb
const lineage = computed(() => {
  if (!selectedCombo.value) return []
  const byId = Object.fromEntries(combinations.value.map((c) => [c.id, c]))
  const chain = []
  const seen = new Set()
  let c = byId[selectedCombo.value]
  while (c && !seen.has(c.id)) { seen.add(c.id); chain.unshift(c.name); c = c.parent ? byId[c.parent] : null }
  return chain
})

let ws = null
let retry = null
const online = computed(() => status.value === 'server on')

function connect() {
  ws = new WebSocket(WS_URL)
  const watchdog = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.CONNECTING) { try { ws.close() } catch {} ; scheduleRetry() }
  }, 2000)
  ws.onopen = () => { clearTimeout(watchdog); status.value = 'server on' }
  ws.onmessage = (e) => {
    let d
    try { d = JSON.parse(e.data) } catch { return }
    switch (d.type) {
      case 'state':
        status.value = d.server || 'server on'
        repos.value = d.repos || []
        combinations.value = d.combinations || []
        summary.value = d.summary || { repos: [], links: [] }
        nodeCount.value = d.nodes || 0
        if (selectedCombo.value && !combinations.value.find((c) => c.id === selectedCombo.value)) {
          selectedCombo.value = ''
        }
        if (!Object.keys(repoBranches.value).length && summary.value.repos.length) send({ type: 'repo_branches' })
        break
      case 'repo_branches':
        if (d.ok) repoBranches.value = d.branches || {}
        break
      case 'combo_graphs':
        if (d.ok) {
          graphsByCombo.value = { ...graphsByCombo.value, [d.id]: d.graphs || [] }
          if (pendingCopy && pendingCopy.combo === d.id) { const p = pendingCopy; pendingCopy = null; doCopy(p) }
        }
        break
      case 'alignment':
        if (d.id === aligning.value) {
          aligning.value = ''
          alignResults.value = d.results || []
          requestComboGraphs(d.id)
        }
        break
      case 'combination_saved':
      case 'combination_deleted':
        if (d.branch_ops && d.branch_ops.length) showBranchToast(d.branch_action, d.branch_ops)
        break
    }
  }
  ws.onclose = () => { status.value = 'desconectado'; scheduleRetry() }
  ws.onerror = () => { try { ws.close() } catch {} ; scheduleRetry() }
}
function scheduleRetry() { clearTimeout(retry); retry = setTimeout(connect, 1500) }
function send(obj) { if (online.value) ws.send(JSON.stringify(obj)) }

function showToast(msg) { toast.value = msg; setTimeout(() => (toast.value = ''), 2200) }

// ── workspaces ──
function onDeriveChild({ parent, name, mode, repos, bases, create }) {
  const parentCombo = combinations.value.find((c) => c.id === parent)
  const parentTargets = parentCombo?.targets || {}
  const allRepos = summary.value.repos.map((r) => r.alias)
  const targets = {}
  if (mode === 'flow') {
    // GROUP/FLUJO = documentación productiva sobre main: todos los repos en main, sin rama nueva.
    for (const a of allRepos) targets[a] = 'main'
    send({ type: 'save_combination', name, parent, targets })
    return
  }
  // TAREA: los repos seleccionados van a la rama nueva `name` (creada desde la base
  // elegida por repo); los no seleccionados quedan en la rama del flujo (o main).
  const sel = new Set(repos && repos.length ? repos : allRepos)
  for (const a of allRepos) targets[a] = sel.has(a) ? name : (parentTargets[a] || 'main')
  send({ type: 'save_combination', name, parent, targets, create_branches: !!create, bases: bases || {} })
}
function onDeleteWorkspace({ id, deleteBranches }) {
  send({ type: 'delete_combination', id, delete_branches: !!deleteBranches })
}
// resume el resultado de crear/borrar ramas (branch_ops) en un toast, por repo
function showBranchToast(action, ops) {
  const verb = action === 'delete' ? 'borrada(s)' : 'creada(s)'
  const done = ops.filter((o) => o.done)
  const errs = ops.filter((o) => o.error)
  const skip = ops.filter((o) => o.skipped)
  const pub = done.filter((o) => o.published)
  const parts = []
  if (done.length) parts.push(`✓ ${verb}: ${done.map((o) => shortA(o.alias)).join(', ')}`)
  if (action === 'delete' && pub.length) parts.push(`${pub.map((o) => shortA(o.alias)).join(', ')} publicada(s): la remota queda`)
  if (skip.length) parts.push(`omitida(s): ${skip.map((o) => shortA(o.alias)).join(', ')}`)
  if (errs.length) parts.push(`⚠ error: ${errs.map((o) => `${shortA(o.alias)} (${o.error})`).join('; ')}`)
  showToast(parts.join(' · ') || 'sin cambios de ramas')
}

// seleccionar un nodo = alinear (checkout+pull) + cargar su árbol
function onSelect(id) {
  selectedCombo.value = selectedCombo.value === id ? '' : id
  if (!selectedCombo.value) return
  alignResults.value = []
  // Solo las TASKS (abajo) tienen ramas propias por repo → solo ellas alinean
  // (checkout + pull). Los contextos y la raíz son documentación sobre main:
  // seleccionarlos muestra su doc/relaciones pero NO cambia ramas.
  const combo = combinations.value.find((c) => c.id === id)
  if (combo?.flow?.kind !== 'task') return
  aligning.value = id
  send({ type: 'align_combination', id })
}
function requestComboGraphs(id) { if (id) send({ type: 'combo_graphs', id }) }

async function writeClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); document.body.removeChild(ta)
    return ok
  } catch { return false }
}

// copiar TODO el árbol del flujo de un workspace (carga on-demand si no está cacheado)
function copyTree(payload) {
  if (graphsByCombo.value[payload.combo]) return doCopy(payload)
  pendingCopy = payload
  requestComboGraphs(payload.combo)
}
async function doCopy({ combo, label }) {
  const graphs = graphsByCombo.value[combo] || []
  const text = graphs.map((g) => g?.trees?.['__all__']).filter(Boolean).join('\n\n')
  if (!text) { showToast('⚠ sin árbol para copiar'); return }
  if (await writeClipboard(text)) {
    copiedKey.value = combo
    setTimeout(() => (copiedKey.value = ''), 1500)
    showToast(`✓ ${label || 'flujo'} copiado · ${Math.round(text.length / 1000)}k caracteres`)
  }
}
async function copyText(text, label) { if (await writeClipboard(text)) showToast(`✓ ${label} copiado`) }

// ── drawer de documentación viva (doc.md del nodo) ──
const docPanel = ref(null) // { id, name, doc } | null
const docCopied = ref(false)
function onShowDoc({ id, name, doc }) { docPanel.value = { id, name, doc }; docCopied.value = false }
function closeDoc() { docPanel.value = null }
const docPath = computed(() => (docPanel.value ? `context/server/data/flows/${docPanel.value.id}/doc.md` : ''))
async function copyDocPath() { if (docPath.value && (await writeClipboard(docPath.value))) showToast('✓ ruta copiada') }
async function copyDoc() {
  if (docPanel.value && (await writeClipboard(docPanel.value.doc))) {
    docCopied.value = true
    setTimeout(() => (docCopied.value = false), 1500)
  }
}
const docHtml = computed(() => (docPanel.value ? renderMarkdown(docPanel.value.doc) : ''))

// mini-render de markdown SIN dependencias: headings, bold, code, hr, listas
// (ul/ol), tablas y párrafos. Cubre lo que usan los doc.md de los flujos.
function mdEsc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function mdInline(s) {
  return mdEsc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}
function renderMarkdown(md) {
  const lines = (md || '').split('\n')
  const out = []
  let list = null // 'ul' | 'ol' | null
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // tabla: fila con | seguida de una fila separadora |---|
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[-:\s|]+\|\s*$/.test(lines[i + 1])) {
      closeList()
      out.push('<table><thead><tr>' + cells(line).map((c) => `<th>${mdInline(c)}</th>`).join('') + '</tr></thead><tbody>')
      let j = i + 2
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        out.push('<tr>' + cells(lines[j]).map((c) => `<td>${mdInline(c)}</td>`).join('') + '</tr>')
        j++
      }
      out.push('</tbody></table>')
      i = j - 1
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { closeList(); const l = h[1].length; out.push(`<h${l}>${mdInline(h[2])}</h${l}>`); continue }
    if (/^\s*---+\s*$/.test(line)) { closeList(); out.push('<hr>'); continue }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' } out.push(`<li>${mdInline(ol[1])}</li>`); continue }
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' } out.push(`<li>${mdInline(ul[1])}</li>`); continue }
    if (line.trim() === '') { closeList(); continue }
    closeList()
    out.push(`<p>${mdInline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') docPanel.value = null })
}

connect()
</script>

<template>
  <div class="wrap">
    <header class="top">
      <div class="brand">
        <Waypoints class="logo-mark" :size="28" :stroke-width="1.6" />
        <div>
          <h1>Context</h1>
          <p v-if="lineage.length" class="tag crumb">
            <template v-for="(n, i) in lineage" :key="i"><span v-if="i" class="crumb-sep">→</span>{{ n }}</template>
          </p>
          <p v-else class="tag">workspaces de ramas cross-repo · CreditOp</p>
        </div>
      </div>
      <div class="stats">
        <span class="pill" :class="online ? 'on' : 'off'">{{ status }}</span>
        <span class="stat"><Database :size="13" /> {{ repos.length }} repos</span>
        <span class="stat"><GitFork :size="13" /> {{ combinations.length }} workspaces</span>
      </div>
    </header>

    <WorkspaceGraph
      :combinations="combinations"
      :repos="summary.repos"
      :repo-branches="repoBranches"
      :selected="selectedCombo"
      :graphs="comboGraphs"
      :copied-key="copiedKey"
      :aligning="aligning"
      :align-results="alignResults"
      @derive="onDeriveChild"
      @delete="onDeleteWorkspace"
      @select="onSelect"
      @copy="copyTree"
      @copy-text="copyText"
      @show-doc="onShowDoc"
    />

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="docPanel" class="doc-backdrop" @click="closeDoc"></div>
      </Transition>
      <Transition name="slide">
        <aside v-if="docPanel" class="doc-drawer">
          <header class="doc-head">
            <FileText :size="18" class="doc-icon" />
            <div class="doc-titles">
              <span class="doc-title">{{ docPanel.name }}</span>
              <button class="doc-path" title="copiar la ruta del doc.md (para editarlo a mano)" @click="copyDocPath">
                {{ docPath }} · doc viva
              </button>
            </div>
            <button class="doc-btn" :title="docCopied ? 'copiado' : 'copiar markdown'" @click="copyDoc">
              <Check v-if="docCopied" :size="14" /><Copy v-else :size="14" />
            </button>
            <button class="doc-btn" title="cerrar (Esc)" @click="closeDoc"><X :size="15" /></button>
          </header>
          <!-- eslint-disable-next-line vue/no-v-html — markdown propio (escapado en mdEsc) -->
          <div class="doc-body" v-html="docHtml"></div>
        </aside>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <div class="toast-wrap">
        <div v-if="toast" class="toast">{{ toast }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.doc-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 50; }
.doc-drawer {
  position: fixed; top: 0; right: 0; height: 100vh; width: min(580px, 92vw);
  background: var(--panel2); border-left: 1px solid var(--border);
  box-shadow: -10px 0 34px rgba(0, 0, 0, .45); z-index: 51;
  display: flex; flex-direction: column;
}
.doc-head {
  display: flex; align-items: center; gap: 8px; padding: 12px 14px;
  border-bottom: 1px solid var(--border); color: var(--text); flex: 0 0 auto;
}
.doc-title { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-icon { flex: 0 0 auto; color: var(--accent); }
.doc-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.doc-path { align-self: flex-start; max-width: 100%; background: none; border: 0; padding: 0; color: var(--muted); font-family: var(--mono); font-size: 10.5px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-path:hover { color: var(--accent); }
.doc-btn {
  display: inline-flex; align-items: center; background: var(--chip); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px; padding: 5px 7px; cursor: pointer;
}
.doc-btn:hover { border-color: var(--accent); color: var(--accent); }
.doc-body { padding: 14px 18px 40px; overflow-y: auto; color: var(--text); font-size: 13px; line-height: 1.55; }

/* markdown renderizado (v-html → :deep) */
.doc-body :deep(h1) { font-size: 18px; margin: 2px 0 12px; }
.doc-body :deep(h2) { font-size: 15px; margin: 20px 0 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.doc-body :deep(h3) { font-size: 13.5px; margin: 15px 0 6px; color: var(--accent); }
.doc-body :deep(h4) { font-size: 13px; margin: 12px 0 4px; color: var(--muted); }
.doc-body :deep(p) { margin: 7px 0; }
.doc-body :deep(ul), .doc-body :deep(ol) { margin: 7px 0; padding-left: 20px; }
.doc-body :deep(li) { margin: 3px 0; }
.doc-body :deep(strong) { color: #fff; }
.doc-body :deep(code) { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-family: var(--mono); font-size: 12px; }
.doc-body :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 16px 0; }
.doc-body :deep(table) { border-collapse: collapse; width: 100%; margin: 9px 0; font-size: 12px; display: block; overflow-x: auto; }
.doc-body :deep(th), .doc-body :deep(td) { border: 1px solid var(--border); padding: 5px 8px; text-align: left; vertical-align: top; }
.doc-body :deep(th) { background: var(--chip); font-weight: 600; white-space: nowrap; }

/* transiciones del drawer */
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform .2s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }

/* header: stats con icono + breadcrumb del workspace seleccionado */
.stat { display: inline-flex; align-items: center; gap: 6px; }
.crumb { display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 12px; color: var(--text); flex-wrap: wrap; }
.crumb-sep { color: var(--muted); }
</style>
