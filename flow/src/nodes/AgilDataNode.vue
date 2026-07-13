<script setup>
import { Handle, Position } from '@vue-flow/core'
import { AlertTriangle, Wifi, WifiOff } from 'lucide-vue-next'
import { bureau, nulls, perfil, providerDown, setNull, fieldNull, BURO_DESC, openFieldInfo } from '../store'
import { useFails } from '../useFails'
import ProviderField from './ProviderField.vue'
import MoneyInput from '../MoneyInput.vue'

const { bad } = useFails()
const EMP = ['empleado', 'independiente', 'pensionado', 'desempleado']
const CONT = ['<3m', '3m', '6m', '12m']
</script>

<template>
  <div class="node node--agil prov-node" :class="{ 'node--down': providerDown.agil }">
    <div class="node__hd node__hd--teal nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.agil')">
      <div class="node__title">Ágil Data</div>
      <button class="prov__api nodrag" :class="{ 'prov__api--down': providerDown.agil }"
              @click.stop="providerDown.agil = !providerDown.agil"
              :title="providerDown.agil ? 'API caída (timeout/5xx) — clic para revivir' : 'simular API caída (timeout/5xx)'">
        <WifiOff v-if="providerDown.agil" :size="13" />
        <Wifi v-else :size="13" />
      </button>
    </div>
    <div class="node__body">
      <div v-if="providerDown.agil" class="api-down"><AlertTriangle :size="13" /> API no responde</div>
      <template v-else>
        <div class="field pv pv--c1" :class="{ 'kv--fail': bad('monthlyIncome') && perfil.salarioFuente === 'Ágil Data' }" title="Certeza 1 — fuente principal del ingreso (cotización real)">
          <input type="checkbox" class="null-tog nodrag" :checked="!!nulls['agilIncome']" @change="e => setNull('agilIncome', e.target.checked)" title="simular sin dato (null)" />
          <span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('buro.agilIncome')">Ingreso</span>
          <b v-if="fieldNull('agilIncome')" class="pv-null">— null</b>
          <MoneyInput v-else v-model="bureau.agilIncome" />
        </div>
        <ProviderField label="Ocupación" field-key="employment" rule-key="employment" type="select" :options="EMP" :certeza="1" />
        <ProviderField label="Edad" field-key="edad" rule-key="age" :min="18" :max="100" :certeza="1" />
        <ProviderField label="Género" field-key="gender" rule-key="gender" type="select" :options="['M', 'F']" :certeza="1" />
        <ProviderField label="Continuidad" field-key="agilContinuity" type="select" :options="CONT" :info="true" :certeza="1" />
      </template>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
