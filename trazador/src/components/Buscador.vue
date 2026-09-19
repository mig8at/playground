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
    <select v-model="t.target" aria-label="Ambiente" @change="t.aURL()">
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
/* Controles al estilo shadcn: el input se hunde (fondo más oscuro que el panel) y los botones se
   elevan. Es la única señal que hace falta para distinguir «acá escribís» de «acá apretás», y
   funciona sin un solo borde de color. */
.buscador { display:flex; gap:8px; flex-wrap:wrap; align-items:center }

input { flex:1 1 320px; min-width:0; padding:8px 12px; border:1px solid var(--line);
  border-radius:var(--r); background:var(--panel2); color:var(--txt);
  transition:border-color .12s, box-shadow .12s }
input::placeholder { color:var(--tenue) }
input:hover { border-color:var(--line-fuerte) }
/* El foco es un ANILLO, no un outline grueso: se ve igual de claro y no corre el layout un píxel. */
input:focus, select:focus, button:focus-visible { outline:none; border-color:var(--ring);
  box-shadow:0 0 0 3px var(--sel) }

select, button { padding:8px 13px; border:1px solid var(--line); border-radius:var(--r);
  background:var(--card); color:var(--txt); cursor:pointer; transition:background .12s, border-color .12s }
select:hover, button:hover:not(:disabled) { background:var(--elev); border-color:var(--line-fuerte) }
button { font-weight:500 }
button:disabled { opacity:.45; cursor:default }

.como { font-size:12.5px; color:var(--dim); margin:10px 0 0 }
.ojo { color:var(--warn); font-weight:500 }
.recientes { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:10px 0 0; font-size:12px }
.chip { font-size:12px; color:var(--dim); background:transparent; border:1px solid var(--line);
  border-radius:var(--r-full); padding:3px 11px; cursor:pointer; font-variant-numeric:tabular-nums;
  transition:color .12s, background .12s, border-color .12s }
.chip:hover { color:var(--txt); background:var(--elev); border-color:var(--line-fuerte) }
</style>
