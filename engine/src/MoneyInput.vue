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

// Acepta un MENOS adelante, porque todo lo que cae en un punto de inserción se SUMA y un valor
// negativo es cómo se resta: la cuota inicial es "cuota inicial −4.000.000". Sin esto el `\D` se
// comía el signo y no había forma de bajar el monto.
function onInput(e) {
  const t = e.target.value
  const neg = t.trim().startsWith('-')
  const digits = t.replace(/\D/g, '')
  if (digits === '') { emit('update:modelValue', neg ? '-' : ''); e.target.value = neg ? '-' : ''; return }
  const n = parseInt(digits) * (neg ? -1 : 1)
  emit('update:modelValue', n)
  e.target.value = n.toLocaleString('es-CO')
}
</script>

<template>
  <input type="text" inputmode="numeric" class="nodrag nf" :value="display"
         :placeholder="placeholder || '(vacío)'" @input="onInput">
</template>
