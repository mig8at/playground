<script setup lang="ts">
import { computed, ref, shallowRef, onMounted } from 'vue'
import { VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import TableNode from '../components/TableNode.vue'
import DetailPanel from '../components/DetailPanel.vue'
import { buildGraph, layoutClustered, neighborsOf, contextColor, contextLabel } from '../lib/transform.js'
import type { Modelo } from '../lib/types.js'
import raw from '../data/modelo-dominio.json'

const modelo = raw as unknown as Modelo
const STORAGE_KEY = 'creditop-erd-positions-v1'

const { fitView, onNodeClick, onPaneClick, onNodeDragStop } = useVueFlow()

const built = buildGraph(modelo)
const dir: 'LR' | 'TB' = 'TB'

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}
function savePositions(ns: Node[]) {
  const map: Record<string, { x: number; y: number }> = {}
  for (const n of ns) map[n.id] = n.position
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

function initialLayout(): Node[] {
  const saved = loadPositions()
  const laid = layoutClustered(built.nodes, built.edges, 3, dir)
  if (Object.keys(saved).length) {
    return laid.map((n) => (saved[n.id] ? { ...n, position: saved[n.id] } : n))
  }
  return laid
}

const nodes = shallowRef<Node[]>(initialLayout())
const edges = shallowRef<Edge[]>(built.edges)

// ---- estado de UI ----
const contexts = modelo.contextos
const active = ref<Set<string>>(new Set(contexts.map((c) => c.key)))
const selectedKey = ref<string | null>(null)
const query = ref('')

// busca por nombre/clave (nueva), por tabla legacy base (vieja),
// y por las tablas viejas absorbidas/unificadas en esta entidad
function matchesQuery(e: {
  name: string
  key: string
  legacy?: { tabla?: string; ref?: string; absorbe?: string[] }
}): boolean {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  if (e.name.toLowerCase().includes(q) || e.key.toLowerCase().includes(q)) return true
  const l = e.legacy
  if (!l) return false
  return (
    (l.tabla ?? '').toLowerCase().includes(q) ||
    (l.ref ?? '').toLowerCase().includes(q) ||
    !!l.absorbe?.some((t) => t.toLowerCase().includes(q))
  )
}

const matchCount = computed(() => {
  if (!query.value.trim()) return null
  return modelo.entidades.filter((e) => active.value.has(e.contexto) && matchesQuery(e)).length
})

const selectedEntidad = computed(
  () => modelo.entidades.find((e) => e.key === selectedKey.value) ?? null,
)

const counts = computed(() => {
  const c: Record<string, number> = {}
  for (const e of modelo.entidades) c[e.contexto] = (c[e.contexto] || 0) + 1
  return c
})

// ---- aplicar filtros/resaltado a nodes & edges ----
function applyView() {
  const neigh = selectedKey.value
    ? neighborsOf(selectedKey.value, edges.value as { source: string; target: string }[])
    : null

  nodes.value = nodes.value.map((n): any => {
    const hidden = !active.value.has(n.data!.entidad.contexto) || !matchesQuery(n.data!.entidad)
    const dimmed = !!neigh && !neigh.has(n.id)
    return { ...n, hidden, data: { ...n.data!, dimmed, selected: n.id === selectedKey.value } }
  })

  const visible = new Set(nodes.value.filter((n) => !n.hidden).map((n) => n.id))
  edges.value = edges.value.map((e): any => {
    const hidden = !visible.has(e.source) || !visible.has(e.target)
    const dim = !!neigh && (!neigh.has(e.source) || !neigh.has(e.target))
    return {
      ...e,
      hidden,
      animated: !!neigh && !dim,
      style: { ...e.style, opacity: dim ? 0.12 : 1 },
    }
  })
}

// ---- acciones ----
function toggleContext(key: string) {
  active.value.has(key) ? active.value.delete(key) : active.value.add(key)
  active.value = new Set(active.value)
  applyView()
}
function allContexts(on: boolean) {
  active.value = on ? new Set(contexts.map((c) => c.key)) : new Set()
  applyView()
}
function selectNode(key: string | null) {
  selectedKey.value = key
  applyView()
  if (key) {
    const n = nodes.value.find((x) => x.id === key)
    if (n)
      setTimeout(
        () => fitView({ nodes: [key], padding: 0.6, duration: 400, maxZoom: 1.2 }),
        20,
      )
  }
}

onNodeClick(({ node }) => selectNode(node.id))
onPaneClick(() => selectNode(null))
onNodeDragStop(() => savePositions(nodes.value))

onMounted(() => {
  applyView()
  setTimeout(() => fitView({ padding: 0.15 }), 80)
})
</script>

<template>
  <div class="app">
    <div class="ctxbar">
      <button class="ctx-all" @click="allContexts(true)">Todos</button>
      <button class="ctx-all" @click="allContexts(false)">Ninguno</button>
      <button
        v-for="c in contexts"
        :key="c.key"
        class="ctx-chip"
        :class="{ off: !active.has(c.key) }"
        :style="{ '--ctx': contextColor(c.key) }"
        :title="c.desc"
        @click="toggleContext(c.key)"
      >
        <span class="dot" />
        {{ contextLabel(c.key) }}
        <em>{{ counts[c.key] || 0 }}</em>
      </button>

      <div class="ctx-search">
        <input
          v-model="query"
          @input="applyView"
          type="search"
          placeholder="Buscar tabla (nueva o vieja)…"
          title="Busca por nombre/clave nueva o por tabla legacy"
        />
        <span v-if="matchCount !== null" class="match">{{ matchCount }} resultado(s)</span>
      </div>
    </div>

    <main class="canvas">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :min-zoom="0.05"
        :max-zoom="2.5"
        fit-view-on-init
        :default-edge-options="{ type: 'smoothstep' }"
      >
        <template #node-table="props">
          <TableNode :id="props.id" :data="props.data" />
        </template>

        <Background :gap="22" pattern-color="#e2e8f0" />
        <Controls />
        <MiniMap
          :node-color="(n: any) => contextColor((n.data?.entidad?.contexto) || '')"
          pannable
          zoomable
        />
      </VueFlow>

      <DetailPanel
        :entidad="selectedEntidad"
        :modelo="modelo"
        @close="selectNode(null)"
        @goto="selectNode"
      />

      <div class="legend">
        <div><span class="ln solid" /> relación interna</div>
        <div><span class="ln dashed" /> referencia entre contextos</div>
        <div><span class="sw" style="background:#f59e0b" /> PK &nbsp; <span class="sw" style="background:#3b82f6" /> FK &nbsp; <span class="sw" style="background:#475569" /> ref. AWS &nbsp; <span style="color:#8b5cf6;font-weight:700">↯</span> emite evento &nbsp; ◆ aggregate root</div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f8fafc;
}
.ctxbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 7px 14px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.ctx-all {
  font-size: 11px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
  color: #475569;
}
.ctx-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 3px 10px 3px 8px;
  cursor: pointer;
  color: #334155;
}
.ctx-chip .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ctx);
}
.ctx-chip em {
  font-style: normal;
  font-size: 10px;
  color: #94a3b8;
  background: #f1f5f9;
  border-radius: 999px;
  padding: 0 5px;
}
.ctx-chip.off {
  opacity: 0.4;
  text-decoration: line-through;
}
.ctx-search {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ctx-search input {
  width: 240px;
  padding: 5px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  font-size: 12px;
  color: #334155;
  background: #f8fafc;
}
.ctx-search input:focus {
  outline: none;
  border-color: #94a3b8;
  background: #fff;
}
.ctx-search input::placeholder {
  color: #94a3b8;
}
.ctx-search .match {
  font-size: 10px;
  color: #94a3b8;
  white-space: nowrap;
}

.canvas {
  position: relative;
  flex: 1;
  min-height: 0;
}
.legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: #475569;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 5;
}
.legend .ln {
  display: inline-block;
  width: 22px;
  height: 0;
  vertical-align: middle;
  margin-right: 4px;
}
.legend .ln.solid {
  border-top: 2px solid #64748b;
}
.legend .ln.dashed {
  border-top: 2px dashed #64748b;
}
.legend .sw {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  vertical-align: middle;
}
</style>
