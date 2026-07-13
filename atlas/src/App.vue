<script setup>
// Atlas — mapa cross-repo + combinaciones de ramas + flujos-grafo (canal→lenders)
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import MapView from './MapView.vue'
import CombinationPanel from './CombinationPanel.vue'
import FlowGraph from './FlowGraph.vue'
import { Waypoints, ChevronRight, ChevronDown } from 'lucide-vue-next'

const WS_URL = 'ws://localhost:8788/ws'

const status = ref('conectando…')
const repos = ref([])
const flows = ref([])
const combinations = ref([])
const branches = ref({})
const selectedCombo = ref('')
const comboGraphs = ref([]) // [GroupGraph] canal→lenders con árboles por camino
const copiedKey = ref('') // `${group}::${key}` recién copiado
const aligning = ref(false) // checkout+pull en curso
const alignResults = ref([]) // reporte por repo
const summary = ref({ repos: [], links: [] })
const nodeCount = ref(0)
const mapCollapsed = ref(false)
const toast = ref('')
let scrollPending = false

const flowsAnchor = ref(null)
const combosAnchor = ref(null)

const selectedComboObj = computed(() => combinations.value.find((c) => c.id === selectedCombo.value) || null)
const selectedComboName = computed(() => selectedComboObj.value?.name || '')
const selectedComboStatus = computed(() => selectedComboObj.value?.status || { repos: [] })

let ws = null
let retry = null
const online = computed(() => status.value === 'server on')

function connect() {
  ws = new WebSocket(WS_URL)
  // watchdog: si queda colgado en CONNECTING (no dispara onopen/onerror), reintenta
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
        flows.value = d.flows || []
        combinations.value = d.combinations || []
        summary.value = d.summary || { repos: [], links: [] }
        nodeCount.value = d.nodes || 0
        if (selectedCombo.value && !combinations.value.find((c) => c.id === selectedCombo.value)) {
          selectedCombo.value = ''
        } else if (selectedCombo.value) {
          requestComboGraphs()
        }
        break
      case 'repo_branches':
        if (d.ok) branches.value = d.branches || {}
        break
      case 'combo_graphs':
        if (d.ok && d.id === selectedCombo.value) {
          comboGraphs.value = d.graphs || []
          if (scrollPending) { scrollPending = false; nextTick(scrollToFlows) }
        }
        break
      case 'alignment':
        if (d.id === selectedCombo.value) {
          aligning.value = false
          alignResults.value = d.results || []
          requestComboGraphs()
        }
        break
    }
  }
  ws.onclose = () => { status.value = 'desconectado'; scheduleRetry() }
  ws.onerror = () => { try { ws.close() } catch {} ; scheduleRetry() }
}
function scheduleRetry() { clearTimeout(retry); retry = setTimeout(connect, 1500) }

function send(obj) { if (online.value) ws.send(JSON.stringify(obj)) }

function scrollToFlows() { flowsAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
function scrollToCombos() { combosAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

function showToast(msg) { toast.value = msg; setTimeout(() => (toast.value = ''), 2200) }

// combinaciones de ramas
function requestBranches() { send({ type: 'repo_branches' }) }
function onSaveCombination({ name, targets }) { send({ type: 'save_combination', name, targets }) }
function onDeleteCombination(id) { send({ type: 'delete_combination', id }) }
function onSelectCombo(id) {
  selectedCombo.value = selectedCombo.value === id ? '' : id
  comboGraphs.value = []
  copiedKey.value = ''
  alignResults.value = []
  aligning.value = false
  if (selectedCombo.value) {
    aligning.value = true
    scrollPending = true
    send({ type: 'align_combination', id: selectedCombo.value })
  }
}
function requestComboGraphs() { if (selectedCombo.value) send({ type: 'combo_graphs', id: selectedCombo.value }) }

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

// copiar el árbol de UN camino del grafo (canal + ese lender, o todo)
async function copyTree({ group, key, label }) {
  const g = comboGraphs.value.find((x) => x.group === group)
  const text = g?.trees?.[key]
  if (!text) return
  if (await writeClipboard(text)) {
    copiedKey.value = group + '::' + key
    setTimeout(() => (copiedKey.value = ''), 1500)
    showToast(`✓ ${label || 'árbol'} copiado · ${Math.round(text.length / 1000)}k caracteres`)
  }
}
async function copyText(text, label) {
  if (await writeClipboard(text)) showToast(`✓ ${label} copiado`)
}
</script>

<template>
  <div class="wrap">
    <header class="top">
      <div class="brand">
        <Waypoints class="logo-mark" :size="28" :stroke-width="1.6" />
        <div>
          <h1>Atlas</h1>
          <p class="tag">mapa de flujos cross-repo · CreditOp</p>
        </div>
      </div>
      <div class="stats">
        <span class="pill" :class="online ? 'on' : 'off'">{{ status }}</span>
        <span class="stat">{{ repos.length }} repos</span>
        <span class="stat">{{ nodeCount }} nodos</span>
        <span class="stat live" @click="scrollToCombos">{{ combinations.length }} combinaciones</span>
      </div>
    </header>

    <div class="map-bar" @click="mapCollapsed = !mapCollapsed">
      <component :is="mapCollapsed ? ChevronRight : ChevronDown" class="map-caret" :size="16" />
      <b>Mapa del ecosistema</b>
      <span class="section-hint">{{ repos.length }} repos · {{ nodeCount }} nodos · datos compartidos</span>
    </div>
    <MapView v-show="!mapCollapsed" :summary="summary" />

    <div ref="combosAnchor">
      <CombinationPanel
        :combinations="combinations"
        :repos="summary.repos"
        :branches="branches"
        :selected="selectedCombo"
        @save="onSaveCombination"
        @delete="onDeleteCombination"
        @need-branches="requestBranches"
        @select="onSelectCombo"
      />
    </div>

    <div ref="flowsAnchor">
      <FlowGraph
        v-if="selectedCombo"
        :combo-name="selectedComboName"
        :graphs="comboGraphs"
        :status="selectedComboStatus"
        :copied-key="copiedKey"
        :aligning="aligning"
        :align-results="alignResults"
        @copy="copyTree"
        @copy-text="copyText"
      />
      <div v-else-if="combinations.length" class="flow-placeholder panel-section">
        <div class="ph-steps">
          <span class="ph-step"><b>1</b> Elegí una combinación de ramas ↑</span>
          <span class="ph-arrow">→</span>
          <span class="ph-step"><b>2</b> Mirá su flujo como grafo (canal → lenders)</span>
          <span class="ph-arrow">→</span>
          <span class="ph-step"><b>3</b> Copiá el árbol de un camino para pegarlo a un LLM</span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div class="toast-wrap">
        <div v-if="toast" class="toast">{{ toast }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.map-bar { display: flex; align-items: center; gap: 10px; margin-top: 4px; padding: 6px 4px; cursor: pointer; user-select: none; }
.map-bar:hover .map-caret { color: var(--accent); }
.map-caret { color: var(--muted); font-size: 12px; width: 14px; }
.map-bar b { font-size: 14px; }

.flow-placeholder { display: flex; align-items: center; justify-content: center; padding: 26px 18px; }
.ph-steps { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: 13px; }
.ph-step b { display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: var(--chip); color: var(--accent); align-items: center; justify-content: center; font-size: 12px; margin-right: 6px; }
.ph-arrow { color: var(--border); }
</style>
