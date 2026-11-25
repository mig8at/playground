<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, state, openFieldInfo } from '../store'
import { Check, X } from 'lucide-vue-next'

// Estado final del flujo de crédito paso-a-paso: success si la firma (OTP) está completa (6/6), si no false.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const ok = computed(() => (state.otp || '').length === 6)
</script>

<template>
  <div v-if="lender" class="node node--cstatus prov-node" :class="ok ? 'psel--ok' : 'psel--bad'">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd nhd-doc psel-hd" title="clic: qué significa el estado" @click="openFieldInfo('psel.estado')">
      <div class="node__title">Estado</div>
    </div>
    <div class="node__body cst-body">
      <div class="cst-badge" :class="ok ? 'cst-badge--ok' : 'cst-badge--bad'"><component :is="ok ? Check : X" :size="30" :stroke-width="2.75" /></div>
      <div class="cst-word" :class="ok ? 'cst-word--ok' : 'cst-word--bad'">{{ ok ? 'success' : 'false' }}</div>
      <div class="cst-detail">{{ ok ? 'Firma completa (OTP 6/6).' : 'Falta la firma — OTP incompleto.' }}</div>
    </div>
  </div>
</template>
