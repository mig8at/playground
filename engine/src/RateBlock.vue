<script setup>
import { computed } from 'vue'
import PercentInput from './PercentInput.vue'
import { inputs, periods, out } from './store.js'
import { PERIODS, notacion } from './sheets.js'

// La conversión de tasa, en dos filas:
//
//   ( ) efectiva  ( ) nominal              ← la convención, arriba: es lo primero que se decide
//   dicha      [anual ▾]     28,17 %   E.A.
//   se cobra   [mensual ▾]  2,089764 %  M.V.
//
// De arriba hacia abajo se lee la conversión completa: con qué convención, de dónde sale el
// número, y en qué termina. El resultado va como PercentInput APAGADO, así la fila "se cobra" se
// lee igual que la de arriba — le pasamos el decimal y el componente lo formatea, un solo camino.
//
// No lleva "equivale a X% E.A." ni las filas de resultado del nodo: el valor ya está al lado de su
// input y la E.A. en la barra de arriba. Repetirlo era ruido.
const result = computed(() => {
  const r = out.value.res.periodRate
  return r?.status === 'ok' ? r.value : ''
})
// La sigla de mercado al lado del campo: E.A. / N.M. / M.V. … con su explicación en el tooltip.
// La de arriba sale de la convención elegida; la de abajo es siempre VENCIDA, porque el motor cobra
// al final de cada período.
const sigDicha = computed(() => notacion(periods.rateStatedIn, !!inputs.compound))
const sigCobra = computed(() => notacion(periods.chargedEvery, false, 'cobra'))

const CONV = [
  { v: true, t: 'efectiva', ayuda: 'Capitaliza: (1 + tasa) ^ (origen / destino) − 1.' },
  { v: false, t: 'nominal',
    ayuda: 'Divide proporcional: tasa × origen / destino. Es el canon de la plataforma (ver F-71).' },
]
</script>

<template>
  <div class="rb">
    <!-- La convención primero: es lo que decide si se capitaliza o se divide, y por lo tanto
         cuánto vale la cuota. Con las dos opciones a la vista se ve que hay una elección; como
         interruptor mostraba solo el estado elegido y eso no se leía. -->
    <div class="rb__conv">
      <label v-for="c in CONV" :key="c.t" class="nodrag rb__opt"
             :class="{ on: !!inputs.compound === c.v }" :title="c.ayuda">
        <input type="radio" :value="c.v" v-model="inputs.compound">
        <span>{{ c.t }}</span>
      </label>
    </div>

    <div class="rb__row">
      <span class="rb__lbl">dicha</span>
      <select class="nodrag rb__per" v-model="periods.rateStatedIn">
        <option v-for="(n, name) in PERIODS" :key="name" :value="name">{{ name }}</option>
      </select>
      <PercentInput v-model="inputs.statedRate" />
      <b class="rb__sig" :title="sigDicha.ayuda">{{ sigDicha.sigla }}</b>
    </div>

    <div class="rb__row">
      <span class="rb__lbl">se cobra</span>
      <select class="nodrag rb__per" v-model="periods.chargedEvery">
        <option v-for="(n, name) in PERIODS" :key="name" :value="name">{{ name }}</option>
      </select>
      <PercentInput :model-value="result" :dec="6" disabled />
      <b class="rb__sig" :title="sigCobra.ayuda">{{ sigCobra.sigla }}</b>
    </div>
  </div>
</template>
