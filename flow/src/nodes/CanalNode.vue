<script setup>
import { Handle, Position } from '@vue-flow/core'
import { canal, openFieldInfo } from '../store'
import { Radio, Headset, ShoppingBag } from 'lucide-vue-next'

// CANAL: por dónde entra la solicitud. Radio asesor | ecommerce. Asesor → nombre del asesor;
// ecommerce → nombre de la tienda. Hoy etiqueta de contexto; más adelante ramifica el flujo.
</script>

<template>
  <div class="node node--canal">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--blue nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.canal')">
      <div class="node__title"><Radio :size="13" /> Canal</div>
    </div>
    <div class="node__body">
      <div class="cn-opts">
        <label class="cn-opt" :class="{ 'cn-opt--on': canal.tipo === 'asesor' }">
          <input type="radio" class="nodrag" value="asesor" v-model="canal.tipo" />
          <Headset :size="13" /><span>Asesor</span>
        </label>
        <label class="cn-opt" :class="{ 'cn-opt--on': canal.tipo === 'ecommerce' }">
          <input type="radio" class="nodrag" value="ecommerce" v-model="canal.tipo" />
          <ShoppingBag :size="13" /><span>Ecommerce</span>
        </label>
      </div>
      <label v-if="canal.tipo === 'asesor'" class="field">
        <span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('canal.asesor')">Nombre asesor</span>
        <input class="nodrag" v-model="canal.asesorNombre" placeholder="nombre del asesor" />
      </label>
      <label v-else class="field">
        <span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('canal.tienda')">Nombre de tienda</span>
        <input class="nodrag" v-model="canal.tiendaNombre" placeholder="nombre de la tienda" />
      </label>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
