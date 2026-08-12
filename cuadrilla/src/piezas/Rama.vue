<script setup>
import { computed } from 'vue'
import { ESTADOS, dias } from '../datos.js'

defineEmits(['quitar'])

const props = defineProps({
  r:    { type: Object, required: true },
  base: { type: String, default: '' },   // la rama base de la épica, para detectar divergencias
})

const e = computed(() => ESTADOS[props.r.estado])
// El mismo número de días significa otra cosa en cada estado, así que se dice con todas las letras.
const cuando = computed(() => (props.r.dias === 0 ? 'creada hoy' : `${e.value.verbo} ${dias(props.r.dias)}`))
// Una rama esperando aprobación hace mucho es lo único que esta pantalla marca en naranja.
const trabada = computed(() => props.r.estado === 'aprobacion' && props.r.dias >= 4)
// Salió de otra base que el resto de la épica: no es un error, pero hay que verlo.
const desviada = computed(() => props.base && props.r.base && props.r.base !== props.base)
</script>

<template>
  <li class="rama" :class="{ trabada, nueva: r.nueva }">
    <div class="linea">
      <span class="nom mono">{{ r.rama }}</span>
      <span class="repo mono">{{ r.repo }}</span>
      <span v-if="r.pr" class="pr mono">#{{ r.pr }}</span>
      <span v-else class="pr sinpr">sin PR</span>
      <span class="badge" :class="r.estado">{{ e.etiqueta }}</span>
      <span class="cuando">{{ cuando }}</span>
      <span v-if="desviada" class="desvio mono" :title="`El resto de la épica sale de ${base}`">
        ↰ desde {{ r.base }}
      </span>
      <span v-if="r.mas || r.men" class="diff mono">
        <i class="mas">+{{ r.mas }}</i> <i class="men">−{{ r.men }}</i>
      </span>
      <!-- Aparece al pasar por encima: sacar una rama es raro y no tiene que competir con el dato. -->
      <button class="quitar" title="sacar de la épica" @click="$emit('quitar')">×</button>
    </div>
    <p v-if="r.nota" class="nota">{{ r.nota }}</p>
  </li>
</template>

<style scoped>
/* Filas de una tabla, no tarjetitas sueltas: el <ul> padre pinta el borde y el hueco de 1px entre
   filas, así que acá el fondo es plano y sin radio. Se lee como una lista, que es lo que es. */
.rama{padding:9px 12px;background:var(--panel)}
.rama:hover{background:var(--panel-2)}
.rama.trabada{box-shadow:inset 2px 0 0 var(--warn)}
.rama.nueva{animation:entra .35s cubic-bezier(.2,.9,.3,1.1)}
@keyframes entra{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}

.linea{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px}
.nom{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  max-width:34ch}
.repo{font-size:11.5px;color:var(--page-tenue)}
.pr{font-size:11.5px;color:var(--page-tenue)}
.pr.sinpr{font-family:inherit;opacity:.8}
.cuando{font-size:11.5px;color:var(--page-tenue)}
.trabada .cuando{color:var(--warn)}
.desvio{font-size:11px;color:var(--contract);border:1px solid currentColor;
  padding:0 6px;border-radius:4px;opacity:.9}
.diff{font-size:11px;margin-left:auto;white-space:nowrap;color:var(--page-tenue)}
.diff .mas{color:var(--ok)}
.diff .men{color:var(--bad)}

/* En qué va a trabajar. Va debajo y en redonda: es prosa, no metadato. */
.nota{margin:4px 0 0;font-size:12px;color:var(--page-tenue);line-height:1.45;padding-left:1px}
.nota::before{content:"↳ ";opacity:.55}
.quitar{background:none;border:none;color:var(--page-tenue);cursor:pointer;font-size:15px;
  line-height:1;padding:0 3px;border-radius:4px;opacity:0;transition:opacity .12s,color .12s}
.rama:hover .quitar{opacity:1}
.quitar:hover{color:var(--bad);background:var(--soft-bg2)}
.diff{margin-left:auto}
</style>
