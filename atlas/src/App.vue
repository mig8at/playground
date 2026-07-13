<script setup>
// Atlas — mapa cross-repo + combinaciones de ramas + flujos por combinación
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import MapView from './MapView.vue'
import CombinationPanel from './CombinationPanel.vue'
import FlowsSection from './FlowsSection.vue'

const WS_URL = 'ws://localhost:8788/ws'

const status = ref('conectando…')
const repos = ref([])
const flows = ref([])
const combinations = ref([])
const branches = ref({})
const selectedCombo = ref('')
const comboTrees = ref({}) // group → árbol Rino de esa fila/flujo
const copiedGroup = ref('') // fila recién copiada
const summary = ref({ repos: [], links: [] })
const nodeCount = ref(0)

const comboFlows = computed(() =>
  flows.value
    .filter((f) => f.combination === selectedCombo.value)
    .slice()
    .sort((a, b) => new Date(a.created) - new Date(b.created)),
)
const selectedComboName = computed(() => combinations.value.find((c) => c.id === selectedCombo.value)?.name || '')

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
          requestComboTrees() // los flujos pudieron cambiar → refrescar los árboles
        }
        break
      case 'repo_branches':
        if (d.ok) branches.value = d.branches || {}
        break
      case 'combo_trees':
        if (d.ok && d.id === selectedCombo.value) comboTrees.value = d.trees || {}
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
  comboTrees.value = {}
  copiedGroup.value = ''
  if (selectedCombo.value) requestComboTrees()
}
function requestComboTrees() { if (selectedCombo.value) send({ type: 'combo_trees', id: selectedCombo.value }) }

// copiar el árbol completo de UNA fila/flujo (todas sus etapas)
async function copyTree(group) {
  const text = comboTrees.value[group]
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
    copiedGroup.value = group
    setTimeout(() => (copiedGroup.value = ''), 1500)
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
    <FlowsSection
      v-if="selectedCombo"
      :combo-name="selectedComboName"
      :flows="comboFlows"
      :trees="comboTrees"
      :copied-group="copiedGroup"
      @copy="copyTree"
    />
  </div>
</template>
