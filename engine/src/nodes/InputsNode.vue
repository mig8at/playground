<script setup>
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import { computed } from 'vue'
import { inputs, periods, controlFor, periodOf } from '../store.js'
import { PERIODS } from '../sheets.js'

// TODO lo que entra a la hoja, editable en vivo: los inputs (los manda el llamador) y las
// constantes (viven en la hoja). Antes eran ~15 nodos sueltos que no aportaban nada — son
// hojas del grafo. Lo que se quiere leer es la CADENA de cálculo.
//
// El v-model apunta al store, NO al prop `data`: `data` se recrea en cada recálculo y el
// input perdería el foco a cada tecla.
// Si el input es la CLAVE de una tabla, el select muestra su `label` y no el número pelado.
// La regla era "clave numérica, texto solo para mostrar" — pero faltaba mostrarlo:
// se veía `178` en vez de `178 · Gaes`, y `4` en vez de `4 · Mensual`.
const PERIOD_LABEL = {
  rateStatedIn: 'la tasa está dicha',
  chargedEvery: 'se cobra',
  termIn: 'el plazo está en',
}
const PERIOD_HELP = {
  rateStatedIn: 'statedPerYear — en qué período el negocio expresa la tasa',
  chargedEvery: 'periodsPerYear — en qué período se amortiza y se cobra',
  termIn: 'termPerYear — la unidad en la que viene el plazo',
}

// Con 17 inputs una lista plana es ilegible: se agrupan por `inputGroups`, que es
// presentación pura (la hoja no depende de ellos).
const props = defineProps({ data: Object })
const sections = computed(() => {
  const g = props.data.inputGroups
  const byName = Object.fromEntries(props.data.inputs.map(i => [i.name, i]))
  if (!g) return [{ title: 'inputs · los manda el llamador', fields: props.data.inputs }]
  return Object.entries(g).map(([title, names]) =>
    ({ title, fields: names.map(n => byName[n]).filter(Boolean) }))
})
</script>

<template>
  <div class="n n--entrada" style="min-width:296px;max-width:296px">
    <div class="n__hd">
      <b>Entrada</b>
      <span class="n__kind">editable</span>
    </div>

    <div class="ent">
      <!-- Los períodos: reemplazan a la sopa de constantes (weeksPerYear, monthsPerYear,
           daysPerMonth…) que eran todas la misma pregunta contada distinto. -->
      <template v-if="data.periods && Object.keys(data.periods).length">
        <div class="ent__sec">períodos</div>
        <div v-for="(_, k) in data.periods" :key="k" class="ent__row">
          <span class="ent__k" :title="PERIOD_HELP[k]">{{ PERIOD_LABEL[k] }}</span>
          <select class="nodrag nf nf--wide" v-model="periods[k]">
            <option v-for="(n, name) in PERIODS" :key="name" :value="name">
              {{ name }} · {{ n }}/año
            </option>
          </select>
        </div>
      </template>

      <template v-for="sec in sections" :key="sec.title">
        <div class="ent__sec">{{ sec.title }}</div>
        <div v-for="f in sec.fields" :key="f.name" class="ent__row"
             :class="{ 'is-missing': inputs[f.name] === '' || inputs[f.name] === undefined,
                       'is-zero': inputs[f.name] === 0 || inputs[f.name] === false }">
          <span class="ent__k" :title="f.label">{{ f.name }}<em
            v-if="periodOf(f.name)" class="per">{{ periodOf(f.name) }}</em></span>

          <select v-if="f.type === 'bool'" class="nodrag nf" v-model="inputs[f.name]">
            <option :value="true">sí</option>
            <option :value="false">no</option>
          </select>
          <MoneyInput v-else-if="f.type === 'money'" v-model="inputs[f.name]" />
          <input v-else class="nodrag nf" type="text" inputmode="decimal" v-model="inputs[f.name]">
        </div>
      </template>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
