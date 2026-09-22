<script setup>
import { computed, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, sucursalDiag, groupField, addGroup, removeGroup, addCond, removeCond, setCond, toggleCondSet, openFieldInfo, productionCollectionChanged } from '../store'
import { X, Check, Plus, Trash2, ListFilter, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'

// group_rules por sucursal como nodo propio (arriba del hub Configurar sucursal). AND dentro del
// grupo · OR entre grupos. Al fallar: rt=2 EXCLUYE, rt≠2 clasifica al fondo. Copiadas por sucursal.
const name = computed(() => ui.selected)
const diag = computed(() => name.value ? sucursalDiag(name.value) : null)
const rawGroups = computed(() => diag.value?.groups || [])
const evalG = computed(() => diag.value?.gate.groups.groups || [])
const gk = (field) => groupField(field)
const FIELDS = ['age', 'monthlyIncome', 'employment', 'gender', 'documentType', 'amount', 'currentArrears', 'debtToIncomePct', 'amlClean', 'identityVerified']
const localGroups = computed(() => productionCollectionChanged(name.value, 'groupRules', rawGroups.value))
const active = ref(0)
const current = computed(() => rawGroups.value[active.value] || null)
const currentEval = computed(() => evalG.value[active.value] || null)
const openMulti = ref(null)
watch(() => rawGroups.value.length, (n) => { active.value = Math.max(0, Math.min(active.value, n - 1)) })
function previous() { active.value = Math.max(0, active.value - 1) }
function next() { active.value = Math.min(rawGroups.value.length - 1, active.value + 1) }
function removeCurrent() { removeGroup(name.value, active.value); active.value = Math.max(0, active.value - 1) }
function addNewGroup() { addGroup(name.value); active.value = rawGroups.value.length - 1 }
function multiKey(ci) { return active.value + ':' + ci }
// El control debe leerse de un vistazo. Los códigos ya son compactos (CC/CE/M/F); para opciones
// largas usamos una inicial y dejamos el nombre completo en el menú y en el tooltip.
function compactOption(value) {
  const text = String(value || '')
  if (text.length <= 4 || /^[A-Z_]+$/.test(text)) return text
  return text[0]?.toUpperCase() || text
}
function selectedText(value) {
  if (!Array.isArray(value) || !value.length) return 'Elegir…'
  const labels = value.map(compactOption)
  return labels.length > 4 ? `${labels.slice(0, 4).join(' · ')} +${labels.length - 4}` : labels.join(' · ')
}
function selectedTitle(value) { return Array.isArray(value) && value.length ? value.join(' · ') : 'Elegir valores' }
function toggleMulti(ci) { const key = multiKey(ci); openMulti.value = openMulti.value === key ? null : key }
function chooseSet(ci, option) { toggleCondSet(name.value, active.value, ci, option) }
</script>

<template>
  <div class="node node--grouprules prov-node" :class="{ 'node--prodlocal': localGroups }" v-if="name">
    <div class="node__hd node__hd--green nhd-doc" title="clic: dónde vive y por qué (copiado por sucursal)" @click="openFieldInfo('suc.grouprules')">
      <div class="node__title"><ListFilter :size="13" /> group_rules</div>
      <span class="pl-cat">AND dentro · OR entre</span>
    </div>
    <div class="node__body">
      <div v-if="!rawGroups.length" class="dn-hint">sin grupos — todos pasan. Agregá un grupo para filtrar por edad/ingreso/ocupación/etc.</div>
      <template v-if="current">
        <div v-if="rawGroups.length > 1" class="gr-carousel nodrag">
          <button :disabled="active === 0" title="grupo anterior" @click.stop="previous"><ChevronLeft :size="13" /></button>
          <span><b>{{ active + 1 }}</b> de {{ rawGroups.length }} · {{ active ? 'O bien…' : 'primera alternativa' }}</span>
          <button :disabled="active === rawGroups.length - 1" title="grupo siguiente" @click.stop="next"><ChevronRight :size="13" /></button>
        </div>
        <div class="gr-group" :class="{ 'gr-ok': currentEval?.ok, 'gr-no': currentEval && !currentEval.ok }">
          <div class="gr-hd">
            <span class="gr-tag">Grupo {{ active + 1 }} <span class="gr-and">· todas (AND)</span></span>
            <span class="gr-mk" :class="currentEval?.ok ? 'ok' : 'no'"><Check v-if="currentEval?.ok" :size="11" /><X v-else :size="11" /></span>
            <button class="gr-del nodrag" @click.stop="removeCurrent" title="quitar grupo"><Trash2 :size="12" /></button>
          </div>
          <div v-for="(c, ci) in current.conds" :key="ci" class="gr-cond" :class="{ 'gr-cond--fail': currentEval && !currentEval.conds[ci]?.ok, 'gr-cond--set': gk(c.field).kind === 'set' }">
            <select class="nodrag gr-field" :value="c.field" @change="e => setCond(name, active, ci, { field: e.target.value })">
              <option v-for="f in FIELDS" :key="f" :value="f">{{ gk(f).label }}</option>
            </select>
            <select class="nodrag gr-op" :value="c.op" @change="e => setCond(name, active, ci, { op: e.target.value })">
              <option v-for="o in gk(c.field).ops" :key="o" :value="o">{{ o }}</option>
            </select>
            <span class="gr-val">
              <MoneyInput v-if="gk(c.field).kind === 'money'" class="afld__in gr-in" :model-value="c.value" @update:model-value="v => setCond(name, active, ci, { value: v })" />
              <input v-else-if="gk(c.field).kind === 'num'" class="nodrag afld__in gr-in" type="number" :value="c.value" @input="e => setCond(name, active, ci, { value: e.target.value })" />
              <button v-else-if="gk(c.field).kind === 'bool'" class="chip-toggle nodrag" :class="{ on: c.value }" @click="setCond(name, active, ci, { value: !c.value })">{{ c.value ? 'sí' : 'no' }}</button>
              <span v-else class="gr-multi-wrap nodrag">
                <button class="gr-multi" :class="{ on: Array.isArray(c.value) && c.value.length }" :title="selectedTitle(c.value)" @click.stop="toggleMulti(ci)"><span>{{ selectedText(c.value) }}</span><ChevronDown :size="13" /></button>
                <span v-if="openMulti === multiKey(ci)" class="gr-multi-menu">
                  <button v-for="o in gk(c.field).options" :key="o" class="gr-multi-option" :class="{ on: Array.isArray(c.value) && c.value.includes(o) }" @click.stop="chooseSet(ci, o)"><Check :size="11" /><span>{{ o }}</span></button>
                </span>
              </span>
            </span>
            <button class="gr-x nodrag" @click.stop="removeCond(name, active, ci)" title="quitar condición"><X :size="11" /></button>
          </div>
          <button class="gr-add nodrag" @click.stop="addCond(name, active)"><Plus :size="11" /> condición</button>
        </div>
      </template>
      <button class="gr-addg nodrag" @click.stop="addNewGroup"><Plus :size="12" /> grupo <span class="gr-and">(O bien…)</span></button>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>
