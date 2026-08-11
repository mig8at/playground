<script setup>
import { ref } from 'vue'
import { post } from '../api.js'

// UN componente para cualquier paso que sea formulario. No sabe qué campos son ni de qué
// paso se trata: los declara la plantilla y el server los sirve resueltos, con el tipo
// que cada clave tiene en el diccionario. Agregar un formulario nuevo no toca este
// archivo — es una fila.
const props = defineProps({ solicitud: String, campos: Array, valores: Object })

// Los valores ya capturados vuelven a llenar el formulario: al reiniciar, lo que la
// persona tipeó sigue ahí.
const datos = ref(
  Object.fromEntries((props.campos || []).map((c) => [c.clave, props.valores?.[c.clave] ?? ''])),
)
const error = ref('')
const ocupado = ref(false)

// El tipo sale del DICCIONARIO, no del formulario: `docNumber` es string en todas las
// plantillas porque es string en un solo lugar.
function inputDe(tipo) {
  if (tipo === 'date') return 'date'
  if (tipo === 'number' || tipo === 'float') return 'text'
  return 'text'
}
function modoDe(tipo) {
  return tipo === 'number' || tipo === 'float' ? 'numeric' : undefined
}

// La validación de formato NO se duplica acá: se manda y el server valida contra el
// `patron` de la plantilla. Dos implementaciones de la misma regla es cómo se llega a un
// front que acepta lo que el back rechaza.
async function enviar() {
  error.value = ''
  ocupado.value = true
  try {
    await post(`/api/solicitudes/${props.solicitud}/formulario`, datos.value)
  } catch (e) {
    error.value = e.message
  } finally {
    ocupado.value = false
  }
}

const incompleto = () => (props.campos || []).some((c) => c.requerido && !datos.value[c.clave])
</script>

<template>
  <form class="paso" @submit.prevent="enviar">
    <label v-for="c in campos" :key="c.clave" class="campo">
      <span>{{ c.label }}<em v-if="!c.requerido"> (opcional)</em></span>
      <input
        v-model="datos[c.clave]"
        :type="inputDe(c.tipo)"
        :inputmode="modoDe(c.tipo)"
        :disabled="ocupado"
      />
      <small v-if="c.ayuda">{{ c.ayuda }}</small>
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <button :disabled="ocupado || incompleto()">
      {{ ocupado ? 'Guardando…' : 'Continuar' }}
    </button>
  </form>
</template>
