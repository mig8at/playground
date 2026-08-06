<script setup>
// El sidebar: las 8 etapas del flujo declarado, siempre las mismas.
//
// Se dibujan desde el MAPA, no desde la traza. Así el árbol existe antes de consultar (en gris) y las
// etapas se van encendiendo — que es lo que hace que la vista no se sienta como un spinner mientras Redash
// hace su cola. Y el hexágono `?` no es decoración: marca las etapas que la BD no puede probar, donde una
// ausencia NO significa «no ocurrió».
// ── EL ÁRBOL DINÁMICO ──
//
// Por defecto se muestran SOLO las etapas del flujo que esta solicitud pudo recorrer, y se pliegan las que
// están DECLARADAS como inexistentes para su combinación de canal × ramal (estado `no-aplica`). Una traza
// rt=0 pasa de 10 etapas a 7; una de Alkosto + Bancolombia, a 7 también, pero otras.
//
// ⚠ LA REGLA QUE NO SE PUEDE ROMPER: se oculta lo que NO EXISTE, nunca lo que está VACÍO. Una etapa sin
// evidencia es justo donde el flujo se pudo haber cortado — esconderla convierte la herramienta en una que
// nunca muestra el problema. Por eso el filtro mira `no-aplica` (una declaración verificada del mapa) y no
// «tiene datos». Y lo plegado se CUENTA y se puede abrir: un árbol que oculta sin decirlo se lee como si el
// flujo tuviera menos pasos de los que tiene.
import { computed, ref } from 'vue'
import { useTrazador } from '../stores/trazador'
const t = useTrazador()
const GLIFO = { ok:'✓', warn:'!', fail:'✕', skip:'·', 'sin-evidencia':'?', 'sin-registro':'~',
  // `no-aplica` ≠ `skip`: «acá esto no ocurre nunca en este ramal» es una pregunta CERRADA, y verla
  // igual que «podía pasar y no pasó» manda a buscar un tramo que no existe.
  'no-aplica':'∅', condicional:'·', pendiente:'·' }

const todas = ref(false)
const fuera = computed(() => t.etapas.filter((e) => e.estado === 'no-aplica'))

// EL SALTO ENTRE ETAPAS. Un hueco de 6 minutos entre el listado y la selección es el cliente pensando; uno
// de 40 es un abandono o una espera de un tercero. Hoy había que restar horas de cabeza, y con etapas que a
// veces no vienen en orden cronológico (ver el aviso de horas no monótonas) restar mal es fácil.
//
// Sólo se muestra cuando el salto es POSITIVO y ≥1 minuto: un salto negativo significa que ese historial no
// está en orden de flujo, y ahí un «+»/«−» invitaría a leerlo como duración cuando no lo es. Ese caso ya
// tiene su propio aviso, que dice bastante más que un número.
const aMin = (hhmmss) => {
  if (!hhmmss) return null
  const [h, m, s] = hhmmss.split(':').map(Number)
  return h * 60 + m + (s || 0) / 60
}
const visibles = computed(() => {
  const es = todas.value ? t.etapas : t.etapas.filter((e) => e.estado !== 'no-aplica')
  let previa = null
  return es.map((e) => {
    const ahora = aMin(e.vivo?.at)
    let salto = ''
    if (ahora !== null && previa !== null) {
      const d = Math.round(ahora - previa)
      if (d >= 1) salto = d >= 60 ? `+${Math.floor(d / 60)}h ${d % 60}m` : `+${d}m`
    }
    if (ahora !== null) previa = ahora
    return { ...e, salto }
  })
})

// Teclado: ↑/↓ mueven entre etapas. Las filas son `<button>` (antes eran `div @click`, invisibles para el
// teclado y para un lector de pantalla), así que Tab y Enter ya funcionan solos; esto agrega el recorrido
// rápido, que es como se navega una lista de checks en CI.
function mover(i, paso) {
  const es = visibles.value
  const j = i + paso
  if (j < 0 || j >= es.length) return
  t.seleccionar(es[j].id)
  document.querySelectorAll('aside .fila')[j]?.focus()
}
</script>

<template>
  <aside>
    <h2>Etapas del flujo</h2>
    <ul>
      <li v-for="(e, i) in visibles" :key="e.id">
        <button class="fila" :class="{ act: e.id === t.etapaActiva?.id, ausente: e.estado === 'no-aplica' }"
                :aria-current="e.id === t.etapaActiva?.id ? 'true' : undefined"
                @click="t.seleccionar(e.id)"
                @keydown.down.prevent="mover(i, 1)" @keydown.up.prevent="mover(i, -1)">
          <span class="ico" :class="e.estado">{{ GLIFO[e.estado] || '·' }}</span>
          <span class="n">{{ e.label }}</span>
          <span v-if="e.salto" class="salto" :title="'transcurrieron ' + e.salto + ' desde la etapa anterior'">{{ e.salto }}</span>
          <span class="t">{{ e.vivo?.at || '' }}</span>
        </button>
      </li>
    </ul>

    <!-- Lo plegado se DICE. Un árbol que oculta en silencio se lee como un flujo con menos pasos. -->
    <button v-if="fuera.length" class="mas" @click="todas = !todas">
      <template v-if="todas">ocultar las {{ fuera.length }} que no aplican</template>
      <template v-else>+ {{ fuera.length }} etapa{{ fuera.length === 1 ? '' : 's' }} que no aplican a este
        flujo</template>
    </button>

    <div class="det">
      <b>Detalles</b><br />
      ambiente <b>{{ t.traza?.target || t.target }}</b><br />
      <template v-if="t.traza">
        fuentes {{ (t.traza.sources || []).join(' + ') }}<br />
        estado {{ t.traza.estado }} «{{ t.traza.estadoN }}»
        <template v-if="t.traza.brokeAt"><br />rompió en <b>{{ t.traza.brokeAt }}</b></template>
      </template>
      <template v-else>
        <span class="dim">árbol declarado · mapa v{{ t.mapa?.version }} + hitos v{{ t.mapa?.subVersion }}</span>
      </template>
    </div>

    <!-- Los avisos son parte del dato, no una nota al pie: dicen cuánto se puede afirmar de lo de arriba. -->
    <div v-if="t.traza?.warnings?.length" class="det">
      <b>Avisos ({{ t.traza.warnings.length }})</b>
      <p v-for="(w, i) in t.traza.warnings" :key="i" class="aviso">⚠ {{ w }}</p>
    </div>
  </aside>
</template>

<style scoped>
aside { border-right:1px solid var(--line); padding:14px 0 }
h2 { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--dim);
  margin:0 0 8px; padding:0 16px }
ul { list-style:none; margin:0; padding:0 }
/* La fila es un <button> y no un <div @click>: así el teclado y los lectores de pantalla la ven. Se le
   quita la piel de botón, no el comportamiento. */
.fila { display:flex; align-items:center; gap:9px; padding:7px 16px; cursor:pointer; width:100%;
  border:0; border-left:2px solid transparent; background:none; font-size:13px; text-align:left }
.fila:hover { background:var(--sel) }
.fila:focus-visible { outline:2px solid var(--accent); outline-offset:-2px }
.fila.act { background:var(--sel); border-left-color:var(--accent); font-weight:600 }
.n { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.t { color:var(--dim); font-size:11px; font-variant-numeric:tabular-nums }
.salto { color:var(--dim); font-size:10px; border:1px solid var(--line); border-radius:3px;
  padding:0 4px; font-variant-numeric:tabular-nums }
.fila.ausente .n { color:var(--dim); text-decoration:line-through; text-decoration-color:var(--line) }
.mas { display:block; margin:6px 16px 0; padding:2px 9px; font-size:11px; color:var(--accent);
  background:none; border:1px dashed var(--line); border-radius:999px; cursor:pointer; text-align:left }
.mas:hover { background:var(--sel) }
.det { margin-top:16px; padding:13px 16px 0; border-top:1px solid var(--line);
  font-size:12px; color:var(--dim); line-height:1.7 }
.det b { color:var(--txt); font-weight:600 }
.aviso { color:var(--warn); margin:5px 0; line-height:1.45 }
</style>
