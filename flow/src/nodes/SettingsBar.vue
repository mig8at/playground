<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { Settings, Sun, Moon, RotateCcw, Check } from 'lucide-vue-next'
import { settings, toggleTheme } from '../settings'
import { resetGraph, persistPing } from '../store'

// "✓ guardado" transitorio: aparece cada vez que se persiste el escenario y se desvanece solo.
const justSaved = ref(false)
let savedTimer
watch(() => persistPing.n, () => {
  justSaved.value = true
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => { justSaved.value = false }, 1600)
})

// Reiniciar con confirmación en dos clics (sin modal): 1º arma (rojo), 2º ejecuta; se desarma a los 3s.
const confirmReset = ref(false)
let confirmTimer
function onReset() {
  if (confirmReset.value) { resetGraph(); return }
  confirmReset.value = true
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmReset.value = false }, 3000)
}
onUnmounted(() => { clearTimeout(savedTimer); clearTimeout(confirmTimer) })
</script>

<template>
  <footer class="settings">
    <div class="settings__title"><Settings :size="14" /> Configuraciones</div>

    <div class="settings__sep"></div>

    <div class="settings__item">
      <span class="settings__lbl">Tema</span>
      <button class="settings__theme nodrag" @click="toggleTheme"
        :title="settings.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'">
        <Sun v-if="settings.theme === 'dark'" :size="14" :stroke-width="2" />
        <Moon v-else :size="14" :stroke-width="2" />
        <span>{{ settings.theme === 'dark' ? 'Oscuro' : 'Claro' }}</span>
      </button>
    </div>

    <div class="settings__sep"></div>

    <span class="settings__lbl">Campos</span>
    <label class="settings__chk" title="Por defecto el grafo muestra SOLO el flujo de solicitud. Activá para revelar lo que NO participa en la solicitud: cobros al comercio (revenue), servicing (post-desembolso), datos informativos del buró e inertes del admin — atenuados y clicables para ver el detalle."><input type="checkbox" v-model="settings.showExtra" /> <span>Mostrar campos fuera de la solicitud</span> <em>revenue · servicing · buró · inertes</em></label>

    <div class="settings__spacer"></div>

    <transition name="fade">
      <span v-if="justSaved" class="settings__saved"><Check :size="12" /> guardado</span>
    </transition>

    <button class="settings__reset nodrag" :class="{ 'settings__reset--armed': confirmReset }" @click="onReset"
      :title="confirmReset ? 'Clic de nuevo para borrar el escenario y las entidades' : 'Borra el escenario guardado (comercio, solicitud, buró, entidades) y recarga. El tema y la visibilidad se conservan.'">
      <RotateCcw :size="13" :stroke-width="2" /> <span>{{ confirmReset ? '¿Borrar todo?' : 'Reiniciar' }}</span>
    </button>
  </footer>
</template>
