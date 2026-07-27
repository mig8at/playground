<script setup>
import { computed } from 'vue'
import { VueFlow, Panel } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import CalcNode from './nodes/CalcNode.vue'
import InputsNode from './nodes/InputsNode.vue'
import GroupNode from './nodes/GroupNode.vue'
import TableNode from './nodes/TableNode.vue'
import RuleNode from './nodes/RuleNode.vue'
import EndNode from './nodes/EndNode.vue'
import RiskNode from './nodes/RiskNode.vue'

import { evalSheet, evalPolicy, fmtNum } from './engine.js'
import { SHEETS } from './sheets.js'
import { layoutSheet, layoutSheetGrouped, layoutPolicy } from './layout.js'
import { ui, inputs, risk, effDef, sheetDef, policyDef, resetSheet } from './store.js'

const nodeTypes = {
  calcNode: CalcNode, inputsNode: InputsNode, groupNode: GroupNode,
  tableNode: TableNode, ruleNode: RuleNode, endNode: EndNode, riskNode: RiskNode,
}

/* ── todo cuelga de acá: una evaluación por cambio de cualquier input ── */
const out = computed(() => evalSheet(effDef.value, inputs))

const outVal = computed(() => {
  const r = out.value.res[effDef.value.output]
  return r?.status === 'ok' ? r.value : null
})

const verdict = computed(() => {
  if (!policyDef.value) return null
  return evalPolicy(policyDef.value, { weeklyRent: outVal.value ?? '', ...risk })
})

const graph = computed(() => (ui.grouped ? layoutSheetGrouped : layoutSheet)(
  effDef.value, out.value, { inputValues: inputs }))

const pgraph = computed(() => policyDef.value && verdict.value
  ? layoutPolicy(policyDef.value, verdict.value, {
      fromSheetName: effDef.value.output, fromSheetValue: outVal.value,
    })
  : { nodes: [], edges: [] })

// remontar el canvas solo al cambiar de hoja / pestaña / nivel de zoom, para que reencuadre.
// NO depende de los inputs: si dependiera, escribir remontaría el grafo a cada tecla.
const canvasKey = computed(() => `${ui.slug}|${ui.tab}|${ui.grouped}`)
const series = computed(() => out.value.series)

const VERDICT = {
  aprobado: { t: 'Aprobado', c: 'ok' },
  rechazado: { t: 'Rechazado', c: 'no' },
  condicional: { t: 'Condicional — requiere codeudor', c: 'mid' },
  revision_manual: { t: 'A revisión manual', c: 'mid' },
  indeterminado: { t: 'Indeterminado', c: 'mid' },
}
</script>

<template>
  <div class="app">
    <!-- ───────── barra superior ───────── -->
    <div class="top">
      <span class="brand">motor<small>cálculo y política · CreditOp</small></span>

      <select v-model="ui.slug" style="min-width:200px">
        <option v-for="(s, k) in SHEETS" :key="k" :value="k">{{ s.label }}</option>
      </select>

      <div class="segs">
        <button :class="{ on: ui.tab === 'calc' }" @click="ui.tab = 'calc'">Cálculo</button>
        <button :class="{ on: ui.tab === 'policy' }" @click="ui.tab = 'policy'">
          Política<template v-if="!policyDef"> · n/a</template>
        </button>
      </div>

      <div class="spacer"></div>

      <span v-if="outVal !== null" class="mono out-chip">
        {{ effDef.output }} <b>{{ fmtNum(outVal) }}</b>
      </span>
      <button v-if="ui.tab === 'calc'" :class="{ on: ui.grouped }" @click="ui.grouped = !ui.grouped">
        {{ ui.grouped ? 'por etapa' : 'detalle' }}
      </button>
      <button @click="resetSheet()" title="Volver a los valores del archivo original">restablecer</button>
      <button @click="ui.dark = !ui.dark">{{ ui.dark ? 'claro' : 'oscuro' }}</button>
    </div>

    <!-- ───────── verdicto ───────── -->
    <div v-if="ui.tab === 'policy' && verdict" class="verdict" :class="(VERDICT[verdict.outcome] || {}).c">
      <h3>{{ (VERDICT[verdict.outcome] || {}).t || verdict.outcome }}</h3>
      <p>
        <template v-if="verdict.firedRule"><b>{{ verdict.firedRule }}</b> · </template>
        {{ verdict.explanation || 'Pasó todas las reglas del gate.' }}
      </p>
    </div>

    <!-- ───────── canvas ───────── -->
    <div class="canvas">
      <VueFlow v-if="ui.tab === 'calc'" :key="canvasKey" :nodes="graph.nodes" :edges="graph.edges"
        :node-types="nodeTypes" :class="{ dark: ui.dark }" fit-view-on-init
        :min-zoom="0.15" :max-zoom="1.8" :nodes-connectable="false" :edges-updatable="false">
        <Background :gap="22" :size="1" :pattern-color="ui.dark ? '#26251e' : '#d3cfc4'" />
        <Controls :show-interactive="false" />
        <Panel position="top-left">
          <div class="legend">
            <span><i style="background:var(--amber)"></i>entrada</span>
            <span><i style="background:var(--blue)"></i>{{ ui.grouped ? 'etapa' : 'fórmula' }}</span>
            <span><i style="background:var(--purple)"></i>output</span>
            <span class="sep">{{ graph.nodes.length }} nodos</span>
            <span class="sep">base {{ sheetDef.periodBase }} · cobro {{ sheetDef.periodCharged }}
              <template v-if="sheetDef.periodBase !== sheetDef.periodCharged"> ⚠ falta puente</template>
            </span>
          </div>
          <div class="legend note">{{ sheetDef.note }}</div>
        </Panel>
      </VueFlow>

      <template v-else>
        <VueFlow v-if="policyDef" :key="canvasKey" :nodes="pgraph.nodes" :edges="pgraph.edges"
          :node-types="nodeTypes" :class="{ dark: ui.dark }" fit-view-on-init
          :min-zoom="0.2" :max-zoom="1.8" :nodes-connectable="false">
          <Background :gap="22" :size="1" :pattern-color="ui.dark ? '#26251e' : '#d3cfc4'" />
          <Controls :show-interactive="false" />
          <Panel position="top-left">
            <div class="legend">
              <span>{{ policyDef.label }}</span>
              <span class="sep">el gate corre en cadena y corta en la primera que falla</span>
            </div>
          </Panel>
        </VueFlow>

        <div v-else class="empty">
          <div class="legend note" style="max-width:520px">
            <b>Esta hoja todavía no tiene política.</b><br><br>
            Y eso es el punto: <span class="mono">motai-renting</span> y
            <span class="mono">motai-rto</span> son dos hojas distintas que comparten
            <b>una sola</b> política — el documento de Manuela lo dice explícito
            ("mismas reglas de validación"). Con <span class="mono">creditopx-salud</span>
            pasa al revés: una hoja para tres comercios. Por eso cálculo y decisión son
            recursos separados.
          </div>
        </div>
      </template>
    </div>

    <!-- ───────── serie ───────── -->
    <div v-if="ui.tab === 'calc' && series" class="drawer">
      <header>
        <b>{{ series.name }}</b>
        <span v-if="series.error" style="color:var(--red)">{{ series.error }}</span>
        <span v-else>{{ series.rows.length }} filas{{ series.capped ? ' (cortado por el tope del motor)' : '' }}</span>
      </header>
      <div v-if="series.rows && series.rows.length" class="scroll">
        <table class="ser">
          <thead><tr><th>#</th><th v-for="c in series.cols" :key="c">{{ c }}</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in series.rows" :key="i">
              <td>{{ i + 1 }}</td>
              <td v-for="c in series.cols" :key="c">{{ fmtNum(r[c], 0) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
