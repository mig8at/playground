<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import PercentInput from '../PercentInput.vue'
import RateBlock from '../RateBlock.vue'
import { fmtNum } from '../engine.js'
import { FORMULA_LABEL } from '../sheets.js'
import { inputs, where } from '../store.js'

// Una etapa AUTOCONTENIDA: sus propios inputs arriba, sus propias fórmulas abajo, separadas por
// una línea. No hay un nodo "entrada" que junte todo — si una perilla aplica al monto, su lugar
// es el nodo del monto.
//
// La última fórmula va resaltada: es la salida de la etapa, lo que las otras consumen — y se
// muestra SIEMPRE. `showRows: false` esconde los pasos intermedios, nunca el resultado: un nodo
// que no dice qué produce obliga a leer la etiqueta del cable para entenderlo.
//
// El v-model apunta al store, NO al prop `data`: `data` se recrea en cada recálculo y el input
// perdería el foco a cada tecla.
const props = defineProps({ data: Object })

const val = r => {
  if (!r || r.status === 'skipped') return 'sin calcular'
  if (r.status === 'error') return 'error'
  return fmtNum(r.value, /rate|Rate/.test(r.name) ? 6 : undefined)
}
const signo = f => (f.sign === -1 ? '−' : f.appliesTo === 'charges' ? '+' : '')
// Si la etapa tiene RateBlock, el bloque es dueño de `statedRate` y `compound`: sacarlos de la
// lista o se dibujan dos veces.
const DEL_BLOQUE = new Set(['statedRate', 'compound'])
const propios = computed(() => props.data.inputs.filter(f =>
  f.appliesTo === props.data.key && !(props.data.rateBlock && DEL_BLOQUE.has(f.name))))
const fianza = computed(() => props.data.inputs.filter(f => f.appliesTo === 'guarantee'))
// el bloque de fianza se mueve entre los dos puntos de inserción; el botón ofrece el otro
const enMonto = computed(() => where.guarantee === 'amount')
const otroLado = computed(() => (enMonto.value ? 'charges' : 'amount'))
const otroNombre = computed(() => (enMonto.value ? 'a la cuota' : 'al monto'))
// con `showRows: false` queda solo la salida
const filas = computed(() => (props.data.showRows ? props.data.rows : props.data.rows.slice(-1)))
</script>

<template>
  <div class="n n--stage" :class="['st--' + data.key, data.group && 'g--' + data.group]"
       style="min-width:296px;max-width:296px">
    <Handle v-if="data.key !== 'credit'" id="in" type="target" :position="Position.Left" />
    <!-- solo las etapas con una dependencia DENTRO de su grupo: la flecha baja en vez de dar
         la vuelta por la izquierda -->
    <Handle v-if="data.hUp" id="up" type="target" :position="Position.Top" />
    <Handle v-if="data.hDown" id="down" type="source" :position="Position.Bottom" />
    <div class="n__hd">
      <b>{{ data.title }}</b>
      <!-- solo los dos puntos de inserción la llevan: es lo que los hace par -->
      <span v-if="data.insertion" class="n__kind n__kind--in" :title="data.insertionHelp">
        {{ data.insertion }}</span>
    </div>

    <div class="ent">
      <!-- inputs propios de la etapa -->
      <div v-for="f in propios" :key="f.name" class="ent__row"
           :class="{ 'is-zero': inputs[f.name] === 0 || inputs[f.name] === false }">
        <span class="ent__k" :title="f.help">
          <em v-if="signo(f)" class="sg">{{ signo(f) }}</em>{{ f.label }}
        </span>
        <select v-if="f.type === 'bool'" class="nodrag nf" v-model="inputs[f.name]">
          <option :value="true">sí</option><option :value="false">no</option>
        </select>
        <MoneyInput v-else-if="f.type === 'money'" v-model="inputs[f.name]" />
        <PercentInput v-else-if="f.type === 'rate'" v-model="inputs[f.name]" />
        <input v-else class="nodrag nf" type="text" inputmode="numeric" v-model="inputs[f.name]">
      </div>

      <RateBlock v-if="data.rateBlock" />

      <!-- La fianza. El encabezado ya NO dice a dónde va: eso lo dice el nodo en el que está.
           Lo único que queda por ofrecer es la acción, mover el bloque al otro. -->
      <template v-if="fianza.length">
        <div class="ent__sec ent__sec--mv">
          fianza
          <button class="nodrag mv" @click="where.guarantee = otroLado"
            :title="`Se calcula y se configura acá porque acá entra. Click para moverla ${otroNombre}: `
              + (enMonto ? 'se reparte en los pagos y deja de generar intereses.'
                         : 'se financia con el crédito y empieza a generar intereses.')">
            mover {{ otroNombre }} ›</button>
        </div>
        <div v-for="f in fianza" :key="f.name" class="ent__row"
             :class="{ 'is-zero': inputs[f.name] === 0 }">
          <span class="ent__k" :title="f.help">{{ f.label }}</span>
          <PercentInput v-model="inputs[f.name]" />
        </div>
      </template>
    </div>

    <!-- resultados de la etapa -->
    <div v-if="filas.length" class="grp-rows st-out">
      <div v-for="(r, i) in filas" :key="r.name" class="grp-row"
           :class="{ 'is-out': i === filas.length - 1, 'is-off': r.status !== 'ok' }"
           :title="r.expr">
        <span class="grp-k">{{ FORMULA_LABEL[r.name] || r.name }}</span>
        <b class="grp-v">{{ val(r) }}</b>
      </div>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
