<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, state, perfilOf, perfilDiagSel, setCatParam, setCatRule, toggleCatSet, OCCUPATIONS, money, openFieldInfo } from '../store'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// Una CATEGORÍA de perfilamiento como nodo propio. Se resalta si gana; se atenúa (gris) si no. El
// campo que la hace fallar contra el usuario actual se pinta ROJO (igual que en el buró). Header
// clickable → sidebar que describe qué es esta categoría. Las 3 son fijas (como el código real).
const props = defineProps({ data: Object })
const name = computed(() => ui.selected)
const catId = computed(() => props.data?.catId)
const cat = computed(() => perfilOf(name.value)?.find(c => c.id === catId.value) || null)
const diag = perfilDiagSel // computed compartido del store (una sola evaluación para hub + 3 tarjetas)
const row = computed(() => diag.value?.rows.find(r => r.cat.id === catId.value) || null)
const checks = computed(() => row.value?.checks || {})
const won = computed(() => !!row.value?.won)
const cupo = computed(() => row.value?.cupo || 0)
const GEN = ['M', 'F']
const set = (k, v) => setCatParam(name.value, catId.value, k, v)
const setR = (k, v) => setCatRule(name.value, catId.value, k, v)
const bad = (k) => checks.value[k] === false // la condición k falla contra el usuario → campo rojo
// Cupo máx en rojo solo en la categoría GANADORA y solo si el monto pedido supera SU cupo (no el del comercio).
const overCupo = computed(() => won.value && (parseInt(String(state.monto).replace(/\D/g, '')) || 0) > cupo.value)
// Rueda del mouse → scroll horizontal del track de chips, solo si hay overflow (si caben, no interfiere).
function wheelScroll(e) {
  const el = e.currentTarget
  if (el.scrollWidth <= el.clientWidth) return
  el.scrollLeft += e.deltaY || e.deltaX
  e.preventDefault()
}
</script>

<template>
  <div v-if="cat" class="node node--cat prov-node" :class="{ 'node--catwon': won, 'node--catoff': !won }">
    <div class="node__hd node__hd--teal cat-hd nhd-doc" title="clic: qué es esta categoría y cuándo cae" @click="openFieldInfo('catnode.' + catId)">
      <span class="cat__id">{{ cat.id }}</span>
      <span class="cat__label cat__label--ro" :title="cat.label">{{ cat.label }}</span>
      <span class="cat__cupo" title="Cupo que otorgaría esta categoría al usuario actual.">≈ {{ money(cupo) }}</span>
      <span v-if="won" class="cat__win">gana</span>
    </div>
    <div class="node__body">
      <!-- Otorga: enganche / cupo / plazo / fondo / capacidad (parámetros, no condiciones) -->
      <div class="cat__grp">
        <div class="cat__rl">Otorga</div>
        <div class="ent-row"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.enganche')">Enganche</span>
          <AffixField suffix="%" class="afld--cnum"><input class="nodrag afld__in" type="number" :value="cat.minInitialFee" @input="e => set('minInitialFee', e.target.value)" /></AffixField>
        </div>
        <div class="ent-row" :class="{ 'ent-row--fail': overCupo }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.cupoMax')">Cupo máx</span>
          <AffixField prefix="$" class="afld--cnum"><MoneyInput class="afld__in" :model-value="cat.maxAmount" @update:model-value="v => set('maxAmount', v)" /></AffixField>
        </div>
        <div class="ent-row"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.plazoMax')">Plazo máx</span>
          <input class="nodrag ent-in afld--cnum" type="number" min="0" :value="cat.maxFeeNumber" @input="e => set('maxFeeNumber', e.target.value)" />
        </div>
        <div class="ent-row ent-row--stack"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.fondo')">Fondo <em class="ent-hint">límite − usado</em></span>
          <div class="ent-substack">
            <AffixField prefix="$" class="afld--mny"><MoneyInput class="afld__in" :model-value="cat.loanLimit" @update:model-value="v => set('loanLimit', v)" /></AffixField>
            <span class="ent-u">−</span>
            <AffixField prefix="$" class="afld--mny"><MoneyInput class="afld__in" :model-value="cat.usedLoan" @update:model-value="v => set('usedLoan', v)" /></AffixField>
          </div>
        </div>
        <div class="ent-row ent-row--stack"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.capacidad')">Capacidad de pago</span>
          <div class="ent-substack">
            <label class="chk--sim cat__vf"><input type="checkbox" :checked="cat.capacityCheck" @change="e => setR('capacityCheck', e.target.checked)" /> validar</label>
            <AffixField suffix="% ing." class="afld--cnum"><input class="nodrag afld__in" type="number" :disabled="!cat.capacityCheck" :value="cat.capacityPct" @input="e => set('capacityPct', e.target.value)" /></AffixField>
          </div>
        </div>
      </div>

      <!-- Regla de asignación (demográfica): el campo que falla se pinta rojo -->
      <div class="cat__grp">
        <div class="cat__rl">Regla · prioridad {{ cat.priority }}</div>
        <div class="ent-row" :class="{ 'ent-row--fail': bad('income') }"><span class="fld-doc" title="clic: dónde vive y por qué (⚠ bug)" @click="openFieldInfo('cat.minIncome')">Ingreso mín</span>
          <AffixField prefix="$" class="afld--cnum"><MoneyInput class="afld__in" :model-value="cat.minIncome" @update:model-value="v => set('minIncome', v)" /></AffixField>
        </div>
        <div class="ent-row" :class="{ 'ent-row--fail': bad('age') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.age')">Edad</span>
          <div class="ent-range">
            <input class="nodrag ent-in ent-in--n" type="number" min="0" :value="cat.minAge" @input="e => set('minAge', e.target.value)" />
            <span class="ent-u">–</span>
            <input class="nodrag ent-in ent-in--n" type="number" min="0" :value="cat.maxAge" @input="e => set('maxAge', e.target.value)" />
          </div>
        </div>
        <div class="ent-row" :class="{ 'ent-row--fail': bad('continuity') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.continuity')">Continuidad mín</span>
          <AffixField suffix="m" class="afld--cnum"><input class="nodrag afld__in" type="number" min="0" :value="cat.minContinuity" @input="e => set('minContinuity', e.target.value)" /></AffixField>
        </div>
        <label class="chk--sim cat__vf cat__vf--full"><input type="checkbox" :checked="cat.verifiedIncome" @change="e => setR('verifiedIncome', e.target.checked)" /> exige ingreso verificado (buró)</label>
        <div class="cat__chips" :class="{ 'ent-row--fail': bad('occupation') }"><span class="cat__cl fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.occupation')">Ocupación</span>
          <div class="chip-scroll nowheel nodrag" @wheel="wheelScroll">
            <button v-for="o in OCCUPATIONS" :key="o" class="chip-toggle nodrag" :class="{ on: cat.occupation.includes(o) }" @click="toggleCatSet(name, catId, 'occupation', o)">{{ o }}</button>
          </div>
        </div>
        <div class="cat__chips" :class="{ 'ent-row--fail': bad('gender') }"><span class="cat__cl fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.gender')">Género</span>
          <div class="chip-scroll nowheel nodrag" @wheel="wheelScroll">
            <button v-for="g in GEN" :key="g" class="chip-toggle nodrag" :class="{ on: cat.gender.includes(g) }" @click="toggleCatSet(name, catId, 'gender', g)">{{ g }}</button>
          </div>
        </div>
      </div>

      <!-- Riesgo (buró): el campo que falla se pinta rojo -->
      <div class="cat__grp">
        <div class="cat__rl">Riesgo (buró)</div>
        <div class="ent-row" :class="{ 'ent-row--fail': bad('score') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.minScore')">Score mín</span>
          <input class="nodrag ent-in afld--cnum" type="number" min="0" :value="cat.minScore" @input="e => set('minScore', e.target.value)" />
        </div>
        <div class="ent-row" :class="{ 'ent-row--fail': bad('negatives') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.maxNegatives')">Negativos máx</span>
          <input class="nodrag ent-in afld--cnum" type="number" min="0" :value="cat.maxNegatives" @input="e => set('maxNegatives', e.target.value)" />
        </div>
        <div class="ent-row" :class="{ 'ent-row--fail': bad('delinq') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.maxDelinq')">Mora máx</span>
          <input class="nodrag ent-in afld--cnum" type="number" min="0" :value="cat.maxDelinq" @input="e => set('maxDelinq', e.target.value)" />
        </div>
        <div class="ent-row" :class="{ 'ent-row--fail': bad('history') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.minHistory')">Antigüedad mín</span>
          <AffixField suffix="m" class="afld--cnum"><input class="nodrag afld__in" type="number" min="0" :value="cat.minHistory" @input="e => set('minHistory', e.target.value)" /></AffixField>
        </div>
        <div class="ent-row" :class="{ 'ent-row--fail': bad('inquiries') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.maxInquiries')">Consultas máx</span>
          <input class="nodrag ent-in afld--cnum" type="number" min="0" :value="cat.maxInquiries" @input="e => set('maxInquiries', e.target.value)" />
        </div>
      </div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>
