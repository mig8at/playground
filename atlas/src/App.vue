<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import MapView from './MapView.vue'
import FlowCatalog from './FlowCatalog.vue'

const WS_URL = 'ws://localhost:8788/ws'

const status = ref('conectando…')
const repos = ref([])
const flows = ref([])
const summary = ref({ repos: [], links: [] })
const nodeCount = ref(0)
// sidebar JSON: kind 'node' (click en el mapa) | 'flow' (click en el catálogo)
const panel = ref(null)

let ws = null
let retry = null

const online = computed(() => status.value === 'server on')

function connect() {
  ws = new WebSocket(WS_URL)
  ws.onopen = () => { status.value = 'server on' }
  ws.onmessage = (e) => {
    let d
    try { d = JSON.parse(e.data) } catch { return }
    switch (d.type) {
      case 'state':
        status.value = d.server || 'server on'
        repos.value = d.repos || []
        flows.value = d.flows || []
        summary.value = d.summary || { repos: [], links: [] }
        nodeCount.value = d.nodes || 0
        break
      case 'node_files':
        if (d.ok && panel.value?.kind === 'node' && panel.value.repo === d.repo && panel.value.lang === d.lang) {
          panel.value = { ...panel.value, total: d.total, files: d.files || [], loading: false }
          requestTree(d.files)
        }
        break
      case 'flow_files':
        if (panel.value?.kind === 'flow' && panel.value.id === d.id) {
          if (d.ok) { panel.value = { ...panel.value, files: d.files || [], description: d.description, status: d.status, loading: false }; requestTree(d.files) }
          else panel.value = { ...panel.value, files: [], error: d.error, loading: false }
        }
        break
      case 'tree':
        if (d.ok && panel.value) panel.value = { ...panel.value, tree: d.text }
        break
    }
  }
  ws.onclose = () => { status.value = 'desconectado'; retry = setTimeout(connect, 1500) }
  ws.onerror = () => ws && ws.close()
}

function send(obj) { if (online.value) ws.send(JSON.stringify(obj)) }

const copied = ref(false)

// pide el árbol estilo Rino (estructura + contenido) de los archivos abiertos
function requestTree(files) {
  const ids = (files || []).map((n) => n.id)
  if (ids.length) send({ type: 'tree', ids })
}

// click en un nodo del mapa → JSON de sus archivos (rankeado)
function onPick({ repo, lang, label }) {
  panel.value = { kind: 'node', repo, lang, label, total: null, files: null, loading: true }
  copied.value = false
  send({ type: 'node_files', repo, lang: lang || '' })
}
// click en una card del catálogo → JSON de los archivos del flujo
function onOpenFlow(flow) {
  panel.value = { kind: 'flow', id: flow.id, label: flow.name, files: null, loading: true }
  copied.value = false
  send({ type: 'flow_files', id: flow.id })
}
function closePanel() { panel.value = null }

// ids con contenido cambiado desde el análisis (para marcarlos)
const changedSet = computed(() => {
  const st = panel.value?.status
  if (!st) return new Set()
  return new Set([...(st.changed || []), ...(st.removed || [])])
})

function compact(n) {
  const o = { id: n.id, path: n.path }
  if (changedSet.value.has(n.id)) o.changed = true
  if (n.definitions?.length) o.definitions = n.definitions
  if (n.routes?.length) o.routes = n.routes.map((r) => `${r.method} ${r.path}`)
  if (n.tables?.length) o.tables = n.tables
  return o
}

// sub-título del sidebar según el tipo
const panelSub = computed(() => {
  const p = panel.value
  if (!p || p.loading) return 'cargando…'
  if (p.kind === 'flow') {
    const n = changedSet.value.size
    return n ? `${p.files.length} archivos · ⚠ ${n} cambió desde el análisis` : `${p.files.length} archivos · ✓ al día`
  }
  return `top ${p.files.length} de ${p.total} · por relevancia`
})

// payload compacto (lo que consumiría el MCP/LLM)
const nodeJson = computed(() => {
  const p = panel.value
  if (!p || !p.files) return ''
  const payload = p.kind === 'flow'
    ? { flow: p.label, description: p.description || undefined, files: p.files.map(compact) }
    : { node: p.label, scope: p.lang ? `${p.repo} · ${p.lang}` : p.repo, total: p.total, shown: p.files.length, files: p.files.map(compact) }
  return JSON.stringify(payload, null, 2)
})

async function copyTree() {
  const text = panel.value?.tree || ''
  if (!text) return
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    // fallback para contextos donde el Clipboard API está bloqueado
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch { ok = false }
  }
  if (ok) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
}

onMounted(connect)
onBeforeUnmount(() => { clearTimeout(retry); ws && ws.close() })
</script>

<template>
  <div class="wrap">
    <header class="top">
      <div class="brand">
        <span class="logo">🗺️</span>
        <div>
          <h1>Atlas</h1>
          <p class="tag">mapa de flujos cross-repo · CreditOp</p>
        </div>
      </div>
      <div class="stats">
        <span class="pill" :class="online ? 'on' : 'off'">{{ status }}</span>
        <span class="stat">{{ repos.length }} repos</span>
        <span class="stat">{{ nodeCount }} nodos</span>
        <span class="stat">{{ flows.length }} flujos</span>
      </div>
    </header>

    <MapView :summary="summary" @pick="onPick" />
    <FlowCatalog :flows="flows" @open="onOpenFlow" />

    <!-- sidebar JSON (click en un nodo del mapa o en una card del catálogo) -->
    <aside v-if="panel" class="json-side">
      <div class="js-head">
        <div>
          <h2>{{ panel.label }}</h2>
          <p class="js-sub">{{ panelSub }}</p>
        </div>
        <div class="js-actions">
          <button class="js-copy" @click="copyTree" :disabled="panel.loading || !panel.tree" :title="panel.tree ? 'copiar el árbol (estructura + contenido)' : 'preparando árbol…'">
            {{ copied ? '✓ copiado' : 'copiar' }}
          </button>
          <button class="x" @click="closePanel" title="cerrar">×</button>
        </div>
      </div>
      <pre class="js-body"><code>{{ nodeJson }}</code></pre>
    </aside>
  </div>
</template>
