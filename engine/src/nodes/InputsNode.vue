<script setup>
import { Handle, Position } from '@vue-flow/core'
import { fmtNum } from '../engine.js'

// TODO lo que entra a la hoja, en un solo nodo: los inputs (los manda el llamador) y las
// constantes (viven en la hoja). Antes eran ~15 nodos sueltos en la columna izquierda y no
// aportaban nada: son hojas del grafo. Lo que se quiere leer es la CADENA de cálculo.
//
// Las constantes no tiran ninguna arista — son ambiente. Los inputs sí, pero solo hacia las
// fórmulas que los leen directo, que son pocas.
defineProps({ data: Object })

const val = (v, name) => {
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (v === undefined || v === '') return '—'
  return fmtNum(Number(v), /rate|factor|ratio|share/i.test(name) ? 6 : undefined)
}
</script>

<template>
  <div class="n n--entrada" style="min-width:238px;max-width:238px">
    <div class="n__hd">
      <b>Entrada</b>
      <span class="n__kind">{{ data.inputs.length }} in · {{ data.constants.length }} const</span>
    </div>

    <div class="ent">
      <div class="ent__sec">inputs · los manda el llamador</div>
      <div v-for="f in data.inputs" :key="f.name" class="ent__row"
           :class="{ 'is-missing': data.values[f.name] === '' || data.values[f.name] === undefined }">
        <span class="ent__k">{{ f.name }}</span>
        <b class="ent__v">{{ val(data.values[f.name], f.name) }}</b>
      </div>

      <div class="ent__sec">constantes · viven en la hoja</div>
      <div v-for="c in data.constants" :key="c" class="ent__row ent__row--const">
        <span class="ent__k">{{ c }}</span>
        <b class="ent__v">{{ val(data.constValues[c], c) }}</b>
      </div>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
