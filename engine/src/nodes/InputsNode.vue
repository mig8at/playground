<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import PercentInput from '../PercentInput.vue'
import RateBlock from '../RateBlock.vue'
import { inputs } from '../store.js'

// La UI muestra SOLO `label` (español corto) y `help` como tooltip. El `name` en inglés no
// aparece nunca acá: vive en el documento y en las fórmulas. Así renombrar una etiqueta no
// puede romper un cálculo.
const props = defineProps({ data: Object })

// La tasa tiene su propio bloque, así que sus dos campos no van en la lista.
const EN_BLOQUE_DE_TASA = new Set(['statedRate', 'compound'])

const sections = computed(() => {
  const byName = Object.fromEntries(props.data.inputs.map(i => [i.name, i]))
  return Object.entries(props.data.inputGroups || {}).map(([title, names]) => ({
    title,
    fields: names.map(n => byName[n]).filter(f => f && !EN_BLOQUE_DE_TASA.has(f.name)),
  })).filter(s => s.fields.length)
})
</script>

<template>
  <div class="n n--entrada" style="min-width:326px;max-width:326px">
    <div class="n__hd">
      <b>Entrada</b>
      <span class="n__kind">editable</span>
    </div>

    <div class="ent">
      <template v-for="(sec, i) in sections" :key="sec.title">
        <div class="ent__sec">{{ sec.title }}</div>
        <div v-for="f in sec.fields" :key="f.name" class="ent__row"
             :class="{ 'is-zero': inputs[f.name] === 0 || inputs[f.name] === false }">
          <span class="ent__k" :title="f.help">{{ f.label }}</span>

          <select v-if="f.type === 'bool'" class="nodrag nf" v-model="inputs[f.name]">
            <option :value="true">sí</option>
            <option :value="false">no</option>
          </select>
          <MoneyInput v-else-if="f.type === 'money'" v-model="inputs[f.name]" />
          <PercentInput v-else-if="f.type === 'rate'" v-model="inputs[f.name]" />
          <input v-else class="nodrag nf" type="text" inputmode="numeric" v-model="inputs[f.name]">
        </div>

        <!-- el bloque de la tasa va después del primer grupo: es condición del crédito -->
        <template v-if="i === 0">
          <div class="ent__sec">tasa</div>
          <RateBlock />
        </template>
      </template>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
