<script setup>
import { computed } from 'vue'
import { VueFlow, Panel } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { Search, Check, X, TriangleAlert, Minus, CornerDownRight } from 'lucide-vue-next'
import StageNode from './nodes/StageNode.vue'
import LenderNode from './nodes/LenderNode.vue'
import { STAGES, SAMPLE_IDS } from './mock'
import { ui, caseData, intentos, intento, selectedNode, search, selectIntento, intentoSummary } from './store'

const money = (n) => '$' + Number(n || 0).toLocaleString('es-CO')
const EDGE = { ok: '#46c98a', warn: '#e6ab4b', fail: '#ec6f6b', skip: '#4b5262' }
const MARK = { ok: Check, warn: TriangleAlert, fail: X, skip: Minus }
const summary = computed(() => intentoSummary(intento.value))

// Construye nodos + aristas del intento seleccionado: espina de etapas + rama de entidades en "listado".
const graph = computed(() => {
  const it = intento.value
  if (!it) return { nodes: [], edges: [] }
  const nodes = [], edges = []
  const LIST_I = STAGES.findIndex(s => s.id === 'listado')
  STAGES.forEach((s, i) => {
    const d = it.stages[s.id] || { status: 'skip' }
    nodes.push({ id: s.id, type: 'stage', position: { x: 40 + i * 212, y: 150 }, draggable: false,
      data: { stageId: s.id, label: s.label, status: d.status, detail: d.detail, reason: d.reason, faq: d.faq } })
    if (i > 0) {
      const prev = it.stages[STAGES[i - 1].id] || {}
      const col = d.status === 'fail' ? EDGE.fail : d.status === 'skip' ? EDGE.skip : EDGE.ok
      edges.push({ id: 'e-' + STAGES[i - 1].id + '-' + s.id, source: STAGES[i - 1].id, sourceHandle: 'r',
        target: s.id, targetHandle: 'l', animated: d.status === 'fail',
        style: { stroke: col, strokeWidth: d.status === 'fail' ? 2.5 : 2, strokeDasharray: d.status === 'skip' ? '5 4' : undefined } })
    }
  })
  const lenders = it.stages.listado?.lenders || []
  lenders.forEach((l, j) => {
    const id = 'lender:' + l.name
    nodes.push({ id, type: 'lender', position: { x: 40 + LIST_I * 212 - 4, y: 330 + j * 88 }, draggable: false, data: { lender: l } })
    const col = l.verdict === 'ok' ? EDGE.ok : l.verdict === 'lowp' ? EDGE.warn : EDGE.fail
    edges.push({ id: 'el-' + j, source: 'listado', sourceHandle: 'b', target: id, targetHandle: 't',
      style: { stroke: col, strokeWidth: 1.6, strokeDasharray: l.verdict === 'ok' ? undefined : '5 4' } })
  })
  return { nodes, edges }
})
</script>

<template>
  <div class="app">
    <!-- ── Sidebar ── -->
    <aside class="side">
      <div class="brand">
        <div class="brand__t"><span class="dot"></span> Soporte · Trazador</div>
        <div class="brand__s">seguí una solicitud y mirá dónde se rompió</div>
      </div>
      <div class="search">
        <div class="search__lbl">Buscar por cédula</div>
        <div class="search__box">
          <Search :size="15" />
          <input :value="ui.query" @input="e => search(e.target.value)" placeholder="ej. 1032424008" inputmode="numeric" />
        </div>
        <div class="chips">
          <button v-for="c in SAMPLE_IDS" :key="c" class="chip" @click="search(c)">{{ c }}</button>
        </div>
        <div class="side__hint">Demo con datos de ejemplo (Fase 0). En producción esto lo alimentará el historial real de la cédula.</div>
      </div>
      <div class="runs">
        <template v-if="caseData">
          <div class="runs__lbl">{{ caseData.nombre }} · {{ intentos.length }} intento(s)</div>
          <div v-for="it in intentos" :key="it.id" class="run" :class="['run--' + it.outcome, { 'run--sel': intento && intento.id === it.id }]" @click="selectIntento(it.id)">
            <div class="run__top">
              <span class="run__id">{{ it.id }}</span>
              <span class="run__badge" :class="'badge--' + it.outcome">{{ it.outcome }}</span>
            </div>
            <div class="run__merch">{{ it.comercio }}</div>
            <div class="run__meta">{{ it.fecha }} · {{ it.producto }} · {{ money(it.monto) }}</div>
            <div class="run__reach"><CornerDownRight :size="12" /> llegó hasta: {{ intentoSummary(it).llegoHasta }}</div>
          </div>
        </template>
        <div v-else-if="ui.notFound" class="empty">Sin resultados para “{{ ui.query }}”.<br />Probá una cédula de ejemplo de arriba.</div>
        <div v-else class="empty">Buscá una cédula para ver sus intentos de solicitud.</div>
      </div>
    </aside>

    <!-- ── Canvas ── -->
    <main class="canvas">
      <div class="hud">
        <div class="hud__t">{{ intento ? intento.comercio + ' · ' + intento.id : 'Trazador de solicitudes' }}</div>
        <div class="hud__s">{{ intento ? 'clic en una etapa o entidad para ver el detalle' : 'elegí una solicitud a la izquierda' }}</div>
      </div>
      <div class="legend">
        <span class="lg"><i style="background:#46c98a"></i> pasó</span>
        <span class="lg"><i style="background:#e6ab4b"></i> alerta</span>
        <span class="lg"><i style="background:#ec6f6b"></i> se rompió</span>
        <span class="lg"><i style="background:#4b5262"></i> no llegó</span>
      </div>
      <VueFlow v-if="intento" :key="intento.id" :nodes="graph.nodes" :edges="graph.edges"
        :nodes-draggable="false" :nodes-connectable="false" :elements-selectable="true"
        :fit-view-on-init="true" :fit-view-options="{ padding: 0.15 }" :min-zoom="0.2" :max-zoom="1.6">
        <template #node-stage="props"><StageNode v-bind="props" /></template>
        <template #node-lender="props"><LenderNode v-bind="props" /></template>
        <Background :gap="22" pattern-color="#1e232f" />
        <Controls :show-interactive="false" />
      </VueFlow>
      <div v-else class="empty" style="margin-top:120px">Sin solicitud seleccionada.</div>
    </main>

    <!-- ── Detalle ── -->
    <aside class="detail">
      <div class="detail__pad" v-if="intento">
        <!-- Resumen del intento -->
        <div class="dsum">
          <div class="dsum__row"><b>{{ intento.comercio }}</b> · {{ intento.sucursal }}</div>
          <div class="dsum__row">{{ intento.producto }} · {{ money(intento.monto) }} · {{ intento.fecha }}</div>
          <div class="dsum__reach">
            <span class="lbl">Llegó hasta</span><br />
            <b>{{ summary.llegoHasta }}</b>
          </div>
          <div v-if="summary.broke" class="dsum__broke"><b>Se rompió en: {{ summary.broke.label }}</b><br />{{ summary.reason }}</div>
          <div v-else class="dsum__reach" style="color:#46c98a"><b>Recorrido completo · aprobado</b></div>
        </div>

        <!-- Detalle del nodo seleccionado -->
        <div v-if="selectedNode && selectedNode.kind === 'stage'">
          <div class="dsec">Etapa seleccionada</div>
          <div class="dcard">
            <div class="dcard__hd">
              <span class="dcard__t">{{ selectedNode.stage.label }}</span>
              <span class="dcard__st" :class="'st-' + selectedNode.data.status">{{ selectedNode.data.status }}</span>
            </div>
            <div class="dhint" style="margin-bottom:8px">{{ selectedNode.stage.hint }}</div>
            <div v-if="selectedNode.data.detail" class="dcard__dt">{{ selectedNode.data.detail }}</div>
            <div v-if="selectedNode.data.reason" class="dcard__reason" :class="selectedNode.data.status === 'fail' ? 'reason--fail' : 'reason--warn'">
              {{ selectedNode.data.reason }}
            </div>
            <span v-if="selectedNode.data.faq" class="faq">ver {{ selectedNode.data.faq }} · FAQ-SOPORTE.md</span>
          </div>
        </div>

        <div v-else-if="selectedNode && selectedNode.kind === 'lender'">
          <div class="dsec">Entidad</div>
          <div class="dcard">
            <div class="dcard__hd">
              <span class="dcard__t">{{ selectedNode.lender.name }}</span>
              <span class="dcard__st" :class="selectedNode.lender.verdict === 'ok' ? 'st-ok' : selectedNode.lender.verdict === 'lowp' ? 'st-warn' : 'st-fail'">rt{{ selectedNode.lender.rt }}</span>
            </div>
            <div class="dcard__dt">{{ selectedNode.lender.reason }}</div>
            <div v-if="selectedNode.lender.stage" class="dcard__reason reason--fail">Se rompió en la etapa <b>{{ selectedNode.lender.stage }}</b> de la consulta a su API.</div>
          </div>
        </div>

        <!-- listado de entidades cuando no hay nodo elegido -->
        <div v-else-if="intento.stages.listado && intento.stages.listado.lenders">
          <div class="dsec">Entidades mostradas</div>
          <div class="dcard">
            <div v-for="l in intento.stages.listado.lenders" :key="l.name" class="lrow">
              <span class="lender__rt" :class="'rt' + l.rt">rt{{ l.rt }}</span>
              <div>
                <div class="lrow__nm">{{ l.name }}</div>
                <div class="lrow__rs">{{ l.reason }}</div>
              </div>
            </div>
          </div>
          <div class="dhint" style="margin-top:12px">Hacé clic en cualquier etapa o entidad del flujo para ver su detalle.</div>
        </div>
      </div>
      <div class="detail__pad" v-else>
        <div class="dhint">Elegí una solicitud para ver su trazado y dónde se rompió.</div>
      </div>
    </aside>
  </div>
</template>
