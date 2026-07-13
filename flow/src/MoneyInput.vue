<script setup>
import { computed } from 'vue'

const props = defineProps({ modelValue: [Number, String], placeholder: String })
const emit = defineEmits(['update:modelValue'])

const display = computed(() => {
  const n = parseInt(String(props.modelValue ?? '').replace(/\D/g, '')) || 0
  return n ? n.toLocaleString('es-CO') : ''
})

function onInput(e) {
  const digits = e.target.value.replace(/\D/g, '')
  const n = digits ? parseInt(digits) : 0
  emit('update:modelValue', n)
  e.target.value = n ? n.toLocaleString('es-CO') : ''  // reformatea con puntos
}
</script>

<template>
  <input type="text" inputmode="numeric" class="nodrag" :value="display" :placeholder="placeholder" @input="onInput" />
</template>
