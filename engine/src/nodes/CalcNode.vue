<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { fmtNum } from '../engine.js'
import { ui, selectFormula } from '../store.js'

// Un nodo por nombre declarado: input (●), constante (○), fórmula (▷) o el output.
// NO hay un nodo por operación — eso convertiría `(1+r)^(m/s)-1` en seis cajitas y sería
// menos legible que la expresión escrita. La expresión va como texto adentro del nodo.
const props = defineProps({ data: Object })

const KIND = {
  input: 'input', const: 'constante', formula: 'fórmula', output: 'output',
}
const shown = computed(() => {
  const d = props.data
  if (d.status === 'skipped') return 'sin calcular'
  if (d.status === 'error') return 'error'
  if (d.value === undefined) return '—'
  // las tasas y factores necesitan más decimales que la plata
  const isRate = /rate|factor|ratio|share/i.test(d.name)
  return fmtNum(d.value, isRate ? 6 : undefined)
})
</script>

<template>
  <div class="n" @click="selectFormula(data.name)"
       :class="[`n--${data.kind}`, { 'is-skipped': data.status === 'skipped',
                'is-error': data.status === 'error', 'is-sel': ui.selected === data.name }]">
    <Handle v-if="data.kind !== 'input' && data.kind !== 'const'" id="in" type="target" :position="Position.Left" />
    <div class="n__hd">
      <b :title="data.name">{{ data.name }}</b>
      <span class="n__kind">{{ KIND[data.kind] }}</span>
    </div>
    <div class="n__body">
      <div class="n__val">{{ shown }}</div>
      <div v-if="data.why" class="n__why">{{ data.why }}</div>
      <div v-if="data.expr" class="n__expr">{{ data.expr }}</div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
