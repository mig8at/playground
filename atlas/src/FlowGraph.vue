<script setup>
import { computed } from 'vue'
import { VueFlow, Handle, Position } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

// La combinación ES el flujo: un grafo Vue Flow con todos sus flujos de negocio
// (canal → lenders). Copia por camino; dot de "sigue válido"; ramas en el header.
const props = defineProps({
  comboName: { type: String, default: '' },
  graphs: { type: Array, default: () => [] },
  status: { type: Object, default: () => ({ repos: [] }) },
  copiedKey: { type: String, default: '' },
  aligning: { type: Boolean, default: false },
  alignResults: { type: Array, default: () => [] },
})
const emit = defineEmits(['copy', 'copy-text'])

const drift = computed(() => {
  const m = {}
  for (const r of (props.status?.repos || [])) m[r.alias] = r.state === 'aligned' ? 'ok' : 'drift'
  return m
})

function isCopied(group, key) { return props.copiedKey === group + '::' + key }
function kb(text) { return text ? '~' + Math.round(text.length / 1000) + 'k' : '' }
function stale(d) { if (!d.has_base) return '' ; return d.changed ? 'stale' : 'fresh' }
function alignClass(r) { return r.error ? (r.error.includes('sin commitear') ? 'warn' : 'err') : 'ok' }

// ── layout: cada flujo en su carril; canal izq → lenders der ──
const NODE_H = 84, ROW_H = 108, COL_X = 320, LANE_GAP = 44

const layout = computed(() => {
  const nodes = [], edges = []
  let laneY = 0
  for (const g of props.graphs) {
    const lenders = g.lenders || []
    const laneH = Math.max(1, lenders.length) * ROW_H
    const chLabel = g.channel?.name || ''
    if (g.channel) {
      const allTree = g.trees['__all__']
      nodes.push({
        id: `${g.group}:channel`, type: 'stage', position: { x: 0, y: laneY + (laneH - NODE_H) / 2 },
        data: {
          ...g.channel, kind: 'channel', drift: drift.value, copyGroup: g.group, copyKey: '__all__',
          size: kb(allTree), hasTree: !!allTree,
          allLabel: lenders.length ? 'todo el flujo' : 'copiar árbol',
          copyLabel: lenders.length ? `${chLabel} (completo)` : chLabel,
        },
      })
    }
    lenders.forEach((l, i) => {
      const y = laneY + i * ROW_H + (ROW_H - NODE_H) / 2
      const t = g.trees[l.id]
      nodes.push({
        id: `${g.group}:${l.id}`, type: 'stage', position: { x: COL_X, y },
        data: {
          ...l, kind: 'lender', drift: drift.value, copyGroup: g.group, copyKey: l.id,
          size: kb(t), hasTree: !!t, copyLabel: g.channel ? `${chLabel} → ${l.name}` : l.name,
        },
      })
      if (g.channel) {
        edges.push({
          id: `${g.group}:${l.id}:e`, source: `${g.group}:channel`, target: `${g.group}:${l.id}`,
          type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 },
        })
      }
    })
    laneY += laneH + LANE_GAP
  }
  return { nodes, edges, height: Math.max(200, laneY) }
})
</script>

<template>
  <section class="flows panel-section fade-in">
    <div class="section-head">
      <h2>Flujo de {{ comboName }}</h2>
      <span class="section-hint">grafo canal → lenders · el botón copiar baja el árbol completo de ese camino</span>
    </div>

    <!-- alineación: checkout + pull al seleccionar -->
    <div v-if="aligning" class="fg-align loading">⟳ alineando repos a {{ comboName }} (checkout + git pull)…</div>
    <div v-else-if="alignResults.length" class="fg-align">
      <span v-for="r in alignResults" :key="r.alias" class="fg-chip" :class="alignClass(r)"
            :title="r.error ? 'click para copiar el comando manual' : ''"
            @click="r.error && emit('copy-text', r.manual, 'comando')">
        <b>{{ r.alias }}</b>
        <template v-if="r.error">{{ alignClass(r) === 'warn' ? '⚠' : '✗' }} {{ r.error }}</template>
        <template v-else>{{ r.was !== r.now ? r.was + '→' + r.now : r.now }}{{ r.pulled ? ' · pull ✓' : '' }}</template>
      </span>
    </div>

    <!-- ramas actuales por repo (drift vs la combinación) -->
    <div v-if="status?.repos?.length" class="fg-legend">
      <span class="fg-legend-lbl">ramas:</span>
      <span v-for="r in status.repos" :key="r.alias" class="fg-branch" :class="r.state === 'aligned' ? 'ok' : 'drift'">
        <b>{{ r.alias }}</b>⑂{{ r.current }}<template v-if="r.state === 'off'"> ⚠→{{ r.target }}</template>
      </span>
    </div>

    <!-- skeleton mientras alinea / carga -->
    <div v-if="aligning || (!graphs.length)" class="fg-canvas skel-canvas">
      <div v-for="i in 3" :key="i" class="skel skel-lane"></div>
    </div>

    <div v-else class="fg-canvas" :style="{ height: layout.height + 40 + 'px' }">
      <VueFlow :nodes="layout.nodes" :edges="layout.edges" fit-view-on-init :nodes-draggable="false"
               :min-zoom="0.4" :max-zoom="1.5" :zoom-on-scroll="false" :pan-on-scroll="false" :prevent-scrolling="false">
        <Background pattern-color="#2a3340" :gap="18" />
        <template #node-stage="{ data }">
          <div class="gnode" :class="data.kind">
            <span v-if="stale(data)" class="gdot" :class="stale(data)"
                  :title="stale(data) === 'stale' ? data.changed + ' archivos cambiaron desde el análisis' : 'al día'"></span>
            <div class="gnode-head">
              <span class="gtag" :class="data.kind">{{ data.kind === 'channel' ? 'canal' : 'lender' }}</span>
              <span class="gname">{{ data.name }}</span>
            </div>
            <div class="grepos">
              <span v-for="r in data.repos" :key="r" class="grepo" :class="data.drift[r] || ''">{{ r }}</span>
            </div>
            <button class="gcopy" :disabled="!data.hasTree"
                    :title="'copiar: ' + data.copyLabel + ' · ' + data.files + ' archivos · ' + data.size"
                    @click="emit('copy', { group: data.copyGroup, key: data.copyKey, label: data.copyLabel })">
              <template v-if="isCopied(data.copyGroup, data.copyKey)">✓ copiado</template>
              <template v-else>⧉ {{ data.kind === 'channel' ? (data.allLabel || 'copiar') : 'copiar' }} · {{ data.size }}</template>
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
.fg-align { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; font-size: 12px; }
.fg-align.loading { color: var(--amber); font-family: var(--mono); }
.fg-chip { font-family: var(--mono); background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; }
.fg-chip b { color: var(--text); margin-right: 5px; }
.fg-chip.ok { color: var(--green); }
.fg-chip.warn { color: var(--amber); cursor: pointer; }
.fg-chip.err { color: var(--red); cursor: pointer; }
.fg-chip.warn:hover, .fg-chip.err:hover { border-color: currentColor; }

.fg-legend { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 12px; }
.fg-legend-lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
.fg-branch { font-size: 12px; font-family: var(--mono); background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; }
.fg-branch b { color: var(--text); margin-right: 4px; }
.fg-branch.ok { color: var(--green); }
.fg-branch.drift { color: var(--amber); }

.fg-canvas { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.skel-canvas { height: 280px; padding: 20px; display: flex; flex-direction: column; gap: 18px; }
.skel-lane { height: 60px; width: 70%; }
.skel-lane:nth-child(2) { width: 55%; }
.skel-lane:nth-child(3) { width: 62%; }

.gnode { position: relative; width: 208px; background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.gnode.channel { border-left: 3px solid var(--accent); }
.gnode.lender { border-left: 3px solid var(--green); }
.gdot { position: absolute; top: 9px; right: 9px; width: 8px; height: 8px; border-radius: 50%; }
.gdot.fresh { background: var(--green); }
.gdot.stale { background: var(--amber); }
.gnode-head { display: flex; align-items: center; gap: 6px; }
.gtag { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: var(--accent); }
.gtag.lender { color: var(--green); }
.gname { font-size: 13px; font-weight: 600; color: var(--text); }
.grepos { display: flex; flex-wrap: wrap; gap: 3px; margin: 6px 0 7px; }
.grepo { font-size: 9px; padding: 1px 6px; border-radius: 4px; background: var(--chip); color: var(--muted); }
.grepo.ok { color: var(--green); background: rgba(63,185,80,.12); }
.grepo.drift { color: var(--amber); background: rgba(227,179,65,.14); }
.gcopy { width: 100%; background: var(--accent); color: #06101f; border: 0; border-radius: 6px; padding: 6px; font-weight: 600; font-size: 11px; cursor: pointer; }
.gcopy:hover:not(:disabled) { filter: brightness(1.08); }
.gcopy:disabled { opacity: .5; cursor: default; }
:deep(.vue-flow__handle) { opacity: 0; }
</style>
