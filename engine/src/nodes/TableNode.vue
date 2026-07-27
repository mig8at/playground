<script setup>
import { Handle, Position } from '@vue-flow/core'
import { fmtNum } from '../engine.js'

// Tabla de búsqueda. La CLAVE es siempre un número (planDurationWeeks, merchantId) —
// nunca un string, para que un typo no caiga en silencio al `else` de un if.
// El texto vive solo en `label` y es para mostrar; el motor nunca lo lee.
const props = defineProps({ data: Object })
const cols = () => Object.keys(props.data.table.rows[0] || {})
</script>

<template>
  <div class="n n--table" style="max-width:290px">
    <div class="n__hd">
      <b>{{ data.name }}</b>
      <span class="n__kind">tabla</span>
    </div>
    <div class="n__body" style="padding:0">
      <table class="ser" style="font-size:10.5px">
        <thead>
          <tr>
            <th v-for="c in cols()" :key="c" :style="c === data.table.key ? 'text-align:center' : ''">
              {{ c === data.table.key ? '⚿ ' + c : c }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in data.table.rows" :key="i">
            <td v-for="c in cols()" :key="c">
              {{ typeof r[c] === 'number' ? fmtNum(r[c], c === data.table.key ? 0 : undefined) : r[c] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
