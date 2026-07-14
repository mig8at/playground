<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, merchant, customLenders, branchStatusOf, setBranchStatus, openFieldInfo } from '../store'
import { Power } from 'lucide-vue-next'

// STATUS por sucursal (lenders_by_allied_branches.status) = 1ª compuerta dura de la 2ª capa.
// El comercio TIENE su catálogo de entidades ("Entidades del comercio"); CADA sucursal ACTIVA o
// DESACTIVA cada una por separado acá. Inactiva → NO se ofrece en esta sucursal (filtro duro del
// listado, igual que getLenders, que solo devuelve las filas activas de lenders_by_allied_branches).
const RT_NAME = { 0: 'Redirect', 1: 'Agregador', 2: 'CreditopX', 3: 'Rotativo' }
const PROD = { credito: 'Crédito', renting: 'Renting', rto: 'Renting con compra' }
const entities = computed(() => [...customLenders])
const onCount = computed(() => entities.value.filter(l => branchStatusOf(l.name)).length)
</script>

<template>
  <div class="node node--branchstatus prov-node">
    <div class="node__hd node__hd--green nhd-doc" title="clic: dónde vive y por qué (status por sucursal)" @click="openFieldInfo('suc.status')">
      <div class="node__title"><Power :size="13" /> Estado en sucursal</div>
      <span class="cfg-count">{{ onCount }}/{{ entities.length }}</span>
    </div>
    <div class="node__body">
      <div class="dn-hint">Activá o desactivá cada entidad del comercio <b>en {{ merchant.sucursal }}</b>. Inactiva = no se ofrece en esta sucursal.</div>
      <div v-if="!entities.length" class="cfg-empty">Sin entidades — creá alguna en “Entidades del comercio”.</div>
      <div v-for="l in entities" :key="l.name" class="cfg-row cfg-erow bs-erow"
           :class="['erow--rt' + l.rt, { 'cfg-row--on': branchStatusOf(l.name), 'cfg-row--cur': ui.selected === l.name }]" :title="l.name">
        <input type="checkbox" class="nodrag" :checked="branchStatusOf(l.name)" @change="e => setBranchStatus(l.name, e.target.checked)" />
        <div class="erow__main bs-pick" title="ver su config de sucursal" @click.stop="ui.selected = l.name">
          <div class="erow__top">
            <span class="erow__nm">{{ l.name }}</span>
            <span class="cfg-rt" :class="'rt' + l.rt">{{ RT_NAME[l.rt] || ('rt' + l.rt) }}</span>
          </div>
          <div class="erow__sub" v-if="l.producto">
            <span class="cfg-cat" :class="'cfg-cat--' + l.producto">{{ PROD[l.producto] }}</span>
          </div>
        </div>
      </div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>
