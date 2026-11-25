<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, state, openFieldInfo } from '../store'
import { FileText, FileSignature } from 'lucide-vue-next'
import OtpInput from '../OtpInput.vue'

// Firma del pagaré tras el Plan de pagos (todo CreditopX). Cuadro blanco con ícono de documento +
// OTP de 6 caracteres. Con los 6 completos la firma es válida → el nodo Estado da "success".
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const otpModel = computed({ get: () => state.otp, set: (v) => { state.otp = v } })
</script>

<template>
  <div v-if="lender" class="node node--firma prov-node">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('psel.firma')">
      <div class="node__title"><FileSignature :size="13" /> Firma</div>
    </div>
    <div class="node__body firma-body">
      <div class="firma-doc"><FileText :size="34" :stroke-width="1.4" /></div>
      <div class="firma-otp-lbl">Firma con OTP</div>
      <OtpInput v-model="otpModel" :length="6" />
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
