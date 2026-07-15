<script setup>
import { Handle, Position } from '@vue-flow/core'
import { providerDown, openFieldInfo } from '../store'
import { AlertTriangle, Wifi, WifiOff } from 'lucide-vue-next'
import ProviderField from './ProviderField.vue'
</script>

<template>
  <div class="node node--exp prov-node" :class="{ 'node--down': providerDown.experian }">
    <div class="node__hd node__hd--blue nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.experian')">
      <div class="node__title">Experian · Acierta</div>
      <button class="prov__api nodrag" :class="{ 'prov__api--down': providerDown.experian }"
              @click.stop="providerDown.experian = !providerDown.experian"
              :title="providerDown.experian ? 'API caída (timeout/5xx) — clic para revivir' : 'simular API caída (timeout/5xx)'">
        <WifiOff v-if="providerDown.experian" :size="13" />
        <Wifi v-else :size="13" />
      </button>
    </div>
    <div class="node__body">
      <div class="pv-hint">datacrédito · score · mismo host/OAuth que Quanto</div>
      <div v-if="providerDown.experian" class="api-down"><AlertTriangle :size="13" /> API no responde</div>
      <template v-else>
        <ProviderField label="Score" field-key="score" rule-key="score" :min="0" :max="1000" :certeza="1" />
        <ProviderField label="Negativos 12m" field-key="negatives12m" rule-key="negatives12m" :min="0" :certeza="1" />
        <ProviderField label="Mora vigente" field-key="currentArrears" rule-key="currentArrears" :min="0" :certeza="1" />
        <ProviderField label="Consultas 6m" field-key="inquiries6m" rule-key="inquiries6m" :min="0" :certeza="1" />
        <ProviderField label="Antigüedad (m)" field-key="creditHistoryMonths" rule-key="creditHistoryMonths" :min="0" :certeza="1" />
        <ProviderField label="Cuota deuda/mes" field-key="monthlyDebtPayment" type="money" :certeza="1" />
        <ProviderField label="Saldo deuda" field-key="totalDebt" type="money" :info="true" />
        <ProviderField label="Disputas" field-key="disputes" :min="0" :info="true" />
      </template>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
