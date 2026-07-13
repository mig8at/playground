<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const WS_URL = 'ws://localhost:8788/ws'

const status = ref('conectando…')
const repos = ref([])
const flows = ref([])
const nodeCount = ref(0)
const scanPath = ref('')
const scanning = ref(false)
const scanMsg = ref('')

const selected = ref(null)   // { flow, nodes }
const edges = ref({})        // nodeId -> edges[]

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
        nodeCount.value = d.nodes || 0
        // si el flujo abierto sigue existiendo, refrescar su detalle
        if (selected.value && !flows.value.find(f => f.id === selected.value.flow.id)) {
          selected.value = null
        }
        break
      case 'scan_result':
        scanning.value = false
        scanMsg.value = d.ok
          ? `✓ ${d.repo.alias} · ${d.repo.node_count} nodos`
          : `✗ ${d.error}`
        if (d.ok) scanPath.value = ''
        break
      case 'flow_detail':
        if (d.ok) { selected.value = { flow: d.flow, nodes: d.nodes || [] }; edges.value = {} }
        break
      case 'connections':
        if (d.ok) edges.value = { ...edges.value, [d.id]: d.edges || [] }
        break
    }
  }
  ws.onclose = () => { status.value = 'desconectado'; retry = setTimeout(connect, 1500) }
  ws.onerror = () => ws && ws.close()
}

function send(obj) { if (online.value) ws.send(JSON.stringify(obj)) }

function scan() {
  const p = scanPath.value.trim()
  if (!p) return
  scanning.value = true
  scanMsg.value = ''
  send({ type: 'scan', path: p })
}
function openFlow(id) { send({ type: 'flow', id }) }
function delFlow(id) { if (confirm('¿Borrar este flujo?')) send({ type: 'delete_flow', id }) }
function loadConns(id) { send({ type: 'connections', id }) }

// agrupa los nodos del flujo abierto por repo
const grouped = computed(() => {
  if (!selected.value) return []
  const by = {}
  for (const n of selected.value.nodes) (by[n.repo] ||= []).push(n)
  return Object.entries(by).map(([repo, nodes]) => ({ repo, nodes }))
})

function shortId(id) { return id.split(':').pop() }

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

    <div class="scanbar">
      <input
        v-model="scanPath"
        placeholder="/Users/…/CREDITOP/github/legacy-backend  → indexar repo"
        @keyup.enter="scan"
      />
      <button :disabled="scanning || !online" @click="scan">
        {{ scanning ? 'indexando…' : 'Indexar repo' }}
      </button>
      <span v-if="scanMsg" class="scanmsg">{{ scanMsg }}</span>
    </div>

    <main class="cols">
      <!-- IZQ: repos + flujos -->
      <aside class="side">
        <section>
          <h2>Repos</h2>
          <p v-if="!repos.length" class="empty">Ningún repo indexado todavía.</p>
          <ul class="repos">
            <li v-for="r in repos" :key="r.alias">
              <span class="dot"></span>
              <b>{{ r.alias }}</b>
              <span class="muted">{{ r.node_count }}</span>
            </li>
          </ul>
        </section>

        <section>
          <h2>Flujos guardados</h2>
          <p v-if="!flows.length" class="empty">
            Aún no hay flujos. Se crean desde el MCP (<code>atlas_save_flow</code>) y aparecen acá en vivo.
          </p>
          <ul class="flows">
            <li
              v-for="f in flows"
              :key="f.id"
              :class="{ active: selected && selected.flow.id === f.id }"
              @click="openFlow(f.id)"
            >
              <div class="flow-head">
                <b>{{ f.name }}</b>
                <button class="x" @click.stop="delFlow(f.id)" title="borrar">×</button>
              </div>
              <div class="flow-meta">
                <span class="chip">{{ f.files }} archivos</span>
                <span v-for="rp in f.repos" :key="rp" class="chip repo">{{ rp }}</span>
              </div>
            </li>
          </ul>
        </section>
      </aside>

      <!-- DER: detalle del flujo -->
      <section class="detail">
        <div v-if="!selected" class="placeholder">
          <p>Seleccioná un flujo para ver sus archivos, agrupados por repo.</p>
        </div>
        <template v-else>
          <div class="detail-head">
            <h2>{{ selected.flow.name }}</h2>
            <p v-if="selected.flow.description" class="desc">{{ selected.flow.description }}</p>
          </div>
          <div v-for="g in grouped" :key="g.repo" class="repogroup">
            <h3><span class="dot"></span>{{ g.repo }} <span class="muted">{{ g.nodes.length }}</span></h3>
            <ul class="files">
              <li v-for="n in g.nodes" :key="n.id">
                <div class="file-row" @click="loadConns(n.id)">
                  <code class="path">{{ n.path }}</code>
                  <span class="lang">{{ n.lang }}</span>
                  <span class="muted">{{ shortId(n.id) }}</span>
                </div>
                <div v-if="n.definitions && n.definitions.length" class="defs">
                  <span v-for="d in n.definitions.slice(0, 8)" :key="d" class="def">{{ d }}</span>
                </div>
                <div v-if="edges[n.id]" class="edges">
                  <p v-if="!edges[n.id].length" class="muted small">sin conexiones detectadas</p>
                  <div v-for="(e, i) in edges[n.id]" :key="i" class="edge" :class="e.kind">
                    <span class="ekind">{{ e.kind }}</span>
                    <span class="edetail">{{ e.detail }}</span>
                    <span class="muted small">{{ e.from === n.id ? '→ ' + shortId(e.to) : '← ' + shortId(e.from) }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </template>
      </section>
    </main>
  </div>
</template>
