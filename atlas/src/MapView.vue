<script setup>
import { computed } from 'vue'
import { VueFlow, Handle, Position } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

// summary = { repos: [{alias, node_count, langs}], links: [{from,to,kind,count}] }
const props = defineProps({ summary: { type: Object, default: () => ({ repos: [], links: [] }) } })
const emit = defineEmits(['pick'])

// click en un nodo-repo → pedir su array de archivos (rankeado)
function onNodeClick({ node }) {
  const d = node?.data
  if (d?.repo) emit('pick', { repo: d.repo, lang: d.lang || '', label: d.title || node.id })
}

const repoMap = computed(() => {
  const m = {}
  for (const r of (props.summary.repos || [])) m[r.alias] = r
  return m
})
function count(alias) { return repoMap.value[alias]?.node_count || 0 }
function lang(alias, l) { return repoMap.value[alias]?.langs?.[l] || 0 }
function branch(alias) { return repoMap.value[alias]?.branch || '' }

// suma de links cross-repo entre los dos grupos (aliados → originaciones)
const bridge = computed(() => {
  const orig = new Set(['legacy-backend', 'frontend-monorepo'])
  let tables = 0, other = 0
  for (const lk of (props.summary.links || [])) {
    if (lk.from === 'application' && orig.has(lk.to)) {
      if (lk.kind === 'table') tables += lk.count
      else other += lk.count
    }
  }
  return { tables, other }
})

// link interno de originaciones (frontend → legacy, route HTTP)
const httpLink = computed(() => {
  for (const lk of (props.summary.links || [])) {
    if (lk.from === 'frontend-monorepo' && lk.to === 'legacy-backend') return lk.count
  }
  return 0
})

const nodes = computed(() => [
  // ── grupo ORIGINACIONES (izquierda) ──
  { id: 'originaciones', type: 'group', position: { x: 40, y: 80 },
    data: { label: 'ORIGINACIONES', sub: 'flujo de originación' },
    style: { width: '320px', height: '250px' } },
  { id: 'legacy-backend', type: 'repo', parentNode: 'originaciones', extent: 'parent',
    position: { x: 20, y: 62 },
    data: { title: 'legacy-backend', sub: 'Laravel · API', n: count('legacy-backend'), accent: '#f0883e', repo: 'legacy-backend', branch: branch('legacy-backend') } },
  { id: 'frontend-monorepo', type: 'repo', parentNode: 'originaciones', extent: 'parent',
    position: { x: 20, y: 158 },
    data: { title: 'frontend-monorepo', sub: 'React · wizard', n: count('frontend-monorepo'), accent: '#4c9aff', repo: 'frontend-monorepo', branch: branch('frontend-monorepo') } },

  // ── grupo ALIADOS (derecha) ──
  { id: 'aliados', type: 'group', position: { x: 560, y: 80 },
    data: { label: 'ALIADOS', sub: 'application · Inertia' },
    style: { width: '320px', height: '250px' } },
  { id: 'app-vue', type: 'repo', parentNode: 'aliados', extent: 'parent',
    position: { x: 20, y: 62 },
    data: { title: 'Vue · aliados', sub: 'resources/js', n: lang('application', 'vue'), accent: '#42b883', repo: 'application', lang: 'vue', branch: branch('application') } },
  { id: 'app-backend', type: 'repo', parentNode: 'aliados', extent: 'parent',
    position: { x: 20, y: 158 },
    data: { title: 'Backend · Laravel', sub: 'app/', n: lang('application', 'php'), accent: '#f0883e', repo: 'application', lang: 'php', branch: branch('application') } },
])

const edges = computed(() => [
  // aliados → originaciones (derecha → izquierda): el puente de datos
  { id: 'bridge', source: 'aliados', target: 'originaciones', type: 'smoothstep',
    animated: true, label: `🗄 ${bridge.value.tables} tablas compartidas`,
    style: { stroke: '#e3b341', strokeWidth: 2 },
    labelStyle: { fill: '#e3b341', fontWeight: 600 },
    labelBgStyle: { fill: '#1c232d' } },
  // interno de originaciones: frontend → legacy (HTTP)
  { id: 'http', source: 'frontend-monorepo', target: 'legacy-backend', type: 'smoothstep',
    label: `${httpLink.value} ruta HTTP`, style: { stroke: '#4c9aff', strokeWidth: 1.5 },
    labelStyle: { fill: '#4c9aff', fontSize: '11px' }, labelBgStyle: { fill: '#1c232d' } },
])
</script>

<template>
  <div class="mapwrap">
    <VueFlow :nodes="nodes" :edges="edges" fit-view-on-init :min-zoom="0.4" :max-zoom="1.5"
             :zoom-on-scroll="false" :pan-on-scroll="false" :prevent-scrolling="false"
             @node-click="onNodeClick">
      <Background pattern-color="#2a3340" :gap="20" />

      <!-- nodo grupo (contenedor) -->
      <template #node-group="{ data }">
        <div class="group-node">
          <div class="group-head">
            <span class="group-title">{{ data.label }}</span>
            <span class="group-sub">{{ data.sub }}</span>
          </div>
        </div>
        <Handle type="source" :position="Position.Left" />
        <Handle type="target" :position="Position.Right" />
        <Handle type="target" :position="Position.Left" />
        <Handle type="source" :position="Position.Right" />
      </template>

      <!-- nodo repo (hijo) -->
      <template #node-repo="{ data }">
        <div class="repo-node" :style="{ borderLeftColor: data.accent }">
          <div class="repo-title">{{ data.title }}</div>
          <div class="repo-sub">{{ data.sub }}</div>
          <div class="repo-foot">
            <span class="repo-n">{{ data.n }} nodos</span>
            <span v-if="data.branch" class="repo-branch">⑂ {{ data.branch }}</span>
          </div>
        </div>
        <Handle type="target" :position="Position.Left" />
        <Handle type="source" :position="Position.Right" />
      </template>
    </VueFlow>
  </div>
</template>

<style scoped>
.mapwrap { height: 560px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }

.group-node {
  width: 100%; height: 100%;
  border: 1.5px dashed var(--border); border-radius: 12px;
  background: rgba(76, 154, 255, .04);
}
.group-head { padding: 10px 14px; }
.group-title { font-size: 13px; font-weight: 700; letter-spacing: 1px; color: var(--text); }
.group-sub { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }

.repo-node {
  width: 280px; background: var(--panel2); border: 1px solid var(--border);
  border-left: 3px solid var(--accent); border-radius: 8px; padding: 10px 12px;
  cursor: pointer; transition: border-color .15s;
}
.repo-node:hover { border-color: var(--accent); }
.repo-title { font-size: 14px; font-weight: 600; color: var(--text); }
.repo-sub { font-size: 11px; color: var(--muted); margin-top: 2px; font-family: ui-monospace, monospace; }
.repo-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; gap: 8px; }
.repo-n { font-size: 11px; color: var(--muted); }
.repo-branch { font-size: 10px; color: #bc8cff; background: rgba(188,140,255,.12); padding: 1px 7px; border-radius: 999px; font-family: ui-monospace, monospace; white-space: nowrap; }

:deep(.vue-flow__handle) { opacity: 0; }
</style>
