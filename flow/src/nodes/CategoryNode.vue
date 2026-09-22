<script setup>
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, state, perfilOf, perfilDiagSel, setCatParam, setCatRule, toggleCatSet, OCCUPATIONS, money, openFieldInfo, productionCollectionChanged } from '../store'
import { ChevronLeft, ChevronRight, ChevronDown, Check } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// Una CATEGORÍA de perfilamiento como nodo propio. Se resalta si gana; se atenúa (gris) si no. El
// campo que la hace fallar contra el usuario actual se pinta ROJO (igual que en el buró). Header
// clickable → sidebar que describe qué es esta categoría. Las 3 son fijas (como el código real).
const props = defineProps({ data: Object })
const name = computed(() => ui.selected)
const catId = computed(() => props.data?.catId)
const cat = computed(() => perfilOf(name.value)?.find(c => c.id === catId.value) || null)
const cats = computed(() => perfilOf(name.value) || [])
const catIndex = computed(() => Math.max(0, Math.min(ui.profileIndex, cats.value.length - 1)))
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
const localProfile = computed(() => productionCollectionChanged(name.value, 'profiles', perfilOf(name.value)))
const openMulti = ref(null)
function previous() { ui.profileIndex = Math.max(0, catIndex.value - 1) }
function next() { ui.profileIndex = Math.min(cats.value.length - 1, catIndex.value + 1) }
function compactOption(value) {
  const text = String(value || '')
  return text.length <= 4 || /^[A-Z_]+$/.test(text) ? text : (text[0]?.toUpperCase() || text)
}
function selectedText(values) {
  if (!Array.isArray(values) || !values.length) return 'Elegir…'
  const labels = values.map(compactOption)
  return labels.length > 4 ? `${labels.slice(0, 4).join(' · ')} +${labels.length - 4}` : labels.join(' · ')
}
function selectedTitle(values) { return Array.isArray(values) && values.length ? values.join(' · ') : 'Elegir valores' }
function toggleMulti(key) { openMulti.value = openMulti.value === key ? null : key }
</script>

<template>
  <div v-if="cat" class="node node--cat prov-node" :class="{ 'node--catwon': won, 'node--catoff': !won, 'node--prodlocal': localProfile }">
    <div class="node__hd node__hd--teal cat-hd nhd-doc" title="clic: qué es esta categoría y cuándo cae" @click="openFieldInfo('catnode.' + catId)">
      <span class="cat__id">{{ cat.id }}</span>
      <span class="cat__label cat__label--ro" :title="cat.label">{{ cat.label }}</span>
      <span class="cat__cupo" title="Cupo que otorgaría esta categoría al usuario actual.">≈ {{ money(cupo) }}</span>
      <span v-if="won" class="cat__win">gana</span>
      <span v-if="cats.length > 1" class="cat__pager nodrag" @click.stop>
        <button :disabled="catIndex === 0" title="perfil anterior" @click="previous"><ChevronLeft :size="12" /></button>
        <b>{{ catIndex + 1 }}/{{ cats.length }}</b>
        <button :disabled="catIndex === cats.length - 1" title="perfil siguiente" @click="next"><ChevronRight :size="12" /></button>
      </span>
    </div>
    <div class="node__body nowheel nodrag" @wheel.stop>
      <!-- Otorga: enganche / cupo / plazo / fondo / capacidad (parámetros, no condiciones) -->
      <div class="cat__grp">
        <div class="cat__rl">Otorga</div>
        <div class="ent-row"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.enganche')">Enganche</span>
          <AffixField suffix="%" class="afld--cnum"><input class="nodrag afld__in" type="number" :value="cat.minInitialFee" @input="e => set('minInitialFee', e.target.value)" /></AffixField>
        </div>
        <div class="ent-row" :class="{ 'ent-row--fail': overCupo }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.cupoMax')">Cupo máx</span>
          <AffixField currency class="afld--cnum"><MoneyInput class="afld__in" :model-value="cat.maxAmount" @update:model-value="v => set('maxAmount', v)" /></AffixField>
        </div>
        <div class="ent-row"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.plazoMax')">Plazo máx</span>
          <input class="nodrag ent-in afld--cnum" type="number" min="0" :value="cat.maxFeeNumber" @input="e => set('maxFeeNumber', e.target.value)" />
        </div>
        <div class="ent-row ent-row--stack"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.fondo')">Fondo <em class="ent-hint">límite − usado</em></span>
          <div class="ent-substack">
            <AffixField currency class="afld--mny"><MoneyInput class="afld__in" :model-value="cat.loanLimit" @update:model-value="v => set('loanLimit', v)" /></AffixField>
            <span class="ent-u">−</span>
            <AffixField currency class="afld--mny"><MoneyInput class="afld__in" :model-value="cat.usedLoan" @update:model-value="v => set('usedLoan', v)" /></AffixField>
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
          <AffixField currency class="afld--cnum"><MoneyInput class="afld__in" :model-value="cat.minIncome" @update:model-value="v => set('minIncome', v)" /></AffixField>
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
        <div class="cat__multi" :class="{ 'ent-row--fail': bad('occupation') }">
          <span class="cat__cl fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.occupation')">Ocupación</span>
          <button class="cat__multi-btn nodrag" :class="{ on: cat.occupation.length }" :title="selectedTitle(cat.occupation)" @click.stop="toggleMulti('occupation')"><span>{{ selectedText(cat.occupation) }}</span><ChevronDown :size="13" /></button>
          <div v-if="openMulti === 'occupation'" class="cat__multi-menu nodrag">
            <button v-for="o in OCCUPATIONS" :key="o" class="cat__multi-option" :class="{ on: cat.occupation.includes(o) }" @click.stop="toggleCatSet(name, catId, 'occupation', o)"><Check :size="11" /><span>{{ o }}</span></button>
          </div>
        </div>
        <div class="cat__multi" :class="{ 'ent-row--fail': bad('gender') }">
          <span class="cat__cl fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('cat.gender')">Género</span>
          <button class="cat__multi-btn nodrag" :class="{ on: cat.gender.length }" :title="selectedTitle(cat.gender)" @click.stop="toggleMulti('gender')"><span>{{ selectedText(cat.gender) }}</span><ChevronDown :size="13" /></button>
          <div v-if="openMulti === 'gender'" class="cat__multi-menu nodrag">
            <button v-for="g in GEN" :key="g" class="cat__multi-option" :class="{ on: cat.gender.includes(g) }" @click.stop="toggleCatSet(name, catId, 'gender', g)"><Check :size="11" /><span>{{ g }}</span></button>
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
