<script setup>
import { Handle, Position } from '@vue-flow/core'
import { fmtNum } from '../engine.js'
import { FORMULA_LABEL } from '../sheets.js'

// Una etapa del cálculo. Las tres claves son las mismas que las secciones de la entrada, así
// que se lee el par: lo que se puso "al monto" sale acá como `valor a financiar`.
//
// La última fila va resaltada: es la salida de la etapa, lo que las otras etapas consumen.
defineProps({ data: Object })

const val = r => {
  if (!r || r.status === 'skipped') return 'sin calcular'
  if (r.status === 'error') return 'error'
  return fmtNum(r.value, /rate/i.test(r.name) ? 6 : undefined)
}
</script>

<template>
  <div class="n n--stage" :class="'st--' + data.key" style="min-width:266px;max-width:266px">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="n__hd">
      <b>{{ data.title }}</b>
      <span class="n__kind">{{ data.rows.length }}</span>
    </div>
    <div class="grp-rows">
      <div v-for="(r, i) in data.rows" :key="r.name" class="grp-row"
           :class="{ 'is-out': i === data.rows.length - 1, 'is-off': r.status !== 'ok' }"
           :title="r.expr">
        <span class="grp-k">{{ FORMULA_LABEL[r.name] || r.name }}</span>
        <b class="grp-v">{{ val(r) }}</b>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
