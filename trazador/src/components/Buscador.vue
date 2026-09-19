<script setup>
// La puerta de entrada del soporte: quien llama dice su cédula o su celular, no un `user_request_id`.
import { useTrazador } from '../stores/trazador'
const t = useTrazador()
</script>

<template>
  <form class="buscador" @submit.prevent="t.buscar()">
    <input
      v-model="t.q"
      placeholder="cédula, teléfono o número de solicitud"
      inputmode="numeric"
      autocomplete="off"
      class="input"
      aria-label="Buscar" />
    <!-- El target se elige acá y no en una config: en soporte se salta de un ambiente a otro, y tener
         que reiniciar para cambiarlo hace que nadie lo cambie. -->
    <select v-model="t.target" class="btn btn-outline" aria-label="Ambiente" @change="t.aURL()">
      <option value="prod">prod</option>
      <option value="staging">staging</option>
      <option value="dev">dev</option>
      <option value="local">local</option>
    </select>
    <button type="submit" class="btn btn-outline" :disabled="t.buscando || !t.q.trim()">
      {{ t.buscando ? 'buscando…' : 'buscar' }}
    </button>
  </form>

  <!-- Se dice CÓMO coincidió. El mismo número puede ser una cédula y un id de solicitud, y un buscador
       que elige en silencio muestra la solicitud de otra persona con total seguridad. -->
  <p v-if="t.resultados?.como?.length" class="como">
    <span :class="{ ojo: t.resultados.como.length > 1 }">
      coincidió como {{ t.resultados.como.join(' y ') }}
    </span>
    <span v-if="t.resultados.como.length > 1"> — mirá bien cuál buscabas</span>
    <span class="dim"> · fuente {{ t.resultados.fuente }}</span>
  </p>
  <p v-else-if="t.resultados" class="como dim">sin coincidencias en {{ t.resultados.target }}</p>

  <!-- Las últimas búsquedas. En soporte se vuelve al mismo puñado de solicitudes todo el día, y volver a
       tipear el número es fricción pura. Sólo se ven cuando no hay nada abierto: con una traza en pantalla
       serían ruido compitiendo con los chips de la persona. -->
  <p v-if="t.recientes.length && !t.traza && !t.resultados" class="recientes">
    <span class="dim">recientes:</span>
    <button v-for="r in t.recientes" :key="r" class="chip" @click="t.abrirReciente(r)">
      {{ r.split(':')[1] }}<span class="dim"> · {{ r.split(':')[0] }}</span>
    </button>
  </p>
</template>

<style scoped>
/* ⚠ Acá vivían el input, el select, el botón y su anillo de foco, escritos a mano. Son `.input` y
   `.btn.btn-outline` de `taller.css`, o sea los mismos que las otras tres: el alto, el radio, el
   anillo de 3px y los estados salen de un solo lugar. Lo único que queda es lo que esta barra tiene
   de propio — que el input se estire y que el `prod ▾ buscar` no envuelva. */
.buscador { display:flex; gap:8px; flex-wrap:wrap; align-items:center }
.buscador .input { flex:1 1 320px; width:auto }
.buscador select.btn { padding-right:8px }

.como { font-size:12.5px; color:var(--dim); margin:10px 0 0 }
.ojo { color:var(--warn); font-weight:500 }
.recientes { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:10px 0 0; font-size:12px }
/* Sobre `.badge.badge-outline`: sólo lo que un reciente tiene de distinto a una píldora cualquiera. */
.chip { cursor:pointer; font-variant-numeric:tabular-nums; padding:3px 11px }
.chip:hover { color:var(--txt); background:var(--accent) }
</style>
