<script setup>
import { ref, computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, state, openFieldInfo } from '../store'
import { FileText, FileSignature } from 'lucide-vue-next'

// Firma del pagaré tras el Plan de pagos (todo CreditopX). Cuadro blanco con ícono de documento +
// OTP de 6 caracteres. Con los 6 completos la firma es válida → el nodo Estado da "success".
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))

const otpInput = ref(null)
const otpModel = computed({
  get: () => state.otp || '',
  set: (v) => { state.otp = String(v).replace(/[^0-9A-Za-z]/g, '').slice(0, 6) },
})
const focusInput = () => otpInput.value?.focus()
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
      <div class="firma-otp" @click="focusInput">
        <input ref="otpInput" class="firma-otp-in nodrag" v-model="otpModel" maxlength="6" inputmode="numeric" autocomplete="one-time-code" aria-label="OTP de 6 caracteres" />
        <div class="firma-otp-boxes">
          <span v-for="i in 6" :key="i" class="firma-otp-box" :class="{ 'firma-otp-box--cur': otpModel.length === i - 1 }">{{ otpModel[i - 1] || '' }}</span>
        </div>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
