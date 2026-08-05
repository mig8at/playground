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
import { computed, ref } from 'vue'
import { useTrazador } from '../stores/trazador'
const t = useTrazador()

// La tira arranca recortada: 40 solicitudes son 29 días, y desplegarlos todos empuja el árbol de etapas
// fuera de la pantalla — el problema que esta vista vino a arreglar. Recortada, pero DICIENDO cuánto falta:
// un scroll sin borde visible esconde la mitad de la historia y nadie lo busca.
const todo = ref(false)
const TOPE = 6 // días visibles cuando está recortada

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

    <div class="tira" :class="{ abierta: todo }">
      <div v-for="g in (todo ? dias : dias.slice(0, TOPE))" :key="g.fecha" class="grupo">
        <span class="fecha">{{ dia(g.fecha) }}</span>
        <button v-for="i in g.chips" :key="i.ureq"
                :class="['chip', CLASE[i.desenlace], { act: t.traza?.ureq === i.ureq }]"
                :title="tip(i)" @click="t.verTraza(i.ureq)">
          <span class="g">{{ GLIFO[i.desenlace] }}</span>{{ i.hora }}
          <span class="n">{{ i.ureq }}</span>
          <!-- La marca de «esto es lo que buscaste» sólo aparece cuando hay mezcla. Si buscaste una cédula
               con 12 intentos, las 12 son directas y marcarlas todas no distingue nada: es ruido. -->
          <span v-if="i.directa && h.expandidas" class="q" aria-label="lo que buscaste">◂</span>
        </button>
      </div>
    </div>

    <p class="pie">
      <button v-if="dias.length > TOPE" class="mas" @click="todo = !todo">
        {{ todo ? 'ver menos' : `ver los ${dias.length} días` }}
      </button>
      <span class="ok">✓ aprobada</span><span class="fail">✕ rota</span>
      <span class="warn">! abandonada</span><span class="dim">· en curso</span>
      <span v-if="h.expandidas" class="dim"><b class="q">◂</b> lo que buscaste — las otras
        {{ h.expandidas }} son de la misma persona</span>
    </p>
  </div>
</template>

<style scoped>
.historia { padding:11px 20px; border-bottom:1px solid var(--line) }
.linea { margin:0 0 6px; font-size:13px; color:var(--dim) }
.linea b { color:var(--txt) }
.t { margin-left:9px; font-weight:600 }
.alerta { margin:0 0 8px; font-size:12px; color:var(--warn); display:flex; gap:10px; flex-wrap:wrap }
.alerta .fail { color:var(--fail); font-weight:600 }

/* Agrupado por día: el día a la izquierda y sus intentos al lado. Que un día tenga cuatro chips ES la
   señal de reintento — no hay que leer ninguna fecha para verla. */
.tira { display:flex; flex-direction:column; gap:4px }
.tira.abierta { max-height:45vh; overflow-y:auto }
.grupo { display:flex; align-items:center; gap:6px; flex-wrap:wrap }
.fecha { font-size:11px; color:var(--dim); width:72px; flex:0 0 72px; text-align:right;
  font-variant-numeric:tabular-nums }

.chip { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; font-size:12px;
  border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--txt);
  cursor:pointer; font-variant-numeric:tabular-nums; white-space:nowrap }
.chip:hover { background:var(--sel) }
.chip .g { font-weight:700 }
.chip .n { color:var(--dim); font-size:11px }
.chip.ok .g { color:var(--ok) } .chip.fail .g { color:var(--fail) }
.chip.warn .g { color:var(--warn) } .chip.skip .g { color:var(--skip) }
/* «lo que buscaste» va como GLIFO y no como borde: el borde ya lo usa `act` (la traza abierta), y la
   solicitud que buscaste suele ser justo la que está abierta — un borde para las dos se pisa a sí mismo. */
.chip .q { color:var(--accent); font-size:10px }
.chip.act { border-color:var(--accent); background:var(--sel); font-weight:600 }
.chip:focus-visible { outline:2px solid var(--accent); outline-offset:1px }

.pie { margin:7px 0 0; font-size:11px; color:var(--dim); display:flex; gap:11px; flex-wrap:wrap;
  align-items:center }
.pie .ok { color:var(--ok) } .pie .fail { color:var(--fail) } .pie .warn { color:var(--warn) }
.pie .q { color:var(--accent) }
.mas { font-size:11px; color:var(--accent); background:none; border:1px solid var(--line);
  border-radius:999px; padding:1px 9px; cursor:pointer }
.mas:hover { background:var(--sel) }
</style>
