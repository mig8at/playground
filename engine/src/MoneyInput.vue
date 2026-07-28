<script setup>
import { computed } from 'vue'

// Igual que el de playground/flow: separador de miles en vivo, solo dígitos.
// `nodrag` es obligatorio — sin esa clase, Vue Flow arrastra el nodo al escribir.
const props = defineProps({ modelValue: [Number, String], placeholder: String })
const emit = defineEmits(['update:modelValue'])

// Un 0 se muestra como "0", NO como vacío: son cosas distintas para el motor — vacío es un
// input ausente (la fórmula se saltea) y 0 es un cero de verdad (la perilla existe y no aplica).
const display = computed(() => {
  const raw = String(props.modelValue ?? '')
  if (raw === '') return ''
  const n = Math.round(Number(raw.replace(/[^\d.-]/g, ''))) || 0
  return n.toLocaleString('es-CO')
})

function onInput(e) {
  const digits = e.target.value.replace(/\D/g, '')
  if (digits === '') { emit('update:modelValue', ''); e.target.value = ''; return }
  const n = parseInt(digits)
  emit('update:modelValue', n)
  e.target.value = n.toLocaleString('es-CO')
}
</script>

<template>
  <input type="text" inputmode="numeric" class="nodrag nf" :value="display"
         :placeholder="placeholder || '(vacío)'" @input="onInput">
</template>
