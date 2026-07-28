<script setup>
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import { computed } from 'vue'
import { inputs, consts, tables, periods, controlFor, periodOf } from '../store.js'
import { PERIODS } from '../sheets.js'

// TODO lo que entra a la hoja, editable en vivo: los inputs (los manda el llamador) y las
// constantes (viven en la hoja). Antes eran ~15 nodos sueltos que no aportaban nada — son
// hojas del grafo. Lo que se quiere leer es la CADENA de cálculo.
//
// El v-model apunta al store, NO al prop `data`: `data` se recrea en cada recálculo y el
// input perdería el foco a cada tecla.
defineProps({ data: Object })

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

const optLabel = (name, value) => {
  for (const t of Object.values(tables)) {
    if (t.key !== name) continue
    const row = t.rows.find(r => Number(r[name]) === Number(value))
    if (row?.label) return `${value} · ${row.label}`
  }
  return String(value)
}
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

      <div class="ent__sec">inputs · los manda el llamador</div>
      <div v-for="f in data.inputs" :key="f.name" class="ent__row"
           :class="{ 'is-missing': inputs[f.name] === '' || inputs[f.name] === undefined }">
        <span class="ent__k" :title="f.label">{{ f.name }}<em
          v-if="periodOf(f.name)" class="per">{{ periodOf(f.name) }}</em></span>

        <select v-if="f.type === 'bool'" class="nodrag nf" v-model="inputs[f.name]">
          <option :value="true">sí</option>
          <option :value="false">no</option>
        </select>
        <select v-else-if="f.enum" class="nodrag nf nf--wide" v-model.number="inputs[f.name]">
          <option v-for="o in f.enum" :key="o" :value="o">{{ optLabel(f.name, o) }}</option>
        </select>
        <MoneyInput v-else-if="f.type === 'money'" v-model="inputs[f.name]" />
        <input v-else class="nodrag nf" type="text" inputmode="decimal" v-model="inputs[f.name]">
      </div>

      <div v-if="data.constants.length" class="ent__sec">constantes · viven en la hoja</div>
      <div v-for="c in data.constants" :key="c" class="ent__row ent__row--const">
        <span class="ent__k">{{ c }}<em v-if="periodOf(c)" class="per">{{ periodOf(c) }}</em></span>
        <MoneyInput v-if="controlFor(c, consts[c]) === 'money'" v-model="consts[c]" />
        <input v-else class="nodrag nf" type="text" inputmode="decimal" v-model.number="consts[c]">
      </div>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
