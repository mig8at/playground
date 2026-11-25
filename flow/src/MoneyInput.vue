<script setup>
import { computed } from 'vue'
import { numberFormat } from './store'

const props = defineProps({ modelValue: [Number, String], placeholder: String })
const emit = defineEmits(['update:modelValue'])

const display = computed(() => {
  const n = parseInt(String(props.modelValue ?? '').replace(/\D/g, '')) || 0
  return n ? numberFormat(n) : ''
})

function onInput(e) {
  const digits = e.target.value.replace(/\D/g, '')
  const n = digits ? parseInt(digits) : 0
  emit('update:modelValue', n)
  e.target.value = n ? numberFormat(n) : ''  // reformatea según el país del comercio
}
</script>

<template>
  <input type="text" inputmode="numeric" class="nodrag" :value="display" :placeholder="placeholder" @input="onInput" />
</template>
