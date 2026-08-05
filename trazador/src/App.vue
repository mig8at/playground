<script setup>
import { onMounted } from 'vue'
import { useTrazador } from './stores/trazador'
import Buscador from './components/Buscador.vue'
import Etapas from './components/Etapas.vue'
import Detalle from './components/Detalle.vue'

const t = useTrazador()
// El mapa primero y solo: no toca ninguna fuente, así que el árbol se dibuja al instante y la app no
// arranca en blanco esperando a Redash.
onMounted(() => t.cargarMapa())

const GLIFO = { aprobado:'✓', roto:'✕', abandonado:'!', 'en-curso':'·' }
const CLASE = { aprobado:'ok', roto:'fail', abandonado:'warn', 'en-curso':'skip' }
</script>

<template>
  <header>
    <div class="fila1">
      <h1>Trazador <span class="dim">· CreditOp</span></h1>
      <span v-if="t.traza" class="ico big" :class="CLASE[t.traza.outcome]">{{ GLIFO[t.traza.outcome] }}</span>
      <span v-if="t.traza" class="badge" :class="CLASE[t.traza.outcome]">{{ t.traza.outcome }}</span>
      <span v-if="t.traza" class="ureq">solicitud {{ t.traza.ureq }}</span>
      <span v-if="t.cargandoTraza" class="dim">armando la traza…</span>
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

  <!-- Varios intentos: hay que elegir. Un cliente puede tener hasta 228 solicitudes, así que adivinar
       cuál quería sería peor que preguntar. -->
  <div v-if="t.resultados?.items?.length > 1" class="intentos">
    <p class="dim">{{ t.resultados.items.length }} intentos — elegí uno:</p>
    <button v-for="i in t.resultados.items" :key="i.ureq"
            :class="['intento', i.desenlace, { act: t.traza?.ureq === i.ureq }]"
            @click="t.verTraza(i.ureq)">
      <b>{{ i.ureq }}</b>
      <span class="dim">{{ i.fecha }}</span>
      <span :class="CLASE[i.desenlace]">{{ i.estadoN }}</span>
      <span class="dim">{{ i.comercio }}</span>
      <span class="dim">{{ i.lender }}</span>
    </button>
  </div>

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
.meta { color:var(--dim); font-size:13px; margin:10px 0 0 }
.err { color:var(--fail); font-size:13px; margin:10px 0 0 }
.intentos { padding:12px 20px; border-bottom:1px solid var(--line); display:flex; flex-direction:column; gap:5px }
.intentos > p { margin:0 0 3px; font-size:12px }
.intento { display:flex; gap:12px; align-items:center; text-align:left; padding:6px 10px;
  border:1px solid var(--line); border-radius:6px; background:var(--panel); cursor:pointer; font-size:13px }
.intento:hover { background:var(--sel) }
.intento.act { border-color:var(--accent) }
.cols { display:grid; grid-template-columns:290px minmax(0,1fr); min-height:60vh }
@media (max-width:860px) { .cols { grid-template-columns:1fr } }
</style>
