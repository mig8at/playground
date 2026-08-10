<script setup>
import { ref } from 'vue'
import { post } from '../api.js'

const props = defineProps({ sesion: String })
const emit = defineEmits(['avanzo'])

// ⚠ La costura del prototipo: los CAMPOS todavía están acá, en el .vue. El backend
// ya no decide solo la SECUENCIA de pasos, pero los campos de este paso siguen en
// código. Volverlos dato es el siguiente movimiento — y es exactamente el hueco que
// el form dinámico real (form-service) ya llena con su schema.
const campos = [
  { id: 'nombre', label: 'Nombre completo', tipo: 'text' },
  { id: 'documento', label: 'Documento', tipo: 'text' },
  { id: 'email', label: 'Correo', tipo: 'email' },
]

const valores = ref(Object.fromEntries(campos.map((c) => [c.id, ''])))
const error = ref('')
const ocupado = ref(false)

async function enviar() {
  error.value = ''
  ocupado.value = true
  try {
    await post(`/api/sesiones/${props.sesion}/datos`, valores.value)
    emit('avanzo')
  } catch (e) {
    error.value = e.message
  } finally {
    ocupado.value = false
  }
}
</script>

<template>
  <form class="paso" @submit.prevent="enviar">
    <h3>Tus datos</h3>
    <label v-for="c in campos" :key="c.id" class="campo">
      <span>{{ c.label }}</span>
      <input v-model="valores[c.id]" :type="c.tipo" :disabled="ocupado" />
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <button :disabled="ocupado || Object.values(valores).some((v) => !v)">
      {{ ocupado ? 'Guardando…' : 'Finalizar' }}
    </button>
  </form>
</template>
