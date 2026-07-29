<script setup>
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import RateBlock from '../RateBlock.vue'
import { inputs } from '../store.js'

// Lo mínimo: monto, número de cuotas, y el bloque de la tasa.
//
// El v-model apunta al store, NO al prop `data`: `data` se recrea en cada recálculo y el
// input perdería el foco a cada tecla.
defineProps({ data: Object })
</script>

<template>
  <div class="n n--entrada" style="min-width:316px;max-width:316px">
    <div class="n__hd">
      <b>Entrada</b>
      <span class="n__kind">editable</span>
    </div>

    <div class="ent">
      <div class="ent__row">
        <span class="ent__k">monto</span>
        <MoneyInput v-model="inputs.amount" />
      </div>
      <div class="ent__row">
        <span class="ent__k">cuotas</span>
        <input class="nodrag nf" type="text" inputmode="numeric" v-model="inputs.installments">
      </div>

      <div class="ent__sec">tasa</div>
      <RateBlock />
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
