<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTrazador } from './stores/trazador'
import { trazaATexto } from './trazaTexto'
import Buscador from './components/Buscador.vue'
import Historia from './components/Historia.vue'
import Mapa from './components/Mapa.vue'
import Detalle from './components/Detalle.vue'

const t = useTrazador()
// El mapa primero y solo: no toca ninguna fuente, así que el árbol se dibuja al instante y la app no
// arranca en blanco esperando a Redash. Después se mira la URL: si trae `?ureq=`, se rearma esa traza.
onMounted(async () => {
  await t.cargarMapa()
  t.desdeURL()
})

// LISTA O MAPA, y las dos conviven a propósito. La lista contesta «¿qué pasó en cada etapa?» mejor que
// nada —hora, salto, subs, eventos— y el mapa contesta «¿por dónde fue y dónde se cortó?», que una lista
// no puede. Reemplazar una por otra antes de saber cuál se usa es tirar algo que funciona: si el mapa
// gana, la lista se va sola, y eso se decide mirándolo, no ahora.
// EL MAPA PUEDE HABER DEJADO DE RESOLVER, y eso no se ve mirando la pantalla: el diagnóstico sale
// igual de prolijo, sólo que equivocado. Se muestra SÓLO lo grave (una etapa que nadie declara, una
// tabla que ya no existe) — los avisos de «mirá esto» viven en `make trazador-chequeo`, porque un
// cartel permanente deja de leerse y tapa a los que sí importan. Misma regla que el panel del harness.
const chequeoGrave = computed(() => (t.mapa?.chequeo || []).filter((h) => h.grave))

// EL ANCHO DEL SIDEBAR, que el usuario mueve y la app recuerda. Es por VIEWER y no una preferencia del
// producto: en una pantalla ancha conviene darle aire al mapa y en una angosta, a los logs.
//
// ⚠ Con try/catch: en una ventana privada o con las cookies bloqueadas el acceso a localStorage TIRA, y
// un layout que no arranca por no poder leer una preferencia es peor que uno que arranca con el default.
const ANCHO_MIN = 300, ANCHO_MAX_PCT = 0.62
const leerAncho = () => { try { return Number(localStorage.getItem('trazador.sidebar')) || 520 } catch { return 520 } }
const anchoSidebar = ref(leerAncho())
watch(anchoSidebar, (v) => { try { localStorage.setItem('trazador.sidebar', String(Math.round(v))) } catch { /* sin storage */ } })

const redimensionando = ref(false)
function tomarTirador() {
  redimensionando.value = true
  // El ancho se mide desde el BORDE DERECHO de la ventana, no como delta del arrastre: así el tirador
  // queda pegado al cursor aunque el puntero se salga del elemento o se mueva más rápido que el render.
  const mover = (e) => {
    anchoSidebar.value = Math.min(window.innerWidth * ANCHO_MAX_PCT,
                                  Math.max(ANCHO_MIN, window.innerWidth - e.clientX))
  }
  const soltar = () => {
    redimensionando.value = false
    removeEventListener('pointermove', mover); removeEventListener('pointerup', soltar)
  }
  addEventListener('pointermove', mover); addEventListener('pointerup', soltar)
}

const GLIFO = { aprobado:'✓', roto:'✕', abandonado:'!', 'en-curso':'·' }
const CLASE = { aprobado:'ok', roto:'fail', abandonado:'warn', 'en-curso':'skip' }

// COPIAR LA TRAZA ENTERA como texto: hechos de BD + logs por paso + avisos, todo junto. El destino de una
// traza casi nunca es esta pantalla — se pega en un ticket, en Slack o en un prompt — y un screenshot no se
// puede grepear ni citar. El texto lo arma `trazaTexto.js` desde el MISMO JSON que pinta la vista.
const copiado = ref(false)
async function copiar() {
  const texto = trazaATexto(t.traza, t.mapa)
  try {
    await navigator.clipboard.writeText(texto)
  } catch {
    // Sin permiso de clipboard (http, iframe): el textarea invisible sigue funcionando en todos lados.
    const ta = document.createElement('textarea')
    ta.value = texto
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copiado.value = true
  setTimeout(() => (copiado.value = false), 1800)
}
</script>

<template>
  <header>
    <div class="fila1">
      <h1>Trazador <span class="dim">· CreditOp</span></h1>
      <span v-if="t.traza" class="ico big" :class="CLASE[t.traza.outcome]">{{ GLIFO[t.traza.outcome] }}</span>
      <span v-if="t.traza" class="badge" :class="CLASE[t.traza.outcome]">{{ t.traza.outcome }}</span>
      <span v-if="t.traza" class="ureq">solicitud {{ t.traza.ureq }}</span>
      <button v-if="t.traza" class="copiar" :class="{ ok: copiado }" @click="copiar"
              title="La traza completa como texto: hechos de BD + logs por paso + avisos. Para pegar en un ticket o un prompt.">
        {{ copiado ? '✓ copiado' : '⧉ copiar traza' }}
      </button>
    </div>

    <!-- LA ESPERA, DICHA. Contra prod son ~20 s en dos saltos porque Redash es asíncrono; un spinner mudo
         tanto tiempo se lee como «se colgó». Cuál de los dos corre convierte la espera en información. -->
    <div v-if="t.fase" class="cargando">
      <div class="barra"><i /></div>
      <span>{{ t.fase === 'buscando' ? 'buscando la solicitud…' : 'armando la traza: BD + logs…' }}</span>
      <span v-if="t.target === 'prod'" class="dim">prod pasa por la cola de Redash, tarda unos segundos</span>
    </div>
    <Buscador />
    <p v-if="t.traza" class="meta">
      {{ t.traza.comercio }} · {{ t.traza.sucursal }}
      <template v-if="t.traza.lender"> · {{ t.traza.lender }} (rt={{ t.traza.rt }})</template>
      · monto {{ Math.round(t.traza.monto).toLocaleString('es-CO') }}
      · doc {{ t.traza.documento }}
      · canal {{ t.traza.origen }}<span v-if="!t.traza.origenDerivado" class="dim"> (supuesto)</span>
    </p>
    <p v-if="t.error" class="err">{{ t.error }}</p>
    <p v-for="h in chequeoGrave" :key="h.texto" class="err mapaRoto">
      ⚠ el mapa dejó de resolver: {{ h.texto }} — <code>make trazador-chequeo</code>
    </p>
  </header>

  <!-- La historia de la persona: sus solicitudes como chips por día. Reemplaza la lista vertical de
       botones anchos, que con 40 intentos empujaba el árbol de etapas fuera de la pantalla. -->
  <Historia />

  <div class="cols" :class="{ midiendo: redimensionando }"
       :style="{ gridTemplateColumns: `minmax(0,1fr) 5px ${Math.round(anchoSidebar)}px` }">
    <Mapa :ancho-sidebar="anchoSidebar" />
    <!-- El tirador es un `<div>` con rol de separador y no un borde: hay que poder AGARRARLO, y 5px de
         zona activa es el mínimo con el que no se falla el click. Doble clic vuelve al ancho de fábrica. -->
    <div class="tirador" role="separator" aria-orientation="vertical" aria-label="Ancho del panel de logs"
         @pointerdown.prevent="tomarTirador" @dblclick="anchoSidebar = 520" />
    <Detalle />
  </div>
</template>

<style scoped>
header { padding:16px 20px; border-bottom:1px solid var(--line) }
.fila1 { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px }
h1 { font-size:18px; margin:0; font-weight:600 }
.ureq { color:var(--dim); font-size:13px }
.copiar { margin-left:auto; padding:4px 12px; font-size:12px; border:1px solid var(--line);
  border-radius:6px; background:var(--panel); color:var(--txt); cursor:pointer }
.copiar:hover { background:var(--sel); border-color:var(--accent) }
.copiar.ok { color:var(--ok); border-color:var(--ok) }

.cargando { display:flex; align-items:center; gap:10px; margin-top:10px; font-size:12px; color:var(--dim) }
.barra { width:120px; height:3px; background:var(--line); border-radius:2px; overflow:hidden; flex:0 0 120px }
/* Indeterminada a propósito: no sabemos cuánto falta (la cola de Redash no lo dice), y una barra que
   fabrica un porcentaje miente. Esta sólo comunica «sigue vivo». */
.barra i { display:block; width:40%; height:100%; background:var(--accent); border-radius:2px;
  animation:corre 1.1s ease-in-out infinite }
@keyframes corre { 0%{transform:translateX(-100%)} 100%{transform:translateX(250%)} }
@media (prefers-reduced-motion:reduce) { .barra i { animation:none; width:100% ; opacity:.5 } }
.meta { color:var(--dim); font-size:13px; margin:10px 0 0 }
.err { color:var(--fail); font-size:13px; margin:10px 0 0 }
.mapaRoto code { background:var(--panel); padding:1px 5px; border-radius:4px; font-size:12px }
/* Tres columnas: mapa · tirador · logs. El ancho de la tercera lo pone el usuario (inline, desde el
   estado), así que acá sólo va el default por si el estilo se aplica antes que el script. */
.cols { display:grid; grid-template-columns:minmax(0,1fr) 5px 520px; min-height:60vh }
/* Mientras se arrastra, el cursor manda en TODA la página: sin esto, al pasar el puntero sobre el mapa
   o sobre el texto de los logs el cursor cambia y el arrastre se siente roto aunque siga funcionando. */
.cols.midiendo { cursor:col-resize; user-select:none }
.tirador { cursor:col-resize; background:var(--line); transition:background .12s }
.tirador:hover, .cols.midiendo .tirador { background:var(--accent) }
/* ⚠ CON EL MAPA, EL DETALLE ES UN SIDEBAR DERECHO — no una fila debajo.
   El mapa es horizontal (tronco a lo largo, un carril por ramal), así que lo que necesita es ANCHO, y
   el detalle es una lista de logs, que necesita ALTO. Ponerlos en dos filas le daba al mapa el ancho
   completo pero dejaba los logs en una tira baja donde no entra nada; al lado, cada uno crece por
   donde le sirve. La lista sigue con su propio reparto: es vertical y compite por el mismo eje. */
.cols.ancha { grid-template-columns:minmax(0,1fr) minmax(320px, 34%) }
@media (max-width:860px) { .cols { grid-template-columns:1fr } }
</style>
