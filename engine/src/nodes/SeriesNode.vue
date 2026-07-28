<script setup>
import { Handle, Position } from '@vue-flow/core'
import { fmtNum } from '../engine.js'

// La tabla como NODO, no como cajón al pie. En el simulador la tabla ES la salida: la cuota
// es un número suelto, la tabla muestra POR QUÉ — cómo baja el saldo y cómo el interés le
// cede lugar al capital. Estaba escondida en un panel colapsado y competía con el grafo;
// acá es parte de la cadena.
//
// Scroll interno con `nowheel`: sin esa clase Vue Flow se queda la rueda del mouse y hace
// zoom del canvas en vez de desplazar la tabla.
defineProps({ data: Object })
</script>

<template>
  <div class="n n--series">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="n__hd">
      <b>{{ data.title }}</b>
      <span class="n__kind">{{ data.error ? 'error' : data.rows.length + ' filas' }}</span>
    </div>

    <div v-if="data.error" class="ser-err">{{ data.error }}</div>

    <div v-else class="ser-wrap nowheel">
      <table class="ser">
        <thead>
          <tr><th>#</th><th v-for="c in data.cols" :key="c">{{ c }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in data.rows" :key="i">
            <td>{{ i + 1 }}</td>
            <td v-for="c in data.cols" :key="c">{{ fmtNum(r[c], 0) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
