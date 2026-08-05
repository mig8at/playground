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
      aria-label="Buscar" />
    <!-- El target se elige acá y no en una config: en soporte se salta de un ambiente a otro, y tener
         que reiniciar para cambiarlo hace que nadie lo cambie. -->
    <select v-model="t.target" aria-label="Ambiente">
      <option value="prod">prod</option>
      <option value="staging">staging</option>
      <option value="dev">dev</option>
      <option value="local">local</option>
    </select>
    <button type="submit" :disabled="t.buscando || !t.q.trim()">
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
</template>

<style scoped>
.buscador { display:flex; gap:8px; flex-wrap:wrap; align-items:center }
input { flex:1 1 320px; min-width:0; padding:7px 11px; border:1px solid var(--line); border-radius:6px;
  background:var(--panel); color:var(--txt) }
input:focus { outline:2px solid var(--accent); outline-offset:-1px }
select, button { padding:7px 12px; border:1px solid var(--line); border-radius:6px;
  background:var(--panel); color:var(--txt); cursor:pointer }
button { font-weight:600 }
button:disabled { opacity:.5; cursor:default }
.como { font-size:13px; color:var(--dim); margin:10px 0 0 }
.ojo { color:var(--warn); font-weight:600 }
</style>
