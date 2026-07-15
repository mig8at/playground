<script setup>
// Context — árbol de WORKSPACES: cada nodo es una combinación de ramas (resumen +
// copy del flujo) del que se pueden DERIVAR hijos que ramifican sobre el padre.
import { ref, computed } from 'vue'
import WorkspaceGraph from './WorkspaceGraph.vue'
import { Waypoints, Plus } from 'lucide-vue-next'

const WS_URL = 'ws://localhost:8788/ws'

const status = ref('conectando…')
const repos = ref([])
const combinations = ref([]) // [{id,name,parent,targets,status,flow}]
const branches = ref({})
const selectedCombo = ref('')
const graphsByCombo = ref({}) // comboId → graphs (caché de árboles para copiar por nodo)
const copiedKey = ref('') // `${combo}::${group}::${key}` recién copiado
const aligning = ref('') // comboId que está alineando
const alignResults = ref([]) // reporte por repo del último align
const summary = ref({ repos: [], links: [] })
const nodeCount = ref(0)
const creating = ref(false) // modal crear workspace raíz
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
      case 'combination_saved':
        if (d.ok && creating.value) creating.value = false
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
function requestBranches() { send({ type: 'repo_branches' }) }
function onCreateRoot({ name, targets }) { send({ type: 'save_combination', name, targets }) }
function onDeriveChild({ parent, name }) {
  // "los 3, mismo nombre": una rama nueva con el mismo nombre en cada repo
  const targets = {}
  for (const r of summary.value.repos) targets[r.alias] = name
  send({ type: 'save_combination', name, parent, targets })
}
function onDeleteWorkspace(id) { send({ type: 'delete_combination', id }) }
function onSetTasks({ id, tasks }) { send({ type: 'set_tasks', id, tasks }) }

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
        <button class="new-ws" :disabled="!online" @click="creating = true; requestBranches()">
          <Plus :size="15" /> nuevo workspace
        </button>
      </div>
    </header>

    <WorkspaceGraph
      :combinations="combinations"
      :repos="summary.repos"
      :branches="branches"
      :selected="selectedCombo"
      :graphs="comboGraphs"
      :copied-key="copiedKey"
      :aligning="aligning"
      :align-results="alignResults"
      :creating="creating"
      @create-root="onCreateRoot"
      @derive="onDeriveChild"
      @delete="onDeleteWorkspace"
      @set-tasks="onSetTasks"
      @select="onSelect"
      @need-branches="requestBranches"
      @copy="copyTree"
      @copy-text="copyText"
      @close-create="creating = false"
    />

    <Teleport to="body">
      <div class="toast-wrap">
        <div v-if="toast" class="toast">{{ toast }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.new-ws { display: inline-flex; align-items: center; gap: 5px; background: var(--accent); color: #06101f; border: 0; border-radius: 8px; padding: 6px 13px; font-weight: 600; font-size: 13px; cursor: pointer; }
.new-ws:hover:not(:disabled) { filter: brightness(1.08); }
.new-ws:disabled { opacity: .5; cursor: default; }
</style>
