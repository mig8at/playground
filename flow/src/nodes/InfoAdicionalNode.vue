<script setup>
import { Handle, Position } from '@vue-flow/core'
import { state, openFieldInfo } from '../store'
import { ClipboardList } from 'lucide-vue-next'

// Información adicional (form_type 6 · additional-info) — SOLO producto Consumo (Credifamilia), entre
// Plan de pagos y Firma. Formulario demo (país, ciudad, cargo, dirección). Bind a state.infoAdicional.
</script>

<template>
  <div class="node node--sol">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('psel.infoadicional')">
      <div class="node__title"><ClipboardList :size="13" /> Información adicional</div>
      <div class="node__kind">form_type 6</div>
    </div>
    <div class="node__body">
      <label class="field"><span>País</span>
        <input class="nodrag" v-model="state.infoAdicional.pais" />
      </label>
      <label class="field"><span>Ciudad</span>
        <input class="nodrag" v-model="state.infoAdicional.ciudad" />
      </label>
      <label class="field"><span>Cargo</span>
        <input class="nodrag" v-model="state.infoAdicional.cargo" />
      </label>
      <label class="field"><span>Dirección</span>
        <input class="nodrag" v-model="state.infoAdicional.direccion" />
      </label>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
