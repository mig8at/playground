<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import PercentInput from '../PercentInput.vue'
import RateBlock from '../RateBlock.vue'
import { inputs } from '../store.js'

// La entrada agrupada por A QUÉ SE APLICA cada valor, no por tipo de costo. En el cálculo hay
// dos puntos de inserción y todo va a uno:
//
//   valor a financiar = monto − lo que RESTA + lo que SUMA
//   cuota total       = cuota del crédito + lo que se suma A CADA PAGO
//
// El grupo sale del `appliesTo` del input, así que agregar una perilla no requiere tocar
// ninguna lista: se ubica sola.
//
// Y la sección de la fianza tiene su ENCABEZADO como interruptor, porque `guaranteeUpfront` no
// es un flag técnico — decide a cuál de los dos grupos pertenece la fianza.
//
// La UI muestra solo `label` (español) y `help` como tooltip; el `name` en inglés vive en el
// documento y en las fórmulas.
const props = defineProps({ data: Object })

const sections = computed(() =>
  (props.data.inputSections || []).map(sec => ({
    ...sec,
    // `rate` no lista campos: el RateBlock ya es dueño de `statedRate` y `compound`, y
    // dibujarlos otra vez los duplicaba.
    fields: sec.key === 'rate' ? [] : props.data.inputs.filter(i => i.appliesTo === sec.key),
  })).filter(s => s.fields.length || s.key === 'rate'))

const signo = f => (f.sign === -1 ? '−' : f.appliesTo === 'installment' ? '+' : '')
</script>

<template>
  <div class="n n--entrada" style="min-width:336px;max-width:336px">
    <div class="n__hd">
      <b>Entrada</b>
      <span class="n__kind">editable</span>
    </div>

    <div class="ent">
      <template v-for="sec in sections" :key="sec.key">
        <!-- la fianza: el encabezado ES el interruptor de a dónde va -->
        <button v-if="sec.key === 'guarantee'" class="nodrag ent__sec ent__sec--btn"
          @click="inputs.guaranteeUpfront = !inputs.guaranteeUpfront"
          :title="inputs.guaranteeUpfront
            ? 'Se financia junto con el crédito, así que genera intereses. Click para pasarla a la cuota.'
            : 'Se reparte en los pagos y no entra al saldo. Click para pasarla al monto.'">
          {{ sec.title }} · va
          <b :class="inputs.guaranteeUpfront ? 'to-amount' : 'to-fee'">
            {{ inputs.guaranteeUpfront ? 'al monto' : 'a la cuota' }}</b> ▾
        </button>

        <div v-else class="ent__sec">
          {{ sec.title }}<em v-if="sec.note">{{ sec.note }}</em>
        </div>

        <RateBlock v-if="sec.key === 'rate'" />

        <div v-for="f in sec.fields" :key="f.name" class="ent__row"
             :class="{ 'is-zero': inputs[f.name] === 0 || inputs[f.name] === false }">
          <span class="ent__k" :title="f.help">
            <em v-if="signo(f)" class="sg">{{ signo(f) }}</em>{{ f.label }}
          </span>

          <select v-if="f.type === 'bool'" class="nodrag nf" v-model="inputs[f.name]">
            <option :value="true">sí</option>
            <option :value="false">no</option>
          </select>
          <MoneyInput v-else-if="f.type === 'money'" v-model="inputs[f.name]" />
          <PercentInput v-else-if="f.type === 'rate'" v-model="inputs[f.name]" />
          <input v-else class="nodrag nf" type="text" inputmode="numeric" v-model="inputs[f.name]">
        </div>
      </template>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
