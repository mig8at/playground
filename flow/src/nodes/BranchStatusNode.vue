<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, merchant, branchStatusOf, toggleBranchStatus, openFieldInfo } from '../store'
import { Power } from 'lucide-vue-next'

// STATUS de la entidad en la sucursal (lenders_by_allied_branches.status) = 1ª compuerta de la 2ª capa.
// El comercio habilita la entidad en su catálogo (merchant.enabled ≈ lenders_by_allieds); CADA sucursal
// la ACTIVA o DESACTIVA por separado. Inactiva → NO se ofrece en esa sucursal (filtro duro del listado).
const name = computed(() => ui.selected)
const on = computed(() => (name.value ? branchStatusOf(name.value) : true))
</script>

<template>
  <div class="node node--branchstatus prov-node" v-if="name">
    <div class="node__hd nhd-doc" :class="on ? 'node__hd--green' : 'node__hd--red'"
         title="clic: dónde vive y por qué (status por sucursal)" @click="openFieldInfo('suc.status')">
      <div class="node__title"><Power :size="13" /> Estado en sucursal</div>
      <span class="pl-cat">status · por sucursal</span>
    </div>
    <div class="node__body">
      <div class="node__desc"><b>{{ name }}</b> en {{ merchant.sucursal }}</div>
      <div class="bs-row">
        <span class="bs-state" :class="on ? 'on' : 'off'">{{ on ? 'activa' : 'inactiva' }}</span>
        <span class="dc-sw nodrag" :class="{ on }" @click.stop="toggleBranchStatus(name)"
              :title="on ? 'clic: desactivar en esta sucursal' : 'clic: activar en esta sucursal'">
          {{ on ? 'desactivar' : 'activar' }}
        </span>
      </div>
      <div class="dn-hint">
        El comercio habilita la entidad en su catálogo; cada sucursal la activa o desactiva por separado.
        <template v-if="!on"><br><b class="bs-warn">Inactiva → no aparece en el listado de {{ merchant.sucursal }}.</b></template>
      </div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>
