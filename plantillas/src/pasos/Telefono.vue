<script setup>
import { ref } from 'vue'
import { post } from '../api.js'

// `inicial` viene del server (los valores capturados de la solicitud), no de memoria del
// browser: así el número sobrevive a un refresco y lo ve también el segundo dispositivo.
const props = defineProps({ solicitud: String, pais: String, inicial: String })
const emit = defineEmits(['avanzo'])

const telefono = ref(props.inicial || '')
const error = ref('')
const enviando = ref(false)

// El componente NO sabe qué formato pide el país: manda el número y el backend valida
// con la regla del país de la SOLICITUD. Duplicar la regla acá es cómo el monorepo terminó
// con los rangos de cada país hardcodeados en TS.
async function enviar() {
  error.value = ''
  enviando.value = true
  try {
    await post(`/api/solicitudes/${props.solicitud}/telefono`, {
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
    <p class="ayuda">Te mandamos un código para confirmar que es tuyo. País: <b>{{ pais }}</b></p>
    <input
      v-model="telefono"
      inputmode="numeric"
      autocomplete="tel"
      placeholder="300 123 4567"
      :disabled="enviando"
    />
    <p v-if="error" class="error">{{ error }}</p>
    <button :disabled="enviando || !telefono">
      {{ enviando ? 'Validando…' : 'Continuar' }}
    </button>
  </form>
</template>
