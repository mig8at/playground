<script setup>
import { computed } from 'vue'

// La hoja GUARDA decimales (0.02) porque así lo hacen los .xlsm y así se le pasan derecho a
// pmt(). Pero escribir "0.02" para decir 2% es antinatural, así que el campo muestra y recibe
// PORCENTAJE. El documento sigue mostrando 0.02 — la UI traduce, el dato no cambia.
const props = defineProps({ modelValue: [Number, String], dec: { type: Number, default: 4 } })
const emit = defineEmits(['update:modelValue'])

const display = computed(() => {
  const v = props.modelValue
  if (v === '' || v == null) return ''
  const p = Number(v) * 100
  return Number.isInteger(p) ? String(p) : p.toFixed(props.dec).replace(/0+$/, '').replace(/\.$/, '')
})

function onInput(e) {
  const raw = e.target.value.replace(',', '.').replace(/[^\d.]/g, '')
  emit('update:modelValue', raw === '' ? '' : Number(raw) / 100)
}
</script>

<template>
  <span class="pct">
    <input class="nodrag" type="text" inputmode="decimal" :value="display" @input="onInput">
    <em>%</em>
  </span>
</template>
