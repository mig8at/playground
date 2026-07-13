<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import MapView from './MapView.vue'
import FlowCatalog from './FlowCatalog.vue'

const WS_URL = 'ws://localhost:8788/ws'

const status = ref('conectando…')
const view = ref('mapa')          // 'mapa' | 'lista'
const repos = ref([])
const flows = ref([])
const summary = ref({ repos: [], links: [] })
const nodeCount = ref(0)

const selected = ref(null)   // { flow, nodes }
const edges = ref({})        // nodeId -> edges[]
const nodeFiles = ref(null)  // { repo, lang, label, total, files, loading }

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
        // si el flujo abierto sigue existiendo, refrescar su detalle
        if (selected.value && !flows.value.find(f => f.id === selected.value.flow.id)) {
          selected.value = null
        }
        break
      case 'flow_detail':
        if (d.ok) { selected.value = { flow: d.flow, nodes: d.nodes || [] }; edges.value = {} }
        break
      case 'connections':
        if (d.ok) edges.value = { ...edges.value, [d.id]: d.edges || [] }
        break
      case 'node_files':
        if (d.ok && nodeFiles.value && nodeFiles.value.repo === d.repo && nodeFiles.value.lang === d.lang) {
          nodeFiles.value = { ...nodeFiles.value, total: d.total, files: d.files || [], loading: false }
        }
        break
    }
  }
  ws.onclose = () => { status.value = 'desconectado'; retry = setTimeout(connect, 1500) }
  ws.onerror = () => ws && ws.close()
}

function send(obj) { if (online.value) ws.send(JSON.stringify(obj)) }

function onPick({ repo, lang, label }) {
  nodeFiles.value = { repo, lang, label, total: null, files: null, loading: true }
  send({ type: 'node_files', repo, lang: lang || '' })
}
function closeNodeFiles() { nodeFiles.value = null }

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
        <div class="toggle">
          <button :class="{ sel: view === 'mapa' }" @click="view = 'mapa'">Mapa</button>
          <button :class="{ sel: view === 'lista' }" @click="view = 'lista'">Lista</button>
        </div>
        <span class="pill" :class="online ? 'on' : 'off'">{{ status }}</span>
        <span class="stat">{{ repos.length }} repos</span>
        <span class="stat">{{ nodeCount }} nodos</span>
        <span class="stat">{{ flows.length }} flujos</span>
      </div>
    </header>

    <template v-if="view === 'mapa'">
      <MapView :summary="summary" @pick="onPick" />

      <section v-if="nodeFiles" class="nodefiles">
        <div class="nf-head">
          <div>
            <h2>{{ nodeFiles.label }}</h2>
            <p class="nf-sub" v-if="!nodeFiles.loading">
              top {{ nodeFiles.files.length }} de {{ nodeFiles.total }} archivos · por relevancia
            </p>
            <p class="nf-sub" v-else>cargando…</p>
          </div>
          <button class="x" @click="closeNodeFiles" title="cerrar">×</button>
        </div>
        <ul class="files" v-if="nodeFiles.files">
          <li v-for="n in nodeFiles.files" :key="n.id">
            <div class="file-row">
              <code class="path">{{ n.path }}</code>
              <span class="lang">{{ n.lang }}</span>
              <span v-if="n.routes && n.routes.length" class="sig route">{{ n.routes.length }} rutas</span>
              <span v-if="n.tables && n.tables.length" class="sig table">{{ n.tables.length }} tablas</span>
              <span class="muted">{{ shortId(n.id) }}</span>
            </div>
            <div v-if="n.definitions && n.definitions.length" class="defs">
              <span v-for="d in n.definitions.slice(0, 8)" :key="d" class="def">{{ d }}</span>
            </div>
          </li>
        </ul>
      </section>

      <FlowCatalog />
    </template>

    <main v-else class="cols">
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
                <div v-if="n.tables && n.tables.length" class="tables">
                  <span v-for="t in n.tables.slice(0, 10)" :key="t" class="tbl">🗄 {{ t }}</span>
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
