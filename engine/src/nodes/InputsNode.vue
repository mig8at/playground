<script setup>
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import { computed } from 'vue'
import { inputs, consts, tables, controlFor } from '../store.js'

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
      <div class="ent__sec">inputs · los manda el llamador</div>
      <div v-for="f in data.inputs" :key="f.name" class="ent__row"
           :class="{ 'is-missing': inputs[f.name] === '' || inputs[f.name] === undefined }">
        <span class="ent__k" :title="f.label">{{ f.name }}</span>

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

      <div class="ent__sec">constantes · viven en la hoja</div>
      <div v-for="c in data.constants" :key="c" class="ent__row ent__row--const">
        <span class="ent__k">{{ c }}</span>
        <MoneyInput v-if="controlFor(c, consts[c]) === 'money'" v-model="consts[c]" />
        <input v-else class="nodrag nf" type="text" inputmode="decimal" v-model.number="consts[c]">
      </div>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
