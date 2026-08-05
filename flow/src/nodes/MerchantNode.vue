<script setup>
import { Handle, Position } from '@vue-flow/core'
import { merchant, ui, merchantProductos, openFieldInfo } from '../store'
import { Store } from 'lucide-vue-next'

// En el prototipo no es relevante elegir un comercio/sucursal real (ni cargar sus lenders por
// sucursal): son solo etiquetas de contexto, texto libre. Las entidades se togglean en
// "Entidades del comercio". La calculadora del comercio se resuelve por nombre (merchantCalc[nombre]).
</script>

<template>
  <div class="node node--merchant" :class="{ 'merch-sel': ui.selected }">
    <Handle id="top" type="target" :position="Position.Top" />
    <div class="node__hd node__hd--blue nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.comercio')">
      <div class="node__title"><Store :size="13" /> Comercio</div>
    </div>
    <div class="node__body">
      <label class="field"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('merch.nombre')">Comercio</span>
        <Handle id="tocom" type="source" :position="Position.Left" class="fld-h" />
        <input class="nodrag" v-model="merchant.nombre" placeholder="nombre del comercio" />
      </label>
      <label class="field"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('merch.sucursal')">Sucursal</span>
        <Handle id="tosuc" type="source" :position="Position.Left" class="fld-h" />
        <input class="nodrag" v-model="merchant.sucursal" placeholder="sucursal" />
      </label>
      <!-- Productos que ofrece el comercio según sus entidades habilitadas (informativo) -->
      <div class="mprods" v-if="merchantProductos.length">
        <span class="mprods__lbl">Productos</span>
        <span v-for="p in merchantProductos" :key="p.key" class="mprod" :class="'mprod--' + p.key" :title="p.label">{{ p.short }}</span>
      </div>
    </div>
    <Handle id="toflow" type="source" :position="Position.Right" />
  </div>
</template>
