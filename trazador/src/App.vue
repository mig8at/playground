<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTrazador } from './stores/trazador'
import { trazaATexto } from './trazaTexto'
import Buscador from './components/Buscador.vue'
import Historia from './components/Historia.vue'
import Etapas from './components/Etapas.vue'
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

const vista = ref(localStorage.getItem('trazador.vista') || 'lista')
watch(vista, (v) => localStorage.setItem('trazador.vista', v))

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
      <span class="vistas" role="group" aria-label="Cómo ver el recorrido">
        <button :class="{ on: vista === 'lista' }" @click="vista = 'lista'"
                title="Las etapas como un run de CI: hora, salto y sub-pasos al abrir">lista</button>
        <button :class="{ on: vista === 'mapa' }" @click="vista = 'mapa'"
                title="El recorrido como grafo: el carril que tomó, dónde se cortó y cuánto faltaba">mapa</button>
      </span>
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

  <div class="cols" :class="{ ancha: vista === 'mapa' }">
    <Etapas v-if="vista === 'lista'" />
    <Mapa v-else />
    <Detalle />
  </div>
</template>

<style scoped>
header { padding:16px 20px; border-bottom:1px solid var(--line) }
.fila1 { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px }
h1 { font-size:18px; margin:0; font-weight:600 }
.ureq { color:var(--dim); font-size:13px }
.vistas { margin-left:auto; display:flex; border:1px solid var(--line); border-radius:6px; overflow:hidden }
.vistas button { padding:4px 11px; font-size:12px; border:0; background:var(--panel); color:var(--dim); cursor:pointer }
.vistas button + button { border-left:1px solid var(--line) }
.vistas button:hover { color:var(--txt) }
.vistas button.on { background:var(--sel); color:var(--accent) }
.copiar { margin-left:10px; padding:4px 12px; font-size:12px; border:1px solid var(--line);
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
.cols { display:grid; grid-template-columns:290px minmax(0,1fr); min-height:60vh }
/* ⚠ EL MAPA NO VA EN UNA COLUMNA, va en una BANDA. Es horizontal —tronco a lo largo y un carril por
   ramal— así que en los 470px de una columna lateral entraba entero pero ilegible: el encuadre lo
   achicaba hasta que los nombres no se leían. Con la vista `mapa` el grid pasa a DOS FILAS, igual que
   el mapa del harness, que también ocupa el ancho completo de su panel. La lista sigue en columna:
   es vertical y ahí sí conviene tenerla al lado del detalle. */
.cols.ancha { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr) }
@media (max-width:860px) { .cols { grid-template-columns:1fr } }
</style>
