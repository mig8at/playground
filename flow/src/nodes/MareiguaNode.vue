<script setup>
import { Handle, Position } from '@vue-flow/core'
import { AlertTriangle, Wifi, WifiOff } from 'lucide-vue-next'
import { bureau, nulls, perfil, providerDown, setNull, fieldNull, BURO_DESC, openFieldInfo } from '../store'
import { useFails } from '../useFails'
import ProviderField from './ProviderField.vue'
import MoneyInput from '../MoneyInput.vue'

const { bad } = useFails()
const CONT = ['<3m', '3m', '6m', '12m']
const TREND = ['creciente', 'estable', 'decreciente']
</script>

<template>
  <div class="node node--mareigua prov-node" :class="{ 'node--down': providerDown.mareigua }">
    <div class="node__hd node__hd--amber nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.mareigua')">
      <div class="node__title">Mareigua</div>
      <button class="prov__api nodrag" :class="{ 'prov__api--down': providerDown.mareigua }"
              @click.stop="providerDown.mareigua = !providerDown.mareigua"
              :title="providerDown.mareigua ? 'API caída (timeout/5xx) — clic para revivir' : 'simular API caída (timeout/5xx)'">
        <WifiOff v-if="providerDown.mareigua" :size="13" />
        <Wifi v-else :size="13" />
      </button>
    </div>
    <div class="node__body">
      <div v-if="providerDown.mareigua" class="api-down"><AlertTriangle :size="13" /> API no responde</div>
      <template v-else>
        <div class="field pv pv--c2" :class="{ 'kv--fail': bad('monthlyIncome') && perfil.salarioFuente === 'Mareigua' }" title="Certeza 2 — respaldo del ingreso (fallback de Ágil Data)">
          <input type="checkbox" class="null-tog nodrag" :checked="!!nulls['mareiguaIncome']" @change="e => setNull('mareiguaIncome', e.target.checked)" title="simular sin dato (null)" />
          <span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('buro.mareiguaIncome')">Ingreso</span>
          <b v-if="fieldNull('mareiguaIncome')" class="pv-null">— null</b>
          <MoneyInput v-else v-model="bureau.mareiguaIncome" />
        </div>
        <ProviderField label="Continuidad" field-key="mareiguaContinuity" type="select" :options="CONT" :info="true" :certeza="2" />
        <ProviderField label="Tendencia" field-key="incomeTrend" type="select" :options="TREND" :info="true" />
      </template>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
