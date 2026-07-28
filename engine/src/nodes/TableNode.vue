<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import { inputs, tables, controlFor } from '../store.js'

// Una tabla de búsqueda es ENTRADA, no cálculo: son datos que entran, igual que los inputs.
// Por eso lleva la cabecera ámbar de la familia Entrada y no la azul de las etapas.
//
// La CLAVE es siempre un número (merchantId, planDurationWeeks) — nunca un string, para que
// un typo no caiga en silencio al `else` de un if. El texto vive en `label`, para mostrar.
const props = defineProps({ data: Object })

const live = computed(() => tables[props.data.name] || props.data.table)
const cols = computed(() => Object.keys(live.value.rows[0] || {}))
const activeKey = computed(() => Number(inputs[live.value.key]))
const editable = c => c !== live.value.key && c !== 'label'

// La grilla se arma según las columnas que tenga la tabla: merchantConfig tiene 4 y
// rentalPlans 3. Cablearla a 4 aplastaba el monto ("12.000.0").
const grid = computed(() => ({
  gridTemplateColumns: cols.value
    .map(c => (c === live.value.key ? '50px' : c === 'label' ? '56px' : 'minmax(0,1fr)'))
    .join(' '),
}))
</script>

<template>
  <div class="n n--table" style="min-width:332px;max-width:332px">
    <div class="n__hd">
      <b>{{ data.name }}</b>
      <span class="n__kind">tabla · editable</span>
    </div>
    <div class="tbl">
      <div class="tbl__hd" :style="grid">
        <span v-for="c in cols" :key="c" :class="{ k: c === live.key }">
          {{ c === live.key ? '⚿ ' + c : c }}
        </span>
      </div>
      <div v-for="(r, i) in live.rows" :key="i" class="tbl__row" :style="grid"
           :class="{ 'is-active': Number(r[live.key]) === activeKey }">
        <template v-for="c in cols" :key="c">
          <span v-if="!editable(c)" class="tbl__ro">{{ r[c] }}</span>
          <MoneyInput v-else-if="controlFor(c, r[c]) === 'money'" v-model="r[c]" />
          <input v-else class="nodrag nf tbl__in" type="text" inputmode="decimal" v-model.number="r[c]">
        </template>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
