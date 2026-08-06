<script setup>
import { onMounted, ref } from 'vue'
import { useTrazador } from './stores/trazador'
import { trazaATexto } from './trazaTexto'
import Buscador from './components/Buscador.vue'
import Historia from './components/Historia.vue'
import Etapas from './components/Etapas.vue'
import Detalle from './components/Detalle.vue'

const t = useTrazador()
// El mapa primero y solo: no toca ninguna fuente, así que el árbol se dibuja al instante y la app no
// arranca en blanco esperando a Redash. Después se mira la URL: si trae `?ureq=`, se rearma esa traza.
onMounted(async () => {
  await t.cargarMapa()
  t.desdeURL()
})

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
  </header>

  <!-- La historia de la persona: sus solicitudes como chips por día. Reemplaza la lista vertical de
       botones anchos, que con 40 intentos empujaba el árbol de etapas fuera de la pantalla. -->
  <Historia />

  <div class="cols">
    <Etapas />
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
.cols { display:grid; grid-template-columns:290px minmax(0,1fr); min-height:60vh }
@media (max-width:860px) { .cols { grid-template-columns:1fr } }
</style>
