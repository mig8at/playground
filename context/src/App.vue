<script setup>
// Context — árbol de WORKSPACES: cada nodo es una combinación de ramas (resumen +
// copy del flujo) del que se pueden DERIVAR hijos que ramifican sobre el padre.
import { ref, computed } from 'vue'
import WorkspaceGraph from './WorkspaceGraph.vue'
import { Waypoints, FileText, Copy, Check, X } from 'lucide-vue-next'

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
const nodeCount = ref(0)
const toast = ref('')

let pendingCopy = null // {combo,group,key,label} esperando su árbol

const comboGraphs = computed(() => graphsByCombo.value[selectedCombo.value] || [])

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
    }
  }
  ws.onclose = () => { status.value = 'desconectado'; scheduleRetry() }
  ws.onerror = () => { try { ws.close() } catch {} ; scheduleRetry() }
}
function scheduleRetry() { clearTimeout(retry); retry = setTimeout(connect, 1500) }
function send(obj) { if (online.value) ws.send(JSON.stringify(obj)) }

function showToast(msg) { toast.value = msg; setTimeout(() => (toast.value = ''), 2200) }

// ── workspaces ──
function onDeriveChild({ parent, name }) {
  // "los 3, mismo nombre": una rama nueva con el mismo nombre en cada repo
  const targets = {}
  for (const r of summary.value.repos) targets[r.alias] = name
  send({ type: 'save_combination', name, parent, targets })
}
function onDeleteWorkspace(id) { send({ type: 'delete_combination', id }) }

// seleccionar un nodo = alinear (checkout+pull) + cargar su árbol
function onSelect(id) {
  selectedCombo.value = selectedCombo.value === id ? '' : id
  if (selectedCombo.value) {
    alignResults.value = []
    aligning.value = id
    send({ type: 'align_combination', id })
  }
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
const docPanel = ref(null) // { name, doc } | null
const docCopied = ref(false)
function onShowDoc({ name, doc }) { docPanel.value = { name, doc }; docCopied.value = false }
function closeDoc() { docPanel.value = null }
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
          <p class="tag">workspaces de ramas cross-repo · CreditOp</p>
        </div>
      </div>
      <div class="stats">
        <span class="pill" :class="online ? 'on' : 'off'">{{ status }}</span>
        <span class="stat">{{ repos.length }} repos</span>
        <span class="stat">{{ combinations.length }} workspaces</span>
      </div>
    </header>

    <WorkspaceGraph
      :combinations="combinations"
      :repos="summary.repos"
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
      <div v-if="docPanel" class="doc-backdrop" @click="closeDoc"></div>
      <aside v-if="docPanel" class="doc-drawer">
        <header class="doc-head">
          <FileText :size="15" />
          <span class="doc-title">{{ docPanel.name }}</span>
          <button class="doc-btn" :title="docCopied ? 'copiado' : 'copiar markdown'" @click="copyDoc">
            <Check v-if="docCopied" :size="14" /><Copy v-else :size="14" />
          </button>
          <button class="doc-btn" title="cerrar (Esc)" @click="closeDoc"><X :size="15" /></button>
        </header>
        <!-- eslint-disable-next-line vue/no-v-html — markdown propio (escapado en mdEsc) -->
        <div class="doc-body" v-html="docHtml"></div>
      </aside>
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
.doc-title { font-weight: 700; font-size: 14px; flex: 1; }
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
</style>
