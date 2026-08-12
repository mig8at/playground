<script setup>
import { computed } from 'vue'
import { persona, pulso, represamiento, represadoPorPersona, dias } from '../datos.js'
import Avatar from './Avatar.vue'

/* Reemplaza al párrafo de descargo que había acá. Tres lecturas y ninguna decorativa:
   qué forma tiene el trabajo, cuánto lleva represado lo que espera, y en quién se acumula.
   Todo sale de las mismas ramas — cero datos aparte. */
const p = computed(() => pulso())
const rep = computed(() => represamiento())
const gente = computed(() => represadoPorPersona())

// Anchos del reparto. Con 0 ramas no se dibuja nada, así no queda una barra fantasma al 100%.
const trozo = n => (p.value.total ? `${(n / p.value.total) * 100}%` : '0%')
</script>

<template>
  <section class="resumen">
    <!-- ── qué forma tiene el trabajo ──────────────────────────────────────────────────────── -->
    <article class="panel">
      <h2>Reparto del trabajo</h2>
      <div class="apilada" :title="`${p.total} ramas`">
        <span class="t aprobacion" :style="{ width: trozo(p.aprobacion) }"></span>
        <span class="t desarrollo" :style="{ width: trozo(p.desarrollo) }"></span>
        <span class="t mergeada"   :style="{ width: trozo(p.mergeada) }"></span>
      </div>
      <ul class="leyenda">
        <li><span class="badge aprobacion"><b>{{ p.aprobacion }}</b> por aprobación</span></li>
        <li><span class="badge desarrollo"><b>{{ p.desarrollo }}</b> en desarrollo</span></li>
        <li><span class="badge mergeada"><b>{{ p.mergeada }}</b> mergeadas</span></li>
      </ul>
    </article>

    <!-- ── cuánto lleva represado ──────────────────────────────────────────────────────────── -->
    <article class="panel">
      <h2>Represamiento <i>de lo que espera aprobación</i></h2>
      <ul class="barras">
        <li v-for="f in rep.filas" :key="f.rango" :class="{ apagada: !f.n }">
          <span class="rot">{{ f.rango }}</span>
          <span class="via"><i :class="f.nivel" :style="{ width: (f.n / rep.tope * 100) + '%' }"></i></span>
          <span class="n">{{ f.n }}</span>
        </li>
      </ul>
      <p v-if="!rep.total" class="nota-panel">No hay nada esperando aprobación.</p>
      <p v-else class="nota-panel">
        <b>{{ rep.filas.filter(f => f.min >= 4).reduce((a, f) => a + f.n, 0) }}</b>
        de {{ rep.total }} llevan 4 días o más.
      </p>
    </article>

    <!-- ── en quién se acumula ─────────────────────────────────────────────────────────────── -->
    <article class="panel">
      <h2>En quién se acumula</h2>
      <ul class="personas">
        <li v-for="f in gente.filas" :key="f.quien">
          <Avatar :quien="f.quien" :tam="20" />
          <span class="nom">{{ persona(f.quien).nombre.split(' ')[0] }}</span>
          <span class="via"><i class="malo" :style="{ width: (f.n / gente.tope * 100) + '%' }"></i></span>
          <span class="n">{{ f.n }}</span>
          <span class="d">{{ dias(f.masDias) }}</span>
        </li>
      </ul>
      <p v-if="!gente.filas.length" class="nota-panel">Nadie tiene nada esperando.</p>
    </article>
  </section>
</template>

<style scoped>
.resumen{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(268px,1fr))}
.panel{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:14px 15px;
  display:flex;flex-direction:column;gap:12px}
h2{font-size:12.5px;font-weight:500;margin:0;color:var(--page-ink)}
h2 i{font-style:normal;font-weight:400;color:var(--page-tenue);font-size:11.5px}
.nota-panel{margin:auto 0 0;font-size:11.5px;color:var(--page-tenue);line-height:1.5}
.nota-panel b{color:var(--warn);font-weight:500}

/* Una sola barra con los tres estados: la proporción se lee sin comparar números. */
.apilada{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--soft-bg2);gap:1px}
.t{display:block;height:100%}
.t.aprobacion{background:var(--warn)}
.t.desarrollo{background:var(--page-tenue)}
.t.mergeada{background:var(--ok)}
.leyenda{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.leyenda b{color:var(--page-ink);font-weight:500;margin-right:1px}

.barras,.personas{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.barras li{display:flex;align-items:center;gap:9px}
.barras .rot{font-size:11.5px;color:var(--page-soft);flex:0 0 84px}
.barras li.apagada .rot,.barras li.apagada .n{color:var(--page-tenue);opacity:.6}

/* La vía es el ancho común: sin un riel fijo, las barras no se comparan entre sí. */
.via{flex:1;height:6px;border-radius:3px;background:var(--soft-bg2);overflow:hidden;min-width:30px}
.via i{display:block;height:100%;border-radius:3px;transition:width .45s cubic-bezier(.4,0,.2,1)}
.via i.ok{background:var(--page-tenue)}
.via i.tibio{background:var(--page-soft)}
.via i.malo{background:var(--warn)}
.via i.peor{background:var(--bad)}
.n{font-size:12px;font-weight:500;color:var(--page-ink);min-width:16px;text-align:right}

.personas li{display:flex;align-items:center;gap:8px}
.personas .nom{font-size:12px;color:var(--page-soft);flex:0 0 54px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.personas .d{font-size:11px;color:var(--page-tenue);flex:0 0 auto;min-width:44px;text-align:right}
</style>
