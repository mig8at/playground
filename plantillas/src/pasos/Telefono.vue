<script setup>
import { ref } from 'vue'
import { post } from '../api.js'

const props = defineProps({ sesion: String, pais: String })
const emit = defineEmits(['avanzo'])

const telefono = ref('')
const error = ref('')
const enviando = ref(false)

// El componente NO sabe qué formato pide el país: manda el número y el backend
// valida. Duplicar la regla acá es cómo el monorepo terminó con los rangos de
// cada país hardcodeados en TS.
async function enviar() {
  error.value = ''
  enviando.value = true
  try {
    await post(`/api/sesiones/${props.sesion}/telefono`, {
      pais: props.pais,
      telefono: telefono.value.replace(/\D/g, ''),
    })
    emit('avanzo')
  } catch (e) {
    error.value = e.message
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <form class="paso" @submit.prevent="enviar">
    <h3>¿A qué celular te escribimos?</h3>
    <p class="ayuda">País de la plantilla: <b>{{ pais }}</b></p>
    <input
      v-model="telefono"
      inputmode="numeric"
      autocomplete="tel"
      placeholder="Número de celular"
      :disabled="enviando"
    />
    <p v-if="error" class="error">{{ error }}</p>
    <button :disabled="enviando || !telefono">
      {{ enviando ? 'Validando…' : 'Continuar' }}
    </button>
  </form>
</template>
