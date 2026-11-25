<script setup>
import { ref, computed } from 'vue'

// OTP reusable: N casillas (length) + un input transparente encima que captura el tecleo.
// Usado por Firma (6), Solicitud (4) y Codeudor (4).
const props = defineProps({ modelValue: { type: String, default: '' }, length: { type: Number, default: 6 } })
const emit = defineEmits(['update:modelValue'])
const input = ref(null)
const val = computed({
  get: () => props.modelValue || '',
  set: (v) => emit('update:modelValue', String(v).replace(/[^0-9A-Za-z]/g, '').slice(0, props.length)),
})
const focus = () => input.value?.focus()
</script>

<template>
  <div class="otp" @click="focus">
    <input ref="input" class="otp-in nodrag" v-model="val" :maxlength="length" inputmode="numeric" autocomplete="one-time-code" aria-label="OTP" />
    <div class="otp-boxes">
      <span v-for="i in length" :key="i" class="otp-box" :class="{ 'otp-box--cur': val.length === i - 1 }">{{ val[i - 1] || '' }}</span>
    </div>
  </div>
</template>
