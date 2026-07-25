<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, posEval, state, money, openFieldInfo } from '../store'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// POS · 2ª evaluación (el dolor nº1, FAQ A1). El listado es un PREVIEW; acá, al "confirmar" en el punto
// de venta, se re-evalúa contra el estado ACTUAL y se compara. Subí "Comprometido" (otro crédito activo
// consumió cupo revolving desde el listado) para ver el preaprobado salir con menos cupo, o sin cupo.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const pe = computed(() => (name.value ? posEval(name.value) : null))
const dispLabel = computed(() => { const p = pe.value; return p ? (p.disponible === Infinity ? 'sin tope' : money(p.disponible)) : '' })
</script>

<template>
  <div v-if="lender && pe" class="node node--poseval prov-node" :class="pe.ok ? 'lc--pass' : 'lc--fail'">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: qué es la 2ª evaluación del POS" @click="openFieldInfo('psel.pos')">
      <div class="node__title">Punto de venta · 2ª evaluación</div>
    </div>
    <div class="node__body pos-body">
      <div class="pos-row"><span class="pos-k">Listado mostró</span><span class="pos-v">cupo {{ money(pe.listadoCupo) }}</span></div>
      <label class="field pos-knob" title="Monto ya comprometido en otro crédito activo desde que se armó el listado. Consume el cupo revolving disponible.">
        <span>Comprometido (crédito activo)</span>
        <AffixField prefix="$"><MoneyInput class="afld__in" v-model="state.posCommitted" /></AffixField>
      </label>
      <div class="pos-row"><span class="pos-k">POS · disponible</span><span class="pos-v">{{ dispLabel }}</span></div>
      <div class="pos-verdict" :class="pe.ok ? 'pos-verdict--ok' : 'pos-verdict--bad'">
        <template v-if="pe.ok">{{ pe.diverges ? 'Difiere pero alcanza' : 'Coincide con el listado' }} — aprueba {{ money(pe.amount) }}</template>
        <template v-else>Sin cupo en el POS — {{ money(pe.committed) }} comprometido dejó {{ dispLabel }} para {{ money(pe.amount) }} pedidos</template>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
