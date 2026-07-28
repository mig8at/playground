<script setup>
import { computed, markRaw, nextTick } from 'vue'
import { ChevronUp, ChevronDown } from 'lucide-vue-next'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import InputsNode from './nodes/InputsNode.vue'
import GroupNode from './nodes/GroupNode.vue'
import TableNode from './nodes/TableNode.vue'
import RuleNode from './nodes/RuleNode.vue'
import EndNode from './nodes/EndNode.vue'
import RiskNode from './nodes/RiskNode.vue'
import NextNode from './nodes/NextNode.vue'
import ZoneNode from './nodes/ZoneNode.vue'
import FormulaPanel from './FormulaPanel.vue'

import { evalPolicy, fmtNum } from './engine.js'
import { SHEETS } from './sheets.js'
import { layoutSheet, layoutPolicy } from './layout.js'
import { ui, inputs, risk, effDef, sheetDef, policyDef, out, resetSheet } from './store.js'

// markRaw: sin esto Vue hace reactivos los componentes y avisa por consola en cada nodo.
const nodeTypes = {
  inputsNode: markRaw(InputsNode), groupNode: markRaw(GroupNode),
  tableNode: markRaw(TableNode), ruleNode: markRaw(RuleNode), endNode: markRaw(EndNode),
  riskNode: markRaw(RiskNode), nextNode: markRaw(NextNode), zoneNode: markRaw(ZoneNode),
}

// `fit-view-on-init` corre con el contenedor en 0x0 y falla en silencio; `pane-ready` llega
// antes de que los nodos estén medidos, así que encuadra contra tamaños estimados.
// `nodes-initialized` es el que llega con todo medido.
const { fitView } = useVueFlow()
function onNodesReady() { nextTick(() => fitView({ padding: 0.12, duration: 0 })) }

const outVal = computed(() => {
  const r = out.value.res[effDef.value.output]
  return r?.status === 'ok' ? r.value : null
})

const verdict = computed(() => {
  if (!policyDef.value) return null
  return evalPolicy(policyDef.value, { weeklyRent: outVal.value ?? '', ...risk })
})

const pgraph = computed(() => policyDef.value && verdict.value
  ? layoutPolicy(policyDef.value, verdict.value, {
      fromSheetName: effDef.value.output, fromSheetValue: outVal.value,
    })
  : { nodes: [], edges: [] })

const graph = computed(() => layoutSheet(effDef.value, out.value, {
  inputValues: inputs, policy: policyDef.value, verdict: verdict.value,
}))

// remontar el canvas solo al cambiar de hoja / pestaña, para que reencuadre.
// NO depende de los inputs: si dependiera, escribir remontaría el grafo a cada tecla.
const canvasKey = computed(() => `${ui.slug}|${ui.tab}`)
const series = computed(() => out.value.series)

// La E.A. es el único eje en el que dos productos se comparan. Antes ninguna hoja la exponía.
const ea = computed(() => {
  const r = out.value.res.annualEffectiveRate
  return r?.status === 'ok' ? (r.value * 100).toFixed(2).replace('.', ',') + '% E.A.' : null
})

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

    <!-- ───────── franja de contexto · fuera del canvas para no tapar los nodos ───────── -->
    <div class="strip">
      <template v-if="ui.tab === 'calc'">
        <span><i style="background:var(--amber)"></i>entrada</span>
        <span><i style="background:var(--blue)"></i>cálculo</span>
        <span><i style="background:var(--teal)"></i>qué sigue</span>
        <span class="sep">{{ graph.nodes.length }} nodos</span>
        <span v-if="ea" class="sep ea">{{ ea }}</span>
        <span class="sep">base {{ sheetDef.periodBase }} · cobro {{ sheetDef.periodCharged }}<template
          v-if="sheetDef.periodBase !== sheetDef.periodCharged"> ⚠ falta puente</template></span>
        <span class="sep note">{{ sheetDef.note }}</span>
      </template>
      <template v-else-if="policyDef">
        <span>{{ policyDef.label }}</span>
        <span class="sep">el gate corre en cadena y corta en la primera que falla</span>
      </template>
    </div>

    <!-- ───────── canvas + panel derecho ───────── -->
    <div class="stage">
    <div class="canvas">
      <VueFlow v-if="ui.tab === 'calc'" :key="canvasKey" :nodes="graph.nodes" :edges="graph.edges"
        :node-types="nodeTypes" :class="{ dark: ui.dark }"
        :min-zoom="0.1" :max-zoom="1.8" :nodes-connectable="false" :edges-updatable="false"
        @nodes-initialized="onNodesReady">
        <Background :gap="22" :size="1" :pattern-color="ui.dark ? '#26251e' : '#d3cfc4'" />
        <Controls :show-interactive="false" />
      </VueFlow>

      <template v-else>
        <VueFlow v-if="policyDef" :key="canvasKey" :nodes="pgraph.nodes" :edges="pgraph.edges"
          :node-types="nodeTypes" :class="{ dark: ui.dark }"
          :min-zoom="0.1" :max-zoom="1.8" :nodes-connectable="false" @nodes-initialized="onNodesReady">
          <Background :gap="22" :size="1" :pattern-color="ui.dark ? '#26251e' : '#d3cfc4'" />
          <Controls :show-interactive="false" />
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

      <FormulaPanel />
    </div>

    <!-- ───────── serie · panel colapsable, estilo consola de VS Code ───────── -->
    <div v-if="ui.tab === 'calc' && series" class="drawer" :class="{ open: ui.seriesOpen }">
      <header @click="ui.seriesOpen = !ui.seriesOpen" :title="ui.seriesOpen ? 'Contraer' : 'Expandir'">
        <ChevronUp v-if="!ui.seriesOpen" :size="14" />
        <ChevronDown v-else :size="14" />
        <b>Plan de pagos</b>
        <span class="mono">{{ series.name }}</span>
        <span v-if="series.error" style="color:var(--red)">{{ series.error }}</span>
        <span v-else>
          {{ series.rows.length }} filas{{ series.capped ? ' · cortado por el tope del motor' : '' }}
        </span>
        <div class="spacer"></div>
        <span v-if="!ui.seriesOpen && series.rows?.length" class="mono peek">
          {{ series.cols.slice(0, 3).join(' · ') }}{{ series.cols.length > 3 ? ' …' : '' }}
        </span>
      </header>

      <div v-if="ui.seriesOpen && series.rows && series.rows.length" class="scroll">
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
