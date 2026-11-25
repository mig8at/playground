<script setup>
import { ref, onUnmounted } from 'vue'
import { Eye, EyeOff, Download, RotateCcw } from 'lucide-vue-next'
import { settings } from '../settings'
import { resetGraph } from '../store'
const emit = defineEmits(['import-prod'])

// Las acciones del lienzo, en la banda del editor (la base: lo frecuente, como iconos con su título).
// Reiniciar pide dos clics (sin modal): el 1º lo arma (rojo) y se desarma solo a los 3 s.
const confirmReset = ref(false)
let confirmTimer
function onReset() {
  if (confirmReset.value) { resetGraph(); return }
  confirmReset.value = true
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmReset.value = false }, 3000)
}
onUnmounted(() => clearTimeout(confirmTimer))
</script>

<template>
  <div class="region-actions">
    <button type="button" class="region-action" :aria-pressed="settings.showExtra"
      :title="settings.showExtra ? 'Ocultar lo que no participa en la solicitud (revenue, servicing, buró informativo, inertes)' : 'Mostrar lo que no participa en la solicitud: revenue, servicing, buró informativo e inertes, atenuados'"
      aria-label="Mostrar campos fuera de la solicitud" @click="settings.showExtra = !settings.showExtra">
      <Eye v-if="settings.showExtra" :size="15" /><EyeOff v-else :size="15" />
    </button>
    <button type="button" class="region-action" title="Importar una configuración puntual de producción" aria-label="Importar de producción" @click="emit('import-prod')"><Download :size="15" /></button>
    <button type="button" class="region-action" :class="{ 'flow-reset--armed': confirmReset }" @click="onReset"
      :title="confirmReset ? 'Clic de nuevo para borrar el escenario y las entidades' : 'Reiniciar: borra el escenario guardado (comercio, solicitud, buró, entidades) y recarga'"
      aria-label="Reiniciar el escenario"><RotateCcw :size="15" /></button>
  </div>
</template>
