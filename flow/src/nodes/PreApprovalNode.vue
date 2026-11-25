<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, lenders, preApprovalResponseOf, setPreApprovalField, usesPreApproval, usesQuotaEngine, delegatedOf, money, openFieldInfo } from '../store'
import { ShieldCheck } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// El servicio de preaprobación (pre-approvals-service). Cuelga ARRIBA de «Entidades disponibles» porque es ahí, tarjeta
// por tarjeta, donde se le consulta. Siempre está y muestra la entidad ELEGIDA: para el agregador (rt=1) le pregunta a
// la API de la entidad (y a la de la delegada que no usa el motor), y ahí se dicta lo que contesta; con CreditopX y la
// delegada que sí lo usa, le pregunta al motor de cupo (otro nodo); el redirect no pasa. No guarda la respuesta: cada consulta vuelve a evaluar.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const r = computed(() => preApprovalResponseOf(name.value))
const row = computed(() => lenders.value.find(x => x.name === name.value) || null)
const set = (k, v) => setPreApprovalField(name.value, k, v)
const editable = computed(() => usesPreApproval(lender.value))
const STATUS = [['aprueba', 'aprueba'], ['rechaza', 'rechaza'], ['timeout', 'no contesta']]
// La fianza de la delegada con su propia API: la contesta la preaprobación, y el plan la usa sólo si la ficha lo dice
// (bond_percentage_source = pre_approval para el %; forced_bond_type en NULL para el tipo). Ver `bondOf`.
const BOND_TYPES = [['anticipada', 'Anticipada'], ['mensual', 'Vencida']]
const bondFromHere = computed(() => lender.value?.rt === 4 && delegatedOf(lender.value).bondSource === 'pre_approval')
const typeFromHere = computed(() => lender.value?.rt === 4 && delegatedOf(lender.value).bondType === 'pre_approval')
const outcome = computed(() => {
  if (!row.value) return ''
  if (row.value.ok) return `la tarjeta sale con cupo ${money(row.value.cupo)} a ${row.value.rate}%`
  return row.value.reason || 'no se ofrece'
})
</script>

<template>
  <div class="node node--tramo prov-node node--preapproval" :class="{ 'node--external': editable }">
    <div class="node__hd node__hd--teal nhd-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('psel.preapproval')">
      <div class="node__title"><ShieldCheck :size="13" /> Servicio de preaprobación</div>
      <div class="node__kind">{{ lender ? lender.name : 'pre-approvals-service' }}</div>
    </div>
    <div class="node__body">
      <div v-if="!lender" class="tr-hint">Se consulta por cada tarjeta del listado. Elegí una entidad en «Entidades disponibles» para ver o dictar lo que contesta.</div>
      <template v-else-if="editable">
        <div class="tr-hint">El servicio le pregunta a la API de {{ lender.name }} (no al motor de cupo): ella decide. Dictá lo que contesta:</div>
        <div class="cat__chips">
          <button v-for="[k, label] in STATUS" :key="k" class="chip-toggle nodrag" :class="{ on: r.status === k }" @click.stop="set('status', k)">{{ label }}</button>
        </div>
        <template v-if="r.status === 'aprueba'">
          <label class="field"><span>Monto máximo</span>
            <AffixField currency class="afld--mny"><MoneyInput class="afld__in" placeholder="el tope de la entidad" :model-value="r.maxAmount" @update:model-value="v => set('maxAmount', v)" /></AffixField>
          </label>
          <label class="field"><span>Tasa % N.M.</span>
            <input class="nodrag" type="number" min="0" step="0.01" placeholder="la de la entidad" :value="r.rate ?? ''" @input="e => set('rate', e.target.value)" />
          </label>
          <template v-if="lender.rt === 4">
            <label class="field" :title="bondFromHere ? 'guarantee_percentage: lo usa el plan porque la ficha dice bond_percentage_source = pre_approval' : 'la ficha toma el % de la tabla del FNG: este no se usa'"><span>Fianza % <em class="ent-hint">guarantee_percentage</em></span>
              <input class="nodrag" type="number" min="0" step="0.1" placeholder="10" :disabled="!bondFromHere" :value="r.bondPct ?? ''" @input="e => set('bondPct', e.target.value)" />
            </label>
            <div class="field"><span>Tipo <em class="ent-hint">guarantee_type</em></span>
              <div class="cat__chips">
                <button v-for="[k, label] in BOND_TYPES" :key="k" class="chip-toggle nodrag" :class="{ on: (r.bondType || 'anticipada') === k }" :disabled="!typeFromHere" @click.stop="set('bondType', k)">{{ label }}</button>
              </div>
            </div>
            <div v-if="!typeFromHere" class="tr-hint">El tipo no se usa: la ficha lo fuerza (forced_bond_type).</div>
          </template>
        </template>
        <div class="tr-active" :class="{ 'tr-active--no': row && !row.ok }">→ {{ outcome }}</div>
      </template>
      <template v-else-if="usesQuotaEngine(lender)">
        <div class="tr-hint">{{ lender.rt === 2 ? 'CreditopX' : lender.name + ' (por alias, como CreditopX)' }}: el servicio no decide, le pregunta al motor de cupo → y devuelve lo que contesta. Se cambia en las categorías, arriba del motor.</div>
        <div class="tr-active" :class="{ 'tr-active--no': row && !row.ok }">→ {{ outcome }}</div>
      </template>
      <div v-else class="tr-hint">Redirect: no pasa por la preaprobación. La entidad decide en su sitio.</div>
    </div>
    <Handle id="toengine" type="source" :position="Position.Right" />
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.node--preapproval { width: 300px; }
</style>
