<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, merchant, customLenders, branchStatusOf, setBranchStatus, openFieldInfo, RT_LABEL } from '../store'
import { Power } from 'lucide-vue-next'

// STATUS por sucursal (lenders_by_allied_branches.status) = bandera de membresía (default true).
// El comercio TIENE su catálogo de entidades ("Entidades del comercio"); cada sucursal la marca acá.
// OJO: NO filtra el getLenders vivo (ni legacy ni application la miran; solo el simulador viejo) →
// es informativo, no una compuerta. El corte duro real es el cupo (rt=2) / la API (rt=1).
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
      <div class="dn-hint">Marca la membresía de cada entidad <b>en {{ merchant.sucursal }}</b>. Es informativo: en el sistema vivo <b>no</b> filtra el listado (default true; solo lo leía el simulador viejo).</div>
      <div v-if="!entities.length" class="cfg-empty">Sin entidades — creá alguna en “Entidades del comercio”.</div>
      <div v-for="l in entities" :key="l.name" class="cfg-row cfg-erow bs-erow"
           :class="['erow--rt' + l.rt, { 'cfg-row--on': branchStatusOf(l.name), 'cfg-row--cur': ui.selected === l.name }]" :title="l.name">
        <input type="checkbox" class="nodrag" :checked="branchStatusOf(l.name)" @change="e => setBranchStatus(l.name, e.target.checked)" />
        <div class="erow__main bs-pick" title="ver su config de sucursal" @click.stop="ui.selected = l.name">
          <div class="erow__top">
            <span class="erow__nm">{{ l.name }}</span>
            <span class="cfg-rt" :class="'rt' + l.rt">{{ RT_LABEL[l.rt] || ('rt' + l.rt) }}</span>
          </div>
          <div class="erow__sub" v-if="l.producto">
            <span class="cfg-cat" :class="'cfg-cat--' + l.producto">{{ PROD[l.producto] }}</span>
          </div>
        </div>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
