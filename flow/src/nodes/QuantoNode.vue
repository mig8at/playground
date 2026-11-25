<script setup>
import { Handle, Position } from '@vue-flow/core'
import { providerDown, openFieldInfo } from '../store'
import { AlertTriangle, Wifi, WifiOff } from 'lucide-vue-next'
import ProviderField from './ProviderField.vue'

// Experian · Quanto: MISMO host/OAuth y misma llamada (/cs/credit-history/v1/hdcplus) que Acierta, pero es
// un PRODUCTO aparte (productCode 62) con risk_central propio ("Experian - Quanto"), credenciales y summary
// separados. Solo trae el ingreso ESTIMADO (certeza 3 · estimación, no dato exacto). Se puede pedir solo,
// junto con Acierta ("Acierta+Quanto") o reusarse del combinado. Toggle API-caída propio.
</script>

<template>
  <div class="node node--quanto prov-node" :class="{ 'node--down': providerDown.quanto }">
    <div class="node__hd node__hd--blue nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.quanto')">
      <div class="node__title">Experian · Quanto</div>
      <button class="prov__api nodrag" :class="{ 'prov__api--down': providerDown.quanto }"
              @click.stop="providerDown.quanto = !providerDown.quanto"
              :title="providerDown.quanto ? 'API caída (timeout/5xx) — clic para revivir' : 'simular API caída (timeout/5xx)'">
        <WifiOff v-if="providerDown.quanto" :size="13" />
        <Wifi v-else :size="13" />
      </button>
    </div>
    <div class="node__body">
      <div class="pv-hint">producto de Experian · mismo host/OAuth que Acierta</div>
      <div v-if="providerDown.quanto" class="api-down"><AlertTriangle :size="13" /> API no responde</div>
      <template v-else>
        <ProviderField label="Ingreso (estimado)" field-key="quantoIncome" type="money" :certeza="3" />
      </template>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
