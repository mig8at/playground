<script setup>
// El sidebar: las 8 etapas del flujo declarado, siempre las mismas.
//
// Se dibujan desde el MAPA, no desde la traza. Así el árbol existe antes de consultar (en gris) y las
// etapas se van encendiendo — que es lo que hace que la vista no se sienta como un spinner mientras Redash
// hace su cola. Y el hexágono `?` no es decoración: marca las etapas que la BD no puede probar, donde una
// ausencia NO significa «no ocurrió».
import { useTrazador } from '../stores/trazador'
const t = useTrazador()
const GLIFO = { ok:'✓', warn:'!', fail:'✕', skip:'·', 'sin-evidencia':'?', 'sin-registro':'~', pendiente:'·' }
</script>

<template>
  <aside>
    <h2>Etapas del flujo</h2>
    <ul>
      <li v-for="e in t.etapas" :key="e.id"
          :class="{ act: e.id === t.etapaActiva?.id }"
          @click="t.seleccionar(e.id)">
        <span class="ico" :class="e.estado">{{ GLIFO[e.estado] || '·' }}</span>
        <span class="n">{{ e.label }}</span>
        <span class="t">{{ e.vivo?.at || '' }}</span>
      </li>
    </ul>

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
li { display:flex; align-items:center; gap:9px; padding:7px 16px; cursor:pointer;
  border-left:2px solid transparent; font-size:13px }
li:hover { background:var(--sel) }
li.act { background:var(--sel); border-left-color:var(--accent); font-weight:600 }
.n { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.t { color:var(--dim); font-size:11px; font-variant-numeric:tabular-nums }
.det { margin-top:16px; padding:13px 16px 0; border-top:1px solid var(--line);
  font-size:12px; color:var(--dim); line-height:1.7 }
.det b { color:var(--txt); font-weight:600 }
.aviso { color:var(--warn); margin:5px 0; line-height:1.45 }
</style>
