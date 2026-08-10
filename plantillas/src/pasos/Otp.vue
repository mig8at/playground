<script setup>
import { ref, onMounted } from 'vue'
import { post } from '../api.js'

const props = defineProps({ sesion: String })
const emit = defineEmits(['avanzo'])

const codigo = ref('')
const error = ref('')
const enviado = ref(false)
const ocupado = ref(false)

async function pedirCodigo() {
  error.value = ''
  ocupado.value = true
  try {
    await post(`/api/sesiones/${props.sesion}/otp/enviar`)
    enviado.value = true
    codigo.value = ''
  } catch (e) {
    error.value = e.message
  } finally {
    ocupado.value = false
  }
}

async function verificar() {
  error.value = ''
  ocupado.value = true
  try {
    await post(`/api/sesiones/${props.sesion}/otp/verificar`, { codigo: codigo.value })
    emit('avanzo')
  } catch (e) {
    error.value = e.message
  } finally {
    ocupado.value = false
  }
}

onMounted(pedirCodigo)
</script>

<template>
  <form class="paso" @submit.prevent="verificar">
    <h3>Ingresá el código</h3>
    <p class="ayuda">
      Es un prototipo local: no hay SMS, el código aparece en el panel de eventos →
    </p>
    <input
      v-model="codigo"
      inputmode="numeric"
      maxlength="6"
      placeholder="6 dígitos"
      class="otp"
      :disabled="ocupado || !enviado"
    />
    <p v-if="error" class="error">{{ error }}</p>
    <button :disabled="ocupado || codigo.length !== 6">
      {{ ocupado ? 'Verificando…' : 'Verificar' }}
    </button>
    <button type="button" class="secundario" :disabled="ocupado" @click="pedirCodigo">
      Pedir otro código
    </button>
  </form>
</template>
