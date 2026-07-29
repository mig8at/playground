<script setup>
import { computed } from 'vue'
import PercentInput from './PercentInput.vue'
import { inputs, periods, out } from './store.js'
import { PERIODS, notacion } from './sheets.js'

// La conversión de tasa, en DOS filas con la convención en la mitad:
//
//   dicha      [anual ▾]   28,17 %
//   ───────── ▼ efectiva ─────────      ← clickeable: efectiva ⇄ nominal
//   se cobra   [mensual ▾]  2,089764 %
//
// De arriba hacia abajo se lee la conversión completa: de dónde sale el número, por qué
// camino, y en qué termina. Antes estaba repartida en tres lugares (dos selects en
// "períodos", el statedRate en "tasa y plazo", y el periodRate recién en el nodo de Cálculo).
//
// La convención va EN EL MEDIO y es el interruptor, porque es exactamente ahí donde se
// decide si se capitaliza o se divide — no en una casilla suelta en otra sección.
// El resultado va como PercentInput apagado, así la fila "se cobra" se lee igual que la de
// arriba. Le pasamos el decimal y el componente hace la conversión a porcentaje, como con
// cualquier otra tasa — un solo camino de formato.
const result = computed(() => {
  const r = out.value.res.periodRate
  return r?.status === 'ok' ? r.value : ''
})
// La sigla de mercado al lado del campo: E.A. / M.V. / T.V. … con su explicación en el tooltip.
// La de arriba sale de la convención elegida; la de abajo es siempre VENCIDA, porque el motor
// cobra al final de cada período.
const sigDicha = computed(() => notacion(periods.rateStatedIn, !!inputs.compound))
const sigCobra = computed(() => notacion(periods.chargedEvery, false, 'cobra'))

const ea = computed(() => {
  const r = out.value.res.annualEffectiveRate
  return r?.status === 'ok' ? (r.value * 100).toFixed(2).replace('.', ',') : null
})
</script>

<template>
  <div class="rb">
    <div class="rb__row">
      <span class="rb__lbl">dicha</span>
      <select class="nodrag rb__per" v-model="periods.rateStatedIn">
        <option v-for="(n, name) in PERIODS" :key="name" :value="name">{{ name }}</option>
      </select>
      <PercentInput v-model="inputs.statedRate" />
      <b class="rb__sig" :title="sigDicha.ayuda">{{ sigDicha.sigla }}</b>
    </div>

    <button class="nodrag rb__conv" :class="{ nom: !inputs.compound }"
      @click="inputs.compound = !inputs.compound"
      :title="inputs.compound
        ? 'Capitaliza: (1+tasa)^(origen/destino) − 1. Click para pasar a nominal.'
        : 'Divide proporcional: tasa × origen/destino. Click para pasar a efectiva.'">
      <i></i><span>▾ {{ inputs.compound ? 'efectiva' : 'nominal' }}</span><i></i>
    </button>

    <div class="rb__row">
      <span class="rb__lbl">se cobra</span>
      <select class="nodrag rb__per" v-model="periods.chargedEvery">
        <option v-for="(n, name) in PERIODS" :key="name" :value="name">{{ name }}</option>
      </select>
      <PercentInput :model-value="result" :dec="6" disabled />
      <b class="rb__sig" :title="sigCobra.ayuda">{{ sigCobra.sigla }}</b>
    </div>

    <div v-if="ea" class="rb__ea">equivale a <b>{{ ea }}% E.A.</b></div>
  </div>
</template>
