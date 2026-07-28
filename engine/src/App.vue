<script setup>
import { computed, markRaw, nextTick } from 'vue'
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
import SeriesNode from './nodes/SeriesNode.vue'
import FormulaPanel from './FormulaPanel.vue'

import { evalPolicy, fmtNum } from './engine.js'
import { SHEETS } from './sheets.js'
import { layoutSheet, layoutPolicy } from './layout.js'
import { ui, inputs, risk, periods, effDef, sheetDef, policyDef, out, sheetDoc, resetSheet } from './store.js'

// markRaw: sin esto Vue hace reactivos los componentes y avisa por consola en cada nodo.
const nodeTypes = {
  inputsNode: markRaw(InputsNode), groupNode: markRaw(GroupNode),
  tableNode: markRaw(TableNode), ruleNode: markRaw(RuleNode), endNode: markRaw(EndNode),
  riskNode: markRaw(RiskNode), nextNode: markRaw(NextNode), zoneNode: markRaw(ZoneNode),
  seriesNode: markRaw(SeriesNode),
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

// La E.A. es el único eje en el que dos productos se comparan. Antes ninguna hoja la exponía.
// El canon de la plataforma es N.M. (credit_line_by_lenders.rate_suffix, 157/157 filas).
// Una hoja `effective` es legítima —así lo hacen los .xlsm— pero DIVERGE, y eso ya pegó en
// producción con Credifamilia (F-71 · CORE-127). El aviso está para que no pase de largo.
// El motor amortiza en `chargedEvery`; el producto cobra en `realWorldCharge`. Si difieren,
// alguien tuvo que decidir cómo cruzar — y en alta-fleet nadie lo escribió.
const bridge = computed(() => !!sheetDef.value.realWorldCharge
  && !!periods.chargedEvery && periods.chargedEvery !== sheetDef.value.realWorldCharge)

const conv = computed(() => {
  const c = sheetDef.value.rateConvention
  if (!c) return null
  const esProducto = !!sheetDef.value.realWorldCharge   // hoja mapeada a un lender real
  return c === 'nominal'
    ? { txt: 'tasa nominal', warn: false }
    : { txt: 'tasa efectiva', warn: esProducto,
        why: esProducto ? 'la plataforma guarda N.M. — ver F-71' : null }
})

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
      <button v-if="ui.tab === 'calc'" :class="{ on: ui.showDoc }" @click="ui.showDoc = !ui.showDoc"
        title="El documento que se guardaría: TODA la lógica de la hoja">documento</button>
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
        <span class="sep nat" :class="{ rent: sheetDef.legalNature === 'arrendamiento operativo' }"
          :title="sheetDef.legalNature === 'arrendamiento operativo'
            ? 'Sin interés: no es crédito, no aplica el techo de usura'
            : 'Hay interés sobre un saldo: es crédito y le aplica el techo de usura'">
          {{ sheetDef.legalNature || 'genérico' }}</span>
        <span v-if="ea" class="sep ea">{{ ea }}</span>
        <span v-if="conv" class="sep" :class="{ warn: conv.warn }" :title="conv.why">
          {{ conv.txt }}<template v-if="conv.warn"> ⚠</template>
        </span>
        <span class="sep" :class="{ warn: bridge }">
          amortiza {{ periods.chargedEvery || '—' }}<template
            v-if="sheetDef.realWorldCharge"> · se cobra {{ sheetDef.realWorldCharge }}</template><template
            v-if="bridge"> ⚠ falta puente</template></span>
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
      <!-- el documento: la hoja entera es este JSON, nada vive en código -->
      <div v-if="ui.tab === 'calc' && ui.showDoc" class="docpane">
        <pre>{{ JSON.stringify(sheetDoc, null, 2) }}</pre>
      </div>

      <VueFlow v-else-if="ui.tab === 'calc'" :key="canvasKey" :nodes="graph.nodes" :edges="graph.edges"
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

  </div>
</template>
