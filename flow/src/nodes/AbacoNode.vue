<script setup>
import { Handle, Position } from '@vue-flow/core'
import { AlertTriangle, Wifi, WifiOff } from 'lucide-vue-next'
import { bureau, nulls, perfil, providerDown, setNull, fieldNull, BURO_DESC, openFieldInfo } from '../store'
import { useFails } from '../useFails'
import MoneyInput from '../MoneyInput.vue'

// Ábaco: proveedor de ingreso GIG (trabajos informales/plataformas). SOLO trae ingreso — no aporta
// score, KYC ni empleo. Entra en la cascada como fuente alternativa (después de Ágil Data y Mareigua).
const { bad } = useFails()
</script>

<template>
  <div class="node node--abaco prov-node" :class="{ 'node--down': providerDown.abaco }">
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.abaco')">
      <div class="node__title">Ábaco</div>
      <button class="prov__api nodrag" :class="{ 'prov__api--down': providerDown.abaco }"
              @click.stop="providerDown.abaco = !providerDown.abaco"
              :title="providerDown.abaco ? 'API caída (timeout/5xx) — clic para revivir' : 'simular API caída (timeout/5xx)'">
        <WifiOff v-if="providerDown.abaco" :size="13" />
        <Wifi v-else :size="13" />
      </button>
    </div>
    <div class="node__body">
      <div v-if="providerDown.abaco" class="api-down"><AlertTriangle :size="13" /> API no responde</div>
      <template v-else>
        <div class="field pv pv--c2" :class="{ 'kv--fail': bad('monthlyIncome') && perfil.salarioFuente === 'Ábaco' }" title="Certeza 2 — ingreso gig (fuente alternativa)">
          <input type="checkbox" class="null-tog nodrag" :checked="!!nulls['abacoIncome']" @change="e => setNull('abacoIncome', e.target.checked)" title="simular sin dato (null)" />
          <span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('buro.abacoIncome')">Ingreso</span>
          <b v-if="fieldNull('abacoIncome')" class="pv-null">— null</b>
          <MoneyInput v-else v-model="bureau.abacoIncome" />
        </div>
      </template>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
