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

/**
 * EL SIDEBAR SE MONTA SOBRE EL MAPA; NO LO EMPUJA.
 *
 * ⚠ El mapa tiene **dos anchos y nada más**: el 100 % con el sidebar cerrado, y el 100 % menos
 * `SIDEBAR_BASE` con el sidebar abierto. Ensanchar el sidebar más allá de su base **no reduce el
 * mapa**: lo tapa.
 *
 * Por qué, y es la diferencia con la versión anterior: el mapa se redibuja cuando cambia su ancho —la
 * separación entre nodos se recalcula—, así que si el sidebar lo empuja, **el dibujo entero se re-arma
 * en cada píxel del arrastre**. Se ve como un grafo que late mientras uno mueve el tirador, y además
 * la posición de cada nodo deja de ser estable justo cuando uno está mirándola. Con el sidebar como
 * capa, el mapa queda quieto: se recalcula UNA vez, al abrir o cerrar.
 */
const SIDEBAR_BASE = 380
const leerAncho = () => { try { const v = Number(localStorage.getItem('trazador.sidebar')); return Number.isFinite(v) && v >= 0 ? v : SIDEBAR_BASE } catch { return SIDEBAR_BASE } }
const anchoSidebar = ref(leerAncho())
// ⚠ Con try/catch: en una ventana privada o con las cookies bloqueadas el acceso a localStorage TIRA, y
// un layout que no arranca por no poder leer una preferencia es peor que uno que arranca con el default.
watch(anchoSidebar, (v) => { try { localStorage.setItem('trazador.sidebar', String(Math.round(v))) } catch { /* sin storage */ } })

/** Cerrado = 0. Es lo único que cambia el ancho del mapa, así que el mapa se entera de ESTO y no del
 *  ancho: ver `SIDEBAR_BASE` arriba. */
const cerrado = computed(() => anchoSidebar.value < 1)

const redimensionando = ref(false)
function tomarTirador() {
  redimensionando.value = true
  const mover = (e) => {
    // Se mide desde el BORDE DERECHO de la ventana, no como delta: así el tirador queda pegado al
    // cursor aunque el puntero se salga del elemento o se mueva más rápido que el render.
    const w = window.innerWidth - e.clientX
    // ⚠ Arrastrarlo hasta el borde CIERRA, y hay un umbral en vez de exigir el cero exacto: un sidebar
    // de 40px no sirve para nada y es imposible de agarrar de nuevo. Por debajo de la mitad de la base
    // se colapsa entero y el mapa pasa a ocupar todo.
    anchoSidebar.value = w < SIDEBAR_BASE / 2 ? 0 : Math.min(window.innerWidth - 220, Math.max(SIDEBAR_BASE, w))
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

  <div class="cols" :class="{ midiendo: redimensionando, cerrado }">
    <!-- El mapa NO lleva el ancho del sidebar: sólo si está abierto o no. Así se recalcula una vez, al
         abrir o cerrar, y no en cada píxel del arrastre. -->
    <!-- El mapa es el EDITOR y `Detalle` el AUXILIARYBAR, en el vocabulario de `taller.css`. El mapa
         no lleva la clase `.editor` a propósito: su regla propia ya dice todo lo que la compartida
         diría, y lo único que agregaría es un `display:flex` que hoy no tiene. Un nombre que no
         cambia nada es un nombre que alguien va a borrar sin saber qué se lleva. -->
    <Mapa :cerrado="cerrado" />

    <!-- El tirador viaja con el borde del panel. Con el sidebar cerrado queda pegado a la derecha y
         sigue sirviendo para volver a abrirlo, que es lo que evita que cerrarlo sea un camino de ida. -->
    <div class="tirador" role="separator" aria-orientation="vertical"
         :aria-label="cerrado ? 'Abrir el panel de logs' : 'Ancho del panel de logs'"
         :style="{ right: `${Math.round(anchoSidebar)}px` }"
         :title="cerrado ? 'abrir los logs' : 'arrastrar para ensanchar · doble clic para cerrar'"
         @pointerdown.prevent="tomarTirador"
         @dblclick="anchoSidebar = cerrado ? SIDEBAR_BASE : 0" />

    <!-- En capa sobre el mapa, no en el flujo: por eso ensancharlo lo TAPA en vez de deformarlo. -->
    <Detalle v-show="!cerrado" class="auxiliarybar" :style="{ width: `${Math.round(anchoSidebar)}px` }" />
  </div>
</template>

<style scoped>
/* Compacto: cada píxel de arriba se lo come el mapa, que es lo que uno mira. */
/* ⚠ LAS SUPERFICIES TIENEN QUE ESCALONARSE, y medirlo es la única forma de saber si pasa. La primera
   versión de esto puso `--panel2` en el header, el mapa Y el panel: los tres quedaron en la misma
   luminancia (12 sobre 255) y con ellos el input, que se supone HUNDIDO, dejó de distinguirse de su
   contenedor. Sin color, la profundidad es lo único que separa una capa de otra.

   La escalera, medida:  fondo 9  ·  lienzo del mapa 12  ·  header y panel 19  ·  tarjeta 24. */
header { padding:12px 18px 14px; border-bottom:1px solid var(--line); flex:0 0 auto;
  background:var(--card) }
.fila1 { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px }
/* ⚠ El título NO compite: con 18px en negrita era lo más pesado de la pantalla, y el título de una
   herramienta es lo que uno menos necesita leer. Manda la solicitud que se está mirando. */
h1 { font-size:14px; margin:0; font-weight:600; letter-spacing:-.01em }
.ureq { color:var(--dim); font-size:13px; font-variant-numeric:tabular-nums }
.copiar { margin-left:auto; padding:6px 12px; font-size:12px; border:1px solid var(--line);
  border-radius:var(--r); background:var(--card); color:var(--dim); cursor:pointer;
  transition:color .12s, background .12s, border-color .12s }
.copiar:hover { color:var(--txt); background:var(--elev); border-color:var(--line-fuerte) }
.copiar.ok { color:var(--ok); border-color:var(--ok) }

.cargando { display:flex; align-items:center; gap:10px; margin-top:10px; font-size:12px; color:var(--dim) }
.barra { width:120px; height:3px; background:var(--line); border-radius:var(--r-full); overflow:hidden; flex:0 0 120px }
/* Indeterminada a propósito: no sabemos cuánto falta (la cola de Redash no lo dice), y una barra que
   fabrica un porcentaje miente. Esta sólo comunica «sigue vivo». */
.barra i { display:block; width:40%; height:100%; background:var(--info);
  animation:corre 1.1s ease-in-out infinite; border-radius:var(--r-full) }
@keyframes corre { 0%{transform:translateX(-100%)} 100%{transform:translateX(250%)} }
@media (prefers-reduced-motion:reduce) { .barra i { animation:none; width:100% ; opacity:.5 } }
.meta { color:var(--dim); font-size:12.5px; margin:7px 0 0 }
.err { color:var(--fail); font-size:12.5px; margin:10px 0 0 }
.mapaRoto code { background:var(--elev); border:1px solid var(--line); padding:1px 6px;
  border-radius:var(--r-sm); font-size:11.5px }
/* ⚠ NO ES UN GRID DE TRES COLUMNAS: es el mapa en flujo y el panel EN CAPA encima.
   El mapa sólo tiene dos anchos —todo, o todo menos la base del sidebar—, así que su dibujo se
   recalcula al abrir o cerrar y no en cada píxel del arrastre. Un grid haría lo contrario: cada
   movimiento del tirador cambiaría la columna del mapa y el grafo se re-armaría entero, latiendo.
   ⚠ `flex:1` + `min-height:0`: sin el `min-height`, un hijo flex NO se achica por debajo de su
   contenido y el `overflow:auto` de adentro no se activa nunca — la página vuelve a estirarse y el
   mapa se va para arriba. Es la parte que siempre se olvida de este patrón. */
.cols { position:relative; flex:1; min-height:0 }
.cols > :first-child { width:calc(100% - 380px); height:100% }
.cols.cerrado > :first-child { width:100% }

/* En capa, pegado a la derecha y por encima del mapa, y un punto MÁS CLARO que él: es lo que lo hace
   leerse como algo que está encima y no como otra zona del mismo plano. */
.auxiliarybar { position:absolute; top:0; right:0; bottom:0; z-index:2;
  background:var(--card); border-left:1px solid var(--line);
  overflow-y:auto; scrollbar-gutter:stable }

.cols.midiendo { cursor:col-resize; user-select:none }
/* El tirador va sobre el panel (z-index mayor) y con una zona de agarre más ancha que su línea: 5px de
   línea se ven bien y se agarran mal. */
.tirador { position:absolute; top:0; bottom:0; width:11px; margin-right:-3px; z-index:3;
  cursor:col-resize; background:transparent; display:flex; justify-content:center }
.tirador::before { content:''; width:5px; background:var(--line); transition:background .12s }
.tirador:hover::before, .cols.midiendo .tirador::before { background:var(--info) }
@media (max-width:860px) { .cols { grid-template-columns:1fr } }
</style>
