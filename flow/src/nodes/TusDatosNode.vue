<script setup>
import { Handle, Position } from '@vue-flow/core'
import { providerDown, openFieldInfo } from '../store'
import { AlertTriangle, Wifi, WifiOff } from 'lucide-vue-next'
import ProviderField from './ProviderField.vue'

const IDENT = [{ value: true, label: 'verificada' }, { value: false, label: 'no verif.' }]
const DOC = ['vigente', 'cancelado']
const LISTAS = [{ value: 'limpio', label: 'limpio' }, { value: 'hit', label: 'hit' }]
</script>

<template>
  <div class="node node--tus prov-node" :class="{ 'node--down': providerDown.tusdatos }">
    <div class="node__hd nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.tusdatos')">
      <div class="node__title">TusDatos</div>
      <button class="prov__api nodrag" :class="{ 'prov__api--down': providerDown.tusdatos }"
              @click.stop="providerDown.tusdatos = !providerDown.tusdatos"
              :title="providerDown.tusdatos ? 'API caída (timeout/5xx) — clic para revivir' : 'simular API caída (timeout/5xx)'">
        <WifiOff v-if="providerDown.tusdatos" :size="13" />
        <Wifi v-else :size="13" />
      </button>
    </div>
    <div class="node__body">
      <div v-if="providerDown.tusdatos" class="api-down"><AlertTriangle :size="13" /> API no responde</div>
      <template v-else>
        <ProviderField label="Identidad" field-key="identidad" rule-key="requireVerifiedIdentity" type="select" :options="IDENT" :certeza="1" />
        <ProviderField label="Listas (AML)" field-key="listas" rule-key="requireCleanAml" type="select" :options="LISTAS" :certeza="1" />
        <ProviderField label="Estado doc." field-key="docStatus" type="select" :options="DOC" :info="true" :certeza="1" />
      </template>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
