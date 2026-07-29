<script setup>
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import { computed } from 'vue'
import { inputs, periods, controlFor, periodOf } from '../store.js'
import RateBlock from '../RateBlock.vue'

// Todo lo que entra a la hoja, editable en vivo.
//
// El v-model apunta al store, NO al prop `data`: `data` se recrea en cada recálculo y el
// input perdería el foco a cada tecla.
//
// La tasa NO va en la lista: tiene su propio bloque (RateBlock), porque la conversión de
// período se entiende como una fila —de dónde sale, por qué camino, en qué termina— y no
// como tres campos en tres secciones distintas.

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
  <div class="n n--entrada" style="min-width:316px;max-width:316px">
    <div class="n__hd">
      <b>Entrada</b>
      <span class="n__kind">editable</span>
    </div>

    <div class="ent">
      <div class="ent__sec">tasa</div>
      <RateBlock />

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
