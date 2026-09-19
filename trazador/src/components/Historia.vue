<script setup>
// LA VIDA DE LA CÉDULA: las solicitudes de la persona como chips, agrupadas por día.
//
// Antes esto era una lista vertical de botones anchos, uno por intento. Con un cliente de 40 solicitudes
// (hay uno de 228 en el dump) esa lista empujaba el árbol de etapas fuera de la pantalla, y el patrón que
// importa —«reintentó cuatro veces el mismo día»— no se veía: había que leer 40 fechas y compararlas.
// En chips por día, el patrón ES la forma: un día con cuatro puntos se ve de un golpe.
//
// Y no muestra sólo lo que se buscó. El server expande a la persona (mismo `user_id`), así que un número
// de solicitud sacado de Jira abre su historia completa sin buscar de nuevo. Los que sí se pidieron
// literalmente llevan marca: «esto es lo que preguntaste» y «esto es el resto» no son lo mismo.
//
// Como todo en la Vue: acá NO se decide nada. El desenlace de cada solicitud y los totales vienen del
// server (`desenlaceDe`/`armarHistoria` en Go), que es el único lugar donde «roto» está definido.
import { computed } from 'vue'
import { useTrazador } from '../stores/trazador'
const t = useTrazador()

// ⚠ Acá vivía un RECORTE a 6 días con su botón «ver los N días», y el motivo escrito era: «40
// solicitudes son 29 días, y desplegarlos todos empuja el árbol de etapas fuera de la pantalla».
// Ese motivo se murió cuando esta vista se mudó al sidebar izquierdo (2026-09-19): en una columna que
// scrollea sola no hay nada que empujar, y el recorte pasó a ser lo que antes evitaba — media historia
// escondida. Se fueron el `todo`, el `TOPE`, el botón y el `max-height: 45vh` de la tira.
// La lección, que vale para cualquier «ver más»: un recorte es la respuesta a un problema de LAYOUT;
// cuando el layout cambia, hay que volver a preguntarse si el problema sigue existiendo.

const GLIFO = { aprobado: '✓', roto: '✕', abandonado: '!', 'en-curso': '·' }
const CLASE = { aprobado: 'ok', roto: 'fail', abandonado: 'warn', 'en-curso': 'skip' }
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const h = computed(() => t.resultados?.historia || null)
const items = computed(() => t.resultados?.items || [])

// Los días, en el orden en que vienen los items (el server los manda de la más nueva a la más vieja).
const dias = computed(() => {
  const out = []
  for (const i of items.value) {
    let g = out[out.length - 1]
    if (!g || g.fecha !== i.fecha) { g = { fecha: i.fecha, chips: [] }; out.push(g) }
    g.chips.push(i)
  }
  return out
})

// «2026-08-04» → «04 ago ’26». Sin `new Date`: la fecha ya viene formateada por el server en la zona
// correcta, y parsearla la movería un día según el navegador.
const dia = (f) => {
  const [a, m, d] = f.split('-')
  return `${d} ${MES[+m - 1]} ’${a.slice(2)}`
}
const tip = (i) => [`#${i.ureq}`, `${i.fecha} ${i.hora}`, i.estadoN, i.comercio, i.lender,
  i.directa ? 'lo que buscaste' : 'misma persona'].filter(Boolean).join(' · ')
</script>

<template>
  <div v-if="items.length" class="historia">
    <!-- El resumen: la respuesta a «¿esta persona ya intentó antes y qué le pasó?» sin abrir nada -->
    <p class="linea">
      <b>{{ h.total }}</b> solicitud{{ h.total === 1 ? '' : 'es' }}
      <template v-if="h.desde !== h.hasta"> · {{ dia(h.desde) }} → {{ dia(h.hasta) }}</template>
      <template v-else> · {{ dia(h.hasta) }}</template>
      <span v-if="h.aprobadas" class="t ok">{{ h.aprobadas }} aprobada{{ h.aprobadas === 1 ? '' : 's' }}</span>
      <span v-if="h.rotas" class="t fail">{{ h.rotas }} rota{{ h.rotas === 1 ? '' : 's' }}</span>
      <span v-if="h.abandonadas" class="t warn">{{ h.abandonadas }} abandonada{{ h.abandonadas === 1 ? '' : 's' }}</span>
      <span v-if="h.enCurso" class="t">{{ h.enCurso }} en curso</span>
      <span v-if="h.comercios > 1" class="dim"> · {{ h.comercios }} comercios</span>
    </p>

    <!-- Las señales que cambian el diagnóstico. Van en texto y no en un color, porque son la diferencia
         entre «el cliente reintentó» y «algo está reintentando solo». -->
    <p v-if="h.mismoDia > 1 || h.personas > 1 || h.truncada" class="alerta">
      <span v-if="h.personas > 1" class="fail">⚠ {{ h.personas }} clientes distintos coinciden con ese
        número — mirá bien cuál buscabas.</span>
      <span v-if="h.mismoDia > 1">hasta <b>{{ h.mismoDia }}</b> intentos en un mismo día.</span>
      <span v-if="h.truncada">sólo se ven las {{ h.total }} más recientes: hay más.</span>
    </p>

    <!-- ⚠ El día pasó de ser una COLUMNA de 72px a la izquierda a ser el encabezado de su grupo
         (`region-head.grupo` de `taller.css`, o sea el mismo que el árbol de `context` y las vistas
         del tablero). En una franja horizontal la columna funcionaba; en 300px dejaba 190 para los
         chips —uno y medio por renglón— y la fecha se repetía en cada línea del wrap. De paso el
         encabezado se PEGA arriba, así que recorriendo 29 días siempre sabés en cuál estás. -->
    <div class="tira">
      <div v-for="g in dias" :key="g.fecha" class="grupo">
        <div class="region-head grupo">
          <span>{{ dia(g.fecha) }}</span>
          <span class="badge badge-secondary badge-xs">{{ g.chips.length }}</span>
        </div>
        <div class="chips">
        <button v-for="i in g.chips" :key="i.ureq"
                :class="['badge', 'badge-outline', 'chip', CLASE[i.desenlace], { act: t.traza?.ureq === i.ureq }]"
                :title="tip(i)" @click="t.verTraza(i.ureq)">
          <span class="g">{{ GLIFO[i.desenlace] }}</span>{{ i.hora }}
          <span class="n">{{ i.ureq }}</span>
          <!-- La marca de «esto es lo que buscaste» sólo aparece cuando hay mezcla. Si buscaste una cédula
               con 12 intentos, las 12 son directas y marcarlas todas no distingue nada: es ruido. -->
          <span v-if="i.directa && h.expandidas" class="q" aria-label="lo que buscaste">◂</span>
        </button>
        </div>
      </div>
    </div>

    <p class="pie">
      <span class="ok">✓ aprobada</span><span class="fail">✕ rota</span>
      <span class="warn">! abandonada</span><span class="dim">· en curso</span>
      <span v-if="h.expandidas" class="dim"><b class="q">◂</b> lo que buscaste — las otras
        {{ h.expandidas }} son de la misma persona</span>
    </p>
  </div>
</template>

<style scoped>
/* Ya no lleva padding ni borde propios: es un bloque más del cuerpo del sidebar, que pone los dos. */
.historia { min-width:0 }
.linea { margin:0 0 6px; font-size:12.5px; color:var(--dim) }
.linea b { color:var(--txt) }
.t { margin-left:9px; font-weight:600 }
.alerta { margin:0 0 8px; font-size:12px; color:var(--warn); display:flex; gap:10px; flex-wrap:wrap }
.alerta .fail { color:var(--fail); font-weight:600 }

/* Agrupado por día: su encabezado y debajo sus intentos. Que un día tenga cuatro chips ES la señal de
   reintento — no hay que leer ninguna fecha para verla. */
.tira { display:flex; flex-direction:column }
/* Sobre `.region-head.grupo`: sale A SANGRE contra los 14px del cuerpo del sidebar (una banda de lado
   a lado se lee como encabezado; con aire a los costados, como otra tarjeta) y en minúsculas, porque
   «18 ago ’26» es un dato y no un rótulo. */
.grupo > .region-head.grupo { margin:6px -14px 4px; padding:4px 14px; width:auto;
  text-transform:none; letter-spacing:normal; font-variant-numeric:tabular-nums }
.chips { display:flex; flex-wrap:wrap; gap:4px }

/* Sobre `.badge.badge-outline`: un intento de la persona es una ETIQUETA que además se aprieta. */
.chip { gap:5px; padding:2px 8px; font-size:12px; color:var(--dim);
  cursor:pointer; font-variant-numeric:tabular-nums }
.chip:hover { background:var(--sel) }
.chip .g { font-weight:700 }
.chip .n { color:var(--dim); font-size:11px }
.chip.ok .g { color:var(--ok) } .chip.fail .g { color:var(--fail) }
.chip.warn .g { color:var(--warn) } .chip.skip .g { color:var(--skip) }
/* «lo que buscaste» va como GLIFO y no como borde: el borde ya lo usa `act` (la traza abierta), y la
   solicitud que buscaste suele ser justo la que está abierta — un borde para las dos se pisa a sí mismo. */
.chip .q { color:var(--info); font-size:10px }
.chip.act { border-color:var(--info); background:var(--sel); font-weight:600 }
.chip:focus-visible { outline:2px solid var(--info); outline-offset:1px }

.pie { margin:7px 0 0; font-size:11px; color:var(--dim); display:flex; gap:11px; flex-wrap:wrap;
  align-items:center }
.pie .ok { color:var(--ok) } .pie .fail { color:var(--fail) } .pie .warn { color:var(--warn) }
.pie .q { color:var(--info) }
</style>
