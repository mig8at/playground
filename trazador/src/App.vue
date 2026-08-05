<script setup>
import { onMounted } from 'vue'
import { useTrazador } from './stores/trazador'
import Buscador from './components/Buscador.vue'
import Historia from './components/Historia.vue'
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
.meta { color:var(--dim); font-size:13px; margin:10px 0 0 }
.err { color:var(--fail); font-size:13px; margin:10px 0 0 }
.cols { display:grid; grid-template-columns:290px minmax(0,1fr); min-height:60vh }
@media (max-width:860px) { .cols { grid-template-columns:1fr } }
</style>
