<script setup>
// La puerta de entrada del soporte: quien llama dice su cédula o su celular, no un `user_request_id`.
// Vive en la banda del mapa, así que sus controles son los de una banda: 28 (`-sm`). Cómo coincidió la
// búsqueda no va acá: es la subbanda del editor (`App.vue`), para que la banda no crezca a dos renglones.
import { useTrazador } from '../stores/trazador'
const t = useTrazador()
</script>

<template>
  <form class="search-form" @submit.prevent="t.search()">
    <input
      v-model="t.q"
      placeholder="cédula, teléfono o número de solicitud"
      inputmode="numeric"
      autocomplete="off"
      class="input input-sm"
      aria-label="Buscar" />
    <!-- El target se elige acá y no en una config: en soporte se salta de un ambiente a otro, y tener
         que reiniciar para cambiarlo hace que nadie lo cambie. Es el `.select` de la base. -->
    <span class="select target-select">
      <select v-model="t.target" class="input input-sm" aria-label="Ambiente" @change="t.changeTarget()">
        <option value="prod">prod</option>
        <option value="staging">staging</option>
        <option value="qa">qa</option>
        <option value="dev">dev</option>
        <option value="local">local</option>
      </select>
    </span>
    <button type="submit" class="btn btn-outline btn-sm" :disabled="t.searching || !t.q.trim()">
      {{ t.searching ? 'Buscando…' : 'Buscar' }}
    </button>
  </form>
</template>

<style scoped>
/* El campo, el select y el botón son los de la base. Lo único propio es que el campo se estire y que
   la fila no envuelva: dentro de la banda, un segundo renglón la haría crecer por encima de 40. */
.search-form { flex:1 1 340px; min-width:0; display:flex; gap:var(--space-2); align-items:center }
.search-form > .input { flex:1 1 auto; min-width:0; width:auto }
.target-select { flex:none; width:104px }
</style>
