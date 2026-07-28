<script setup>
import { Handle, Position } from '@vue-flow/core'
import { fmtNum } from '../engine.js'
import { ui, selectFormula, periodOf } from '../store.js'

// TODO el cálculo en UN nodo, con las etapas como secciones adentro.
//
// Antes era un nodo por etapa. Se juntó por simetría con la Entrada —si los datos van
// juntos porque son datos, los cálculos van juntos porque son cálculos— y porque el
// grafo estaba duplicando lo que el panel derecho hace mejor: `depende de` y `lo usan`,
// con valores y navegables. El grafo se queda con la ARQUITECTURA (entrada → cálculo →
// qué sigue) y el panel con las dependencias.
//
// Las etapas sobreviven como encabezados de sección: sin ellas se pierde que en alta-fleet
// hay dos créditos distintos.
defineProps({ data: Object })

const val = (r, name) => {
  if (!r) return '—'
  if (r.status === 'skipped') return 'sin calcular'
  if (r.status === 'error') return 'error'
  return fmtNum(r.value, /rate|factor|ratio|share/i.test(name) ? 6 : undefined)
}
</script>

<template>
  <div class="n n--grp" style="min-width:288px;max-width:288px">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="n__hd">
      <b>Cálculo</b>
      <span class="n__kind">{{ data.total }} fórmulas</span>
    </div>

    <div class="grp-rows">
      <template v-for="sec in data.sections" :key="sec.title">
        <div class="grp-sec">{{ sec.title }}</div>
        <div v-for="r in sec.rows" :key="r.name" class="grp-row nodrag"
             :class="{ 'is-out': r.isOutput, 'is-off': r.status !== 'ok', 'is-sel': ui.selected === r.name }"
             :title="r.expr" @click="selectFormula(r.name)">
          <span class="grp-k">{{ r.name }}<em v-if="periodOf(r.name)" class="per">{{ periodOf(r.name) }}</em></span>
          <b class="grp-v">{{ val(r, r.name) }}</b>
        </div>
      </template>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
