<script setup>
import { computed } from 'vue'
import { persona, pulso, dias } from '../datos.js'

/* El header. Una sola pregunta: ¿hay algo trabado ahora mismo?
   No es un resumen bonito — es el renglón por el que alguien abre esto a media mañana. Por eso lo
   que manda es la rama que MÁS lleva esperando, con nombre y apellido, y no un promedio. */
const p = computed(() => pulso())
</script>

<template>
  <header class="pulso">
    <RouterLink v-if="p.vieja" to="/revision" class="titular trabado">
      <span class="ico">⏳</span>
      <span class="txt">
        Lo más viejo esperando aprobación: <b>{{ dias(p.vieja.dias) }}</b> —
        <span class="mono">{{ p.vieja.rama }}</span>
        <span class="quien">{{ persona(p.vieja.autor).nombre.split(' ')[0] }}, {{ p.vieja.epica.nombre }}</span>
      </span>
    </RouterLink>
    <span v-else-if="p.total" class="titular limpio">
      <span class="ico">✓</span>
      <span class="txt">Nada esperando aprobación. Todo está en desarrollo o mergeado.</span>
    </span>
    <span v-else class="titular vacio">
      <span class="txt">Todavía no hay ramas en ninguna épica.</span>
    </span>

    <div class="cifras">
      <RouterLink to="/revision" class="cifra aprobacion" title="ramas con PR esperando aprobación">
        <b>{{ p.aprobacion }}</b> por aprobación
      </RouterLink>
      <span class="cifra"><b>{{ p.desarrollo }}</b> en desarrollo</span>
      <span class="cifra ok"><b>{{ p.mergeada }}</b> {{ p.mergeada === 1 ? 'mergeada' : 'mergeadas' }}</span>
    </div>
  </header>
</template>

<style scoped>
/* Sin caja: una banda con una línea abajo. El header no compite con el contenido, lo antecede. */
.pulso{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap;
  border-bottom:1px solid var(--line);padding:0 0 14px}
.titular{display:flex;align-items:baseline;gap:8px;min-width:0;flex:1 1 320px;
  font-size:12.5px;line-height:1.55;text-decoration:none;color:var(--page-soft)}
.titular .ico{flex:0 0 auto;font-size:11px}
.titular.trabado b{color:var(--warn);font-weight:500}
.titular.trabado .mono{color:var(--page-ink)}
.titular.trabado:hover .mono{text-decoration:underline}
.titular.limpio{color:var(--ok)}
.quien{color:var(--page-tenue);font-size:12px;margin-left:7px}

.cifras{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-left:auto}
.cifra{font-size:12.5px;color:var(--page-soft);white-space:nowrap;text-decoration:none;
  display:inline-flex;align-items:center;gap:6px}
/* El punto de estado, igual que en los badges: color solo para decir qué es, no para decorar. */
.cifra::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--page-tenue);
  flex:0 0 auto}
.cifra b{color:var(--page-ink);font-weight:500}
.cifra.aprobacion::before{background:var(--warn)}
.cifra.aprobacion:hover{color:var(--page-ink)}
.cifra.ok::before{background:var(--ok)}
</style>
