<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, sucursalDiag, groupField, addGroup, removeGroup, addCond, removeCond, setCond, toggleCondSet, openFieldInfo } from '../store'
import { X, Check, Plus, Trash2, ListFilter } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'

// group_rules por sucursal como nodo propio (arriba del hub Configurar sucursal). AND dentro del
// grupo · OR entre grupos. Al fallar: rt=2 EXCLUYE, rt≠2 clasifica al fondo. Copiadas por sucursal.
const name = computed(() => ui.selected)
const diag = computed(() => name.value ? sucursalDiag(name.value) : null)
const rawGroups = computed(() => diag.value?.groups || [])
const evalG = computed(() => diag.value?.gate.groups.groups || [])
const gk = (field) => groupField(field)
const FIELDS = ['age', 'monthlyIncome', 'employment', 'gender', 'documentType', 'amount', 'currentArrears', 'debtToIncomePct', 'amlClean', 'identityVerified']
</script>

<template>
  <div class="node node--grouprules prov-node" v-if="name">
    <div class="node__hd node__hd--green nhd-doc" title="clic: dónde vive y por qué (copiado por sucursal)" @click="openFieldInfo('suc.grouprules')">
      <div class="node__title"><ListFilter :size="13" /> group_rules</div>
      <span class="pl-cat">AND dentro · OR entre</span>
    </div>
    <div class="node__body">
      <div v-if="!rawGroups.length" class="dn-hint">sin grupos — todos pasan. Agregá un grupo para filtrar por edad/ingreso/ocupación/etc.</div>
      <template v-for="(g, gi) in rawGroups" :key="gi">
        <div v-if="gi > 0" class="gr-or">O bien</div>
        <div class="gr-group" :class="{ 'gr-ok': evalG[gi]?.ok, 'gr-no': evalG[gi] && !evalG[gi].ok }">
          <div class="gr-hd">
            <span class="gr-tag">Grupo {{ gi + 1 }} <span class="gr-and">· todas (AND)</span></span>
            <span class="gr-mk" :class="evalG[gi]?.ok ? 'ok' : 'no'"><Check v-if="evalG[gi]?.ok" :size="11" /><X v-else :size="11" /></span>
            <button class="gr-del nodrag" @click.stop="removeGroup(name, gi)" title="quitar grupo"><Trash2 :size="12" /></button>
          </div>
          <div v-for="(c, ci) in g.conds" :key="ci" class="gr-cond" :class="{ 'gr-cond--fail': evalG[gi] && !evalG[gi].conds[ci]?.ok }">
            <select class="nodrag gr-field" :value="c.field" @change="e => setCond(name, gi, ci, { field: e.target.value })">
              <option v-for="f in FIELDS" :key="f" :value="f">{{ gk(f).label }}</option>
            </select>
            <select class="nodrag gr-op" :value="c.op" @change="e => setCond(name, gi, ci, { op: e.target.value })">
              <option v-for="o in gk(c.field).ops" :key="o" :value="o">{{ o }}</option>
            </select>
            <span class="gr-val">
              <MoneyInput v-if="gk(c.field).kind === 'money'" class="afld__in gr-in" :model-value="c.value" @update:model-value="v => setCond(name, gi, ci, { value: v })" />
              <input v-else-if="gk(c.field).kind === 'num'" class="nodrag afld__in gr-in" type="number" :value="c.value" @input="e => setCond(name, gi, ci, { value: e.target.value })" />
              <button v-else-if="gk(c.field).kind === 'bool'" class="chip-toggle nodrag" :class="{ on: c.value }" @click="setCond(name, gi, ci, { value: !c.value })">{{ c.value ? 'sí' : 'no' }}</button>
              <span v-else class="gr-chips">
                <button v-for="o in gk(c.field).options" :key="o" class="chip-toggle nodrag" :class="{ on: Array.isArray(c.value) && c.value.includes(o) }" @click="toggleCondSet(name, gi, ci, o)">{{ o }}</button>
              </span>
            </span>
            <button class="gr-x nodrag" @click.stop="removeCond(name, gi, ci)" title="quitar condición"><X :size="11" /></button>
          </div>
          <button class="gr-add nodrag" @click.stop="addCond(name, gi)"><Plus :size="11" /> condición</button>
        </div>
      </template>
      <button class="gr-addg nodrag" @click.stop="addGroup(name)"><Plus :size="12" /> grupo <span class="gr-and">(O bien…)</span></button>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>
