<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, lenders, preApprovalResponseOf, setPreApprovalField, money, openFieldInfo } from '../store'
import { ShieldCheck } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// El servicio de preaprobación (pre-approvals-service), por tarjeta del listado. Para el agregador (rt=1) le pregunta
// a la API de la entidad; para la delegada (rt=4), al motor de la entidad. No guarda la respuesta: cada consulta vuelve
// a evaluar. Acá se dicta lo que contesta, para ver qué hace el resto del flujo con eso.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const r = computed(() => preApprovalResponseOf(name.value))
const row = computed(() => lenders.value.find(x => x.name === name.value) || null)
const set = (k, v) => setPreApprovalField(name.value, k, v)
const STATUS = [['aprueba', 'aprueba'], ['rechaza', 'rechaza'], ['timeout', 'no contesta']]
const outcome = computed(() => {
  if (!row.value) return ''
  if (row.value.ok) return `la tarjeta sale con cupo ${money(row.value.cupo)} a ${row.value.rate}%`
  return row.value.reason || 'no se ofrece'
})
</script>

<template>
  <div v-if="lender" class="node node--tramo prov-node">
    <div class="node__hd node__hd--teal nhd-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('psel.preapproval')">
      <div class="node__title"><ShieldCheck :size="13" /> Servicio de preaprobación</div>
      <div class="node__kind">pre-approvals-service</div>
    </div>
    <div class="node__body">
      <div class="tr-hint">Lo que contesta {{ lender.rt === 4 ? 'el motor de la entidad' : 'la API de ' + lender.name }} para esta tarjeta. Editalo:</div>
      <div class="cat__chips">
        <button v-for="[k, label] in STATUS" :key="k" class="chip-toggle nodrag" :class="{ on: r.status === k }" @click.stop="set('status', k)">{{ label }}</button>
      </div>
      <template v-if="r.status === 'aprueba'">
        <label class="field"><span>Monto máximo aprobado <i class="pa-hint">vacío = el tope de la entidad</i></span>
          <AffixField currency class="afld--mny"><MoneyInput class="afld__in" :model-value="r.maxAmount" @update:model-value="v => set('maxAmount', v)" /></AffixField>
        </label>
        <label class="field"><span>Tasa (% N.M.) <i class="pa-hint">vacío = la de la entidad</i></span>
          <input class="nodrag" type="number" min="0" step="0.01" :value="r.rate ?? ''" @input="e => set('rate', e.target.value)" />
        </label>
      </template>
      <div class="tr-active" :class="{ 'tr-active--no': row && !row.ok }">→ {{ outcome }}</div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.pa-hint { font-style: normal; opacity: .6; font-size: 10px; margin-left: 4px; }
</style>
