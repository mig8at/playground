<script setup>
/* El globo con la traducción. Posición `fixed` calculada a mano y no un tooltip de CSS: dentro de
   una columna con scroll, un tooltip absoluto se recorta contra el borde justo en la última línea
   del párrafo, que es donde más se necesita. */
import { computed } from 'vue'
import { decir, hayVoz } from '../voz.js'
import { veces, sabida, alternarSabida } from '../memoria.js'

const props = defineProps({ globo: Object })

const ETIQUETA = {
  core: 'una de las 100',
  nueva: 'palabra nueva',
  frase: 'phrasal verb / expresión',
  sentido: 'acá significa otra cosa',
}

const mirada = computed(() => veces(props.globo?.clave))
const esSabida = computed(() => sabida(props.globo?.clave))
const estilo = computed(() => ({
  left: `${props.globo.x}px`,
  top: `${props.globo.y}px`,
  transform: `translate(-50%, ${props.globo.arriba ? '-100%' : '0'})`,
}))
</script>

<template>
  <div v-if="globo" class="globo" :class="{ abajo: !globo.arriba }" :style="estilo" role="tooltip">
    <div class="cab">
      <span class="en">{{ globo.entrada.en }}</span>
      <button v-if="hayVoz()" class="son" title="Escucharla" @click.stop="decir(globo.entrada.en)">♪</button>
      <span class="tipo" :data-tipo="globo.entrada.tipo">{{ ETIQUETA[globo.entrada.tipo] }}</span>
    </div>

    <div class="es">{{ globo.entrada.es }}</div>
    <div v-if="globo.entrada.nota" class="nota">{{ globo.entrada.nota }}</div>

    <div class="pie">
      <span v-if="mirada > 1" class="tenue">la miraste {{ mirada }} veces</span>
      <span v-else class="tenue">primera vez</span>
      <button class="se" :aria-pressed="esSabida" @click.stop="alternarSabida(globo.clave)">
        {{ esSabida ? '✓ ya la sé' : 'ya la sé' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.globo{position:fixed;z-index:50;max-width:320px;min-width:170px;
  background:var(--panel);border:1px solid var(--line-fuerte);border-radius:8px;
  padding:9px 11px 8px;pointer-events:auto;
  /* La única sombra de la herramienta. Se la gana: flota sobre el texto y sin ella se confunde. */
  box-shadow:0 6px 24px rgba(0,0,0,.13);margin-top:-8px}
.globo.abajo{margin-top:8px}

.cab{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px}
.en{font-weight:600;font-size:13.5px;letter-spacing:-.01em}
.son{border:0;background:none;color:var(--page-tenue);cursor:pointer;font-size:14px;padding:0 2px;
  line-height:1;transition:color .15s}
.son:hover{color:var(--accent)}
.tipo{font-size:10.5px;letter-spacing:.02em;color:var(--page-tenue);margin-left:auto}
.tipo[data-tipo="nueva"]{color:var(--nueva)}
.tipo[data-tipo="frase"]{color:var(--frase)}
.tipo[data-tipo="sentido"]{color:var(--sentido)}

.es{font-size:14px;line-height:1.45}
.nota{margin-top:6px;padding-top:6px;border-top:1px solid var(--line);
  font-size:12.5px;line-height:1.5;color:var(--page-soft)}

.pie{display:flex;align-items:center;justify-content:space-between;gap:10px;
  margin-top:7px;padding-top:6px;border-top:1px solid var(--line);font-size:11.5px}
.se{border:0;background:none;padding:0;cursor:pointer;font:inherit;font-size:11.5px;
  color:var(--page-tenue);transition:color .15s}
.se:hover{color:var(--page-ink)}
.se[aria-pressed="true"]{color:var(--sentido)}
</style>
