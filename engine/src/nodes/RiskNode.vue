<script setup>
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import { risk } from '../store.js'
import { fmtNum } from '../engine.js'

// La entrada de la POLÍTICA: el canon que produjo la hoja (no editable acá — sale del cálculo)
// más los datos de la persona, que la hoja nunca vio.
defineProps({ data: Object })
</script>

<template>
  <div class="n n--entrada" style="min-width:282px;max-width:282px">
    <div class="n__hd">
      <b>Entrada</b>
      <span class="n__kind">editable</span>
    </div>
    <div class="ent">
      <div class="ent__sec">viene de la hoja de cálculo</div>
      <div class="ent__row">
        <span class="ent__k">{{ data.fromSheetName }}</span>
        <b class="ent__v" style="color:var(--purple)">{{ fmtNum(data.fromSheetValue) }}</b>
      </div>

      <div class="ent__sec">datos de la persona</div>
      <div class="ent__row">
        <span class="ent__k">monthlyIncome</span>
        <MoneyInput v-model="risk.monthlyIncome" />
      </div>
      <div class="ent__row">
        <span class="ent__k">creditScore</span>
        <input class="nodrag nf" type="text" inputmode="numeric" v-model.number="risk.creditScore">
      </div>

      <div class="ent__sec">derivados por la política</div>
      <div v-for="(v, k) in data.derived" :key="k" class="ent__row ent__row--const">
        <span class="ent__k">{{ k }}</span>
        <b class="ent__v">{{ v.status === 'ok' ? fmtNum(v.value, /pct|share/i.test(k) ? 2 : 0) : '—' }}</b>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
