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
import NextNode from './nodes/NextNode.vue'
import ZoneNode from './nodes/ZoneNode.vue'
import SeriesNode from './nodes/SeriesNode.vue'
import FormulaPanel from './FormulaPanel.vue'

import { fmtNum } from './engine.js'
import { PRESETS, NO_NORMALIZABLE } from './sheets.js'
import { layoutSheet } from './layout.js'
import { ui, inputs, periods, effDef, preset, out, sheetDoc, presetDoc, loadPreset } from './store.js'

// markRaw: sin esto Vue hace reactivos los componentes y avisa por consola en cada nodo.
const nodeTypes = {
  inputsNode: markRaw(InputsNode), groupNode: markRaw(GroupNode),
  nextNode: markRaw(NextNode), zoneNode: markRaw(ZoneNode), seriesNode: markRaw(SeriesNode),
}

// `fit-view-on-init` corre con el contenedor en 0x0 y falla en silencio; `pane-ready` llega
// antes de que los nodos estén medidos. `nodes-initialized` es el que llega con todo medido.
const { fitView } = useVueFlow()
function onNodesReady() { nextTick(() => fitView({ padding: 0.12, duration: 0 })) }

const graph = computed(() => layoutSheet(effDef.value, out.value, { inputValues: inputs }))

const outVal = computed(() => {
  const r = out.value.res[effDef.value.output]
  return r?.status === 'ok' ? r.value : null
})

const ea = computed(() => {
  const r = out.value.res.annualEffectiveRate
  return r?.status === 'ok' ? (r.value * 100).toFixed(2).replace('.', ',') + '% E.A.' : null
})

// remontar el canvas al cambiar de preset o de vista, para que reencuadre.
// NO depende de los inputs: si dependiera, escribir remontaría el grafo a cada tecla.
const canvasKey = computed(() => `${ui.preset}|${ui.showDoc}`)
</script>

<template>
  <div class="app">
    <!-- ───────── barra superior ───────── -->
    <div class="top">
      <span class="brand">motor<small>una hoja · N configuraciones</small></span>

      <select v-model="ui.preset" style="min-width:320px">
        <option v-for="(p, k) in PRESETS" :key="k" :value="k">{{ p.label }}</option>
      </select>

      <div class="spacer"></div>

      <span v-if="outVal !== null" class="mono out-chip">
        {{ effDef.output }} <b>{{ fmtNum(outVal) }}</b>
      </span>
      <button :class="{ on: ui.showDoc }" @click="ui.showDoc = !ui.showDoc"
        title="Los dos documentos: la hoja (fórmulas) y la configuración (valores)">documento</button>
      <button @click="loadPreset()" title="Volver a los valores originales del producto">restablecer</button>
      <button @click="ui.dark = !ui.dark">{{ ui.dark ? 'claro' : 'oscuro' }}</button>
    </div>

    <!-- ───────── franja de contexto ───────── -->
    <div class="strip">
      <span><i style="background:var(--amber)"></i>entrada</span>
      <span><i style="background:var(--blue)"></i>cálculo</span>
      <span><i style="background:var(--teal)"></i>qué sigue</span>
      <span v-if="preset.legalNature" class="sep nat">{{ preset.legalNature }}</span>
      <span v-if="ea" class="sep ea">{{ ea }}</span>
      <span class="sep">tasa {{ inputs.compound ? 'efectiva' : 'nominal' }}</span>
      <span class="sep">amortiza {{ periods.chargedEvery }}</span>
      <span class="sep note">{{ preset.note }}</span>
    </div>

    <!-- ───────── canvas + panel derecho ───────── -->
    <div class="stage">
      <div class="canvas">
        <!-- los DOS documentos: la hoja es una para todos; la config es lo único que cambia -->
        <div v-if="ui.showDoc" class="docpane">
          <div class="docs">
            <section>
              <h3>La hoja <span>una sola, igual para todos los productos</span></h3>
              <pre>{{ JSON.stringify(sheetDoc, null, 2) }}</pre>
            </section>
            <section>
              <h3>La configuración <span>lo único que distingue un producto de otro</span></h3>
              <pre>{{ JSON.stringify(presetDoc, null, 2) }}</pre>
              <p class="docnote">
                Solo se listan los valores distintos de cero. Todo lo que no aparece es una
                perilla que este producto no usa.
              </p>
            </section>
          </div>
        </div>

        <VueFlow v-else :key="canvasKey" :nodes="graph.nodes" :edges="graph.edges"
          :node-types="nodeTypes" :class="{ dark: ui.dark }"
          :min-zoom="0.1" :max-zoom="1.8" :nodes-connectable="false" :edges-updatable="false"
          @nodes-initialized="onNodesReady">
          <Background :gap="22" :size="1" :pattern-color="ui.dark ? '#26251e' : '#d3cfc4'" />
          <Controls :show-interactive="false" />
        </VueFlow>
      </div>

      <FormulaPanel />
    </div>

    <!-- ───────── lo que NO normaliza, y por qué ───────── -->
    <div class="foot">
      <template v-for="(why, k) in NO_NORMALIZABLE" :key="k">
        <b>{{ k }}</b> no entra en la hoja — {{ why }}
      </template>
    </div>
  </div>
</template>
