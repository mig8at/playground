<script setup>
import { computed } from 'vue'
import PercentInput from './PercentInput.vue'
import { inputs, periods, out } from './store.js'
import { PERIODS } from './sheets.js'

// La conversión de tasa, en UNA fila:
//
//   [período] [tasa]  ──convención──▸  [período] [tasa resultante]
//      dicha                              se cobra
//
// Antes estaba repartida en tres lugares (dos selects en "períodos", el statedRate en "tasa
// y plazo", y el periodRate en el nodo de Cálculo). Junta, la fila ES la conversión: se lee
// de dónde sale el número, por qué camino, y en qué termina.
//
// La flecha lleva la CONVENCIÓN y es clickeable, porque es exactamente ahí donde se decide
// si se capitaliza o se divide — no en una casilla suelta en otra sección.
// sin ceros de cola: 2% se lee "2", no "2,000000" — pero 0,412539% conserva sus decimales
const result = computed(() => {
  const r = out.value.res.periodRate
  if (r?.status !== 'ok') return null
  return (r.value * 100).toFixed(6).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',')
})
const ea = computed(() => {
  const r = out.value.res.annualEffectiveRate
  return r?.status === 'ok' ? (r.value * 100).toFixed(2).replace('.', ',') : null
})
</script>

<template>
  <div class="rb">
    <div class="rb__lbl"><span>dicha</span><span>se cobra</span></div>

    <div class="rb__row">
      <select class="nodrag rb__per" v-model="periods.rateStatedIn">
        <option v-for="(n, name) in PERIODS" :key="name" :value="name">{{ name }}</option>
      </select>
      <PercentInput v-model="inputs.statedRate" />

      <button class="nodrag rb__arrow" :class="{ nom: !inputs.compound }"
        @click="inputs.compound = !inputs.compound"
        :title="inputs.compound
          ? 'Capitaliza: (1+tasa)^(origen/destino) − 1. Click para pasar a nominal.'
          : 'Divide proporcional: tasa × origen/destino. Click para pasar a efectiva.'">
        <i></i>{{ inputs.compound ? 'efectiva' : 'nominal' }}<i></i>
      </button>

      <select class="nodrag rb__per" v-model="periods.chargedEvery">
        <option v-for="(n, name) in PERIODS" :key="name" :value="name">{{ name }}</option>
      </select>
      <b class="rb__out">{{ result ?? '—' }}<em>%</em></b>
    </div>

    <div v-if="ea" class="rb__ea">equivale a <b>{{ ea }}% E.A.</b></div>
  </div>
</template>
