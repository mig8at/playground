<script setup>
import { computed, markRaw, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import StageNode from './nodes/StageNode.vue'
import SeriesNode from './nodes/SeriesNode.vue'

import { fmtNum } from './engine.js'
import { layoutSheet } from './layout.js'
import { ui, inputs, periods, effDef, out, sheetDoc, reset } from './store.js'

// markRaw: sin esto Vue hace reactivos los componentes y avisa por consola en cada nodo.
const nodeTypes = {
  stageNode: markRaw(StageNode),
  seriesNode: markRaw(SeriesNode),
}

// `fit-view-on-init` corre con el contenedor en 0x0 y falla en silencio; `pane-ready` llega
// antes de que los nodos estén medidos. `nodes-initialized` es el que llega con todo medido.
const { fitView } = useVueFlow()
function onNodesReady() { nextTick(() => fitView({ padding: 0.14, duration: 0 })) }

const graph = computed(() => layoutSheet(effDef.value, out.value, { inputValues: inputs }))

const cuota = computed(() => {
  const r = out.value.res.totalInstallment
  return r?.status === 'ok' ? r.value : null
})
const financiado = computed(() => {
  const r = out.value.res.financedAmount
  return r?.status === 'ok' ? r.value : null
})
// Lo que se le suma a cada cuota además de la amortización. Se muestra solo si hay algo, porque
// es justo el aviso de que "lo que paga ≠ la cuota del crédito". Ahora es UNA fórmula con
// nombre (la salida de la etapa `a la cuota`), no una suma armada acá.
const extraPorCuota = computed(() => {
  const r = out.value.res.installmentCharges
  return r?.status === 'ok' && r.value > 0 ? r.value : null
})
const ea = computed(() => {
  const r = out.value.res.annualEffectiveRate
  return r?.status === 'ok' ? (r.value * 100).toFixed(2).replace('.', ',') + '% E.A.' : null
})
const total = computed(() => (cuota.value != null ? cuota.value * Number(inputs.installments) : null))

// NO depende de los inputs: si dependiera, escribir remontaría el grafo a cada tecla.
const canvasKey = computed(() => String(ui.showDoc))
</script>

<template>
  <div class="app">
    <div class="top">
      <span class="brand">motor<small>monto · cuotas · tasa</small></span>
      <div class="spacer"></div>
      <span v-if="cuota !== null" class="mono out-chip">
        {{ effDef.formulaLabel.totalInstallment }} <b>{{ fmtNum(cuota) }}</b>
      </span>
      <button :class="{ on: ui.showDoc }" @click="ui.showDoc = !ui.showDoc"
        title="La hoja entera, tal como se guardaría">documento</button>
      <button @click="reset()">restablecer</button>
      <button @click="ui.dark = !ui.dark">{{ ui.dark ? 'claro' : 'oscuro' }}</button>
    </div>

    <div class="strip">
      <span v-if="ea" class="ea">{{ ea }}</span>
      <span class="sep">tasa {{ inputs.compound ? 'efectiva' : 'nominal' }}</span>
      <span class="sep">amortiza {{ periods.chargedEvery }}</span>
      <span v-if="financiado !== null && financiado !== Number(inputs.amount)" class="sep fin">
        valor a financiar {{ fmtNum(financiado) }}</span>
      <span v-if="extraPorCuota !== null" class="sep">
        de la cuota, {{ fmtNum(extraPorCuota) }} no es el crédito</span>
      <span v-if="total !== null" class="sep">total a pagar {{ fmtNum(total) }}</span>
    </div>

    <div class="canvas">
      <div v-if="ui.showDoc" class="docpane">
        <pre>{{ JSON.stringify(sheetDoc, null, 2) }}</pre>
      </div>

      <VueFlow v-else :key="canvasKey" :nodes="graph.nodes" :edges="graph.edges"
        :node-types="nodeTypes" :class="{ dark: ui.dark }"
        :min-zoom="0.2" :max-zoom="1.8" :nodes-connectable="false" :edges-updatable="false"
        @nodes-initialized="onNodesReady">
        <Background :gap="22" :size="1" :pattern-color="ui.dark ? '#26251e' : '#d3cfc4'" />
        <Controls :show-interactive="false" />
      </VueFlow>
    </div>
  </div>
</template>
