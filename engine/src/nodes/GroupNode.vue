<script setup>
import { Handle, Position } from '@vue-flow/core'
import { fmtNum } from '../engine.js'
import { ui, selectFormula } from '../store.js'

// Una ETAPA del cálculo: varias fórmulas que el negocio piensa como una sola cosa
// ("Valor a financiar", "Fianza", "Canon"). El agrupado es SOLO disposición: el documento
// sigue siendo una bolsa plana de fórmulas con nombre y el motor ni se entera.
defineProps({ data: Object })

const val = (r, name) => {
  if (!r) return '—'
  if (r.status === 'skipped') return 'sin calcular'
  if (r.status === 'error') return 'error'
  return fmtNum(r.value, /rate|factor|ratio|share/i.test(name) ? 6 : undefined)
}
</script>

<template>
  <div class="n n--grp" :class="{ 'has-output': data.hasOutput }" style="min-width:262px;max-width:262px">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="n__hd">
      <b>{{ data.title }}</b>
      <span class="n__kind">{{ data.rows.length }}</span>
    </div>
    <div class="grp-rows">
      <div v-for="r in data.rows" :key="r.name" class="grp-row nodrag"
           :class="{ 'is-out': r.isOutput, 'is-off': r.status !== 'ok', 'is-sel': ui.selected === r.name }"
           :title="r.expr" @click="selectFormula(r.name)">
        <span class="grp-k">{{ r.name }}</span>
        <b class="grp-v">{{ val(r, r.name) }}</b>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
