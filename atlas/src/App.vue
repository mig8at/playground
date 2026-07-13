<script setup>
// Atlas — mapa cross-repo + combinaciones de ramas + flujos-grafo (canal→lenders)
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import MapView from './MapView.vue'
import CombinationPanel from './CombinationPanel.vue'
import FlowGraph from './FlowGraph.vue'

const WS_URL = 'ws://localhost:8788/ws'

const status = ref('conectando…')
const repos = ref([])
const flows = ref([])
const combinations = ref([])
const branches = ref({})
const selectedCombo = ref('')
const comboGraphs = ref([]) // [GroupGraph] canal→lenders con árboles por camino
const copiedKey = ref('') // `${group}::${key}` recién copiado
const summary = ref({ repos: [], links: [] })
const nodeCount = ref(0)

const comboFlows = computed(() =>
  flows.value
    .filter((f) => f.combination === selectedCombo.value)
    .slice()
    .sort((a, b) => new Date(a.created) - new Date(b.created)),
)
const selectedComboObj = computed(() => combinations.value.find((c) => c.id === selectedCombo.value) || null)
const selectedComboName = computed(() => selectedComboObj.value?.name || '')
const selectedComboStatus = computed(() => selectedComboObj.value?.status || { repos: [] })

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
        combinations.value = d.combinations || []
        summary.value = d.summary || { repos: [], links: [] }
        nodeCount.value = d.nodes || 0
        if (selectedCombo.value && !combinations.value.find((c) => c.id === selectedCombo.value)) {
          selectedCombo.value = ''
        } else if (selectedCombo.value) {
          requestComboGraphs() // los flujos pudieron cambiar → refrescar los grafos
        }
        break
      case 'repo_branches':
        if (d.ok) branches.value = d.branches || {}
        break
      case 'combo_graphs':
        if (d.ok && d.id === selectedCombo.value) comboGraphs.value = d.graphs || []
        break
    }
  }
  ws.onclose = () => { status.value = 'desconectado'; retry = setTimeout(connect, 1500) }
  ws.onerror = () => ws && ws.close()
}

function send(obj) { if (online.value) ws.send(JSON.stringify(obj)) }

// combinaciones de ramas
function requestBranches() { send({ type: 'repo_branches' }) }
function onSaveCombination({ name, targets }) { send({ type: 'save_combination', name, targets }) }
function onDeleteCombination(id) { if (confirm('¿Borrar esta combinación?')) send({ type: 'delete_combination', id }) }
function onSelectCombo(id) {
  selectedCombo.value = selectedCombo.value === id ? '' : id
  comboGraphs.value = []
  copiedKey.value = ''
  if (selectedCombo.value) requestComboGraphs()
}
function requestComboGraphs() { if (selectedCombo.value) send({ type: 'combo_graphs', id: selectedCombo.value }) }

// copiar el árbol de UN camino del grafo (canal + ese lender, o todo)
async function copyTree({ group, key }) {
  const g = comboGraphs.value.find((x) => x.group === group)
  const text = g?.trees?.[key]
  if (!text) return
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
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
    copiedKey.value = group + '::' + key
    setTimeout(() => (copiedKey.value = ''), 1500)
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
        <span class="stat">{{ combinations.length }} combinaciones</span>
      </div>
    </header>

    <MapView :summary="summary" />
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
    <FlowGraph
      v-if="selectedCombo"
      :combo-name="selectedComboName"
      :graphs="comboGraphs"
      :status="selectedComboStatus"
      :copied-key="copiedKey"
      @copy="copyTree"
    />
  </div>
</template>
