<script setup>
import { computed } from 'vue'
import { VueFlow, Handle, Position } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

// La combinación ES el flujo: un grafo Vue Flow con todos sus flujos de negocio
// (canal → lenders) y, en la leyenda, las ramas actuales de cada repo (drift).
const props = defineProps({
  comboName: { type: String, default: '' },
  graphs: { type: Array, default: () => [] }, // [{group, channel, lenders, trees}]
  status: { type: Object, default: () => ({ repos: [] }) }, // combinación: {aligned, repos:[{alias,target,current,state}]}
  copiedKey: { type: String, default: '' },
  aligning: { type: Boolean, default: false },
  alignResults: { type: Array, default: () => [] }, // [{alias,was,now,target,switched,pulled,error,manual}]
})
const emit = defineEmits(['copy'])

// drift por repo (para pintar los chips de los nodos)
const drift = computed(() => {
  const m = {}
  for (const r of (props.status?.repos || [])) m[r.alias] = r.state === 'aligned' ? 'ok' : 'drift'
  return m
})

function emitCopy(group, key) { emit('copy', { group, key }) }
function isCopied(group, key) { return props.copiedKey === group + '::' + key }

// ── layout manual: cada flujo de negocio en su carril; canal izq → lenders der ──
const NODE_H = 78, ROW_H = 100, COL_X = 320, LANE_GAP = 40

const layout = computed(() => {
  const nodes = [], edges = []
  let laneY = 0
  for (const g of props.graphs) {
    const lenders = g.lenders || []
    const laneH = Math.max(1, lenders.length) * ROW_H
    if (g.channel) {
      nodes.push({
        id: `${g.group}:channel`, type: 'stage', position: { x: 0, y: laneY + (laneH - NODE_H) / 2 },
        data: { ...g.channel, kind: 'channel', drift: drift.value, copyGroup: g.group, copyKey: '__all__',
          hasTree: !!g.trees['__all__'], allLabel: lenders.length ? '⧉ todo el flujo' : '⧉ copiar' },
      })
    }
    lenders.forEach((l, i) => {
      const y = laneY + i * ROW_H + (ROW_H - NODE_H) / 2
      nodes.push({
        id: `${g.group}:${l.id}`, type: 'stage', position: { x: COL_X, y },
        data: { ...l, kind: 'lender', drift: drift.value, copyGroup: g.group, copyKey: l.id, hasTree: !!g.trees[l.id] },
      })
      if (g.channel) {
        edges.push({ id: `${g.group}:${l.id}:e`, source: `${g.group}:channel`, target: `${g.group}:${l.id}`,
          type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 } })
      }
    })
    laneY += laneH + LANE_GAP
  }
  return { nodes, edges, height: Math.max(220, laneY) }
})
</script>

<template>
  <section class="flows">
    <div class="fl-head">
      <h2>Flujo de {{ comboName }}</h2>
      <span class="muted">grafo canal → lenders · click en un nodo copia el árbol de ese camino</span>
    </div>

    <!-- alineación: checkout + pull al seleccionar -->
    <div v-if="aligning" class="fg-align loading">⟳ alineando repos a {{ comboName }} (checkout + git pull)…</div>
    <div v-else-if="alignResults.length" class="fg-align">
      <template v-for="r in alignResults" :key="r.alias">
        <span v-if="r.error" class="fg-align-err">
          ✗ <b>{{ r.alias }}</b>: {{ r.error }} · <code>{{ r.manual }}</code>
        </span>
        <span v-else class="fg-align-ok">
          ✓ <b>{{ r.alias }}</b> {{ r.was !== r.now ? r.was + '→' + r.now : r.now }}{{ r.pulled ? ' · pull' : '' }}
        </span>
      </template>
    </div>

    <!-- ramas actuales por repo (drift vs la combinación) -->
    <div v-if="status?.repos?.length" class="fg-legend">
      <span v-for="r in status.repos" :key="r.alias" class="fg-branch" :class="r.state === 'aligned' ? 'ok' : 'drift'">
        <b>{{ r.alias }}</b> ⑂ {{ r.current }}
        <template v-if="r.state === 'off'">· esperado {{ r.target }}</template>
        <template v-else-if="r.state === 'moved'">· avanzó</template>
      </span>
    </div>

    <p v-if="!graphs.length" class="fl-empty">
      Sin flujos en esta combinación. Se crean vía el MCP (<code>atlas_save_flow</code> con <code>group</code> + <code>kind</code>).
    </p>

    <div v-else class="fg-canvas" :style="{ height: layout.height + 40 + 'px' }">
      <VueFlow :nodes="layout.nodes" :edges="layout.edges" fit-view-on-init :nodes-draggable="false"
               :min-zoom="0.4" :max-zoom="1.5" :zoom-on-scroll="false" :pan-on-scroll="false" :prevent-scrolling="false">
        <Background pattern-color="#2a3340" :gap="18" />
        <template #node-stage="{ data }">
          <div class="gnode" :class="data.kind">
            <div class="gnode-head">
              <span class="gtag" :class="data.kind">{{ data.kind === 'channel' ? 'canal' : 'lender' }}</span>
              <span class="gname">{{ data.name }}</span>
            </div>
            <span class="gmeta">{{ data.files }} archivos</span>
            <div class="grepos">
              <span v-for="r in data.repos" :key="r" class="grepo" :class="data.drift[r] || ''">{{ r }}</span>
            </div>
            <button class="gcopy" :disabled="!data.hasTree" @click="emitCopy(data.copyGroup, data.copyKey)">
              {{ isCopied(data.copyGroup, data.copyKey) ? '✓ copiado' : (data.kind === 'channel' ? (data.allLabel || '⧉ copiar') : '⧉ copiar') }}
            </button>
          </div>
          <Handle v-if="data.kind === 'channel'" type="source" :position="Position.Right" />
          <Handle v-if="data.kind === 'lender'" type="target" :position="Position.Left" />
        </template>
      </VueFlow>
    </div>
  </section>
</template>

<style scoped>
.flows { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.fl-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.fl-head h2 { font-size: 16px; }
.fl-empty { color: var(--muted); font-size: 13px; line-height: 1.5; }
.fl-empty code { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-size: 12px; }

.fg-align { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; font-size: 12px; }
.fg-align.loading { color: #e3b341; font-family: ui-monospace, monospace; }
.fg-align-ok { color: var(--green); font-family: ui-monospace, monospace; }
.fg-align-ok b, .fg-align-err b { color: var(--text); }
.fg-align-err { color: var(--red); font-family: ui-monospace, monospace; }
.fg-align-err code { background: var(--panel2); border: 1px solid var(--border); padding: 1px 6px; border-radius: 4px; color: var(--text); margin-left: 4px; }

.fg-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.fg-branch { font-size: 12px; font-family: ui-monospace, monospace; background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; }
.fg-branch b { color: var(--text); margin-right: 4px; }
.fg-branch.ok { color: var(--green); }
.fg-branch.drift { color: #e3b341; }

.fg-canvas { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }

.gnode { width: 200px; background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; }
.gnode.channel { border-left: 3px solid var(--accent); }
.gnode.lender { border-left: 3px solid #3fb950; }
.gnode-head { display: flex; align-items: center; gap: 6px; }
.gtag { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: var(--accent); }
.gtag.lender { color: #3fb950; }
.gname { font-size: 13px; font-weight: 600; color: var(--text); }
.gmeta { font-size: 10px; color: var(--muted); }
.grepos { display: flex; flex-wrap: wrap; gap: 3px; margin: 5px 0 6px; }
.grepo { font-size: 9px; padding: 1px 5px; border-radius: 4px; background: var(--chip); color: var(--muted); }
.grepo.ok { color: var(--green); background: rgba(63,185,80,.12); }
.grepo.drift { color: #e3b341; background: rgba(227,179,65,.14); }
.gcopy { width: 100%; background: var(--accent); color: #06101f; border: 0; border-radius: 6px; padding: 5px; font-weight: 600; font-size: 11px; cursor: pointer; }
.gcopy:disabled { opacity: .5; cursor: default; }
:deep(.vue-flow__handle) { opacity: 0; }
</style>
